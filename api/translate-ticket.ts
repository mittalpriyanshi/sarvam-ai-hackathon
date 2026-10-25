/**
 * POST /api/translate-ticket  — decode a ticket image or pasted text with Sarvam AI.
 * GET  /api/translate-ticket  — report whether the server has a Sarvam key configured.
 *
 * Uses Vercel's Web-standard handler signature (Request → Response). This bypasses
 * Vercel's Node "helpers", which pre-read the request body and break streaming
 * multipart parsers; request.formData() parses the upload natively.
 */

/* ------------------------------------------------------------------ */
/* Config                                                              */
/* ------------------------------------------------------------------ */

const SARVAM_BASE = 'https://api.sarvam.ai';
const CHAT_MODEL = 'sarvam-105b';
const MAX_FILE_BYTES = 4 * 1024 * 1024; // Vercel caps request bodies at 4.5 MB
const MAX_TEXT_CHARS = 8000;
const TOTAL_BUDGET_MS = 56_000; // vercel.json sets maxDuration to 60 s
const OCR_BUDGET_MS = 32_000;
const POLL_INTERVAL_MS = 1500;

// Output languages offered in the UI (Sarvam's 11 core languages).
const OUTPUT_LANGUAGES: Record<string, string> = {
  'en-IN': 'English',
  'hi-IN': 'Hindi',
  'bn-IN': 'Bengali',
  'gu-IN': 'Gujarati',
  'kn-IN': 'Kannada',
  'ml-IN': 'Malayalam',
  'mr-IN': 'Marathi',
  'od-IN': 'Odia',
  'pa-IN': 'Punjabi',
  'ta-IN': 'Tamil',
  'te-IN': 'Telugu',
};

// Ticket (source) languages passed to Sarvam Vision (BCP-47 codes).
const TICKET_LANGUAGES = new Set([
  'en-IN', 'hi-IN', 'bn-IN', 'gu-IN', 'kn-IN', 'ml-IN', 'mr-IN', 'pa-IN', 'ta-IN', 'te-IN', 'ur-IN',
]);

const FIELD_KEYS = [
  'travellerName', 'origin', 'destination', 'departureDate', 'departureTime',
  'arrivalDate', 'arrivalTime', 'trainOrBusNumber', 'ticketClass', 'seat', 'coach',
  'platform', 'bookingReference', 'bookingStatus', 'fare',
] as const;
type FieldKey = (typeof FIELD_KEYS)[number];

// Fields where a wrong value could make someone miss a train: must appear verbatim in the source.
const STRICT_FIELDS: FieldKey[] = [
  'departureTime', 'arrivalTime', 'seat', 'coach', 'platform', 'bookingReference', 'trainOrBusNumber',
];

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

function json(status: number, body: unknown, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extraHeaders },
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  if (ms <= 0) throw new HttpError(504, 'TIMEOUT', 'The request took too long. Please try again.');
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(ms) });
  } catch (e) {
    const name = (e as Error)?.name;
    if (name === 'TimeoutError' || name === 'AbortError') {
      throw new HttpError(504, 'TIMEOUT', 'Sarvam AI took too long to respond. Please try again.');
    }
    throw new HttpError(502, 'UPSTREAM_UNREACHABLE', 'Could not reach Sarvam AI. Please try again.');
  }
}

/** Pull a short, non-sensitive error description out of a Sarvam error body. */
async function upstreamDetail(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as any;
    const d = body?.detail ?? body?.error?.message ?? body?.title ?? body?.message;
    return typeof d === 'string' ? d.slice(0, 200) : '';
  } catch {
    return '';
  }
}

async function mapUpstream(res: Response, stage: string): Promise<HttpError> {
  const status = res.status;
  const detail = await upstreamDetail(res);
  console.error(`[sarvam:${stage}] status ${status}`);
  const suffix = detail ? ` (${detail})` : '';
  if (status === 401 || status === 403)
    return new HttpError(502, 'AUTH', `Sarvam AI rejected the server API key. Check SARVAM_API_KEY.${suffix}`);
  if (status === 402)
    return new HttpError(502, 'BILLING', `Your Sarvam account has no credits or access for ${stage}.${suffix}`);
  if (status === 429)
    return new HttpError(429, 'RATE_LIMIT', 'Sarvam AI rate limit reached. Wait a minute and retry.');
  if (status === 413)
    return new HttpError(413, 'FILE_TOO_LARGE', 'Sarvam AI says the image is too large.');
  if (status === 400 || status === 422)
    return new HttpError(422, 'UPSTREAM_REJECTED', `Sarvam AI could not process this ticket during ${stage}.${suffix}`);
  return new HttpError(502, 'UPSTREAM_ERROR', `Sarvam AI returned an error during ${stage}. Please retry.`);
}

function isJpeg(b: Uint8Array) {
  return b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
}
function isPng(b: Uint8Array) {
  return b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
}

/* ------------------------------------------------------------------ */
/* Sarvam Vision (Document AI → Digitise)                             */
/*   POST /doc-ai/v1/job/digitise          → { job_id, status }        */
/*   GET  /doc-ai/v1/job/{id}/status       → { status }                */
/*   GET  /doc-ai/v1/job/{id}/results?format=md                        */
/*        → { documents: [{ pages: [{ page_number, content }] }] }     */
/* ------------------------------------------------------------------ */

const TERMINAL = new Set(['completed', 'partially_completed', 'failed', 'rejected']);

async function digitiseImage(apiKey: string, img: { bytes: Uint8Array; mime: string }, language: string, deadline: number): Promise<string> {
  const ext = img.mime === 'image/png' ? 'png' : 'jpg';
  const form = new FormData();
  form.append('file', new Blob([img.bytes as BlobPart], { type: img.mime }), `ticket.${ext}`);
  form.append('language', language);

  const headers = { 'api-subscription-key': apiKey };
  const ocrDeadline = Math.min(deadline, Date.now() + OCR_BUDGET_MS);

  const created = await fetchWithTimeout(`${SARVAM_BASE}/doc-ai/v1/job/digitise`, { method: 'POST', headers, body: form }, ocrDeadline - Date.now());
  if (!created.ok) throw await mapUpstream(created, 'image reading');
  const job = (await created.json()) as { job_id?: string; status?: string };
  if (!job.job_id) throw new HttpError(502, 'UPSTREAM_ERROR', 'Sarvam AI did not return a job id.');
  const jobUrl = `${SARVAM_BASE}/doc-ai/v1/job/${encodeURIComponent(job.job_id)}`;

  // Poll until the job reaches a terminal status.
  let status = String(job.status || '').toLowerCase();
  while (!TERMINAL.has(status)) {
    if (Date.now() + POLL_INTERVAL_MS >= ocrDeadline)
      throw new HttpError(504, 'TIMEOUT', 'Reading the image took too long. Try again or paste the text.');
    await sleep(POLL_INTERVAL_MS);
    const st = await fetchWithTimeout(`${jobUrl}/status`, { headers }, ocrDeadline - Date.now());
    if (!st.ok) throw await mapUpstream(st, 'image reading');
    status = String(((await st.json()) as { status?: string }).status || '').toLowerCase();
  }
  if (status === 'failed' || status === 'rejected')
    throw new HttpError(422, 'OCR_FAILED', 'Sarvam Vision could not read this image. Try a clearer photo or paste the text.');

  const resultsRes = await fetchWithTimeout(`${jobUrl}/results?format=md`, { headers }, deadline - Date.now());
  if (!resultsRes.ok) throw await mapUpstream(resultsRes, 'image reading');
  const results = (await resultsRes.json()) as { documents?: { pages?: { page_number?: number; content?: unknown }[] }[] };

  const pages = (results.documents ?? []).flatMap((d) => d.pages ?? []);
  pages.sort((a, b) => (a.page_number ?? 0) - (b.page_number ?? 0));
  const text = pages
    .map((p) => (typeof p.content === 'string' ? p.content : p.content ? JSON.stringify(p.content) : ''))
    .join('\n\n')
    .trim();

  if (!text) throw new HttpError(422, 'OCR_EMPTY', 'No readable text was found on this image. Try a sharper photo or paste the text.');
  return text.slice(0, MAX_TEXT_CHARS);
}

/* ------------------------------------------------------------------ */
/* Sarvam LLM (chat completions)                                      */
/* ------------------------------------------------------------------ */

function buildPrompt(targetLanguage: string) {
  return `You are Ticket Translator. You read the raw text of ONE travel ticket (train, bus, flight or event) and help a traveller understand it.

Write every explanation, note, instruction, checklist item, translation and the summary in ${targetLanguage}.
Copy field "value"s EXACTLY as printed on the ticket (same characters, numbers and script). Do not reformat dates or times.

STRICT RULES
- Never invent, guess or "fill in" details. If something is not printed on the ticket, its value is null.
- importantInstructions: only instructions actually printed on the ticket (translated). Never add generic advice there.
- checklist: short actions for the traveller. basis="ticket" if the action comes directly from ticket text; basis="suggestion" for general good practice you are inferring.
- abbreviations: explain codes/abbreviations that appear on the ticket (e.g. PNR, CNF, RAC, WL, 3A, SL, GN) — only ones actually present.
- uncertainFields: field keys or short labels for anything blurry, cut off, ambiguous or contradictory.
- translation: up to 12 important original lines/phrases from the ticket with their translation into ${targetLanguage}.

Return ONLY a JSON object, no markdown, with exactly this shape:
{
  "ticketType": "train" | "bus" | "flight" | "event" | "unknown",
  "sourceLanguage": "<language(s) the ticket is written in>",
  "fields": {
    ${FIELD_KEYS.map((k) => `"${k}": { "value": string | null, "note": string | null }`).join(',\n    ')}
  },
  "abbreviations": [{ "term": string, "meaning": string }],
  "importantInstructions": [string],
  "checklist": [{ "item": string, "basis": "ticket" | "suggestion" }],
  "translation": [{ "original": string, "translated": string }],
  "uncertainFields": [string],
  "summary": "<2-4 sentence plain-language summary in ${targetLanguage}>",
  "spokenScript": "<what a helpful friend would SAY aloud in ${targetLanguage}, max 900 characters>"
}
"note" is a short plain-language explanation in ${targetLanguage} (e.g. what a class code means), or null.
"spokenScript" will be read aloud by text-to-speech: natural spoken ${targetLanguage}, no symbols, bullets, markdown or emojis.
Cover where and when they travel, train/bus number, coach and seat, booking status, then the most important things to do.
Write times in words people say (e.g. "8:05 in the evening"), read codes letter by letter, and only use facts present on the ticket.`;
}

function extractJson(content: string): unknown {
  let s = content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  try {
    return JSON.parse(s);
  } catch {
    const start = s.indexOf('{');
    const end = s.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(s.slice(start, end + 1));
      } catch {
        /* fall through */
      }
    }
  }
  return null;
}

async function callChat(apiKey: string, body: Record<string, unknown>, deadline: number) {
  return fetchWithTimeout(
    `${SARVAM_BASE}/v1/chat/completions`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'api-subscription-key': apiKey,
      },
      body: JSON.stringify(body),
    },
    deadline - Date.now(),
  );
}

async function explainTicket(apiKey: string, ticketText: string, targetLanguage: string, deadline: number): Promise<unknown> {
  const body: Record<string, unknown> = {
    model: CHAT_MODEL,
    messages: [
      { role: 'system', content: buildPrompt(targetLanguage) },
      { role: 'user', content: `TICKET TEXT (verbatim):\n"""\n${ticketText}\n"""` },
    ],
    temperature: 0.1,
    max_tokens: 4096,
    // Reasoning is on by default and its tokens count against max_tokens; null disables it.
    reasoning_effort: null,
    response_format: { type: 'json_object' },
  };

  let res = await callChat(apiKey, body, deadline);
  // If the model/plan rejects JSON mode, retry once without it (the prompt already demands JSON only).
  if (res.status === 400 || res.status === 422) {
    console.error(`[sarvam:translation] status ${res.status}, retrying without response_format`);
    delete body.response_format;
    res = await callChat(apiKey, body, deadline);
  }
  if (!res.ok) throw await mapUpstream(res, 'translation');

  const data = (await res.json()) as { choices?: { message?: { content?: string | null }; finish_reason?: string }[] };
  const choice = data.choices?.[0];
  const content = choice?.message?.content;
  if (!content) throw new HttpError(502, 'MALFORMED_AI_OUTPUT', 'The AI returned an empty answer. Please retry.');
  const parsed = extractJson(content);
  if (!parsed || typeof parsed !== 'object') {
    const cut = choice?.finish_reason === 'length' ? ' It was cut off before finishing.' : '';
    throw new HttpError(502, 'MALFORMED_AI_OUTPUT', `The AI answer was not valid JSON.${cut} Please retry.`);
  }
  return parsed;
}

/* ------------------------------------------------------------------ */
/* Output validation                                                   */
/* ------------------------------------------------------------------ */

const str = (v: unknown, max = 500): string | null => {
  if (typeof v === 'number') v = String(v);
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (!t || /^(null|n\/a|na|not found.*|unknown|-|none)$/i.test(t)) return null;
  return t.slice(0, max);
};
const arr = (v: unknown, max = 20): unknown[] => (Array.isArray(v) ? v.slice(0, max) : []);
const norm = (s: string) => s.toLowerCase().replace(/[\s\-_/.,:|*]+/g, '');

function validate(raw: any, sourceText: string) {
  const types = ['train', 'bus', 'flight', 'event', 'unknown'];
  const normalizedSource = norm(sourceText);

  const fields = {} as Record<FieldKey, { value: string | null; note: string | null }>;
  const uncertain = new Set<string>(arr(raw?.uncertainFields).map((x) => str(x, 80)).filter(Boolean) as string[]);

  for (const k of FIELD_KEYS) {
    const f = raw?.fields?.[k];
    const isObj = typeof f === 'object' && f !== null;
    let value = str(isObj ? f.value : f, 200);
    const note = isObj ? str(f.note, 300) : null;
    // Guard against invented values: strict fields must appear in the ticket text.
    if (value && STRICT_FIELDS.includes(k)) {
      const nv = norm(value);
      if (!nv || !normalizedSource.includes(nv)) {
        value = null;
        uncertain.add(k);
      }
    }
    fields[k] = { value, note: value ? note : null };
  }

  return {
    ticketType: types.includes(raw?.ticketType) ? raw.ticketType : 'unknown',
    sourceLanguage: str(raw?.sourceLanguage, 60) ?? 'unknown',
    fields,
    abbreviations: arr(raw?.abbreviations, 15)
      .map((a: any) => ({ term: str(a?.term, 30), meaning: str(a?.meaning, 200) }))
      .filter((a) => a.term && a.meaning && normalizedSource.includes(norm(a.term!))),
    importantInstructions: arr(raw?.importantInstructions, 12).map((x) => str(x, 400)).filter(Boolean) as string[],
    checklist: arr(raw?.checklist, 12)
      .map((c: any) => ({
        item: str(typeof c === 'string' ? c : c?.item, 300),
        basis: c?.basis === 'ticket' ? 'ticket' : 'suggestion',
      }))
      .filter((c) => c.item),
    translation: arr(raw?.translation, 15)
      .map((t: any) => ({ original: str(t?.original, 400), translated: str(t?.translated, 400) }))
      .filter((t) => t.original && t.translated),
    uncertainFields: [...uncertain],
    summary: str(raw?.summary, 1200) ?? '',
    spokenScript: str(raw?.spokenScript, 2000) ?? '',
  };
}

/* ------------------------------------------------------------------ */
/* Handlers                                                            */
/* ------------------------------------------------------------------ */

const apiKey = () => process.env.SARVAM_API_KEY?.trim() || '';

export function GET(): Response {
  return json(200, { configured: Boolean(apiKey()), outputLanguages: OUTPUT_LANGUAGES });
}

export async function POST(request: Request): Promise<Response> {
  const deadline = Date.now() + TOTAL_BUDGET_MS;
  try {
    const ct = request.headers.get('content-type') || '';
    if (!ct.toLowerCase().startsWith('multipart/form-data'))
      throw new HttpError(415, 'BAD_CONTENT_TYPE', 'Send the ticket as multipart/form-data.');
    const declared = Number(request.headers.get('content-length') || 0);
    if (declared > MAX_FILE_BYTES + 256 * 1024) throw new HttpError(413, 'FILE_TOO_LARGE', 'Image is larger than 4 MB.');

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      throw new HttpError(400, 'BAD_FORM', 'Malformed upload.');
    }

    const field = (name: string) => {
      const v = form.get(name);
      return typeof v === 'string' ? v : '';
    };
    const targetCode = field('targetLanguage');
    const ticketLang = field('ticketLanguage') || 'en-IN';
    const pasted = field('text').trim();
    const fileEntry = form.get('file');
    const file = fileEntry && typeof fileEntry !== 'string' ? (fileEntry as Blob) : null;

    if (!OUTPUT_LANGUAGES[targetCode]) throw new HttpError(400, 'BAD_LANGUAGE', 'Unsupported target language.');
    if (!TICKET_LANGUAGES.has(ticketLang)) throw new HttpError(400, 'BAD_LANGUAGE', 'Unsupported ticket language.');
    if (!file && !pasted) throw new HttpError(400, 'NO_INPUT', 'Upload a ticket image or paste the ticket text.');
    if (pasted.length > MAX_TEXT_CHARS) throw new HttpError(413, 'TEXT_TOO_LONG', `Pasted text is over ${MAX_TEXT_CHARS} characters.`);

    let image: { bytes: Uint8Array; mime: string } | null = null;
    if (file) {
      if (file.size === 0) throw new HttpError(400, 'EMPTY_FILE', 'The uploaded file is empty.');
      if (file.size > MAX_FILE_BYTES) throw new HttpError(413, 'FILE_TOO_LARGE', 'Image is larger than 4 MB.');
      const bytes = new Uint8Array(await file.arrayBuffer());
      const mime = isJpeg(bytes) ? 'image/jpeg' : isPng(bytes) ? 'image/png' : '';
      if (!mime) throw new HttpError(415, 'BAD_FILE_TYPE', 'Upload a JPG, PNG or WEBP image.');
      image = { bytes, mime };
    }

    const key = apiKey();
    if (!key) throw new HttpError(503, 'NOT_CONFIGURED', 'Live decoding is not configured on this server yet. Try the sample ticket.');

    const sourceText = image ? await digitiseImage(key, image, ticketLang, deadline) : pasted;
    const raw = await explainTicket(key, sourceText, OUTPUT_LANGUAGES[targetCode], deadline);
    const result = validate(raw, sourceText);

    return json(200, {
      success: true,
      mode: 'live',
      input: image ? 'image' : 'text',
      targetLanguage: OUTPUT_LANGUAGES[targetCode],
      targetLanguageCode: targetCode,
      sourceText,
      ...result,
    });
  } catch (e) {
    if (e instanceof HttpError) return json(e.status, { success: false, code: e.code, error: e.message });
    console.error('[translate-ticket] unexpected error', (e as Error)?.name);
    return json(500, { success: false, code: 'INTERNAL', error: 'Something went wrong. Please try again.' });
  }
}

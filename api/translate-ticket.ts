import type { IncomingMessage, ServerResponse } from 'node:http';
import busboy from 'busboy';
import { unzipSync, strFromU8 } from 'fflate';

/* ------------------------------------------------------------------ */
/* Config                                                              */
/* ------------------------------------------------------------------ */

const SARVAM_BASE = 'https://api.sarvam.ai';
const CHAT_MODEL = 'sarvam-105b';
const MAX_FILE_BYTES = 4 * 1024 * 1024; // Vercel caps request bodies at 4.5 MB
const MAX_TEXT_CHARS = 8000;
const TOTAL_BUDGET_MS = 56_000; // function maxDuration is 60 s
const OCR_BUDGET_MS = 30_000;
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

// Ticket (source) languages passed to Sarvam Vision / Document AI.
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

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function fail(res: ServerResponse, status: number, code: string, error: string) {
  send(res, status, { success: false, code, error });
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

function mapUpstream(status: number, stage: string): HttpError {
  if (status === 401 || status === 403)
    return new HttpError(502, 'AUTH', 'Sarvam AI rejected the server API key. Check SARVAM_API_KEY.');
  if (status === 429)
    return new HttpError(429, 'RATE_LIMIT', 'Sarvam AI rate limit reached. Wait a minute and retry.');
  if (status === 400 || status === 422)
    return new HttpError(422, 'UPSTREAM_REJECTED', `Sarvam AI could not process this ticket (${stage}).`);
  return new HttpError(502, 'UPSTREAM_ERROR', `Sarvam AI returned an error during ${stage}. Please retry.`);
}

function isJpeg(b: Buffer) {
  return b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
}
function isPng(b: Buffer) {
  return b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
}

/* ------------------------------------------------------------------ */
/* Multipart parsing                                                   */
/* ------------------------------------------------------------------ */

interface ParsedForm {
  fields: Record<string, string>;
  file?: { buffer: Buffer; mime: string };
}

function parseMultipart(req: IncomingMessage): Promise<ParsedForm> {
  return new Promise((resolve, reject) => {
    const ct = req.headers['content-type'] || '';
    if (!ct.includes('multipart/form-data')) {
      reject(new HttpError(415, 'BAD_CONTENT_TYPE', 'Send the ticket as multipart/form-data.'));
      return;
    }
    let bb: busboy.Busboy;
    try {
      bb = busboy({ headers: req.headers, limits: { fileSize: MAX_FILE_BYTES, files: 1, fields: 10, fieldSize: 64 * 1024 } });
    } catch {
      reject(new HttpError(400, 'BAD_FORM', 'Malformed upload.'));
      return;
    }
    const fields: Record<string, string> = {};
    let file: ParsedForm['file'];
    let tooBig = false;

    bb.on('field', (name, val) => {
      fields[name] = val;
    });
    bb.on('file', (name, stream, info) => {
      const chunks: Buffer[] = [];
      stream.on('data', (d: Buffer) => chunks.push(d));
      stream.on('limit', () => {
        tooBig = true;
      });
      stream.on('end', () => {
        if (name === 'file' && !tooBig) file = { buffer: Buffer.concat(chunks), mime: info.mimeType };
      });
    });
    bb.on('error', () => reject(new HttpError(400, 'BAD_FORM', 'Malformed upload.')));
    bb.on('close', () => {
      if (tooBig) reject(new HttpError(413, 'FILE_TOO_LARGE', 'Image is larger than 4 MB.'));
      else resolve({ fields, file });
    });
    req.pipe(bb);
  });
}

/* ------------------------------------------------------------------ */
/* Sarvam Vision (Document AI → Digitise)                             */
/* ------------------------------------------------------------------ */

async function digitiseImage(apiKey: string, img: { buffer: Buffer; mime: string }, language: string, deadline: number): Promise<string> {
  const ext = img.mime === 'image/png' ? 'png' : 'jpg';
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(img.buffer)], { type: img.mime }), `ticket.${ext}`);
  form.append('language', language);
  form.append('output_format', 'md');

  const headers = { 'api-subscription-key': apiKey };
  const ocrDeadline = Math.min(deadline, Date.now() + OCR_BUDGET_MS);

  const created = await fetchWithTimeout(`${SARVAM_BASE}/doc-ai/v1/job/digitise`, { method: 'POST', headers, body: form }, ocrDeadline - Date.now());
  if (!created.ok) {
    console.error('[digitise:create] status', created.status);
    throw mapUpstream(created.status, 'image reading');
  }
  const job = (await created.json()) as { job_id?: string };
  if (!job.job_id) throw new HttpError(502, 'UPSTREAM_ERROR', 'Sarvam AI did not return a job id.');

  // Poll until terminal.
  let status = 'pending';
  while (Date.now() < ocrDeadline) {
    await sleep(POLL_INTERVAL_MS);
    const st = await fetchWithTimeout(`${SARVAM_BASE}/doc-ai/v1/job/${job.job_id}/status`, { headers }, ocrDeadline - Date.now());
    if (!st.ok) {
      console.error('[digitise:status] status', st.status);
      throw mapUpstream(st.status, 'image reading');
    }
    status = String(((await st.json()) as { status?: string }).status || '').toLowerCase();
    if (['completed', 'partially_completed', 'failed', 'rejected'].includes(status)) break;
  }
  if (status === 'failed' || status === 'rejected')
    throw new HttpError(422, 'OCR_FAILED', 'Sarvam Vision could not read this image. Try a clearer photo or paste the text.');
  if (status !== 'completed' && status !== 'partially_completed')
    throw new HttpError(504, 'TIMEOUT', 'Reading the image took too long. Try again or paste the text.');

  const dlMeta = await fetchWithTimeout(`${SARVAM_BASE}/doc-ai/v1/job/${job.job_id}/download-url`, { headers }, deadline - Date.now());
  if (!dlMeta.ok) {
    console.error('[digitise:download-url] status', dlMeta.status);
    throw mapUpstream(dlMeta.status, 'image reading');
  }
  const { url } = (await dlMeta.json()) as { url?: string };
  if (!url) throw new HttpError(502, 'UPSTREAM_ERROR', 'Sarvam AI did not return a download link.');

  const zipRes = await fetchWithTimeout(url, {}, deadline - Date.now());
  if (!zipRes.ok) throw new HttpError(502, 'UPSTREAM_ERROR', 'Could not download the read-out from Sarvam AI.');
  const bytes = new Uint8Array(await zipRes.arrayBuffer());

  // Output is a ZIP containing the markdown file plus metadata JSON.
  let text = '';
  try {
    const files = unzipSync(bytes);
    const md = Object.entries(files)
      .filter(([name]) => name.toLowerCase().endsWith('.md'))
      .sort((a, b) => b[1].length - a[1].length)[0];
    if (md) text = strFromU8(md[1]);
  } catch {
    // Not a zip — some responses may be the raw file.
    text = strFromU8(bytes);
  }
  text = text.trim();
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
  "summary": "<2-4 sentence plain-language summary in ${targetLanguage}>"
}
"note" is a short plain-language explanation in ${targetLanguage} (e.g. what a class code means), or null.`;
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
        /* fallthrough */
      }
    }
  }
  return null;
}

async function explainTicket(apiKey: string, ticketText: string, targetLanguage: string, deadline: number): Promise<unknown> {
  const body = {
    model: CHAT_MODEL,
    messages: [
      { role: 'system', content: buildPrompt(targetLanguage) },
      { role: 'user', content: `TICKET TEXT (verbatim):\n"""\n${ticketText}\n"""` },
    ],
    temperature: 0.1,
    max_tokens: 4096,
    reasoning_effort: null,
    response_format: { type: 'json_object' },
  };
  const res = await fetchWithTimeout(
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
  if (!res.ok) {
    console.error('[chat] status', res.status);
    throw mapUpstream(res.status, 'translation');
  }
  const data = (await res.json()) as { choices?: { message?: { content?: string | null }; finish_reason?: string }[] };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new HttpError(502, 'MALFORMED_AI_OUTPUT', 'The AI returned an empty answer. Please retry.');
  const parsed = extractJson(content);
  if (!parsed || typeof parsed !== 'object')
    throw new HttpError(502, 'MALFORMED_AI_OUTPUT', 'The AI answer was not valid JSON. Please retry.');
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
const norm = (s: string) => s.toLowerCase().replace(/[\s\-_/.,:]+/g, '');

function validate(raw: any, sourceText: string) {
  const types = ['train', 'bus', 'flight', 'event', 'unknown'];
  const normalizedSource = norm(sourceText);

  const fields = {} as Record<FieldKey, { value: string | null; note: string | null }>;
  const uncertain = new Set<string>(arr(raw?.uncertainFields).map((x) => str(x, 80)).filter(Boolean) as string[]);

  for (const k of FIELD_KEYS) {
    const f = raw?.fields?.[k];
    let value = str(typeof f === 'object' && f !== null ? f.value : f, 200);
    const note = typeof f === 'object' && f !== null ? str(f.note, 300) : null;
    // Guard against invented values: strict fields must appear in the ticket text.
    if (value && STRICT_FIELDS.includes(k) && !normalizedSource.includes(norm(value))) {
      value = null;
      uncertain.add(k);
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
  };
}

/* ------------------------------------------------------------------ */
/* Handler                                                             */
/* ------------------------------------------------------------------ */

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const apiKey = process.env.SARVAM_API_KEY?.trim();

  if (req.method === 'GET') {
    send(res, 200, { configured: Boolean(apiKey), outputLanguages: OUTPUT_LANGUAGES });
    return;
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    fail(res, 405, 'METHOD_NOT_ALLOWED', 'Use POST.');
    return;
  }

  const deadline = Date.now() + TOTAL_BUDGET_MS;
  try {
    const { fields, file } = await parseMultipart(req);
    const targetCode = fields.targetLanguage || '';
    const ticketLang = fields.ticketLanguage || 'en-IN';
    const pasted = (fields.text || '').trim();

    if (!OUTPUT_LANGUAGES[targetCode]) throw new HttpError(400, 'BAD_LANGUAGE', 'Unsupported target language.');
    if (!TICKET_LANGUAGES.has(ticketLang)) throw new HttpError(400, 'BAD_LANGUAGE', 'Unsupported ticket language.');
    if (!file && !pasted) throw new HttpError(400, 'NO_INPUT', 'Upload a ticket image or paste the ticket text.');
    if (pasted.length > MAX_TEXT_CHARS) throw new HttpError(413, 'TEXT_TOO_LONG', `Pasted text is over ${MAX_TEXT_CHARS} characters.`);
    if (file) {
      if (!file.buffer.length) throw new HttpError(400, 'EMPTY_FILE', 'The uploaded file is empty.');
      const okType = (file.mime === 'image/jpeg' && isJpeg(file.buffer)) || (file.mime === 'image/png' && isPng(file.buffer));
      if (!okType) throw new HttpError(415, 'BAD_FILE_TYPE', 'Upload a JPG, PNG or WEBP image.');
    }
    if (!apiKey) throw new HttpError(503, 'NOT_CONFIGURED', 'Live decoding is not configured on this server yet. Try the sample ticket.');

    const sourceText = file ? await digitiseImage(apiKey, file, ticketLang, deadline) : pasted;
    const raw = await explainTicket(apiKey, sourceText, OUTPUT_LANGUAGES[targetCode], deadline);
    const result = validate(raw, sourceText);

    send(res, 200, {
      success: true,
      mode: 'live',
      input: file ? 'image' : 'text',
      targetLanguage: OUTPUT_LANGUAGES[targetCode],
      sourceText,
      ...result,
    });
  } catch (e) {
    if (e instanceof HttpError) {
      fail(res, e.status, e.code, e.message);
    } else {
      console.error('[translate-ticket] unexpected error', (e as Error)?.name);
      fail(res, 500, 'INTERNAL', 'Something went wrong. Please try again.');
    }
  }
}

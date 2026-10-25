/**
 * POST /api/speak  { text, language, voice } → { audio: <base64>, mime }
 * Reads the decoded ticket aloud with Sarvam AI text-to-speech (Bulbul v3).
 */

const SARVAM_TTS_URL = 'https://api.sarvam.ai/text-to-speech';
const TTS_MODEL = 'bulbul:v3';
const MAX_CHARS = 2400; // Bulbul v3 accepts up to 2500 characters per request
const TIMEOUT_MS = 25_000;

// Languages supported by Sarvam TTS (same 11 the app offers for output).
const LANGUAGES = new Set(['en-IN', 'hi-IN', 'bn-IN', 'gu-IN', 'kn-IN', 'ml-IN', 'mr-IN', 'od-IN', 'pa-IN', 'ta-IN', 'te-IN']);
// Bulbul v3 speaker names (lowercase, case-sensitive).
const VOICES = new Set(['shubh', 'priya']);

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
const fail = (status: number, code: string, error: string) => json(status, { success: false, code, error });

/** Trim to the limit at a sentence boundary so speech doesn't stop mid-word. */
function clip(text: string): string {
  if (text.length <= MAX_CHARS) return text;
  const cut = text.slice(0, MAX_CHARS);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('। '), cut.lastIndexOf('\n'));
  return end > MAX_CHARS * 0.5 ? cut.slice(0, end + 1) : cut;
}

function sniffMime(b64: string): string {
  if (b64.startsWith('UklGR')) return 'audio/wav'; // "RIFF"
  if (b64.startsWith('SUQz') || b64.startsWith('//')) return 'audio/mpeg'; // ID3 tag or MPEG frame sync
  return 'audio/mpeg';
}

export async function POST(request: Request): Promise<Response> {
  let payload: any;
  try {
    payload = await request.json();
  } catch {
    return fail(400, 'BAD_JSON', 'Send JSON: { text, language, voice }.');
  }

  const text = typeof payload?.text === 'string' ? payload.text.trim() : '';
  const language = String(payload?.language || '');
  const voice = VOICES.has(payload?.voice) ? payload.voice : 'shubh';

  if (!text) return fail(400, 'NO_TEXT', 'Nothing to read aloud.');
  if (!LANGUAGES.has(language)) return fail(400, 'BAD_LANGUAGE', 'Voice is not available for this language.');

  const apiKey = process.env.SARVAM_API_KEY?.trim();
  if (!apiKey) return fail(503, 'NOT_CONFIGURED', 'Voice needs the Sarvam API key to be configured on the server.');

  let res: Response;
  try {
    res = await fetch(SARVAM_TTS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-subscription-key': apiKey },
      body: JSON.stringify({
        text: clip(text),
        language_code: language,
        model: TTS_MODEL,
        speaker: voice,
        pace: 1.0,
        output_audio_codec: 'mp3',
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    const name = (e as Error)?.name;
    if (name === 'TimeoutError' || name === 'AbortError') return fail(504, 'TIMEOUT', 'Generating speech took too long. Please retry.');
    return fail(502, 'UPSTREAM_UNREACHABLE', 'Could not reach Sarvam AI. Please retry.');
  }

  if (!res.ok) {
    console.error(`[sarvam:tts] status ${res.status}`);
    let detail = '';
    try {
      const b = (await res.json()) as any;
      const d = b?.error?.message ?? b?.detail ?? b?.message;
      if (typeof d === 'string') detail = ` (${d.slice(0, 200)})`;
    } catch {
      /* ignore */
    }
    if (res.status === 401 || res.status === 403) return fail(502, 'AUTH', `Sarvam AI rejected the server API key.${detail}`);
    if (res.status === 429) return fail(429, 'RATE_LIMIT', 'Sarvam AI rate limit reached. Wait a minute and retry.');
    if (res.status === 400 || res.status === 422) return fail(422, 'UPSTREAM_REJECTED', `Sarvam AI could not voice this text.${detail}`);
    return fail(502, 'UPSTREAM_ERROR', 'Sarvam AI returned an error while generating speech. Please retry.');
  }

  const data = (await res.json()) as { audios?: unknown[] };
  const audio = data.audios?.[0];
  if (typeof audio !== 'string' || !audio) return fail(502, 'NO_AUDIO', 'Sarvam AI returned no audio. Please retry.');
  return json(200, { success: true, audio, mime: sniffMime(audio) });
}

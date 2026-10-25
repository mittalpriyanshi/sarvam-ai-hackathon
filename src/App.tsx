import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle, ArrowRight, BookOpen, Check, CheckCircle2, ClipboardCopy, FileText, ImageUp,
  Info, Languages, Loader2, Pause, Play, RotateCcw, ScanText, Sparkles, Ticket, Volume2, X,
} from 'lucide-react';
import { ACCEPTED_TYPES, MAX_UPLOAD_BYTES, formatBytes, prepareImage } from './image';
import { SAMPLE_RESULT } from './sample';
import { FIELD_LABELS, OUTPUT_LANGUAGES, TICKET_LANGUAGES, type FieldKey, type TicketResult } from './types';

type Phase = 'input' | 'loading' | 'result' | 'error';
type Tab = 'image' | 'text';

export default function App() {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [phase, setPhase] = useState<Phase>('input');
  const [tab, setTab] = useState<Tab>('text');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [targetLang, setTargetLang] = useState('en-IN');
  const [ticketLang, setTicketLang] = useState('en-IN');
  const [inputError, setInputError] = useState<string | null>(null);
  const [error, setError] = useState<{ message: string; code?: string } | null>(null);
  const [result, setResult] = useState<TicketResult | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    fetch('/api/translate-ticket')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setConfigured(Boolean(d?.configured)))
      .catch(() => setConfigured(false));
  }, []);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const pickFile = useCallback((f: File | undefined | null) => {
    setInputError(null);
    if (!f) return;
    if (!ACCEPTED_TYPES.includes(f.type)) {
      setInputError('Please upload a JPG, PNG or WEBP image.');
      return;
    }
    if (f.size > MAX_UPLOAD_BYTES) {
      setInputError(`That image is ${formatBytes(f.size)}. The limit is 10 MB.`);
      return;
    }
    setFile(f);
    setPreview(URL.createObjectURL(f));
  }, []);

  const clearFile = () => {
    setFile(null);
    setPreview(null);
  };

  const startOver = () => {
    abortRef.current?.abort();
    clearFile();
    setText('');
    setResult(null);
    setError(null);
    setInputError(null);
    setPhase('input');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const canSubmit = tab === 'image' ? Boolean(file) : text.trim().length >= 10;

  const decode = async () => {
    if (!canSubmit) {
      setInputError(tab === 'image' ? 'Add a ticket image first.' : 'Paste at least a line or two of the ticket.');
      return;
    }
    setPhase('loading');
    setError(null);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const form = new FormData();
      form.append('targetLanguage', targetLang);
      if (tab === 'image' && file) {
        const prepared = await prepareImage(file);
        form.append('file', prepared, prepared.name);
        form.append('ticketLanguage', ticketLang);
      } else {
        form.append('text', text.trim());
      }
      const res = await fetch('/api/translate-ticket', { method: 'POST', body: form, signal: ctrl.signal });
      let data: any = null;
      try {
        data = await res.json();
      } catch {
        /* non-JSON (e.g. platform timeout page) */
      }
      if (!res.ok || !data?.success) {
        const msg = data?.error || (res.status === 504 ? 'The request timed out. Please retry.' : `Request failed (${res.status}). Please retry.`);
        setError({ message: msg, code: data?.code });
        setPhase('error');
        return;
      }
      setResult(data as TicketResult);
      setPhase('result');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      setError({ message: (e as Error).message || 'Network error. Check your connection and retry.' });
      setPhase('error');
    }
  };

  const showSample = () => {
    setResult(SAMPLE_RESULT);
    setPhase('result');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="min-h-screen">
      <Header configured={configured} />
      <main className="mx-auto max-w-5xl px-4 pb-16 sm:px-6">
        {phase !== 'result' && (
          <section className="pt-8 pb-6 text-center sm:pt-14 sm:pb-10">
            <h1 className="text-3xl font-extrabold tracking-tight text-navy-950 sm:text-5xl">
              Your ticket, <span className="text-teal-600">finally understood.</span>
            </h1>
            <p className="mx-auto mt-3 max-w-xl text-base text-navy-500 sm:text-lg">
              Upload a train, bus or event ticket. Get it translated, every code explained, and a checklist of what to do next.
            </p>
          </section>
        )}

        {phase === 'input' && (
          <InputPanel
            tab={tab} setTab={setTab} file={file} preview={preview} pickFile={pickFile} clearFile={clearFile}
            text={text} setText={setText} targetLang={targetLang} setTargetLang={setTargetLang}
            ticketLang={ticketLang} setTicketLang={setTicketLang} inputError={inputError}
            onDecode={decode} onSample={showSample} configured={configured}
          />
        )}
        {phase === 'loading' && <LoadingPanel isImage={tab === 'image'} onCancel={() => { abortRef.current?.abort(); setPhase('input'); }} />}
        {phase === 'error' && error && (
          <ErrorPanel
            error={error}
            isImage={tab === 'image'}
            onRetry={decode}
            onEdit={() => setPhase('input')}
            onPasteText={() => { setTab('text'); setPhase('input'); }}
            onSample={showSample}
          />
        )}
        {phase === 'result' && result && <ResultView result={result} onStartOver={startOver} />}
      </main>
      <footer className="border-t border-navy-100 py-6 text-center text-xs text-navy-500">
        Tickets are processed in memory and never stored. Always confirm critical details with the operator.
      </footer>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Header({ configured }: { configured: boolean | null }) {
  return (
    <header className="sticky top-0 z-10 border-b border-navy-100 bg-white/85 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4 sm:px-6">
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-navy-900 text-teal-500">
            <Ticket className="h-4 w-4" aria-hidden />
          </span>
          <span className="text-base font-bold tracking-tight text-navy-950">Ticket Translator</span>
        </div>
        {configured && (
          <span className="flex items-center gap-1.5 rounded-full bg-teal-50 px-3 py-1 text-xs font-semibold text-teal-700 ring-1 ring-teal-100">
            <Sparkles className="h-3.5 w-3.5" aria-hidden /> Powered by Sarvam AI
          </span>
        )}
      </div>
    </header>
  );
}

/* ------------------------------------------------------------------ */

interface InputPanelProps {
  tab: Tab; setTab: (t: Tab) => void;
  file: File | null; preview: string | null; pickFile: (f: File | null | undefined) => void; clearFile: () => void;
  text: string; setText: (s: string) => void;
  targetLang: string; setTargetLang: (s: string) => void;
  ticketLang: string; setTicketLang: (s: string) => void;
  inputError: string | null; onDecode: () => void; onSample: () => void; configured: boolean | null;
}

function InputPanel(p: InputPanelProps) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <section className="mx-auto max-w-2xl rounded-3xl bg-white p-4 shadow-card ring-1 ring-navy-100 sm:p-6">
      <div role="tablist" aria-label="Input method" className="mb-4 grid grid-cols-2 gap-1 rounded-xl bg-navy-50 p-1">
        {([['text', 'Paste text', FileText], ['image', 'Upload image', ImageUp]] as const).map(([key, label, Icon]) => (
          <button
            key={key} role="tab" aria-selected={p.tab === key} onClick={() => p.setTab(key)}
            className={`flex items-center justify-center gap-2 rounded-lg py-2 text-sm font-semibold transition ${p.tab === key ? 'bg-white text-navy-950 shadow-sm' : 'text-navy-500 hover:text-navy-800'}`}
          >
            <Icon className="h-4 w-4" aria-hidden /> {label}
          </button>
        ))}
      </div>

      {p.tab === 'image' ? (
        p.file && p.preview ? (
          <div className="relative overflow-hidden rounded-2xl border border-navy-100 bg-navy-50">
            <img src={p.preview} alt="Preview of the uploaded ticket" className="mx-auto max-h-80 w-full object-contain" />
            <div className="flex items-center justify-between gap-2 border-t border-navy-100 bg-white px-3 py-2 text-sm">
              <span className="truncate text-navy-700">{p.file.name} · {formatBytes(p.file.size)}</span>
              <button onClick={p.clearFile} className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 font-medium text-navy-500 hover:bg-navy-50 hover:text-navy-900">
                <X className="h-4 w-4" aria-hidden /> Remove
              </button>
            </div>
          </div>
        ) : (
          <div
            role="button" tabIndex={0} aria-label="Upload a ticket image: click or drop a file"
            onClick={() => inputRef.current?.click()}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inputRef.current?.click(); } }}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => { e.preventDefault(); setDragging(false); p.pickFile(e.dataTransfer.files?.[0]); }}
            className={`flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-12 text-center transition sm:py-16 ${dragging ? 'border-teal-500 bg-teal-50' : 'border-navy-100 bg-navy-50/60 hover:border-teal-500 hover:bg-teal-50/50'}`}
          >
            <span className="mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-white text-teal-600 shadow-card ring-1 ring-navy-100">
              <Ticket className="h-7 w-7" aria-hidden />
            </span>
            <p className="text-base font-semibold text-navy-900">Drop your ticket here, or <span className="text-teal-600 underline underline-offset-2">browse</span></p>
            <p className="mt-1 text-sm text-navy-500">Photo or screenshot · JPG, PNG, WEBP · up to 10 MB</p>
          </div>
        )
      ) : (
        <div>
          <label htmlFor="ticket-text" className="mb-1.5 block text-sm font-semibold text-navy-800">Ticket text</label>
          <textarea
            id="ticket-text" rows={8} value={p.text} onChange={(e) => p.setText(e.target.value)} maxLength={8000}
            placeholder="Paste everything printed on the ticket (SMS, email or e-ticket text)…"
            className="w-full resize-y rounded-2xl border border-navy-100 bg-navy-50/60 p-3 font-mono text-sm text-navy-900 placeholder:font-sans placeholder:text-navy-300 focus:border-teal-500 focus:bg-white focus:outline-none"
          />
          <p className="mt-1 text-right text-xs text-navy-500">{p.text.length} / 8000</p>
        </div>
      )}
      <input ref={inputRef} type="file" accept={ACCEPTED_TYPES.join(',')} className="hidden" onChange={(e) => { p.pickFile(e.target.files?.[0]); e.target.value = ''; }} />

      <div className={`mt-4 grid gap-3 ${p.tab === 'image' ? 'sm:grid-cols-2' : ''}`}>
        {p.tab === 'image' && (
          <Select id="ticket-lang" label="Ticket is written in" icon={ScanText} value={p.ticketLang} onChange={p.setTicketLang}
            options={TICKET_LANGUAGES.map((l) => ({ value: l.code, label: l.label }))} />
        )}
        <Select id="target-lang" label="Explain it to me in" icon={Languages} value={p.targetLang} onChange={p.setTargetLang}
          options={OUTPUT_LANGUAGES.map((l) => ({ value: l.code, label: l.code === 'en-IN' ? 'English' : `${l.label} · ${l.native}` }))} />
      </div>

      {p.inputError && (
        <p role="alert" className="mt-3 flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden /> {p.inputError}
        </p>
      )}
      {p.configured === false && (
        <p className="mt-3 flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> Live decoding isn't configured on this server yet. You can still try the sample ticket.
        </p>
      )}

      <button
        onClick={p.onDecode}
        className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-navy-900 px-6 py-4 text-base font-bold text-white shadow-card transition hover:bg-navy-800 disabled:cursor-not-allowed disabled:opacity-50"
      >
        Decode my ticket <ArrowRight className="h-5 w-5" aria-hidden />
      </button>
      <button onClick={p.onSample} className="mx-auto mt-3 flex items-center gap-1.5 rounded-md px-2 py-1 text-sm font-semibold text-teal-700 hover:underline">
        <Sparkles className="h-4 w-4" aria-hidden /> No ticket handy? Try a sample ticket
      </button>
    </section>
  );
}

function Select({ id, label, icon: Icon, value, onChange, options }: {
  id: string; label: string; icon: typeof Languages; value: string; onChange: (v: string) => void; options: { value: string; label: string }[];
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold text-navy-800">
        <Icon className="h-4 w-4 text-navy-500" aria-hidden /> {label}
      </label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl border border-navy-100 bg-white px-3 py-2.5 text-sm font-medium text-navy-900 focus:border-teal-500 focus:outline-none">
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function LoadingPanel({ isImage, onCancel }: { isImage: boolean; onCancel: () => void }) {
  const steps = isImage
    ? ['Reading your ticket with Sarvam Vision', 'Translating and explaining the details', 'Building your travel checklist']
    : ['Reading your ticket text', 'Translating and explaining the details', 'Building your travel checklist'];
  const [step, setStep] = useState(0);
  useEffect(() => {
    const timings = isImage ? [9000, 22000] : [2500, 12000];
    const ts = timings.map((t, i) => setTimeout(() => setStep(i + 1), t));
    return () => ts.forEach(clearTimeout);
  }, [isImage]);

  return (
    <section aria-live="polite" className="mx-auto max-w-md rounded-3xl bg-white p-6 text-center shadow-card ring-1 ring-navy-100 sm:p-8">
      <Loader2 className="mx-auto h-10 w-10 animate-spin text-teal-600" aria-hidden />
      <h2 className="mt-4 text-lg font-bold text-navy-950">Decoding your ticket…</h2>
      <p className="mt-1 text-sm text-navy-500">This usually takes 10–40 seconds.</p>
      <ol className="mt-6 space-y-3 text-left">
        {steps.map((s, i) => (
          <li key={s} className="flex items-center gap-3 text-sm">
            {i < step ? <CheckCircle2 className="h-5 w-5 shrink-0 text-teal-600" aria-hidden />
              : i === step ? <Loader2 className="h-5 w-5 shrink-0 animate-spin text-navy-700" aria-hidden />
              : <span className="h-5 w-5 shrink-0 rounded-full border-2 border-navy-100" aria-hidden />}
            <span className={i <= step ? 'font-medium text-navy-900' : 'text-navy-300'}>{s}</span>
          </li>
        ))}
      </ol>
      <button onClick={onCancel} className="mt-6 text-sm font-semibold text-navy-500 hover:text-navy-900">Cancel</button>
    </section>
  );
}

function ErrorPanel({ error, isImage, onRetry, onEdit, onPasteText, onSample }: {
  error: { message: string; code?: string }; isImage: boolean; onRetry: () => void; onEdit: () => void; onPasteText: () => void; onSample: () => void;
}) {
  const notConfigured = error.code === 'NOT_CONFIGURED';
  return (
    <section role="alert" className="mx-auto max-w-md rounded-3xl bg-white p-6 text-center shadow-card ring-1 ring-red-100 sm:p-8">
      <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-red-50 text-red-600"><AlertTriangle className="h-6 w-6" aria-hidden /></span>
      <h2 className="mt-4 text-lg font-bold text-navy-950">We couldn't decode that ticket</h2>
      <p className="mt-1 text-sm text-navy-700">{error.message}</p>
      <div className="mt-6 flex flex-col gap-2">
        {notConfigured ? (
          <button onClick={onSample} className="flex items-center justify-center gap-2 rounded-xl bg-navy-900 px-4 py-3 text-sm font-bold text-white hover:bg-navy-800">
            <Sparkles className="h-4 w-4" aria-hidden /> Try the sample ticket
          </button>
        ) : (
          <button onClick={onRetry} className="flex items-center justify-center gap-2 rounded-xl bg-navy-900 px-4 py-3 text-sm font-bold text-white hover:bg-navy-800">
            <RotateCcw className="h-4 w-4" aria-hidden /> Retry
          </button>
        )}
        {isImage && !notConfigured && (
          <button onClick={onPasteText} className="rounded-xl px-4 py-2.5 text-sm font-semibold text-teal-700 ring-1 ring-teal-100 hover:bg-teal-50">Paste the ticket text instead</button>
        )}
        <button onClick={onEdit} className="rounded-xl px-4 py-2.5 text-sm font-semibold text-navy-500 hover:bg-navy-50">Back to edit</button>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */

const NotFound = () => <span className="italic text-navy-300">Not found on ticket</span>;

function buildSummaryText(r: TicketResult) {
  const f = r.fields;
  const lines = [
    'Ticket Translator — travel summary' + (r.mode === 'sample' ? ' (SAMPLE DATA)' : ''),
    '',
    r.summary,
    '',
    ...(['origin', 'destination', 'departureDate', 'departureTime', 'arrivalDate', 'arrivalTime', 'trainOrBusNumber', 'coach', 'seat', 'platform', 'bookingReference'] as FieldKey[])
      .map((k) => `${FIELD_LABELS[k]}: ${f[k].value ?? 'Not found on ticket'}`),
  ];
  if (r.checklist.length) lines.push('', 'Checklist:', ...r.checklist.map((c) => `☐ ${c.item}${c.basis === 'suggestion' ? ' (suggestion)' : ''}`));
  if (r.uncertainFields.length) lines.push('', `Double-check: ${r.uncertainFields.join(', ')}`);
  return lines.join('\n');
}

async function copyText(s: string) {
  try {
    await navigator.clipboard.writeText(s);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = s;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
}

type VoiceState = 'idle' | 'loading' | 'ready' | 'playing' | 'paused' | 'error';
const VOICES = [
  { id: 'shubh', label: 'Shubh' },
  { id: 'priya', label: 'Priya' },
] as const;

/** Reads the decoded ticket aloud via /api/speak (Sarvam Bulbul text-to-speech). */
function ListenBar({ text, languageCode, languageLabel }: { text: string; languageCode: string; languageLabel: string }) {
  const [voice, setVoice] = useState<string>('shubh');
  const [state, setState] = useState<VoiceState>('idle');
  const [err, setErr] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const cache = useRef<Record<string, string>>({}); // voice → object URL

  useEffect(() => {
    const urls = cache.current;
    return () => {
      audioRef.current?.pause();
      Object.values(urls).forEach((u) => URL.revokeObjectURL(u));
    };
  }, []);

  const startAudio = async (url: string) => {
    audioRef.current?.pause();
    const audio = new Audio(url);
    audioRef.current = audio;
    audio.onended = () => setState('idle');
    audio.onerror = () => { setErr('Your browser could not play this audio.'); setState('error'); };
    try {
      await audio.play();
      setState('playing');
    } catch {
      // Some browsers block playback that starts after a network wait; the next tap plays instantly from cache.
      setState('ready');
    }
  };

  const onPress = async () => {
    setErr(null);
    const a = audioRef.current;
    if (state === 'playing' && a) { a.pause(); setState('paused'); return; }
    if (state === 'paused' && a) { await a.play(); setState('playing'); return; }
    if (state === 'loading') return;

    let url = cache.current[voice];
    if (!url) {
      setState('loading');
      try {
        const res = await fetch('/api/speak', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, language: languageCode, voice }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.audio) throw new Error(data?.error || `Voice request failed (${res.status}).`);
        const bytes = Uint8Array.from(atob(data.audio), (c) => c.charCodeAt(0));
        url = URL.createObjectURL(new Blob([bytes], { type: data.mime || 'audio/mpeg' }));
        cache.current[voice] = url;
      } catch (e) {
        setErr((e as Error).message || 'Could not generate speech.');
        setState('error');
        return;
      }
    }
    await startAudio(url);
  };

  const changeVoice = (v: string) => {
    audioRef.current?.pause();
    audioRef.current = null;
    setVoice(v);
    setErr(null);
    setState('idle');
  };

  const label =
    state === 'loading' ? 'Preparing audio…'
    : state === 'playing' ? 'Pause'
    : state === 'paused' ? 'Resume'
    : state === 'ready' ? 'Audio ready — tap to play'
    : `Listen in ${languageLabel}`;
  const Icon = state === 'loading' ? Loader2 : state === 'playing' ? Pause : state === 'paused' || state === 'ready' ? Play : Volume2;

  return (
    <section aria-label="Listen to your ticket" className="mb-4 rounded-3xl bg-teal-50 p-4 ring-1 ring-teal-100 sm:p-5">
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={onPress}
          disabled={!text || state === 'loading'}
          aria-pressed={state === 'playing'}
          className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-teal-600 px-5 py-3.5 text-base font-bold text-white shadow-card transition hover:bg-teal-700 disabled:opacity-60 sm:flex-none"
        >
          <Icon className={`h-5 w-5 ${state === 'loading' ? 'animate-spin' : ''}`} aria-hidden /> {label}
        </button>
        <div className="flex items-center gap-2">
          <label htmlFor="voice" className="text-sm font-semibold text-navy-700">Voice</label>
          <select
            id="voice" value={voice} onChange={(e) => changeVoice(e.target.value)}
            className="rounded-xl border border-teal-100 bg-white px-3 py-2 text-sm font-medium text-navy-900 focus:border-teal-500 focus:outline-none"
          >
            {VOICES.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
          </select>
        </div>
        <p className="w-full text-xs text-teal-700 sm:w-auto sm:flex-1 sm:text-right">Spoken by Sarvam AI · Bulbul</p>
      </div>
      {err && (
        <p role="alert" className="mt-3 flex items-start gap-2 text-sm text-red-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> {err}
        </p>
      )}
    </section>
  );
}

export function ResultView({ result: r, onStartOver }: { result: TicketResult; onStartOver: () => void }) {
  const [done, setDone] = useState<Set<number>>(new Set());
  const [copied, setCopied] = useState(false);
  const f = r.fields;

  const toggle = (i: number) => setDone((prev) => {
    const next = new Set(prev);
    if (next.has(i)) next.delete(i); else next.add(i);
    return next;
  });

  const copy = async () => {
    await copyText(buildSummaryText(r));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const dateTime = (d: string | null, t: string | null) => (d || t ? [t, d].filter(Boolean).join(' · ') : null);
  const detailKeys: FieldKey[] = ['travellerName', 'trainOrBusNumber', 'ticketClass', 'coach', 'seat', 'platform', 'bookingReference', 'bookingStatus', 'fare'];

  return (
    <div className="pt-6 sm:pt-10">
      {r.mode === 'sample' && (
        <div className="mb-4 flex items-start gap-2 rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-200">
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span><strong>Sample data.</strong> This is a made-up demo ticket, not a result from Sarvam AI.</span>
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-teal-700">
            {r.ticketType !== 'unknown' ? `${r.ticketType} ticket` : 'Ticket'} · written in {r.sourceLanguage} · explained in {r.targetLanguage}
          </p>
          <h1 className="text-2xl font-extrabold tracking-tight text-navy-950 sm:text-3xl">Here's your ticket, decoded</h1>
        </div>
        <div className="flex gap-2">
          <button onClick={copy} className="flex items-center gap-2 rounded-xl bg-navy-900 px-4 py-2.5 text-sm font-bold text-white hover:bg-navy-800">
            {copied ? <Check className="h-4 w-4" aria-hidden /> : <ClipboardCopy className="h-4 w-4" aria-hidden />}
            {copied ? 'Copied' : 'Copy travel summary'}
          </button>
          <button onClick={onStartOver} className="flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-bold text-navy-800 ring-1 ring-navy-100 hover:bg-navy-50">
            <RotateCcw className="h-4 w-4" aria-hidden /> Start over
          </button>
        </div>
      </div>

      <ListenBar
        text={r.spokenScript || r.summary}
        languageCode={r.targetLanguageCode || OUTPUT_LANGUAGES.find((l) => l.label === r.targetLanguage)?.code || 'en-IN'}
        languageLabel={r.targetLanguage}
      />

      {/* Boarding-pass style hero */}
      <article className="overflow-hidden rounded-3xl bg-white shadow-card ring-1 ring-navy-100">
        <div className="bg-navy-900 px-5 py-6 text-white sm:px-8">
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
            <Endpoint label="From" value={f.origin.value} sub={dateTime(f.departureDate.value, f.departureTime.value)} />
            <ArrowRight className="h-6 w-6 text-teal-500" aria-hidden />
            <Endpoint label="To" value={f.destination.value} sub={dateTime(f.arrivalDate.value, f.arrivalTime.value)} align="right" />
          </div>
          {(f.origin.note || f.destination.note) && (
            <p className="mt-3 text-xs text-navy-300">{[f.origin.note, f.destination.note].filter(Boolean).join(' · ')}</p>
          )}
        </div>
        <div className="border-t-2 border-dashed border-navy-100" />
        <dl className="grid grid-cols-2 gap-x-4 gap-y-5 px-5 py-6 sm:grid-cols-3 sm:px-8">
          {detailKeys.map((k) => (
            <div key={k} className="min-w-0">
              <dt className="text-xs font-semibold uppercase tracking-wider text-navy-500">{FIELD_LABELS[k]}</dt>
              <dd className="mt-1 break-words font-mono text-sm font-semibold text-navy-950">{f[k].value ?? <NotFound />}</dd>
              {f[k].note && <dd className="mt-0.5 text-xs text-navy-500">{f[k].note}</dd>}
            </div>
          ))}
        </dl>
      </article>

      <div className="mt-6 grid gap-6 lg:grid-cols-5">
        <div className="space-y-6 lg:col-span-3">
          <Card title="In plain words" icon={BookOpen}>
            <p className="leading-relaxed text-navy-800">{r.summary || 'No summary available.'}</p>
          </Card>

          <Card title="Your travel checklist" icon={CheckCircle2}
            aside={<span className="text-xs font-medium text-navy-500">{done.size}/{r.checklist.length} done</span>}>
            {r.checklist.length ? (
              <ul className="space-y-2">
                {r.checklist.map((c, i) => (
                  <li key={i}>
                    <label className={`flex cursor-pointer items-start gap-3 rounded-xl p-3 ring-1 transition ${done.has(i) ? 'bg-teal-50 ring-teal-100' : 'ring-navy-100 hover:bg-navy-50'}`}>
                      <input type="checkbox" checked={done.has(i)} onChange={() => toggle(i)} className="mt-0.5 h-5 w-5 shrink-0 rounded accent-teal-600" />
                      <span className="flex-1">
                        <span className={`text-sm ${done.has(i) ? 'text-navy-500 line-through' : 'text-navy-900'}`}>{c.item}</span>
                        <Basis basis={c.basis} />
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-navy-500">No checklist items.</p>}
            <p className="mt-3 text-xs text-navy-500"><strong className="text-teal-700">On ticket</strong> = taken from the ticket. <strong className="text-navy-700">Suggested</strong> = general advice, not printed on it.</p>
          </Card>

          <Card title="Original vs translation" icon={Languages}>
            {r.translation.length ? (
              <div className="divide-y divide-navy-100 overflow-hidden rounded-xl ring-1 ring-navy-100">
                <div className="hidden grid-cols-2 bg-navy-50 text-xs font-semibold uppercase tracking-wider text-navy-500 sm:grid">
                  <span className="px-3 py-2">On the ticket</span><span className="px-3 py-2">In {r.targetLanguage}</span>
                </div>
                {r.translation.map((t, i) => (
                  <div key={i} className="grid gap-1 p-3 sm:grid-cols-2 sm:gap-0 sm:p-0">
                    <p className="font-mono text-xs text-navy-500 sm:px-3 sm:py-2.5">{t.original}</p>
                    <p className="text-sm text-navy-900 sm:px-3 sm:py-2.5">{t.translated}</p>
                  </div>
                ))}
              </div>
            ) : <p className="text-sm text-navy-500">Nothing to translate.</p>}
            <details className="mt-3 text-sm">
              <summary className="cursor-pointer font-semibold text-navy-700">Full text read from the ticket</summary>
              <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-xl bg-navy-50 p-3 font-mono text-xs text-navy-800">{r.sourceText}</pre>
            </details>
          </Card>
        </div>

        <div className="space-y-6 lg:col-span-2">
          {r.uncertainFields.length > 0 && (
            <div className="rounded-3xl bg-amber-50 p-5 ring-1 ring-amber-200">
              <h2 className="flex items-center gap-2 text-sm font-bold text-amber-900"><AlertTriangle className="h-4 w-4" aria-hidden /> Double-check these</h2>
              <p className="mt-1 text-xs text-amber-800">Couldn't be read confidently, or weren't printed clearly on the ticket.</p>
              <ul className="mt-3 flex flex-wrap gap-2">
                {r.uncertainFields.map((u) => (
                  <li key={u} className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-amber-900 ring-1 ring-amber-200">{FIELD_LABELS[u as FieldKey] ?? u}</li>
                ))}
              </ul>
            </div>
          )}

          <Card title="Printed on your ticket" icon={Ticket}>
            {r.importantInstructions.length ? (
              <ul className="space-y-2.5">
                {r.importantInstructions.map((s, i) => (
                  <li key={i} className="flex gap-2.5 text-sm text-navy-800"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-teal-500" />{s}</li>
                ))}
              </ul>
            ) : <p className="text-sm text-navy-500">No special instructions found on the ticket.</p>}
          </Card>

          {r.abbreviations.length > 0 && (
            <Card title="Codes explained" icon={Info}>
              <dl className="space-y-2.5">
                {r.abbreviations.map((a) => (
                  <div key={a.term} className="flex items-start gap-3">
                    <dt className="shrink-0 rounded-md bg-navy-900 px-2 py-0.5 font-mono text-xs font-semibold text-white">{a.term}</dt>
                    <dd className="text-sm text-navy-800">{a.meaning}</dd>
                  </div>
                ))}
              </dl>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function Endpoint({ label, value, sub, align = 'left' }: { label: string; value: string | null; sub: string | null; align?: 'left' | 'right' }) {
  return (
    <div className={`min-w-0 ${align === 'right' ? 'text-right' : ''}`}>
      <p className="text-xs font-semibold uppercase tracking-wider text-teal-500">{label}</p>
      <p className="mt-1 break-words text-lg font-extrabold leading-tight sm:text-2xl">{value ?? <span className="text-base font-medium italic text-navy-300">Not found on ticket</span>}</p>
      <p className="mt-1 font-mono text-xs text-navy-300 sm:text-sm">{sub ?? 'Time not found on ticket'}</p>
    </div>
  );
}

function Basis({ basis }: { basis: 'ticket' | 'suggestion' }) {
  return basis === 'ticket'
    ? <span className="ml-2 inline-flex items-center rounded-full bg-teal-100 px-2 py-0.5 align-middle text-[10px] font-bold uppercase tracking-wide text-teal-700">On ticket</span>
    : <span className="ml-2 inline-flex items-center rounded-full bg-navy-100 px-2 py-0.5 align-middle text-[10px] font-bold uppercase tracking-wide text-navy-700">Suggested</span>;
}

function Card({ title, icon: Icon, aside, children }: { title: string; icon: typeof Info; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-3xl bg-white p-5 shadow-card ring-1 ring-navy-100 sm:p-6">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-bold text-navy-950"><Icon className="h-5 w-5 text-teal-600" aria-hidden /> {title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}


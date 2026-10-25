# Ticket Translator

**Your ticket, finally understood.** Upload a train, bus or event ticket (photo or screenshot), or paste its text. Ticket Translator reads it with Sarvam AI, translates it into one of 11 Indian languages, explains every code (PNR, CNF, 3A, WL…), and turns it into a travel checklist.

## How it works

```
Browser ──multipart──▶ POST /api/translate-ticket (Vercel function)
                          │
                          ├─ image → Sarvam Vision (Document AI "Digitise", model sarvam-vision)
                          │           POST /doc-ai/v1/job/digitise → poll /status → /download-url → unzip markdown
                          │
                          └─ text  → Sarvam chat completions (sarvam-105b, JSON mode)
                                      → schema validation + anti-hallucination checks → JSON to UI
```

**Never invents details.** Booking reference, seat, coach, platform, train number and times must appear verbatim in the text read from the ticket; anything the model returns that isn't there is dropped and flagged under "Double-check these". Checklist items are tagged **On ticket** vs **Suggested**.

- WEBP and large images are re-encoded to JPEG in the browser (Sarvam Vision takes JPG/PNG; Vercel caps request bodies at 4.5 MB).
- Nothing is stored or logged; only upstream HTTP status codes are logged.
- The API key lives only in the server-side env var `SARVAM_API_KEY`.
- Without a key the app still builds and runs; the **sample ticket** demo is clearly labelled as sample data.

## Deploy to Vercel (CLI)

```bash
npm install
npx vercel login                                # once
npx vercel link --yes                           # creates the Vercel project
npx vercel env add SARVAM_API_KEY production    # paste your Sarvam key when prompted
npx vercel --prod                               # deploy
```

## Run locally

```bash
npm install
npx vercel env pull .env.local                  # or create .env.local with SARVAM_API_KEY=...
npx vercel dev                                  # frontend + API on http://localhost:3000
```

`npm run dev` runs only the Vite frontend (the API will 404 there).

## Checks

```bash
npm run typecheck   # app + API
npm run build
```

## API

`GET /api/translate-ticket` → `{ configured: boolean, outputLanguages }`

`POST /api/translate-ticket` (multipart/form-data)

| field | required | notes |
|---|---|---|
| `file` | one of file/text | JPG or PNG, ≤ 4 MB |
| `text` | one of file/text | ≤ 8000 chars |
| `targetLanguage` | yes | `en-IN hi-IN bn-IN gu-IN kn-IN ml-IN mr-IN od-IN pa-IN ta-IN te-IN` |
| `ticketLanguage` | no | language printed on the ticket, for Sarvam Vision (default `en-IN`) |

Errors return `{ success: false, code, error }` with 400/405/413/415/422/429/502/503/504.

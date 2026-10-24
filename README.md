# Teach Me This File

A teacher uploads a file and writes a short prompt ("Teach this to 7th graders, in French. Be Socratic. Keep it under 15 minutes."). The app turns the file into a lesson plan and opens a chat where an AI tutor teaches it to a student, one step at a time: it explains one idea, asks a question, grades the answer, gives hints before answers, and moves on when the student shows they understood.

I built it as a home assignment for an AI Engineer role. The reasoning behind the main choices is in [DECISIONS.md](DECISIONS.md).

- Live app: https://teach-me-this-file.vercel.app
- Repository: https://github.com/GalHillel/teach-me-this-file
- Stack: React 19 + Vite + Tailwind CSS 4 (JavaScript) on the front end, Node.js + Express 5 on the back end, deployed on Vercel.
- AI: bring your own key. Google AI Studio (Gemini), Groq and OpenRouter keys work. The live app also has a Gemini key on the server, so it works without one; a key typed in the settings is used instead when present.

## What it does

- Upload a PDF (with selectable text), Word `.docx`, or `.txt` / `.md` file by drag and drop or file picker. The file is read in the browser and split into passages that keep their page, section or line numbers.
- Clear messages for files the app cannot use: empty, damaged, password protected, scanned PDFs without a text layer (no OCR), unsupported types, files over 25 MB.
- The teacher prompt sets age, style, length and goals. The lesson language is a separate choice (or taken from the prompt). Three editable examples are included, one in Hebrew.
- The server builds a structured lesson plan: objectives, the content type, 2 to 8 steps sized to the file and the time, and per step an approach (explanation, worked example or practice), a check question, success criteria, a common mistake, and the passages it is based on.
- Each student answer is graded first: verdict, completeness, concepts shown and missing, misconception, an evidence quote and a confidence level. The server checks the grade, then decides the next move in code: hint, stronger hint, a follow-up when the grader is unsure, an explanation followed by one more check after three tries, the next step, or a summary at the end.
- Tutor answers stream token by token. Stop cancels the request on the server and the provider, keeps the partial text, and leaves the lesson state unchanged.
- "Step 3 of 7" progress, a lesson plan panel with the outcome of each step, labels for what the tutor is doing (hint, follow-up, explanation, summary), and a summary card at the end with the steps worth reviewing.
- A source button under tutor messages opens the exact passage from the file, labelled "based on", "related" or "step material", with the shared words highlighted.
- The interface is in English, Hebrew or French, with a right-to-left layout for Hebrew. Lessons and documents can be right-to-left too.
- The lesson survives a reload in the same tab. The API key does not; it stays in memory only.
- If the main AI models are busy and a lighter backup model answers, the app says so.

## How it works

```
Browser                                               Server (Express on Vercel)
-------                                               --------------------------
File -> extract text (pdf.js / mammoth)
     -> passages with page labels
Teacher prompt + sampled passages -- POST /api/lessons -> planner: prompt -> JSON -> validated plan
                                  <-- plan + initial progress
Student answer + plan + progress  -- POST /api/turns  -> assessor: grade the answer (JSON), check the grade
  + current step passages                              progress.js: decide the move, new progress
                                  <-- SSE: progress    tutor: stream the reply for that move
                                  <-- SSE: notice      (only when a backup model answered)
                                  <-- SSE: delta ...
                                  <-- SSE: done
Commit the new progress on "done", match the reply to passages (BM25), save the chat to sessionStorage
```

The server is stateless. The lesson plan, progress and messages live in a React reducer in the browser and are sent with each turn. The rules that move the lesson forward are plain functions in `server/lesson/progress.js`, not something the model is asked to remember.

## Project structure

```
api/index.js                 Vercel entry, exports the Express app
server/
  app.js                     routes, error handling, SSE turn endpoint
  config.js                  environment variables with defaults
  serverKey.js               same-origin check and daily budget for the server key
  metrics.js                 in-memory counters shown by /api/health
  errors.js                  error codes, user-facing messages, provider error mapping
  validation.js              request validation and size limits
  rateLimit.js, sse.js       per-IP limit, event-stream writer with heartbeat
  lesson/planner.js          builds and validates the lesson plan
  lesson/assessor.js         grades a student answer and checks the grade
  lesson/progress.js         lesson state machine (pure functions)
  lesson/prompts.js          all prompts, untrusted-content fencing
  lesson/tutor.js            one turn: grade, decide, stream
  providers/                 Gemini (model tiers, cooldowns), OpenAI-compatible (Groq, OpenRouter), mock
shared/text.js               tokenizer, stopwords, BM25 ranking, text direction
src/
  App.jsx                    screens, settings, file reading
  api/                       fetch client and SSE reader
  document/                  PDF, Word and text extraction, chunking
  lesson/                    chat reducer, useTutor hook, source matching, session storage
  i18n/                      English, Hebrew and French strings, translator
  components/                UI
eval/                        golden sets and runners for source matching and grading
tests/                       Vitest unit and API tests
```

## Run it locally

Requirements: Node.js 20.12 or newer, npm.

```bash
npm install
cp .env.example .env    # optional, see below
npm run dev
```

`npm run dev` starts the API on port 8787 and Vite on port 5173 (Vite proxies `/api`). Open http://localhost:5173, click "Add API key" and paste a key.

Without a key you can still click through the whole flow: set `ALLOW_MOCK_PROVIDER=true` in `.env`, restart, and pick "Mock (local testing only)" in the settings. The mock returns canned text; it is there to test the UI and the lesson flow, not the teaching.

## API keys

Get a free key from one of:

- Google AI Studio: https://aistudio.google.com/apikey (default model `gemini-3.6-flash`, with fallbacks)
- Groq: https://console.groq.com/keys (default model `llama-3.3-70b-versatile`)
- OpenRouter: https://openrouter.ai/keys (default model `meta-llama/llama-3.3-70b-instruct:free`)

Paste it in the settings dialog. The provider is detected from the key prefix, or you can pick it. The key is kept in the page's memory only (a reload clears it), sent to the server in the `X-AI-Key` header with each request, passed on to the provider, and never stored or logged by the server.

As an option, the server can have its own key: set `AI_API_KEY` (and `AI_PROVIDER` if the prefix is not recognised) in the environment. A key typed in the settings always wins. The server key only answers same-origin requests from the app's own page and has a daily budget, so it can not be used through the API from elsewhere.

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8787` | Local API port |
| `AI_API_KEY` | empty | Optional server key, used when the request has no key (`GEMINI_API_KEY` also works) |
| `AI_PROVIDER` | detected | `gemini`, `groq` or `openrouter` for the server key |
| `SERVER_KEY_DAILY_LIMIT` | `400` | Requests per day the server key may serve, counted in memory per server instance; the key only answers same-origin requests from the app |
| `GEMINI_MODELS` | `gemini-3.6-flash,gemini-3.8-flash,gemini-2.5-flash` | Main Gemini models, tried in order when one is overloaded, slow, out of quota or unavailable |
| `GEMINI_BACKUP_MODELS` | `gemini-3.5-flash-lite` | Lighter models used only after the main ones fail; the UI tells the student when one answered |
| `GROQ_MODEL` | `llama-3.3-70b-versatile` | Model for Groq keys |
| `OPENROUTER_MODEL` | `meta-llama/llama-3.3-70b-instruct:free` | Model for OpenRouter keys |
| `PROVIDER_TIMEOUT_MS` | `20000` | Timeout for one model call, after which the next model is tried |
| `PROVIDER_DEADLINE_MS` | `45000` | Total time one AI call may spend across all models |
| `RATE_LIMIT_PER_MINUTE` | `30` | Requests per minute per IP on the AI endpoints |
| `ALLOW_MOCK_PROVIDER` | `false` | Enables the mock provider, for local testing only |

## Tests

```bash
npm test        # Vitest: extraction, chunking, source matching, state machine, grading checks, prompts, API, i18n, storage
npm run lint
npm run build
node eval/sources.js                                       # source matching on the golden set, no AI calls
EVAL_API_KEY=your-key EVAL_LABEL=mine node eval/grading.js # grading on 43 golden answers, real model calls
```

`eval/grading.js` writes its results to `eval/results/grading-<label>.json`: accuracy, how often a wrong or partial answer was graded correct, median latency, and which models answered.

The API tests run the real Express app with a mock provider: plan creation, SSE streaming, hint versus advance, request validation, provider errors as SSE `error` events, cancelling the provider call when the client disconnects, rate limiting, and a check that the key never reaches the logs. How I tested the AI's teaching behaviour with a real model is in [DECISIONS.md](DECISIONS.md#how-i-know-it-works).

## Deploy

The repo deploys to Vercel as is: Vite builds the front end to `dist/`, and `api/index.js` becomes one Node.js function that serves every `/api/*` route (see `vercel.json`).

1. Import the repository in Vercel. No settings are needed beyond the defaults read from `vercel.json`.
2. Optionally add `AI_API_KEY` in Project Settings > Environment Variables.
3. To deploy on every push to `main`, the project must be connected to the repository under Project Settings > Git. My project is not connected yet, so I deploy each commit by hand.

Any Node host works too: run `npm run build`, serve `dist/` as static files, and run `npm start` for the API behind the same origin.

## Known limitations

- No OCR. Scanned pages are detected and reported, but not read.
- Formulas and tables in PDFs come out as plain text, sometimes out of order. Word tables are kept as rows.
- Very long documents: the plan is built from up to about 60,000 characters sampled evenly across the file. Every passage is still used for the source panel.
- The lesson lives in the browser tab. A reload restores it; closing the tab ends it, and the key must be entered again after a reload.
- The rate limit, the server-key budget, model cooldowns and metrics are in memory, per server instance.
- The live app's own Gemini key is on the free tier and only answers requests from the site itself. If its daily quota is used up, the server falls back to Flash-Lite and says so, and when that is used up too, the app says the daily quota is used up. Adding your own key in the settings avoids this.

More in [DECISIONS.md](DECISIONS.md#weaknesses-i-know-about).

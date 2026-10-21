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
- The teacher prompt sets age, language, style, length and goals. Three editable examples are included, one in Hebrew.
- The server builds a structured lesson plan: objectives, 3 to 8 steps, a check question and success criteria per step, and the passages each step is based on.
- Each student answer is graded first (correct, partial, incorrect, a question, or off topic). The app then decides the next move in code: hint, stronger hint, show the answer after three tries, move to the next step, or finish with a summary, a final question and what to review.
- Tutor answers stream token by token. Stop cancels the request on the server and the provider, keeps the partial text, and leaves the lesson state unchanged.
- "Step 3 of 7" progress, a lesson plan panel with the outcome of each step, and a source button under tutor messages that opens the exact passage from the file with the shared words highlighted.
- Right-to-left lessons and documents (Hebrew, Arabic), math rendered with KaTeX, and a layout that works on a phone.

## How it works

```
Browser                                               Server (Express on Vercel)
-------                                               --------------------------
File -> extract text (pdf.js / mammoth)
     -> passages with page labels
Teacher prompt + sampled passages -- POST /api/lessons -> planner: prompt -> JSON -> validated plan
                                  <-- plan + initial progress
Student answer + plan + progress  -- POST /api/turns  -> assessor: grade the answer (JSON)
  + current step passages                              progress.js: decide the move, new progress
                                  <-- SSE: progress    tutor: stream the reply for that move
                                  <-- SSE: delta ...
                                  <-- SSE: done
Commit the new progress on "done", match the reply to passages for the source button
```

The server is stateless. The lesson plan, progress and messages live in a React reducer in the browser and are sent with each turn. The rules that move the lesson forward are plain functions in `server/lesson/progress.js`, not something the model is asked to remember.

## Project structure

```
api/index.js                 Vercel entry, exports the Express app
server/
  app.js                     routes, error handling, SSE turn endpoint
  config.js                  environment variables with defaults
  errors.js                  error codes, user-facing messages, provider error mapping
  validation.js              request validation and size limits
  rateLimit.js, sse.js       per-IP limit, event-stream writer with heartbeat
  lesson/planner.js          builds and validates the lesson plan
  lesson/assessor.js         grades a student answer
  lesson/progress.js         lesson state machine (pure functions)
  lesson/prompts.js          all prompts, untrusted-content fencing
  lesson/tutor.js            one turn: grade, decide, stream
  providers/                 Gemini, OpenAI-compatible (Groq, OpenRouter), mock for tests
shared/text.js               tokenizer, passage ranking, text direction
src/
  App.jsx                    screens, settings, file reading
  api/                       fetch client and SSE reader
  document/                  PDF, Word and text extraction, chunking
  lesson/                    chat reducer, useTutor hook, source matching
  components/                UI
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

- Google AI Studio: https://aistudio.google.com/apikey (default models `gemini-3.5-flash`, and `gemini-3.5-flash-lite` for grading, each with fallbacks)
- Groq: https://console.groq.com/keys (default model `llama-3.3-70b-versatile`)
- OpenRouter: https://openrouter.ai/keys (default model `meta-llama/llama-3.3-70b-instruct:free`)

Paste it in the settings dialog. The provider is detected from the key prefix, or you can pick it. The key is kept in the page's memory only (a reload clears it), sent to the server in the `X-AI-Key` header with each request, passed on to the provider, and never stored or logged by the server.

As an option, the server can have its own key: set `AI_API_KEY` (and `AI_PROVIDER` if the prefix is not recognised) in the environment. A key typed in the settings always wins.

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8787` | Local API port |
| `AI_API_KEY` | empty | Optional server key, used when the request has no key (`GEMINI_API_KEY` also works) |
| `AI_PROVIDER` | detected | `gemini`, `groq` or `openrouter` for the server key |
| `GEMINI_MODEL` | `gemini-3.5-flash,gemini-3.5-flash-lite,gemini-2.5-flash,gemini-flash-latest` | Gemini models for planning and teaching, tried in order when one is overloaded, slow, out of quota or unavailable |
| `GEMINI_GRADER_MODEL` | `gemini-3.5-flash-lite,gemini-flash-lite-latest,gemini-3.5-flash` | Gemini models that grade answers (faster, and a separate free-tier quota) |
| `GROQ_MODEL` | `llama-3.3-70b-versatile` | Model for Groq keys |
| `OPENROUTER_MODEL` | `meta-llama/llama-3.3-70b-instruct:free` | Model for OpenRouter keys |
| `GEMINI_TUTOR_THINKING_BUDGET` | `0` | Gemini thinking tokens for the streamed tutor reply. `0` makes the first words appear faster; leave empty for models that do not accept the setting |
| `PROVIDER_TIMEOUT_MS` | `25000` | Timeout for one provider call, after which the next Gemini model is tried |
| `RATE_LIMIT_PER_MINUTE` | `30` | Requests per minute per IP on the AI endpoints |
| `ALLOW_MOCK_PROVIDER` | `false` | Enables the mock provider, for local testing only |

## Tests

```bash
npm test        # Vitest: extraction, chunking, source matching, lesson state machine, prompts, API routes
npm run lint
npm run build
```

The API tests run the real Express app with a mock provider: plan creation, SSE streaming, hint versus advance, request validation, provider errors as SSE `error` events, cancelling the provider call when the client disconnects, rate limiting, and a check that the key never reaches the logs. How I tested the AI's teaching behaviour with a real model is in [DECISIONS.md](DECISIONS.md#how-i-know-it-works).

## Deploy

The repo deploys to Vercel as is: Vite builds the front end to `dist/`, and `api/index.js` becomes one Node.js function that serves every `/api/*` route (see `vercel.json`).

1. Import the repository in Vercel. No settings are needed beyond the defaults read from `vercel.json`.
2. Optionally add `AI_API_KEY` in Project Settings > Environment Variables.

Any Node host works too: run `npm run build`, serve `dist/` as static files, and run `npm start` for the API behind the same origin.

## Known limitations

- No OCR. Scanned pages are detected and reported, but not read.
- Formulas and tables in PDFs come out as plain text, sometimes out of order. Word tables are kept as rows.
- Very long documents: the plan is built from up to about 60,000 characters sampled evenly across the file. Every passage is still used for the source panel.
- The lesson lives in the browser tab. Reloading the page ends it.
- The rate limit is in memory, per server instance.

More in [DECISIONS.md](DECISIONS.md#weaknesses-i-know-about).

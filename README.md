# Teach Me This File

A teacher uploads a file and writes a short prompt ("Teach this to 7th graders, in French. Be Socratic. Keep it under 15 minutes."). The app turns the file into a lesson plan and opens a chat where an AI tutor teaches it to a student, one step at a time: it explains one idea, asks a question, grades the answer, gives hints before answers, and moves on when the student shows they understood.

I built it as a home assignment for an AI Engineer role. The reasoning behind the main choices is in [DECISIONS.md](DECISIONS.md).

- Live app: https://teach-me-this-file.vercel.app
- Repository: https://github.com/GalHillel/teach-me-this-file
- Stack: React 19 + Vite + Tailwind CSS 4 (JavaScript) on the front end, Node.js + Express 5 on the back end, deployed on Vercel.
- AI: bring your own key. Google AI Studio (Gemini), Groq and OpenRouter keys work. The live app also has a Gemini key on the server, so it works without one; a key typed in the settings is used instead when present.

## What it does

- Upload a PDF (with selectable text), Word `.docx`, or `.txt` / `.md` file by drag and drop or file picker, or start from one of two sample files (English and Hebrew). The file is read in the browser and split into passages that keep their page or line numbers and the heading they sit under. Running headers and footers that repeat on most PDF pages are removed, and identical passages are kept once.
- Clear messages for files the app cannot use: empty, damaged, password protected, scanned PDFs without a text layer (no OCR), unsupported types, files over 25 MB, and files whose content does not match their name (a renamed image is not read as a PDF).
- The teacher prompt sets age, style, length and goals. The lesson language is a separate choice (or taken from the prompt). Three editable examples are included, one in Hebrew.
- The server builds a structured lesson plan: objectives, the content type, 2 to 8 steps sized to the file and the time, and per step an approach (explanation, worked example or practice), a check question, success criteria, a common mistake, the steps it builds on, and the passages it is based on. Steps are put in an order where each comes after the steps it builds on.
- Each student answer is graded first: verdict, completeness, concepts shown and missing, misconception, what kind of problem it is (misread the question, unsure, does not know, right without the reasoning, copied from the file), an evidence quote and a confidence level. The server checks the grade, then decides the next move in code.
- The help after a wrong answer depends on the mistake: a small nudge first, then a focused hint, a counter-example when the grader names a misconception, smaller sub-questions, a worked example or an analogy when the student does not know, and the full explanation with one more check after three tries. The tutor picks a kind of help it has not used on the step yet, and repeats only after the options for that situation run out.
- When the grader says a wrong answer comes from an idea of an earlier step this one builds on (the code checks that the step really is one), or an earlier step was weak, the tutor checks that step first with one short question, grades the answer against it, and comes back to the current question. A failed check marks the earlier step for practice.
- A right answer to a smaller question (a sub-question, a counter-example) is not counted as understanding the step: the tutor confirms it and asks the whole question again, unless the answer already covers it.
- "Hint" and "Explain differently" buttons let the student ask for help before answering. A right answer after help counts as shown with help, not as understood on the first try.
- After the last step comes a short final check: up to three steps, chosen by how weak they were, how many steps build on them and how long ago they were taught, each with a new question that asks the student to use the idea, answered without hints. A copied answer, or one without the asked-for reason, gets one request to say it in their own words before it counts. It can be skipped.
- Tutor answers stream token by token. Stop cancels the request on the server and the provider, keeps the partial text, and leaves the lesson state unchanged.
- Progress shows what was shown for each step, not a percentage: applied to a new question, shown on your own, shown with help, or needs practice, with the reasons (first try, hints, full explanation, final check). The summary groups the steps this way, suggests when to review each one (1, 3, 7 or 14 days), offers a practice round for the weak ones, and downloads the notes as Markdown.
- A learning map shows the steps and which ones build on which, and marks each key concept as found in the file or not found in it.
- The student can ask a question at any point. The app finds the passages of the whole file that answer it and sends them with the turn, so the tutor can answer from the file without losing its place in the lesson.
- A search panel lists the lesson's key concepts and the file's sections, highlights matches, and says which step teaches each passage.
- The tutor cites the passages it uses, like [c3]. The server keeps only citations of passages the tutor was actually given and checks a quote that carries a passage id against the file; citations show as chips that open the passage, and a quote that is not in the file is flagged under the message. When the tutor cites nothing, the app falls back to matching the message to passages ("based on", "related" or "step material").
- The interface is in English, Hebrew or French, with a right-to-left layout for Hebrew. Lessons and documents can be right-to-left too.
- The lesson survives a reload in the same tab. The API key does not; it stays in memory only.
- If the main AI models are busy and a lighter backup model answers, the app says so.
- Keyboard: Esc stops a reply, a skip link jumps to the answer box, and new messages are announced to screen readers.

## A three-minute demo

This path shows what a plain chat with the file would not do. It uses the photosynthesis sample on the setup screen.

1. Start the lesson. The tutor teaches step 1 and asks what a plant takes in.
2. Answer "Plants get their food from the soil." The reply comes in a tinted panel labelled "Counter-example": a case where your idea predicts something that does not happen, not the answer.
3. Answer the counter-example correctly. The tutor does not move on; it says "Now the whole question" and asks the step's question again, because answering a smaller question is not the step.
4. Answer fully. Step 1 is marked "shown with help" in the plan, not "shown on your own".
5. Click a passage chip in any reply. The panel shows the exact text from the file, which the server checked the tutor was given.
6. On the last step, answer with a mistake from an earlier step ("it uses the green light the leaf absorbs"). The tutor goes back to that step with one short question, then returns to the original question.
7. After the last step comes the final check: new questions, no hints, the Hint button gone. Get one wrong.
8. The summary separates "applied to a new question" from "needs practice", suggests review dates, and offers a practice round for the weak step. The learning map shows which steps build on which.

Steps 3 and 6 depend on how the model grades the answer. In my live run on 25 October, step 3 went as described on the second try; on the first, the grader called the answer partial and the tutor gave a focused hint instead. The detour in step 6 happens only when the grader names the earlier step.

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
  lesson/ordering.js         prerequisite ordering of plan steps
  lesson/policy.js           which help to give, and when to check an earlier step
shared/text.js               tokenizer, stopwords, BM25 ranking, text direction
shared/lesson.js             evidence levels, final-check selection, review schedule (server and browser)
shared/citations.js          reads and checks the tutor's citations and quotes
src/
  App.jsx                    screens, settings, file reading
  api/                       fetch client and SSE reader
  document/                  PDF, Word and text extraction, structure (headers, headings), chunking
  lesson/                    chat reducer, useTutor hook, source matching and search, session storage
  samples/                   the two sample files
  i18n/                      English, Hebrew and French strings, translator
  components/                UI
eval/                        golden sets and runners for source matching, retrieval and grading; benchmark
tests/                       Vitest unit, property and API tests
tests/e2e/ui.mjs             browser harness: 15 viewports, English and Hebrew, axe-core, full lesson flow
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

As an option, the server can have its own key: set `AI_API_KEY` (and `AI_PROVIDER` if the prefix is not recognised) in the environment. A key typed in the settings always wins. The server key only answers requests that look like they come from the app's own page (`Sec-Fetch-Site: same-origin`, or a matching `Origin`) and has a daily budget. A browser on another site can not use it, but a script that forges those headers can, up to the budget. It is a brake on casual use, not access control.

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
| `PROVIDER_TIMEOUT_MS` | `15000` | Timeout for one model call during a lesson turn, after which the next model is tried |
| `PROVIDER_DEADLINE_MS` | `40000` | Total time one turn call may spend across all models |
| `PLAN_TIMEOUT_MS` | `35000` | Timeout for one model call while planning the lesson |
| `PLAN_DEADLINE_MS` | `75000` | Total time planning may spend across all models |
| `RATE_LIMIT_PER_MINUTE` | `30` | Requests per minute per IP on the AI endpoints |
| `ALLOW_MOCK_PROVIDER` | `false` | Enables the mock provider, for local testing only |

## Tests

```bash
npm test              # Vitest: extraction, chunking, source matching, state machine, grading checks, prompts, API, i18n, storage, property tests
npm run lint
npm run test:e2e      # builds, then runs the browser harness with the mock provider
npm run eval:sources  # source matching on the golden set, no AI calls
npm run eval:retrieval
npm run bench         # chunking, indexing and scoring times on synthetic documents
npm run eval:hybrid   # BM25 against character trigrams and their fusion, tuned on English, held out on Hebrew and French
npm run eval:load     # first-screen load time under CPU and network throttling
npm run eval:teaching # teaching scenarios through the engine with the labelled grades, dev and held-out, no AI calls
EVAL_API_KEY=your-key node eval/teaching.js --mode=model --split=holdout --systems=engine,plain # the same scenarios with a real model, and a plain single-prompt tutor as baseline
EVAL_API_KEY=your-key EVAL_LABEL=mine node eval/grading.js # grading on 51 golden answers, real model calls
```

`npm run test:e2e` uses the Chromium that Playwright installs (`npx playwright install chromium` once). It serves the build with the headers from `vercel.json`, checks every screen at 15 sizes from 320 to 2560 px in English and Hebrew for overflow, unreachable buttons, small targets and axe-core violations, runs a full lesson with help requests, a detour, a re-check, the final check and a practice round, reads a generated PDF, and fails on any problem. Two full journeys (English on desktop, Hebrew on a phone) also stop a reply, fail a provider call and retry it, reload during a reply and in the middle of the lesson, and check after every turn that the server's state, the saved state and what the screen shows agree. `--report=file.json` saves the details. It checks layout and flow with canned replies, not teaching quality.

`eval/teaching.js` plays 55 written scenarios (dev and held-out sets on different lessons) through the engine and checks what the tutor should detect, which help it should give and what it may claim; the design and the results are in [DECISIONS.md](DECISIONS.md#how-i-evaluate-the-teaching). In short: with the labelled grades the engine passes all 25 held-out scenarios it can run without a model; with a real model (Flash-Lite, the only one with quota) it passed 22 of 29 held-out scenarios against 16 for a plain single-prompt tutor with the same model and rules. These are scripted students, not real ones.

`eval/grading.js` writes its results to `eval/results/grading-<label>.json`: accuracy, how often a wrong or partial answer was graded correct, median latency, and which models answered.

The API tests run the real Express app with a mock provider: plan creation, SSE streaming, hint versus advance, request validation, provider errors as SSE `error` events, cancelling the provider call when the client disconnects, rate limiting, and a check that the key never reaches the logs. How I tested the AI's teaching behaviour with a real model is in [DECISIONS.md](DECISIONS.md#how-i-know-it-works).

## Deploy

The repo deploys to Vercel as is: Vite builds the front end to `dist/`, and `api/index.js` becomes one Node.js function that serves every `/api/*` route (see `vercel.json`).

1. Import the repository in Vercel. No settings are needed beyond the defaults read from `vercel.json`.
2. Optionally add `AI_API_KEY` in Project Settings > Environment Variables.
3. To deploy on every push to `main`, connect the project to the repository under Project Settings > Git. Mine is connected, so each push to `main` builds a production deployment.

Any Node host works too: run `npm run build`, serve `dist/` as static files, and run `npm start` for the API behind the same origin.

## Known limitations

- No OCR. Scanned pages are detected and reported, but not read.
- Formulas and tables in PDFs come out as plain text, sometimes out of order. Word tables are kept as rows.
- Very long documents: the plan is built from up to about 60,000 characters sampled evenly across the file. Every passage is still used for the source panel.
- The lesson lives in the browser tab. A reload restores it; closing the tab ends it, and the key must be entered again after a reload.
- The rate limit, the server-key budget, model cooldowns and metrics are in memory, per server instance.
- The leak check on the tutor's output catches only a verbatim copy of a marker in the instructions. It does not stop a model that paraphrases its instructions.
- Heading detection in PDFs uses font size, so a PDF that marks headings only with bold text of normal size gets no sections.
- The live app's own Gemini key is on the free tier and only answers requests from the site itself. If its daily quota is used up, the server falls back to Flash-Lite and says so, and when that is used up too, the app says the daily quota is used up. Adding your own key in the settings avoids this.
- Teaching quality is measured on 55 scenarios I wrote, with scripted students, and on a real model only with Flash-Lite. No study with students has been run.

More in [DECISIONS.md](DECISIONS.md#weaknesses-i-know-about).

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
- When the grader says a wrong answer comes from an idea of an earlier step this one builds on (the code checks that the step really is one), the tutor checks that step first with one short question, grades the answer against it, and comes back to the current question. It also goes back without the grader when the earlier step is fragile: after the second wrong answer if the earlier step was only right with help, after the first if it needed the full explanation or a later answer already showed a gap in it. The grader is shown the common mistake of each earlier step and the wrong ideas this student showed there.
- A right answer to a smaller question (a sub-question, a counter-example) is not counted as understanding the step: the tutor confirms it and asks the whole question again, unless the answer already covers it. After that, help on the step always asks the whole question.
- An answer pasted from the document or from the tutor's last message is caught, also when it is several sentences, and the tutor asks for the same answer in the student's own words. A reply to an answer that is not right never opens with praise; the server drops a praise word at the start of the reply.
- "Hint" and "Explain differently" buttons let the student ask for help before answering. A right answer after help counts as shown with help, not as understood on the first try.
- After the last step comes a short final check: up to three steps, chosen by how weak they were, how many steps build on them and how long ago they were taught. Each gets the transfer question the plan wrote for that step in advance, a new case that asks the student to use the idea, answered without hints and graded against the criteria written with it. A copied answer, or one without the asked-for reason, gets one request to say it in their own words before it counts. It can be skipped.
- Tutor answers stream token by token. Stop cancels the request on the server and the provider, keeps the partial text, and leaves the lesson state unchanged.
- Every graded answer is logged with the question it answered (the step's question, a smaller question, a check of an earlier step, a final-check or practice question), the help behind it (none, a hint, a smaller question, a worked solution, a reminder), the grade, the passages and the move the engine made with its reason. A state per step is derived from that log by one function: not checked yet, just starting, developing, shown on your own, or worth another look when a later answer showed a gap. A right answer after help is never counted as shown on your own, and neither is a copied, unsure or unexplained one; only an answer without help can bring a step back. Details in [LEARNER_MODEL.md](LEARNER_MODEL.md).
- Progress shows that state, not a percentage: the plan counts steps shown on your own next to steps done, each step says what it rests on ("you got it after a hint", "a later step showed this idea needs another look"), and help messages carry one line on why that help was given. The summary groups the steps by state, suggests when to review each one (1, 3, 7 or 14 days), offers a practice round for the weak ones, and downloads the notes as Markdown. The learning map also names the next action.
- A learning map shows the steps and which ones build on which, and marks each key concept as found in the file or not found in it.
- The student can ask a question at any point. The app finds the passages of the whole file that answer it and sends them with the turn, to the grader and to the tutor, so a question about a later part of the file is answered from the file instead of being treated as off-topic, and the lesson keeps its place.
- A search panel lists the lesson's key concepts and the file's sections, highlights matches, and says which step teaches each passage.
- The tutor cites the passages it uses, like [c3]. The server keeps only citations of passages the tutor was actually given and checks a quote that carries a passage id against the file; citations show as chips that open the passage, and a quote that is not in the file is flagged under the message. When the tutor cites nothing, the app falls back to matching the message to passages ("based on", "related" or "step material").
- The interface is in English, Hebrew or French, with a right-to-left layout for Hebrew. Lessons and documents can be right-to-left too.
- The lesson survives a reload in the same tab. The API key does not; it stays in memory only.
- If the main AI models are busy and a lighter backup model answers, the app says so.
- Keyboard: Esc stops a reply, a skip link jumps to the answer box, and new messages are announced to screen readers.

## A demo in under five minutes

This path shows what a plain chat with the file would not do. It uses the photosynthesis sample on the setup screen.

1. **Upload.** Pick the photosynthesis sample (or drop a file) and start the lesson.
2. **Concepts and prerequisites.** Open the learning map: each step, the steps it builds on, and each key concept marked as found in the file or not. The map also says what comes next.
3. **A wrong answer.** Answer "Plants get their food from the soil."
4. **The intervention.** The reply comes in a tinted panel labelled "Counter-example", with one line on why: one idea in the answer got mixed up. It is a case where your idea predicts something that does not happen, not the answer.
5. **Help is not mastery.** Answer the counter-example. The tutor does not move on; it asks the whole question again ("you answered the smaller part"). Answer fully. The step closes with "Counted as shown with help, because a hint came first", and the plan shows "Shown with help" and "0 of 3 shown on your own".
6. **Ask about another part.** Ask "What are the stomata?" The answer comes from the passage that covers it, cited, and the tutor returns to the current question.
7. **An earlier idea.** On the last step, answer with a mistake from an earlier step ("it uses the green light the leaf absorbs"). The tutor checks that step with one short question, then returns. The earlier step is now "Worth another look" in the plan, even after the right answer to the check, because that answer came after a reminder.
8. **Transfer on your own.** The final check asks new questions about the weakest steps, with no hints. Answer one correctly: that step becomes "shown on your own" with an independent answer behind it. Get one wrong.
9. **The learner model and the summary.** Open the learning map: each step's state and what it rests on, and the next action (practise the weak step). The summary groups the steps by state and offers a practice round.

Steps 4, 5 and 7 depend on how the model grades the answer. The detour in step 7 happens only when the grader names the earlier step, or when that step was fragile.

I ran the same kind of path on the live site with a real model on 27 October, in English on a desktop and in Hebrew on a phone, writing each answer after reading the question the model had generated. Upload, plan, a right answer, a mistake, help that fit the mistake, a question about another section, the final check and an honest summary all worked in both languages. The return to the whole question failed once in English (a fill-in-the-blank hint, then a one-word answer, completed the step); that is fixed in the code, and the details are in [DECISIONS.md](DECISIONS.md#production-on-27-october).

### Offline demo

```bash
npm install
npm run demo        # http://localhost:4400
```

This builds the app and serves it with scripted replies instead of a model, for when there is no key or no quota. Every screen shows a banner saying that no AI model is used. The scripted grader reads keywords: an answer containing "wrong" is a mistake with a misconception (a counter-example follows), "partly" is a partial answer, "gap" is a mistake from an earlier step (a detour from step 2 on), one ending with "?" is a question, and anything else is right. With these the demo steps above run in English or Hebrew, including the learner states, the "why" lines and the next action. The replies are canned text: this shows the flow, the state machine and the learner model, not the teaching. Say so when you show it.

When things go wrong, these are the paths I have seen on the live site and how the app recovers:

- **An answer to a different question.** If the student answers something the tutor did not ask, the grader calls it a misread question. The tutor says so and asks again in simpler words, and the attempt is not counted. On 26 October this happened to my own scripted answers, which did not fit the first step the model had planned.
- **A pasted answer.** Paste a sentence from the passage. The tutor asks for the same answer in your own words instead of moving on.
- **A failed request.** Turn off the network, or hit the provider's rate limit, and send an answer. The message says what happened, and Try again sends the same answer once. The lesson state does not change in between.
- **Stop.** Press Stop or Esc during a reply. The partial text stays, marked as stopped, and the step is not counted.
- **The day's quota runs out during a demo.** The site moves to a lighter model and says so in a notice; when that is used up too, the message says the daily quota is used up. Switch to a key of your own in the settings, or to `npm run demo` and say that the replies are scripted.
- **A slow or failed reply.** A reply that times out keeps its partial text, marked as failed, and Try again sends the same answer; the lesson state changes only when a reply finishes.
- **The tutor's own mistake.** After a counter-example, the grader sometimes counted a narrow answer as the whole step (AUDIT 84), and on 27 October a fill-in-the-blank hint let a one-word answer through (AUDIT 89). After any help that narrows the question, the app now asks the whole question before the step counts, so this costs one extra question instead of a false "understood".

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

The server is stateless. The lesson plan, progress and messages live in a React reducer in the browser and are sent with each turn. The rules that move the lesson forward are plain functions in `server/lesson/progress.js`, not something the model is asked to remember. Each move comes with a reason code, and each graded answer is appended to an evidence log inside the progress object; the server validates the log like the rest of the progress, and the browser adds the id of the student message each entry came from. `shared/learner.js` turns the log into the learner state that the policy, the final check, the practice list and the interface all read.

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
shared/learner.js            learner state per step from the evidence log (server and browser)
shared/lesson.js             levels read from the learner state, final-check selection, review schedule
shared/citations.js          reads and checks the tutor's citations and quotes
src/
  App.jsx                    screens, settings, file reading
  api/                       fetch client and SSE reader
  document/                  PDF, Word and text extraction, structure (headers, headings), chunking
  lesson/                    chat reducer, useTutor hook, what the progress view shows, source matching and search, session storage
  samples/                   the two sample files
  i18n/                      English, Hebrew and French strings, translator
  components/                UI
eval/                        golden sets and runners for source matching, retrieval, grading and teaching; benchmark
pilot/                       protocol and documents for a small user pilot (not run yet)
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

Without a key you can still click through the whole flow with `npm run demo` (see "Offline demo" above), or set `ALLOW_MOCK_PROVIDER=true` in `.env`, restart, and pick "Mock (local testing only)" in the settings. The mock returns canned text; it is there to test the UI and the lesson flow, not the teaching.

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
| `DEMO_MODE` | `false` | Set by `npm run demo`; the app shows the offline-demo banner |

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
EVAL_API_KEY=your-key node eval/teaching.js --mode=model --split=holdout2 --systems=engine,plain --label=mine # the same scenarios with a real model, and a plain single-prompt tutor as baseline; add --resume to continue an interrupted run
EVAL_API_KEY=your-key EVAL_LABEL=mine node eval/grading.js # grading on 51 golden answers, real model calls; EVAL_RESUME=1 continues
```

Both model evals can also run without a key on the machine: `--provider=remote` (or `EVAL_PROVIDER=remote`) with `EVAL_REMOTE_URL` set to a deployment of the `eval/remote-model` branch sends each model call from a browser page on that deployment, so the key stays in the deployment's environment. That branch adds the model-call route the eval needs and is not merged into `main`.

`npm run test:e2e` uses the Chromium that Playwright installs (`npx playwright install chromium` once). It serves the build with the headers from `vercel.json`, checks every screen at 15 sizes from 320 to 2560 px in English and Hebrew for overflow, unreachable buttons, small targets and axe-core violations, runs a full lesson with help requests, a detour, a re-check, the final check and a practice round, reads a generated PDF, and fails on any problem. Two full journeys (English on desktop, Hebrew on a phone) also stop a reply, fail a provider call and retry it, reload during a reply and in the middle of the lesson, and check after every turn that the server's state, the saved state and what the screen shows agree. `--report=file.json` saves the details. It checks layout and flow with canned replies, not teaching quality.

`eval/teaching.js` plays 147 written scenarios (a dev set, four held-out sets, the round-9 final set and a few regression scenarios; each held-out set and the final set was written and committed before its first run) through the engine and checks what the tutor should detect, which help it should give, what it may claim and, on held-out-4, which learner state each step should end in; the design and the results are in [DECISIONS.md](DECISIONS.md#how-i-evaluate-the-teaching) and [LEARNER_MODEL.md](LEARNER_MODEL.md). In short: on held-out-4, with Flash-Lite for every call, the engine with the learner model claimed no step as shown on your own that was not (0 of 16, against 2 of 16 without it), went back to the earlier step in 3 of 4 prerequisite scenarios (2 of 4 without it) and passed 17 of 21 scenarios, against 14 for the previous engine and 10 for a plain single-prompt tutor; outside the 4 scenarios that test the new rules the engines pass the same 14 of 17. These are scripted students, not real ones, one run each, on scenarios I wrote.

In round 9 I pre-registered a comparison on a new set before running it ([eval/PREREGISTRATION.md](eval/PREREGISTRATION.md)) and tagged each scenario as written for the learner model's rules or not. Over three repeats on Flash-Lite: on the 18 scenarios not written for those rules the two engines pass about the same, 16, 16 and 16 against 14, 17 and 15, and the plain tutor 10, 12 and 10; on the 6 that test the rules the learner-model engine passes 17 of 18 runs and the other 0 of 18. `node eval/compare.js --run=b:1:eval/results/runs/r9-final-rep1-b ...` recomputes every measure, including how often a reply answers the next check question before asking it, and how often a right answer is asked again.

A model run saves each scenario as it finishes to `eval/results/runs/<label>/results.jsonl`, with every turn, next to a meta file (commit, engine, prompt and scenario hashes, models) and a summary that counts complete, failed and not-run scenarios. It never overwrites a run, and `--resume` refuses to continue if the code, prompts, scenarios or models changed.

`eval/grading.js` saves each answer to `eval/results/grading-<label>.jsonl` and writes the summary to `eval/results/grading-<label>.json`: accuracy, how often a wrong or partial answer was graded correct, median latency, and which models answered.

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
- Teaching quality is measured on 117 scenarios I wrote, with scripted students, and system comparisons only with Flash-Lite, one run each. No study with students has been run; `pilot/PROTOCOL.md` is ready for one, with a comparison against reading alone.
- The learner states describe this lesson only. "Worth another look" means a later answer in the lesson missed the idea, not that it was forgotten; the app keeps nothing between lessons.

More in [DECISIONS.md](DECISIONS.md#weaknesses-i-know-about).

# Audit, 24 October 2026

I audited the version at commit `35b9e91`, which was the deployed version (a local tag `restore/before-upgrade-2026-10-24` points to it). This file lists what I found and what happened to each finding. The requirements matrix at the end shows how each requirement is checked now. "Live" means checked on https://teach-me-this-file.vercel.app after deploying commit `eb94efc` on 24 October.

Severity: Critical (breaks the core flow or leaks secrets), High (wrong teaching, abuse risk, or a requirement only half met), Medium (noticeable quality gap), Low (polish).

## Findings

| # | Sev. | Area | Problem | Evidence | Impact | Fix | How it was verified | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | High | Security | The Gemini key was pasted into the chat and is set as the server key, so the public site and anyone calling `/api/*` directly spend it. | `AI_API_KEY` set in Vercel for Production. `/api/health` returns `serverKey: true`. No origin check. | Quota can be exhausted by strangers, and the key should count as leaked. | Server-key requests now need a same-origin browser request and have a daily budget, counted per instance. The owner rotates the key. | API tests for origin and budget; live: a direct `curl` to `/api/lessons` gets 403 `server_key_restricted` | Fixed in code; key rotation is the owner's step |
| 2 | High | AI | When grading fails or keeps returning `off_topic`, the student can stay on a step forever, because those verdicts never count as attempts. | `planMove` returns `redirect` or `respond` without changing state. Live run on 21 Oct: a full on-topic answer was graded "Off topic" twice. | The lesson stalls and the student gets no feedback. | Explicit step state with `stalls`. After 2 non-answers in a row, the next one counts as an attempt. | `tests/progress.test.js`, including a test that no sequence of messages keeps a step active | Fixed |
| 3 | High | AI | Fallback switched silently to Flash-Lite, which graded worse in live tests. | Model list ended with `gemini-3.5-flash-lite`. No signal to the client. | Wrong verdicts move the lesson, and the user has no idea quality dropped. | Models are split into a main and a backup tier. The backup is used only after the main models fail; the turn sends a `backup_model` notice and the UI shows a banner. | Provider and API tests. Not seen live, because no live run fell back to the backup tier | Fixed, live path not observed |
| 4 | High | AI | After three failed tries the tutor gave the answer and moved on with no check. The step was marked revealed, but the student never showed understanding. | `reveal_and_advance` completed the step immediately. | Weak learning, and the review list was the only trace. | A `recheck` phase: explain, then ask one easier question on the same step. The outcome is `recovered` or `review`. | Unit tests, live lesson run | Fixed |
| 5 | Medium | AI | The assessment had no confidence, evidence or concept data, so the engine could not tell a sure "correct" from a guess. | `assessor.js` returned verdict plus three notes. | Uncertain "correct" verdicts moved the lesson on. | Structured assessment (correctness, completeness, concepts, misconception, confidence, evidence quote). It is validated on the server, and evidence must quote the student. A low-confidence "correct" triggers one short probe question. | Unit tests, live grading eval | Fixed |
| 6 | Medium | Algorithms | The source matcher attached a second, unrelated passage to most messages, and matched a generic "well done" message to page 1. | Golden set (39 cases): 21 wrong extra sources, 1 false match, 1 miss. | The source button points at the wrong text. | BM25 with stopwords, light Hebrew prefix handling, a second source only when close to the first, and "based on" vs "related" labels. Matching is limited to the passages the tutor actually received. | `eval/sources.js`: extra sources 21 to 1, false matches 1 to 0, top-1 97% to 94% (one tie, still shown second). `tests/sources.test.js` fails on regressions | Fixed |
| 7 | Medium | Reliability | The fallback chain could wait 25 s on each of four models (about 100 s). It also retried models known to be out of daily quota on every request. | `PROVIDER_TIMEOUT_MS=25000`, no memory of failures. | Very slow failures. | Per-call timeout plus an overall deadline, and a short in-memory cooldown per key and model after 503, timeout or daily quota. | Provider tests | Fixed |
| 8 | Medium | Provider | The default model `gemini-3.5-flash` is an alias that is not in Google's model list. It resolves to 3.6 Flash. `thinkingLevel` is rejected by 2.5 Flash. | Live probe 24 Oct: `gemini-3.5-flash` answered with `modelVersion: gemini-3.6-flash`; `gemini-2.5-flash` + `thinkingLevel` gave 400. | Stale names, and settings that break some models. | Documented model IDs, plus a small capability table that sends `thinkingLevel: low` only to models that accept it. | Live probe, provider tests | Fixed |
| 9 | Medium | UX | All UI text was hard-coded in English. Document, lesson and UI language were not separated, and the teacher could set the lesson language only by writing it in the prompt. | Strings inside components. | Hebrew-speaking teachers get an English UI; the language choice is implicit. | Small i18n module (English, Hebrew, French) with RTL layout for Hebrew, plus an explicit lesson-language choice. | Key-coverage test; live browser runs in Hebrew on desktop and phone | Fixed |
| 10 | Medium | UX | A reload lost the lesson. | State only in React. | A phone switching apps can end the lesson. | The lesson is saved in `sessionStorage` (this tab only, no key) and restored on reload with a notice. "New lesson" clears it. | Storage tests; live reload check | Fixed |
| 11 | Medium | UX | Hints, answers and summaries looked the same as normal explanations, and the end of a lesson had no summary view. | `ChatMessage` rendered every tutor message the same way. | It is harder to follow what the tutor is doing. | Messages are labelled by move (Hint, Follow-up question, Explanation and one more check, Lesson summary). A summary card shows outcomes and steps to review. Clicking a finished step scrolls to where it was taught. | Reducer tests; live lesson runs | Fixed |
| 12 | Medium | Process | Pushing to GitHub did not trigger a Vercel deployment, so every deploy was manual. | No deployments for pushed commits. | The live site can drift from `main`. | The project has no Git connection in Vercel (the project API returns no `link`), so pushes can not trigger builds. Connecting it is an account setting for the owner. Until then I deploy each commit by hand and check that the served bundle matches the build. | Project API; served bundle hash compared with the local build | Open, owner action |
| 13 | Low | Security | `trust proxy` was `true`. | `app.set('trust proxy', true)` | Behind other hosts the rate limit could be bypassed with a forged `X-Forwarded-For`. On Vercel the header is overwritten. | Trust one hop. | API test | Fixed |
| 14 | Low | Product | No warning for documents with very little text, and no note on what leaves the browser. | `prepareDocument` | Thin lessons; privacy unclear. | Short-document warning; privacy line on the setup screen. | Unit test | Fixed |
| 15 | Low | Security | Prompt-injection defences are prompt-level only. | `fence()` and instructions. | A model can still be talked into things. | Kept the layers, added grader-instruction cases to the golden eval and a server check that refuses a "correct" for answers that instruct the grader. Documented the limit. | Assessor tests, live grading eval | Reduced, not solved |

Checked and fine:

- **Markdown XSS:** `react-markdown` without `rehype-raw` escapes HTML, and its URL transform drops `javascript:` links. A test now covers this.
- **Key in logs:** an existing test covers it, and the provider log lines contain only the task, model, status and timing.
- **CORS:** no CORS headers are set, so browsers cannot read the API from other origins.
- **Double send:** guarded by the controller ref.
- **Stop:** aborts the provider fetch. A test checks the signal.

## Second audit, 24 October, evening

I re-audited production (`13d5def`) without relying on the earlier report. Baseline numbers are in `eval/results/*-baseline.*` and in the browser harness report (`tests/e2e/ui.mjs`, production build with the mock provider, 15 viewports, English and Hebrew, axe-core).

| # | Sev. | Area | Problem | Evidence | Plan | Verification | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 16 | High | Responsive | At 320 px the lesson toolbar overflows and the "Show the lesson plan" button sits under the progress bar and header, so it can not be tapped. | Harness: click blocked, element intercepted by the progress bar. | Let the toolbar wrap; shrink the progress bar on narrow screens. | Harness at 320 to 2560 px | Open |
| 17 | High | RTL | In Hebrew on a phone, the side sheets (plan, source) render partly off-screen; the close button is unreachable. | Harness: `button[סגירה]` off-screen at 320 px, Hebrew. | Position the sheet with logical properties and full width on small screens. | Harness, Hebrew | Open |
| 18 | Medium | Accessibility | The scrolling body of dialogs can not receive keyboard focus (axe `scrollable-region-focusable`, serious). | axe on 4 screens. | Make the scroll region focusable and labelled. | axe in the harness | Open |
| 19 | Medium | Robustness | A late `delta` or `done` event after Stop crashes the chat reducer. The current client stops reading on abort, so this is latent. | Reproduced in a test: `Cannot read properties of undefined (reading 'id')`. | Ignore stream events when no turn is open; property tests over event orders. | Reducer property tests | Open |
| 20 | Medium | Retrieval | Short student questions find no passage: 10 of 27 answerable questions show nothing, because a match needs two shared words. During a turn the tutor only sees the current and next step's passages, so questions about other parts of the file get weak answers. | `eval/retrieval.js` baseline: question recall of shown sources 0.60, MRR 0.87. | A question retriever over the whole file with its own abstention rule, sent with the turn. Tune on English documents, report Hebrew and French as held out. | Retrieval eval, API test | Open |
| 21 | Medium | Documents | PDF headers and footers that repeat on every page become part of every passage, and headings are not kept, so passages have no section. | Code review of `pdf.js` and `chunk.js`. | Drop lines that repeat on most pages; detect headings and keep a section per passage. | Unit tests with fixtures | Open |
| 22 | Medium | Teaching | The planner's step order is trusted as is. There are no prerequisites and no check for cycles. | `validatePlan` keeps the model's order. | Ask for prerequisites, validate them, order steps topologically with document order as the tie-break, break cycles deterministically. | Unit and property tests | Open |
| 23 | Medium | Teaching | The grade can not tell a misread question, a hedged right answer, real lack of knowledge, or a right answer without the reasoning that was asked for. All become a hint. | Assessment schema. | An `issue` field with a closed set of values and a matching move for each. | Assessor and state-machine tests, grading eval | Open |
| 24 | Medium | Teaching | Steps marked for review are listed at the end, but there is no way to practise them. | Completion card. | A review round over the weak steps, driven by the same state machine. | State-machine and reducer tests, browser run | Open |
| 25 | Medium | Security | No security headers: no CSP, `X-Content-Type-Options`, `Referrer-Policy` or `frame-ancestors`. | Production response headers. | Headers in `vercel.json`, checked by the harness, which serves the same headers. | Harness, live headers | Open |
| 26 | Medium | Security | `body-parser` (through Express) has a high-severity advisory (denial of service on trailing bytes); the fix is a patch release. | `npm audit`. | `npm audit fix` without breaking upgrades. | `npm audit` | Open |
| 27 | Low | Security | KaTeX has low-severity advisories; `npm audit` suggests a "fix" that is a large downgrade. KaTeX runs with `trust: false`, so `\href` and similar are disabled. | `npm audit`. | Keep the current version, document the reason. | Review | Open |
| 28 | Medium | Privacy | Fonts load from Google Fonts, so every visitor's browser contacts Google, and a strict CSP has to allow it. | `index.html`. | Self-host the fonts from npm packages. | Harness: no external requests | Open |
| 29 | Medium | Reliability | One model call may wait 20 s before falling back; a live turn waited 21 s for its first word. | Live check 14 on 24 October. | Shorter per-call timeouts for grading and teaching, kept configurable. | Provider tests | Open |
| 30 | Medium | Security | Nothing checks the tutor's output for leaked instructions. | Code review. | A per-request canary in the system prompt; a reply that contains it is stopped and replaced by an error. | API test | Open |
| 31 | Low | RTL | In right-to-left lessons, code and formulas inherit the paragraph direction. | `index.css`. | Isolate code, `pre` and KaTeX as left-to-right. | Visual check in the harness | Open |
| 32 | Low | Performance | The KaTeX stylesheet loads on the setup screen. | `main.jsx` imports it. | Load it with the lesson screen. | Build output | Open |
| 33 | Low | Keyboard | Esc does not stop a streaming reply; there is no skip link to the answer box. | Manual check. | Esc to stop; a skip link. | Harness | Open |

## Requirements matrix

Status after the upgrade. "Live" refers to the browser runs against production on 24 October, listed in [DECISIONS.md](DECISIONS.md#live-checks-24-october).

| Requirement | Implementation | Test | Status |
| --- | --- | --- | --- |
| Upload PDF, Word or text; clear errors for bad files | `src/document/*` | `tests/document.test.js`; live with PDF and text files; bad-file cases from 21 October | Done |
| Teacher prompt sets audience, language, style, length, goals | `prompts.js`, `planner.js` (`minutesFromPrompt`, `maxStepsFor`) | `tests/planner.test.js`; live | Done |
| Structured lesson plan with objectives, steps, checkpoints, sources, completion criteria | `planner.js` `validatePlan` | `tests/planner.test.js`; live | Done |
| Teach one step at a time and check understanding | `progress.js`, `tutor.js` | `tests/progress.test.js`, `tests/api.test.js`; live | Done |
| Structured assessment, validated on the server | `assessor.js` | `tests/assessor.test.js`; grading eval | Done |
| State machine always exits; re-check after an explanation | `progress.js` | `tests/progress.test.js`; live re-check and recovery | Done |
| Streaming | `sse.js`, `src/api/sse.js` | `tests/api.test.js`, `tests/chat.test.js`; live | Done |
| Real Stop that leaves the state unchanged | `app.js` abort, `chatReducer.js` | API cancel test, reducer test; live | Done |
| Sources without invented page numbers; based / related / step | `src/lesson/sources.js`, `shared/text.js` | `tests/sources.test.js`, `eval/sources.js`; live | Done |
| Right-to-left lessons and interface | `i18n`, `directionForLanguage`, logical CSS | translation test; live Hebrew desktop and phone | Done |
| Separate interface, document, lesson and student languages | `i18n`, `lessonLanguage` in the plan request | planner and translation tests; live | Done |
| Phone layout | responsive layout, plan sheet | live at 390 px, no horizontal scroll | Done |
| Error messages with a way out | `errors.js`, `ErrorNotice`, `SetupScreen` | API tests; live invalid key and provider failure | Done |
| Key never stored or logged | `client.js`, `storage.js`, providers | key-in-logs test, storage test | Done |
| Server key not usable from outside the site | `serverKey.js`, `app.js` | API tests; live 403 | Done |
| No silent switch to a weaker model | `gemini.js` tiers, `notice` event, banner | provider, API and reducer tests | Done, banner not seen live |
| Lesson survives a reload | `storage.js`, `useTutor.js` | storage and reducer tests; live | Done |
| Lesson end has value: summary and review list | `CompletionCard`, `lessonSummary` | reducer test; live | Done |
| Golden data and eval with real metrics | `eval/` | runs recorded in `eval/results/` | Done |
| Production matches `main` | manual deploy per commit | served bundle compared with the build | Done by hand; automatic deploy needs the Git connection (finding 12) |

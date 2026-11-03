# Decisions

The assignment asks for the main choices, what I left out, the weaknesses I know, what I would do with four more hours, and how I know it works. I built this over more time than the suggested four hours, in rounds; the last section summarises what the earlier rounds taught me, including the results that went against me. The full round-by-round record is kept in the `archive` branch.

## Main decisions and why

### 1. The code decides what happens next; the model only writes

The model has three narrow jobs: write a lesson plan as JSON, grade one answer as JSON, and write the message for a move that the code has already chosen. The move itself comes from pure functions (`server/lesson/progress.js`, `policy.js`) that take the lesson state and the grade and return a move ("hint", "advance", "check an earlier step", "probe", ...) with a reason code.

Why: a single "be a good Socratic tutor" prompt forgets where it is, moves on after a lucky guess and praises wrong answers. Rules in code are testable, the same every time, and explainable: every message in the chat can show why it was sent ("Why a hint: the answer is not complete yet."). Every grade is also checked in code before it is used (`server/lesson/assessor.js`): the evidence quote must be in the student's answer, "correct" with low completeness becomes "partial", an instruction to the grader is treated as off topic, and a copy of the file or of the tutor's own words is a copy whatever the model said.

Cost: two model calls per answer (grade, then reply) instead of one, and more code than a single prompt.

### 2. The lesson state lives in the browser, and the server is stateless

The plan, the progress of each step, the evidence log and the messages are in a React reducer (`src/lesson/chatReducer.js`) and in sessionStorage, not in the chat history. Each turn sends the state to the server, which validates it (`server/validation.js`), decides the move, and returns the new state in the same SSE stream as the reply. The browser commits the new state only when the reply finishes, so a stopped or failed reply leaves the lesson where it was.

Why: free serverless hosting has no memory between requests and a sleeping server, and the assignment asks for state outside the chat. Keeping the state in the browser means no database, no accounts and nothing to clean up; a reload in the same tab restores the lesson. The cost is a larger request body (capped) and a lesson that does not move between devices.

### 3. Teach first, check after

A step starts in a `teach` phase. The explanation is written from a prompt that does not contain the step's check question or its success criteria, and ends by inviting the student to react. The student's reply is not graded; then the check question comes in its own message, with no hints. A question the student asks in between is answered first.

Why: in earlier versions one message taught the idea and asked the question about it, so the explanation often contained the answer, and a student who repeated it was credited with understanding. A prompt instruction ("do not answer the check question") reduced this but did not remove it (16 of 36 next-step replies still did). Separating the two messages fixed the question message (0 of 12 next steps on the real model contained the answer). The explanation still states the idea most of the time, which is what teaching is, so the grader is also shown the tutor's messages on the step and says whether they already gave the answer. A right answer after that is logged as "shown with help", never "shown on your own".

Cost: one more turn and one more model call per step.

### 4. Progress is an evidence log with one function that reads it

Every graded answer is appended to a log in the progress object: which step, which kind of question (the step's own, a smaller one after help, a check of an earlier step, a final-check or practice question), how much help came before it (none, a hint, a smaller question, a worked solution, a reminder, the answer already shown), the grade and the move. `shared/learner.js` derives each step's state from the log: not checked yet, emerging, developing (right only with help), shown on your own (right with no help), or worth another look (a later answer missed it). The same function is used by the server policy, the plan panel, the final check and the summary.

Why: "step 3 of 7" says where the lesson is, not what the student showed. With a log, every state points at the answers behind it, and four rules keep the claims honest: a right answer after a smaller question, a worked solution or a reminder is never "shown on your own"; nor is a copied, unsure or unexplained answer; a gap found later moves a shown step back; only an answer without help can bring it back. The final check picks the weakest steps and asks a new case without hints, which is the only way a step that was taught with help can become "shown on your own". The summary may only claim what the log supports.

I rejected a probability model (knowledge tracing): it needs parameters fitted on real learners, which do not exist here, and a number would suggest precision the data does not have.

### 5. Sources are passages with labels, and citations are checked

The file is read in the browser and split into passages that keep their page or line label and section heading. The plan links each step to passages. Each turn sends the step's passages, plus the passages that best match the student's message (BM25), so a question about a later part of the file is answered from the file. The tutor cites passages as `[c3]`; the server keeps only ids of passages it was given and checks any quoted sentence against the file (`shared/citations.js`). The UI shows citations as chips that open the passage, and a quote that is not in the file is flagged. When the file does not cover a question, the prompt requires the tutor to say so before giving general knowledge.

Why BM25 and not embeddings: the files are one document of school material, the queries are short, and BM25 needs no model, no index service and no extra cost. On the golden set the right passage is the top match for 96% of tutor messages and among the top three for 94% of student questions (`npm run eval:retrieval`). File text and student messages are fenced as data in every prompt, and a canary in the tutor's instructions stops a reply that starts to reveal them.

### 6. Files are read in the browser

PDF (pdf.js), Word (mammoth) and text are parsed in the browser; the server only receives the passages. This avoids the request-size limit of serverless functions for the file itself, keeps the original file on the user's machine, and gives immediate, specific errors: empty, damaged, password-protected, renamed, unsupported, scanned. There is no OCR: a scanned PDF is refused with a message that says why and what to do, and scanned pages in a mixed PDF are skipped and listed. Long files are planned from a sample of passages across the file, and the file card says so.

### 7. The reviewer's key, and the server key as an extra

The key typed in the settings lives in React state only. It is sent to this app's server in the `X-AI-Key` header with each AI request, passed to the provider and dropped. It is never in a URL, never in sessionStorage (a test checks what is stored), never returned to the browser and never logged (a test checks the logs). A typed key always wins over the server key. The provider is detected from the key prefix (Gemini, Groq, OpenRouter) or chosen.

The live site also has a free-tier Gemini key, so it works for someone without a key. It only answers same-origin requests and has a daily budget. That is a brake, not access control. The header says which key is in use ("Demo key · use yours").

### 8. Streaming and stopping

Replies stream as server-sent events over a POST (`progress`, then `delta` chunks, then `done` with the citations, or `error`). Stop or Esc aborts the fetch; the server sees the closed connection and aborts the provider request. The partial text stays, marked as stopped, and the lesson state does not change. Each model call has a timeout and each turn a deadline, sized to fit a serverless function; when a model is busy, slow or out of quota, the next one is tried and the UI says when a lighter backup model answered.

## What I decided not to do, and why

- **OCR.** It needs a paid service or a heavy model in the browser, and for school worksheets its errors would be taught as facts. A clear refusal with a way forward is safer.
- **A database, accounts or saved lessons.** Not needed for one lesson in one sitting, and each would bring privacy and hosting work.
- **Embeddings or a vector store.** BM25 is enough for one document; I tried fusing BM25 with character trigrams: it helped on the English set it was tuned on and changed nothing on the held-out Hebrew and French questions.
- **An agent framework or a single tutor prompt.** See decision 1. A plain single-prompt tutor was my baseline in every comparison and passed the fewest scenarios.
- **A probability model of the learner.** See decision 4.
- **More grader rules for edge cases.** In round 9 I added two rules for specific grading mistakes. An ablation showed that one of them caused a new regression and the two together another, and neither had a measured benefit, so both were removed.
- **PowerPoint, old `.doc`, images, audio.** Not needed to show the core; they are refused with a clear message.
- **Claims about learning.** I wrote a protocol for a small pilot with students, but did not run it, so nothing here says students learn better.

## Known weaknesses

- **The explanation usually states the idea.** So most first right answers count as "shown with help", and a student who already knew the idea is under-credited until the final check.
- **The grader is a model.** It was right on 48 of 51 golden answers and never marked a wrong or partial answer correct, but in conversations it sometimes calls a related question off topic, or grades an answer to an earlier-step check as answering a different question. Whether the explanation already gave the answer is also a model judgement; it was wrong once in nine checks, in the direction that lowers the claim.
- **An earlier-step check can state that step's answer before asking it,** and a mistake from an earlier step sends the student back even when the current step teaches the same idea.
- **Free-tier limits.** The production key's models are often slow: on 2 November one Hebrew lesson lost its closing summary to two timeouts, and on 3 November 2 of 15 turns timed out. The state is kept and Try again resends, but the student waits.
- **Model behaviour depends on the model.** With the default English prompt and a Hebrew file, one model taught in English (as the prompt rule says) and another in Hebrew; choosing the lesson language removes the ambiguity.
- **Files.** No OCR; formulas and tables in PDFs come out as plain text, sometimes out of order; only the first 300 PDF pages and 600,000 characters are read.
- **Limits in memory.** The rate limit, the server-key budget and model cooldowns are per server instance.
- **Evidence.** Every behavioural result comes from scenarios I wrote, scripted students or my own answers, mostly on one model family.

## What I would do with four more hours

1. Make the plan write each step's check question about a different case than the one the explanation uses, then measure how often a first right answer is still "shown with help". This targets the main weakness without new machinery.
2. Run the five-student pilot that is already written (the archive branch has the protocol and forms), and read the transcripts: where students stall, what they skip, which hints help.
3. Handle slow free-tier models better: when the main model times out, retry the reply once with a shorter context before falling back to a weaker model, and show which model answered each message.

## How I know it works

Five kinds of evidence, kept apart.

**1. Automated tests with a mock model** (`npm test`, `npm run test:e2e`). 352 unit, property and API tests: the state machine (including a property test that no step is claimed as shown on your own without an independent right answer, and that every step ends within a bounded number of replies), grade checks, prompts, file reading, citations, storage (no key stored), the API (streaming, cancellation, validation, provider errors, key never logged). The browser harness drives the built app with the mock model at 15 screen sizes in English and Hebrew with axe-core, through a full lesson, a stop, a provider failure and retry, and reloads. These test the flow, not the teaching.

**2. The engine on labelled scenarios, no model** (`npm run eval:teaching`). 49 dev and held-out conversations with the grades given: the engine chooses the expected move and help in all of them; a naive rule set (two hints, then the answer and the next step) passes 56% of the held-out ones.

**3. Real-model evaluation** (Gemini 3.5 Flash-Lite, the cheapest model the app supports, through the app's own engine; raw turns in `eval/results/runs/`).

- Grader: 48 of 51 golden answers graded as labelled; no wrong or partial answer graded correct.
- Round 9, pre-registered ([eval/PREREGISTRATION.md](eval/PREREGISTRATION.md)): 26 new scenarios, three repeats, three systems. The learner-model engine claimed no step as shown on your own that was not (0 of 60 labelled states, against 6 of 60 for the engine without the log) and recovered a missing prerequisite in 11 of 12 runs (3 of 12). Outside the scenarios written for its rules it was not better than the simpler engine (14 to 17 of 18 against 16), and a plain single-prompt tutor passed 10 to 12 of 18.
- Round 10 ablation ([eval/ABLATION_R10.md](eval/ABLATION_R10.md), written before the runs): each round-9 change added to production on its own, five repeats. One grader rule caused a regression, two together caused another, and only the second grade of an answer after help had a benefit (0 of 6 to 6 of 6). The final engine keeps only that change plus teach-first.
- Final engine against the previous production engine, one repeat on the same 24 scenarios: 18 against 19. No measured difference. Steps wrongly claimed as shown: 0 of 20 for both.

**4. Production verification** (the live site with its own server key and models, a headless browser driving the real page with `eval/live-lesson.mjs --url`, my own answers written after reading each message). One run on 2 November (`eval/results/live-r10/production/`) and one on 3 November on the final code (`eval/results/live-r10/production-2026-11-03.txt`). The table is the 3 November run unless it says otherwise.

| # | Scenario | How | Result |
| --- | --- | --- | --- |
| 1 | Wrong answer | "Digestion, plants take food from the soil" to the photosynthesis check question | Graded incorrect with the misconception named; the tutor gave a counter-example hint and did not give the answer |
| 2 | Right answer in my own words | Answered the check question in my own words | Graded correct and the lesson moved on; logged "shown with help", because the explanation had already stated it. On 2 November a pasted sentence from the tutor was graded as a copy and not credited |
| 3 | Source grounding | Opened the passage behind a tutor message | The panel showed the passage with its line labels and section, marked as checked against the file |
| 4 | Outside the document | Asked how long a cut flower stays alive | The tutor said the document does not cover it, then answered from general knowledge and returned to the question (after one timeout and Try again) |
| 5 | Hebrew file, English prompt | Hebrew water-cycle text, "Teach this in English to 9th graders", Hebrew interface, 390x844 | Lesson in English, left to right; citation labels and the source panel in Hebrew, right to left |
| 6 | Stop | Esc 3 seconds into a reply | Stopped before any text; no new evidence and the state did not change. Stopping in the middle of streamed text: NOT TESTED on production, covered by the mock browser test |
| 7 | Reload | Reloaded during the final check | The lesson came back at "Final check 2 of 3" and finished with the summary |
| 8 | Your own key | A fake Gemini key in the settings | "The AI provider rejected this API key" in the app; the server log shows `invalid_key` and no key. A full lesson with a real reviewer key: NOT TESTED (needs the reviewer's key) |

Problems production showed, and what I changed: 2 of 15 turns in the English lesson timed out and Try again recovered them, and replies took 1 to 37 seconds; a reply cut off by the provider was shown as finished (now an error, `3f81615`); a failed optional second grade failed the whole turn (now the turn goes on, `d65d839`); a check question opened with "Great!" after the student only said they understood (now opening praise needs a correct grade, `5aad30e`). The last fix was not re-run on production.

**5. Real students.** None. The pilot was written and NOT RUN.

## What the earlier rounds taught me

- **Round 5:** a lexical check of the tutor's text against the success criteria was unreliable in Hebrew, so judgements about meaning go to the grader, whose output can only lower a claim.
- **Round 7:** after a smaller question, the grader sometimes counted a narrow answer as the whole step; the engine now asks the whole question again before the step counts.
- **Rounds 8 and 9:** the learner model stopped false claims of understanding, but the pre-registered comparison showed it was not better at teaching outside the cases it was built for. I kept it for honesty, not as a teaching improvement.
- **Round 9:** two grader rules written for two specific failures caused two new failures. **Round 10:** I removed them after an ablation, and fixed answer leakage by changing the structure (teach, then ask) instead of adding another instruction.

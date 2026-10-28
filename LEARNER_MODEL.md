# Learner model: proposal and evaluation plan

Written on 27 October 2026, before the implementation and before any run of the evaluation described here. Results are added at the end and do not change the sections above them.

## What exists today

The engine already keeps a little evidence per step in `progress.steps[i]`: attempts, hints, the help used, an outcome when the step ends (`mastered`, `learned`, `recovered`, `review`), the result of a prerequisite check (`revisit`) and the final-check results. `shared/lesson.js` turns these into a level per step (`applied`, `shown`, `shown_with_help`, `needs_practice`), which the plan panel, the summary, the review schedule and the eval use.

What it does not have:

- No record of individual answers. A level cannot say which answer, to which question, with how much help, led to it.
- No memory across steps. A misconception the student showed on step 1 is gone by step 3, and the grader is not told about it.
- Some evidence is dropped. When a later answer shows that an earlier step was not understood (a prerequisite check), the earlier step keeps its level unless the check is failed.
- Decisions carry no reason. A move like `hint` is recorded; why that move was chosen is only in the code path.

## Options

| | Option | What it adds | Cost and risk |
| --- | --- | --- | --- |
| A | **Evidence log in the progress object, state derived by one pure function** | An append-only list of graded answers with question kind, support, grade, misconception and passages; a deterministic `learnerModel(plan, progress)` in `shared/` used by the server policy and the UI | A larger request body (capped); the old level names need a mapping for the old scenario labels |
| B | Per key concept, from the grader's `conceptsShown` and `conceptsMissing` | Finer than a step | Matches free text from the grader to the plan's key concepts: lexical, and round 5 showed a lexical match fails in Hebrew (AUDIT 63). Grading is per question, so per-concept evidence would be inferred, not observed |
| C | A probabilistic model (Bayesian knowledge tracing or similar) per step | A probability instead of a label | Needs parameters fitted on real learners, which do not exist here; a number would suggest precision the data cannot support |

I chose **A**. It reuses the existing state (the progress object the browser already keeps and sends with every turn, validated by the server), it adds one source of truth instead of a second store, and every state can be explained by pointing at the answers that produced it. B and C would add inference I cannot check.

## The model

**Evidence entry**, one per graded answer, appended by the server in `planMove`:

| Field | Meaning |
| --- | --- |
| `n` | Sequence number in the lesson |
| `step` | The step the answer was about (for a prerequisite check: the earlier step) |
| `question` | `check` (the step's question), `narrowed` (an answer while the question is narrowed by help), `detour` (a prerequisite check), `transfer` (final check), `practice` |
| `support` | `independent`, `hinted` (help that kept the whole question), `narrowed` (help that made the question smaller), `worked` (after a worked solution), `reminded` (a prerequisite check after a reminder) |
| `verdict`, `issue`, `misconception` | From the grade, after the server checks |
| `sources` | Ids of the passages given to the grader |
| `move`, `reason` | What the engine did and why |
| `gap` | Set on an entry that records a gap in this step revealed by a later step (grader or weak-prerequisite rule) |
| `message` | The id of the student's message, added by the browser |

No names or other personal data; the student's text stays in the chat messages, not in the log.

**States**, derived in order over a step's entries:

| State | Meaning | Set by |
| --- | --- | --- |
| `not_assessed` | No graded answer about this step | No entries |
| `emerging` | Answers so far are partial or wrong, without a named misconception; or right but copied, unsure or without the asked reason; or still wrong after the full explanation | Partial or incorrect without misconception; a right answer with issue `copied`, `hedged` or `unjustified`; a wrong answer after a worked solution |
| `developing` | Right only with help, or a misconception was named and not yet followed by an independent right answer | A right answer with support other than `independent`; an incorrect answer with a misconception |
| `demonstrated` | A right answer to the whole question with no help on the step | A right, unqualified answer with support `independent` (check, transfer or practice) |
| `needs_review` | The lesson had moved past the step (demonstrated or developing), then a later answer in this lesson showed a gap | A gap entry, or a wrong transfer, practice or prerequisite answer on a step that was `developing` or `demonstrated` |

`needs_review` means "a later answer in this lesson missed it". It says nothing about forgetting over time, which this app cannot observe.

**Confidence** is a word, not a number: `low` (one answer, or only partial evidence), `medium` (one independent right answer on the step's own question, or two or more answers for the other states), `high` (an independent right answer to a new transfer or practice question, or two independent right answers, and no missed later answer or gap on the step). A state from assisted answers is never above `medium`.

The older levels the interface used (`shown`, `applied` and so on) are now read from the state: `demonstrated` is `applied` with high confidence from a transfer or practice answer and `shown` otherwise, `developing` is `shown_with_help`, `emerging` and `needs_review` are `needs_practice`. Sessions saved before the log existed, and steps the evaluation starts as already done, get their entries from the step's outcome (`mastered` independent, `learned` hinted, `recovered` right after a worked solution, `review` wrong after one), its prerequisite check and its final-check result.

**Rules that keep claims honest**

1. A right answer after narrowing help, a worked solution or a reminder is never `demonstrated`.
2. A copied, hedged or unjustified answer is never `demonstrated`, whatever the verdict.
3. A gap revealed by a later step always moves a demonstrated step to `needs_review`, even if the prerequisite check is then passed (the check came after a reminder).
4. Only an independent answer can move a step back to `demonstrated`.

## Policy changes that use the model

Each move gets a `reason` code, stored with the evidence and shown in the UI where it helps the student.

| Change | Precondition | Effect |
| --- | --- | --- |
| Grader sees earlier steps' common mistakes and the misconceptions this student showed there | Always, for steps with prerequisites | Better attribution of a wrong answer to an earlier step (AUDIT 95) |
| Fragile prerequisite check | A wrong answer on a step whose prerequisite is `needs_review`, or `developing` after a worked solution: after the first wrong answer. `developing` otherwise: after the second | Go back to the earlier idea first (the existing detour), then return |
| Gap recorded on the earlier step | Any detour | The earlier step becomes `needs_review` and is preferred for the final check |
| Final-check selection by state | End of the last step | `needs_review` first, then `developing`, then `demonstrated` with only medium confidence, then by how many steps depend on it |
| Copied answer | Issue `copied` | Ask for the student's own words, saying neutrally that these are the document's words: no praise, and no claim that the content is wrong (AUDIT 93) |

The grader, the policy and the reply stay separate: the grader produces a grade, the policy produces a move, a reason and an evidence entry, the tutor writes the text.

## Hypothesis and pre-registered evaluation

**Hypothesis:** the learner model and the policy changes make the engine's claims about the learner more accurate and its decisions more appropriate, without making grading or lessons worse.

What this evaluation cannot measure: whether students learn more. The students are scripted; their answers do not change with the teaching. That needs real learners (`pilot/PROTOCOL.md`) or the experiment in DECISIONS.

**Systems**, same scenarios, same model (`gemini-3.5-flash-lite` for every call), through the eval deployment:

- **A0**: the engine as deployed at the start of this round (`af59c33`).
- **A1**: A0 plus the two prompt fixes of this round (copied answers, earlier steps' common mistakes in the grader), so the prompt effect can be separated from the policy effect.
- **B**: A1 plus the learner model and the policy changes.
- **C**: the plain single-prompt tutor.

**Scenario set:** held-out-4, written and committed before B is final, on two lessons not used before (one English, one Hebrew), with copied answers, alternative correct wording, ambiguous answers, questions about other sections, a question the document does not answer, prerequisite gaps the grader must attribute, narrowed help, and whole lessons with a final check. Every scenario labels the expected learner state per step at the end. The dev set is used for building B; held-out-4 is run only after B is frozen.

**Primary measures** (decided now):

1. **Overclaims**: steps the system reports as demonstrated (A0 and A1: `applied` or `shown`) when the label says they are not.
2. **Unsupported advancement**: moves to the next step or the final check without the evidence the scenario requires.
3. **Prerequisite recovery**: in scenarios whose error comes from an earlier step, the share where the tutor goes back to it and returns.

**Secondary measures:** scenarios passed; grading accuracy with wrong-accepted and right-rejected counts; intervention fit; return to the question; lessons completed; citations (invalid ids, weakly supported sentences); "not in the document" said when needed; approval on answers that were not right; time per turn and model calls.

**Decision rule:** B is better than A1 if it has fewer overclaims, no more unsupported advancement, at least the same prerequisite recovery, and passes no fewer scenarios than A1 minus one. A1 against A0 shows the effect of the prompt fixes alone. Each comparison is reported with its denominators; differences of one or two scenarios are reported as no measurable difference.

**Runs:** one run of all four systems; a second run of A1 and B if the free quota allows, since that comparison matters most. Every run saves per-scenario results with the model, prompt and code hashes.

**Held-out-4 as committed** (before any learner-model code): 21 scenarios on `seasons-en` and `foodchain-he` in `eval/golden/`, 19 conversations and 2 paraphrase groups. How the measures are computed, in `eval/teaching-lib.js`:

- A0 and A1 have no learner states, so their state for a step is read from their own level: `shown` or `applied` is `demonstrated`, `shown_with_help` is `developing`, `needs_practice` is `needs_review` if the step had been passed and `developing` otherwise, an active step with no answers is `not_assessed` and with answers `emerging`. B's state comes from its learner model.
- Overclaims: labelled steps whose acceptable states do not include `demonstrated`, counted when the system's state is `demonstrated` (denominator 16).
- Unsupported advancement: turns failed as "moved on without evidence".
- Prerequisite recovery: scenarios in `prerequisite` and `fragile_prerequisite` where a check of an earlier step is followed by a return to the question (denominator 4).

With the labelled grades (policy layer, no model), A0 passes 15 of 19 conversations. The 4 failures are the cases that encode B's rules, so A0 fails them by design: in the 2 `fragile_prerequisite` scenarios A0 keeps hinting where B should go back to the earlier step, and in the 2 `prerequisite` scenarios A0 still reports the earlier step as demonstrated after its gap showed (2 of 16 overclaims). Results are reported with and without these 4. The saved policy-layer result is `eval/results/teaching-policy-holdout4-a0.json`.

## Results (added after the runs)

Held-out-4 on `gemini-3.5-flash-lite`, one run per system, 21 of 21 scenarios completed for each (full table and caveats in DECISIONS.md, "Results: held-out-4 on a real model"):

| | A0 | A1 | B | Plain |
| --- | --- | --- | --- | --- |
| Overclaims | 2/16 | 2/16 | 0/16 | n/a |
| Unsupported advancement | 0 | 0 | 0 | 0 |
| Prerequisite recovery | 1/4 | 2/4 | 3/4 | 1/4 |
| Scenarios passed | 14/21 | 14/21 | 17/21 | 10/21 |
| Passed, without the 4 scenarios that encode B's rules | 14/17 | 14/17 | 14/17 | 9/17 |

By the decision rule above, B is better than A1. The difference comes from the scenarios that test B's rules; elsewhere the three engines pass the same number. One run of 21 scenarios is a direction, not a measured effect, and none of this says whether students learn more.

Changes after B was frozen, each found on held-out-4 or on production and covered by a regression test (AUDIT 99 to 103): Hebrew forms of "do" became stopwords; a final-check fail forced by repeated non-answers is logged; an earlier step whose last check was passed waits for the second wrong answer before it is checked again, and copied, unsure or unexplained answers never trigger that check; the final check gives no hint when it asks again; the closing message claims nothing beyond what was shown. Held-out-4 is not independent evidence for these changes.

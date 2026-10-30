# Round 9 evaluation: pre-registration

Written on 28 October 2026, before any model run of round 9 and before the final evaluation set was run in any mode. Results go in a separate section at the end, added after the runs; nothing above it changes after the first run. Any later change to this document is a new commit with the reason in its message.

## Questions

1. Are AUDIT 96, 104 and 105 closed on a real model, not only in unit tests?
2. Is B better than A1 on scenarios that were not written to test B's rules?
3. What do the engines do on the two problems found on production in round 8: a step introduction that answers its own check question (answer leakage), and a question asked again after the student already answered it (unnecessary repetition)?

This evaluation cannot say whether anyone learns more. The students are scripted; their answers do not depend on the teaching. That question belongs to the pilot (`pilot/PROTOCOL.md`), which has not been run.

## Systems

| Name | Code | What it is |
| --- | --- | --- |
| A1 | `28b8f2e` | The round-8 engine with the two prompt fixes (copied answers, earlier steps' common mistakes in the grader), no learner model. Same definition as in round 8 |
| B | The head of branch `round9` when the first final9 run starts; its commit goes in the run metadata, and the engine and prompts get no change until the last repeat ends | A1 plus the learner model and policy of round 8, the fixes for AUDIT 99 to 103, and the round-9 fixes for 96, 104 and 105 |
| Plain | the single-prompt tutor in `eval/teaching-lib.js` (`plainSystem`) | One prompt with the plan and the document, no grader and no policy |

B differs from A1 in more than the learner model: it also has every bug fix since `28b8f2e`. A difference between them cannot be put on the learner model alone.

The harness (scenario runner, metrics, scripted student) is the round-9 one for all three systems. For A1 it is copied into a checkout of `28b8f2e`, as in round 8; the harness reads A1's own engine files.

## Model and conditions

- Every model call goes to `gemini-3.5-flash-lite`, main and backup, through the eval deployment of the `eval/remote-model` branch, which pins the model with preview-only variables. Each call records the model that answered; a call answered by any other model is an infrastructure error, not data.
- The model version behind the name cannot be verified from outside Google; only the model id returned with each call is recorded.
- Same scenarios, same order, same pause between calls (4.5 s) for every system. Scenarios run one at a time, with A1, B and Plain on each scenario before the next scenario, so a quota stop leaves all three systems at the same point.
- Saved per call or turn: the full reply text, the grade, move, reason, progress, citations, models, time to the whole reply, a timestamp, characters sent and received. Token counts are not available through the eval route; characters stand in for cost. The free quota has no money cost.
- If the quota runs out: the run stops, the completed scenarios stay saved, the next run resumes from the same point on another day with the same model and the same code hashes (the runner refuses to resume if the model or the engine, prompt or scenario hashes changed). An incomplete comparison is reported as incomplete, with denominators.
- No model is switched midway. Results from different models are never merged.

## Scenario sets

| Set | Use in round 9 | Independent? |
| --- | --- | --- |
| dev (24) | Changing the engine | No |
| holdout to holdout4 (79) | Regression: rerun in the policy layer after every change; some scenarios rerun on the model to check the round-9 fixes | No. All four have been seen; held-out-3 and held-out-4 found the bugs fixed in rounds 7 to 9, and in round 9 eight answers in them gained a `whole` label (see below) |
| regress9 (4 new) plus 6 named scenarios from the held-out sets | Real-model check of the three fixes | No. Written after the fixes, by the person who made them |
| final9 (26 new) | The comparison in this document | Partly; see below |

**final9** is written in this commit, on two lessons used nowhere before (`magnets-en`, `spoilage-he`), before any system has run on it in any mode, including the label-only policy layer. Before the model runs, only a structural check runs on it (valid JSON, lessons and steps exist, every turn has a label and an expectation). Its expectations are not changed after that. Authoring errors found later are reported as authoring errors and counted as written.

**Why it is only partly independent.** The same person wrote B, the round-9 fixes and these scenarios, and knew how B behaves. Two things limit the effect, without removing it:

1. Expectations follow a written rule for a good tutor, not B's rules (next section). Where a good tutor could do more than one thing, all of them are accepted.
2. Every scenario is tagged. **Targeted** scenarios test a rule that only B has: going back to an earlier step after repeated wrong answers (`fragile_prerequisite`), marking an earlier step as needing review after its gap shows (`learner_model`), or ending a step on a whole answer after narrowing help (`whole_answer`, a round-9 fix). **Not targeted** scenarios test behaviour any engine is meant to have. The conclusion about B in general rests on the not-targeted scenarios only.

Composition: 26 scenarios, 13 per lesson. Targeted: 6 (2 `whole_answer`, 2 `prerequisite` with a learner-state end label, 2 `fragile_prerequisite`). Not targeted: 20, including 2 whole lessons with a final check and 2 paraphrase groups that only test grading.

## Expectations: the rule a scenario follows

- A complete, correct, unqualified answer to the question asked: move on (`next_step`, or `final_check` after the last step). Asking it again, probing it or hinting is wrong.
- A partial answer: help (`hint`); for an unsure answer, `probe` or `hint`.
- A wrong answer with a wrong idea about the current step: `hint`. A wrong answer whose idea belongs to an earlier step: `hint` or `check_earlier` in not-targeted scenarios; only `check_earlier` in targeted ones.
- A pasted answer: `probe` or `hint`, without praise.
- A question about the document: answer it (`answer_question`) and cite the passage; for a question the document does not cover, say so.
- An answer to a different question: `ask_again` or `hint`.
- During the final check: no hint, no praise of a wrong answer, move on after a wrong answer.
- End learner states use the five states of LEARNER_MODEL.md. For A1, states are read from its levels as in round 8.

## Measures

Computed by `eval/compare.js` from the saved runs. Each is reported for the whole set, the targeted scenarios and the not-targeted scenarios, per system and per repeat.

| Measure | Definition |
| --- | --- |
| Scenario success | A scenario passes when every turn's action is among the expected ones, no turn breaks a text check (praise on a wrong answer, a hint in the final check, a missing citation where one is required, "not in the document" missing, a summary that leaves out the weak step), and, for A1 and B, the end states and step match. Same checks as round 8 |
| False acceptance | Graded answers whose label does not accept `correct`, graded `correct`. For Plain, its own judgement tag |
| False rejection | Answers labelled only `correct`, graded anything else |
| Overclaim | Labelled end states that do not accept `demonstrated`, where the system's state is `demonstrated` (A1 and B only) |
| Unsupported advancement | Turns that moved on (`next_step`, `final_check`, `summary`) when the expectation did not allow moving on |
| Prerequisite recovery | In `prerequisite` and `fragile_prerequisite` scenarios, a `check_earlier` followed later by `back_to_question` |
| Answer leakage in teaching | A reply that moves to a new step (`next_step`) and, in the same message, contains at least the pre-set number of answer markers of that new step's check question (`leakMarkers` in `teaching.json`, written with the scenarios). Denominator: such replies |
| Answer leakage in help | A `hint` or `back_to_question` reply that contains every answer marker group of the current step |
| Unnecessary repetition | A turn labelled `correct` with no issue, whose expectation allows no re-asking, where the system asked again (`back_to_question`, `probe` or `ask_again`) |
| Citations | Invalid citation ids; citations whose sentence shares little with the cited passage (score below 0.2), as in round 8 |
| Not in the document | Replies that should say the document does not cover a question and do not |
| Latency and failures | Median and 95th percentile time per turn; scenarios that ended in an infrastructure error or a quota stop |
| Cost | Model calls and characters sent and received per scenario |

Leakage and approval are automatic text checks. Every reply flagged by either is also read by hand, and both counts are reported.

## Decision rules, fixed now

Let *n* be the number of not-targeted conversation scenario runs completed for both A1 and B (scenarios × completed repeats).

1. **B better in general**: on not-targeted scenarios, B passes more than A1 in every completed repeat, the total difference is at least max(3, 10% of *n*), and B is not worse than A1 on false acceptance, unsupported advancement, answer leakage or unnecessary repetition (worse means more than one extra case per repeat).
2. **B worse in general**: the same with A1 and B swapped.
3. Otherwise: **no measurable difference** outside the targeted cases.
4. **B's rules work in the targeted cases** if B passes at least 75% of targeted scenario runs and more than A1. If B improves only there and ties elsewhere, the conclusion is that the rules work in those cases, not that B is better.
5. **Noise**: for every system with two or more repeats, the number of scenarios whose pass or fail changed between repeats is reported. A difference between systems no larger than that is reported as within run-to-run variation.
6. No statistical significance is claimed. With at most three repeats of 24 conversations there is no basis for it.

**Fixes (questions 1 and 3)**: each of 96, 104 and 105 is "closed on the model" if B passes its regression scenarios in every repeat run, and "not shown" otherwise; one failure is reported with the reply text. 96 has two parts: leakage is measured by the leakage measure on all next-step replies in regress9 and final9; repetition by the `whole_answer` scenarios.

## Order of runs, as far as the quota allows

1. final9, repeat 1: A1, B, Plain on each scenario in turn.
2. Regression scenarios, B, one run.
3. final9, repeats 2 and 3, the same way.
4. Regression scenarios with A1, if quota remains.

Repeats are separate run directories (`r9-final-rep1`, ...). A repeat that does not finish is reported with how far it got.

## What the scripted student does in the final check

The final check asks about steps in an order each engine chooses. A turn with `about` is the scripted answer to the final-check question about that step. When the engine asks about a different step than the next scripted answer, the runner sends the pending answer whose `about` matches the step asked, as a real student would answer the question in front of them. Plain has no visible queue, so its answers go in the written order. This rule is new in round 9 and applies to all systems and all sets.

## Results (added after the runs)

Runs on 28 October (16:20 to 17:23 UTC), 29 October (07:12 to 08:14 UTC) and 30 October (07:13 to 08:11 UTC); each day stopped by the quota or by the end of the planned runs. Every call was answered by `gemini-3.5-flash-lite`. B ran at `feab2be`; A1 at `28b8f2e` with the round-9 harness. Raw results: `eval/results/runs/r9-final-rep{1,2,3}-{a1,b,plain}`, `r9-regress-a1`, `r9-regress-b`; the comparison is `eval/results/r9-final-compare.json` (`node eval/compare.js --run=...` over the nine runs), the regression summaries `eval/results/r9-regress-b.json` and `eval/results/r9-regress-compare.json`.

**What is complete:** all three repeats for all three systems, 26 of 26 scenarios each, and the regression run for A1 and B. Scenarios that ended in an infrastructure error were run again from the start until they completed, whatever their result: 48 such lines in repeat 1 (the share link was replaced during the run on 28 October), 12 in repeat 2 and 39 in repeat 3 (the provider answered `provider_unavailable` from about 07:10 to 07:25 UTC on 30 October). The infrastructure-error lines stay in the raw files; the comparison uses the last completed line per scenario.

### final9, conversations passed (automatic checks, as pre-registered)

| | A1 rep 1 | A1 rep 2 | A1 rep 3 | B rep 1 | B rep 2 | B rep 3 | Plain rep 1 | Plain rep 2 | Plain rep 3 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Not targeted | 16/18 | 16/18 | 16/18 | 14/18 | 17/18 | 15/18 | 10/18 | 12/18 | 10/18 |
| Targeted | 0/6 | 0/6 | 0/6 | 6/6 | 5/6 | 6/6 | 2/6 | 2/6 | 2/6 |
| All | 16/24 | 16/24 | 16/24 | 20/24 | 22/24 | 21/24 | 12/24 | 14/24 | 12/24 |

Totals over three repeats: not targeted A1 48/54, B 46/54, Plain 32/54; targeted A1 0/18, B 17/18, Plain 6/18.

**Read by hand:** one automatic failure is a false flag. On `f9-he-copied` the approval check matched "בדיוק" in "השתמשת במילים שמופיעות בדיוק במקור" ("you used the words exactly as in the source", 108). It is A1's only failure on that scenario in all three repeats and B's only failure on it in repeat 1. Without it, not targeted would be A1 17, 17, 17 and B 15, 17, 15. The decision rules below are applied to the automatic counts; the hand count does not change any of them.

### Other measures, three repeats together

| | A1 | B | Plain |
| --- | --- | --- | --- |
| False acceptance | 3/57 | 2/57 | 0/57 |
| False rejection | 9/81 | 5/87 | 6/75 |
| Overclaims | 6/60 | 0/60 | n/a |
| Unsupported advancement | 3 | 2 | 0 |
| Prerequisite recovery | 3/12 | 11/12 | 0/12 |
| Answer leakage in teaching (automatic) | 23/30 | 16/36 | 0/36 |
| Answer leakage in help (automatic) | 18/55 | 9/45 | 7/57 |
| Unnecessary repetition | 18/75 | 3/75 | 9/75 |
| Approval on a wrong answer: automatic / read by hand | 5 / 2 | 3 / 2 | 4 / 3 |
| "Not in the document" missing | 0 | 2 | 0 |
| Invalid citation ids | 0 | 2 | 0 |
| Weakly supported citations | 8/188 | 11/171 | 9/118 |
| Model calls | 336 | 354 | 171 |
| Characters sent / received | 1.76 M / 118 k | 1.93 M / 127 k | 1.08 M / 44 k |
| Time per turn, median / 95th percentile, repeats 2 and 3 | 3.9 s / 6.9 s; 3.7 s / 5.7 s | 3.8 s / 7.2 s; 3.6 s / 7.6 s | 2.4 s / 4.0 s; 2.2 s / 3.7 s |
| Scenarios that changed pass or fail between repeats | 0 | 4 | 3 |

Repeat 1's 95th percentile was 41 to 44 s for the engines and 20 s for Plain: the provider was slow on the evening of 28 October.

The denominators of teaching leakage differ because they count next-step replies, and A1 moved on less often. Plain's 0 is by construction: it asks before it teaches.

**Leaks read by hand.** All 16 teaching leaks the automatic check flagged for B were read and are real: the reply states the principle the new check question asks for, then asks it (for example "Earth itself acts like a giant magnet ... a tiny, light needle that is actually a small magnet ... opposite poles attract", then "Why does a compass needle always point north?"). One is borderline: repeat 3, `f9-en-journey`, says iron is attracted and aluminium is not, but not that steel contains iron. A1's 10 flags in repeat 3 were read and are of the same kind. Help leakage was read for all three systems but is not given a hand count: most of B's flags are hints that state the answer, while several back-to-question flags in all three systems repeat what the student had just said, which the check cannot tell apart, and most of Plain's flags are either-or questions ("do they pull together or push away?").

**Approval read by hand.** The real cases are "נכון מאוד" to the answer "זה עובש" on `f9-he-journey` (the label calls it partial; A1 repeats 1 and 2, B repeats 1 and 3, and both engines moved on without evidence), and for Plain the same scenario, "זה נכון, במקרר באמת קר" on a partial answer and "זה נכון מאוד" on a copied answer. The rest are the "בדיוק" false flags (108).

### Decision rules

*n* = 54 (18 not-targeted conversation scenarios × 3 repeats); the threshold is max(3, 5.4), so 6.

- Rule 1 (B better in general): **no.** B passed more than A1 only in repeat 2 (17 against 16); fewer in repeats 1 and 3 (14 and 15 against 16). In total B passed 2 fewer.
- Rule 2 (B worse in general): **no.** A1 did not pass more in repeat 2, and the total difference of 2 is below 6.
- Rule 3: **no measurable difference outside the targeted cases.** The difference is also within run-to-run variation (rule 5): 4 scenarios flipped for B between repeats.
- Rule 4: **B's rules work in the targeted cases:** 17 of 18 targeted runs (94%) against 0 of 18 for A1.
- Rule 6: no statistical significance is claimed.

Where B lost on not-targeted scenarios:

- `f9-he-not-in-document` in all three repeats: the grader called "how long can eggs stay in the fridge?" `off_topic`, so the tutor redirected (106). In repeat 3 the redirect did say the document is not about eggs, but the action was still `ask_again`. A1 graded it a question in all three repeats.
- `f9-en-copied` in repeats 1 and 3: a pasted general rule was graded `misread_question`, so the tutor asked again instead of probing or hinting (109). A1 graded it `copied` in all three repeats.
- `f9-he-journey` in repeats 1 and 3, as A1 in all three: "זה עובש" graded correct, and the engine moved on.

The grader prompts of A1 and B differ only in the round-9 rules (104, 105) and the second grade (96). 106 and 109 are therefore probably side effects of those rules. This is not tested.

A1's actions were identical in all three repeats (its reply text was not). B's second grading call adds one model call per right answer after narrowing help; B used 5% more calls than A1.

### The round-9 fixes on a real model (regression run, one repeat each for A1 and B)

The regression run uses regress9 (4 scenarios) and 6 named held-out scenarios. Running A1 on it shows which results the fixes produce and which A1 already gets.

| Fix | Scenarios | A1 | B | Result |
| --- | --- | --- | --- | --- |
| 96, a whole answer after narrowing asked again | `ho3-en-narrowing`, `ho3-en-journey`, `ho3-he-narrowing`, `ho4-he-narrowing`; final9 `whole_answer` scenarios | 2 of 4; final9 `whole_answer` 0 of 6 | 4 of 4, each with the second grade `whole_question_right`; final9 `whole_answer` 6 of 6 | **Closed on the model** in these runs |
| 96, the teaching answers the check question | `r9-en-leak-seasons`, `r9-en-leak-sound`, `r9-he-leak-foodchain`; every next-step reply in final9 | 3 of 3 leak; final9 23 of 30 | 2 of 3 leak; final9 16 of 36 | **Not closed.** Less often, still in about 4 of 10 next-step replies |
| 104, back to an earlier step when the current step teaches the idea | `ho4-en-misconception` | Fails | Fails: the grader still named the earlier step, and the reminder gave that step's answer before asking it | **Not shown** |
| 105, a wrong reason graded as answering another question | `r9-en-final-wrong-reason`, `ho3-he-journey` | Passes both: `incorrect` with no issue | Passes both: `incorrect` with no issue | **Not reproduced on either engine.** A1, without the rule, grades these answers correctly, so these runs do not show that the rule is what made the difference. The likely difference from production is the harness change: the scripted student now answers the question the engine actually asks |

None of this says whether students learn more.

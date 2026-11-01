# Round 10 ablation: which round-9 change causes which regression

Written and committed before any ablation run.

## Why

In round 9, B lost two not-targeted final9 scenarios that A1 passed in all three repeats (AUDIT 106 and 109). 104 failed on both. B differs from production (`7545a6b`) by exactly four changes, and production differs from A1 (`28b8f2e`) by the round-8 learner model and the fixes for 99 to 103. The ablation adds each round-9 change to production on its own.

## Configurations

| Name | Code | What it adds |
| --- | --- | --- |
| a1 | `28b8f2e` | The round-9 A1 reference |
| p | `7545a6b` | Production: A1 plus the learner model and the fixes for 99 to 103 |
| g | `abl10-g` | p plus the second grade against the whole check question (96) |
| t | `abl10-t` | p plus the teaching instruction not to answer the check question, and the `build_up` wording (96) |
| r104 | `abl10-r104` | p plus the grader rule for 104 |
| r105 | `abl10-r105` | p plus the grader rule for 105 |
| b | `feab2be` | B, all four changes |

The four branches together give exactly B's server code. All configurations use the round-9 harness (`9b852bc`), the same remote Flash-Lite deployment and a 4.5 s pause between calls.

## Scenarios and repeats

- Regressions, 5 repeats per configuration: `f9-he-not-in-document` (106), `f9-en-copied` (109), `ho4-en-misconception` (104).
- Benefit of the second grade, 3 repeats, configurations p, g and b: `f9-en-whole-after-help`, `f9-he-whole-after-help`.

The scenarios and their expectations are not changed. They come from final9 and held-out-4, which have been seen. The results are used to choose components, so they are not independent evidence for the chosen engine.

## How a run is counted

- A behavioural failure is a completed scenario that fails its checks. A model failure is an infrastructure error, a quota stop or an unusable grade (`no_usable_grade`). The two are counted apart, and a model failure is run again.
- For 106 and 109 the first turn decides, so its grade (verdict and issue) is recorded for every run.

## Attribution rule

- A change is called the likely cause of a regression when, on that scenario, p fails in at most 1 of 5 repeats, p plus the change fails in at least 3 of 5, and no other single change fails in more than 1 of 5.
- If p already fails in 2 or more repeats, the regression is not from round 9 and is reported as such.
- Anything else is reported as unattributed. With 5 repeats this shows association under one model and one set of prompts, not proof of mechanism. Each attribution is checked by reading the failing conversations.

## Keep or remove

A round-9 change stays in the final engine only if it has a measured benefit and no attributed regression. A change with no measured benefit is removed, however harmless.

## Results (added after the runs, 1 November)

All runs on `gemini-3.5-flash-lite` through the same preview deployment, 15:31 to 16:05 UTC for the configurations above, 16:07 to 16:15 UTC for the round-10 engine (`c`, commit `eb15599`). No infrastructure errors, no quota stop, no unusable grades. Raw results: `eval/results/runs/r10-ablation/` (`abl-*` and `ablw-*`; the round-10 engine's are in `eval/results/runs/r10-engine/`).

Scenarios passed:

| Scenario | a1 | p | g | t | r104 | r105 | b | c |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `f9-en-copied` (109) | 5/5 | 5/5 | 5/5 | 5/5 | 2/5 | 5/5 | 0/5 | 5/5 |
| `f9-he-not-in-document` (106) | 2/5 | 4/5 | 4/5 | 5/5 | 5/5 | 3/5 | 0/5 | 5/5 |
| `ho4-en-misconception` (104) | 0/5 | 0/5 | 0/5 | 0/5 | 1/5 | 0/5 | 0/5 | 0/5 |
| `f9-en-whole-after-help` (96) | | 0/3 | 3/3 | | | | 3/3 | 3/3 |
| `f9-he-whole-after-help` (96) | | 0/3 | 3/3 | | | | 3/3 | 3/3 |

For 106 and 109 the first turn decides. On that turn the grader's input is the same for p, g and t (the opening question is scripted, and the second grade runs only after narrowing help), so b's first grade is p's with both grader rules. b therefore also stands for the combination r104 plus r105 on these two scenarios; no separate combination run was needed.

### Attribution, by the rule above

- **109: the 104 rule is the likely cause.** p failed 0 of 5, r104 3 of 5, every other single change 0 of 5. With the 105 rule as well (b) it failed 5 of 5. Read by hand: in the failing runs the grader saw the copy ("The student copied the source text instead of explaining how the magnet separates the cans") but returned `incorrect` with `misread_question`. The server only marks a copy when the verdict is `correct` or `partial`, so the tutor asked the question again instead of asking for the student's own words.
- **106: not attributable to one change.** p failed 1 of 5, r105 2 of 5, r104 and t 0 of 5; together (b) the two grader rules failed 5 of 5. That is an interaction, measured on one scenario. Even without any round-9 change the grader sometimes calls this question off topic: p failed 1 of 5, A1 3 of 5.
- **104: no configuration fixes it.** The 104 rule passed 1 of 5, everything else 0 of 5.
- **The second grade (96) has a measured benefit:** 0 of 6 without it, 6 of 6 with it, and it is in no failure above.
- **The 105 rule:** round 9 showed no benefit (A1, without the rule, graded the same answers correctly), and here it adds to 106.
- **The round-9 teaching instruction:** no regression and no benefit measured on its own. The round-10 teach-first change replaces it.

### Decision

Kept: the second grade. Removed: the 104 rule, the 105 rule and the round-9 teaching instruction. The round-10 engine `c` is production plus the second grade plus the teach-first change. On the same scenarios it passed 109 5 of 5, 106 5 of 5 and the two 96 scenarios 6 of 6; 104 stays open at 0 of 5.

These scenarios were seen before and were used to choose, so the numbers are not independent evidence for the chosen engine.

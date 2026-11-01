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

# Round 6 regression tests against the round-5 code

I copied the round-6 test files into a worktree of `8fa9b77` (production before round 6) and ran them there. These tests fail on the round-5 code and pass on the round-6 code.

| Test | File | Round 5 (`8fa9b77`) | Round 6 |
| --- | --- | --- | --- |
| counts a question the document answers as a question, not off topic | assessor | fail | pass |
| shows the grader the matching passages from other parts of the document | assessor | fail | pass |
| answers a question about another part of the file even when the grader calls it off topic | api | fail | pass |
| trusts the copy check over the model's guess that the question was misread | assessor | fail | pass |
| does the same in Hebrew, and for a model that says the right answer is unjustified | assessor | fail | pass |
| counts every pasted sentence, not only the longest one | assessor | fail | pass |
| gives only help that asks the whole question, so a right answer to a sub-question cannot end the step | progress | fail | pass |
| never ends a step on a right answer to a narrowed question unless the grader says it meets the step | properties | fail when fast-check finds the sequence (it did on the first run, not on a later one) | pass |
| opening praise: 3 unit tests and 1 streamed reply | calibration | fail (module did not exist) | pass |
| keeps a transfer question per step, but not one that repeats the check question | planner | fail | pass |
| asks for one in the plan prompt | planner | fail | pass |
| has the final check ask the planned question, and falls back to a new one when there is none | planner | fail | pass |
| grades against the planned final-check question and its criteria | assessor | fail | pass |

Run: 11 failed, 126 passed in the five files that load, and the calibration file could not load.

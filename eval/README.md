# Evaluation

How I checked the parts of the tutor that unit tests can not check. Nothing here is part of the running app. The results behind the decisions are summarised in [DECISIONS.md](../DECISIONS.md#how-i-know-it-works).

## Scenarios (`golden/`)

- `teaching.json`, `teaching-r10.json`: 150 written student conversations on 16 short lessons (`teaching-lessons.json`), in English and Hebrew. Each says what the tutor should detect, which help it should give, what it may not claim, and on some sets which learner state each step should end in. Sets: `dev` (written first, used while building), four held-out sets, `final9` (26 scenarios, written and committed with the pre-registration before any run), and a few regression scenarios. A held-out set was committed before its first run.
- `grading.json`: 51 student answers with the expected verdict, used to measure the grader.
- `sources.json`, `retrieval.json`: which passage should back a tutor message or answer a student question.

## Runners

| Command | Model calls | What it measures |
| --- | --- | --- |
| `npm run eval:teaching` | none | The lesson engine on the dev and held-out scenarios, with the labelled grades in place of the grader |
| `node eval/teaching.js --mode=model --split=final9 --systems=engine` | yes | Whole conversations with the real model grading and writing; saves every turn to `results/runs/<label>/` and can `--resume` |
| `node eval/compare.js --run=...` | none | Recomputes the measures over saved runs, targeted and not-targeted scenarios apart |
| `node eval/grading.js` | yes | Grader accuracy on the 51 golden answers |
| `npm run eval:sources`, `npm run eval:retrieval` | none | Passage matching and question retrieval on the golden sets |
| `node eval/live-lesson.mjs` | yes, unless `--provider=mock` | The real interface in a headless browser, a local build or `--url=` a deployed site; a person answers each message through a command file |

Model runs need either `EVAL_API_KEY` or `--provider=remote` with `EVAL_REMOTE_URL`, a deployment of the eval-only model route (kept in the `archive` branch).

## Saved results (`results/`)

- `runs/r9-final-*`, `r9-final-compare.json`: the pre-registered comparison ([PREREGISTRATION.md](PREREGISTRATION.md)).
- `runs/r10-ablation`, `runs/r10-engine`: the round-10 ablation and the final engine ([ABLATION_R10.md](ABLATION_R10.md)).
- `live-r10/`: transcripts of complete lessons through the interface, on a local build and on production.
- `grading-r7.*`, `teaching-policy-*.json`, `sources-after.txt`, `retrieval-after.json`: the latest grader, engine and source results.

Earlier per-round results, the round-by-round audit log and the unrun pilot forms are in the `archive` branch.

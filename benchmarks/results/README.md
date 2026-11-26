# Benchmarks — where to look, and what the numbers mean

**Read this first, then `W1-ts-project1/FINDINGS.md`.** That findings page is the honest state
of the campaign, including the wave that had to be withdrawn.

## The one-paragraph answer to "is bb any use to agents?"

**We do not know yet, and the first wave says why: the agents never used it.** Across 17 valid
runs with the tools mounted and provably answering, `bb` was called **zero times**. Carrying
the 16 tool schemas cost ~15,500 tokens *per turn* and bought nothing back. The single trace
that does consider the tools rejects them on a premise that was **false** — "the workspace
isn't indexed" — when the index had been built there seconds earlier.

That is not a "no". A feature nobody invokes cannot be scored. It is a **discoverability**
result, and it is the most actionable thing the campaign has produced.

## Status of each wave

| wave | state | why |
|---|---|---|
| W0 | harness only | no pinned project, no result |
| W1 | **WITHDRAWN** | 11 of 17 valid runs read their own golden patch — the workspace was inside the checkout. Cost/adoption numbers survive; correctness does not. |
| W2 | in flight | isolation fixed, contamination gate armed, probe fixed; re-measuring W1's tasks cleanly |

## Is the instrument trustworthy?

This is the question that decides whether the numbers above may be published. Eight gates, each
of which has been **seen to go red** (`script/bench/selftest.sh`, currently 24 checks):

| gate | what it prevents | how it was tested |
|---|---|---|
| golden | admitting a task its own reference fix cannot pass | caught 5 of 6 p-queue tasks being unpassable |
| contamination | an agent reading its own answer key | flags 18 of 27 traces from the contaminated wave |
| isolation | the workspace being inside the checkout at all | live run: 32 calls, 0 contamination hits |
| probe | scoring an arm whose tools silently failed to load | distinguishes a dead MCP server from a dead provider |
| placebo | mistaking "any extra context helps" for bb helping | arm E scrambles retrieval args; verified it changes answers |
| skills leak | arm D being identical to C | reverting the fix showed all five arms with 10 skills |
| verify-record | a record contradicting its own evidence | caught 4 contradictions in pre-repair records |
| chart honesty | a negative value drawn as a positive bar | mutation-tested |

The gate that matters most is not in that table: **every claim traces to a `trace.ndjson` whose
sha256 is recorded in the run record.** Both defects that voided W1 were found by reading
transcripts, not scores.

## Roster

| project | repo | size | tasks | golden gate |
|---|---|---|---|---|
| project1 | p-queue @ `7f272ab5` | 27 files | 6 | **6/6 pass** |
| project2 | immer @ `784c86bb` | 169 files | 6 | **6/6 pass** |
| project3 | execa @ `6f856d55` | 686 files | 0 | in progress — its suite takes ~700 s per run and its anchors keep proving load-sensitive |

## Should this continue? What would make it worth continuing

The campaign has spent most of its effort building an instrument that can be believed, and the
instrument now works. What it has **not** yet produced is a single clean correctness result.

Two things decide whether it is worth more:

1. **The p-queue corpus cannot answer the question.** Six tasks, each one localised file. A
   strong model needs no retrieval for them. Even a clean W2 will most likely be ceiling.
2. **The real question is adoption, not accuracy.** Before spending more on correctness, one
   cheap experiment is decisive: give the agent a task where `grep` genuinely cannot answer —
   cross-file impact on execa's 686 files — and see whether it reaches for `bb_impact`. If it
   still does not, the product problem is salience, and no amount of benchmarking accuracy will
   fix that.

> Reproduction and full method: `docs/benchmarks/DESIGN.md`, `HARNESS.md`,
> `PROTOCOL-VS-EXECUTION.md` (40 rows: what the protocol claims vs what the code does).
> Raw evidence: `benchmarks/.work/<wave>/runs/<id>/` (gitignored, regenerable).

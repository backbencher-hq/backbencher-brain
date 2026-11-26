# Why the agent never called bb — measured, not guessed

The W1 wave found `bb_usage.calls = 0` across all 17 valid runs. That number on its own could
mean four different things, so this page separates them with evidence from the traces.

| hypothesis                                     | test                                                        | verdict                                                                                              |
| ---------------------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| the server was not mounted                     | probe in the same profile answers a `bb_search` call        | **ruled out** — C, D and E all passed the probe, which itself made 5 real `mcp__bb__bb_search` calls |
| the tools were not in the model's context      | static-prefix tokens, C vs B                                | **ruled out** — C's prefix is ~15,500 tokens larger than B's, which is the 16 tool schemas           |
| the model considered bb and chose otherwise    | scan `thinking` events for `bb_*`, `mcp__bb`, `backbencher` | **no occurrence in any task turn** — the model never even named the tools                            |
| the model never saw a reason to reach for them | every `thinking` event scanned for a bb tool name           | **supported, with one exception that proves the point** — see below                                  |

## The measurement that matters

```
arm B  static prefix  ~7,500 tokens   (system + manual block)
arm C  static prefix ~23,000 tokens   (system + manual block + 16 tool schemas)
       -----------------------------------------------
       cost of carrying the tools:  ~15,500 tokens PER TURN
       bb calls made:                0
```

So bb was **paid for on every single turn and used on none**. Over the three valid arm-C runs
that is 46,584 tokens of pure schema, bought for nothing.

## Why "the model chose bash" is the wrong reading

Across 27 traces, **exactly one** `thinking` event names a bb tool. It is worth reading in
full, because it is the only time the agent weighed the tools and it declined on a premise
that was **false**:

> "Should I use bb tools? The workspace isn't indexed (it's a benchmark armC, bb MCP may point
> elsewhere). ... However instructions say prefer bb_edit; but bb index likely points at the
> main repo, not workspace. Let me check bb_health quickly? Might be overhead. Safer to use
> normal edit on the workspace; the workspace instructions permit host tools."

The index _was_ built in that workspace before the turn — the run record proves it
(`memory.peak_rss_index_mb = 87`, and the index step would have invalidated the run with
`index-failed` otherwise). So the agent reasoned itself out of a working tool using an
assumption it could have checked in one call, and explicitly chose not to check because it
"might be overhead".

That single trace is the most useful thing in this wave. Everything else is the null case; this
is a **rejection with a stated reason**, and the reason is wrong. Three failures are visible in
it at once: the agent did not know the workspace was indexed, it did not trust that bb pointed
where it was working, and the cost of checking (one call) was judged higher than the cost of
guessing wrong.

- If the model had considered and rejected bb, the product's answers would need to be better.
- Since it never considered them, the problem is that **16 tools presented as a flat list are
  invisible next to 6 familiar host tools.** Nothing in the prompt gives the model a _reason_
  to prefer them, and the task is solvable without them.

Arm D is the strongest evidence for this: it carries the published skills — which exist
precisely to route code questions to bb — and it also made 0 calls. Adding documentation did
not create salience.

## What this implies for the marketing question

The question is "has the bb of any use to the agents ever?" On this corpus the honest answer
is: **the agents never found out either way**, because they never used it. That is not a
no — a feature that is never exercised cannot be scored. It is a **discoverability** result,
and it is the most actionable thing this wave produced.

Three fixes follow directly, in order of likely effect:

1. **Measure salience directly.** Give the agent a task where bash genuinely cannot answer in
   reasonable time (a cross-file impact question on execa's 686 files). If it still reaches for
   grep, the problem is presentation, not task fit.
2. **Test fewer, better-signposted tools.** 16 tools at 15,500 tokens is 97 tokens of schema
   per tool per turn. A 3-tool surface (search/ask/graph) would cost ~3,000 and might be
   _chosen_ where 16 are ignored. That is a product experiment, and this harness can run it.
3. **Do not claim benefit from arm C.** Any report that shows C ≈ A on these tasks and
   concludes "bb doesn't help" would be wrong: it was never invoked.

> Every claim above is checkable against `benchmarks/.work/W1/runs/*/trace.ndjson`, whose
> sha256 is in the matching `run-record.json`.

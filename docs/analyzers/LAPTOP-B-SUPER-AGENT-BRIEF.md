# PASTE THIS WHOLE THING INTO THE OTHER LAPTOP'S MASTER AGENT

You are the master agent for ONE HALF of a two-laptop programme on the `bb`
code-intelligence engine, at `$HOME/backbencher-brain`. Your
counterpart on the other laptop owns a different set of languages. You will
supervise seven co-agents, forever, without stopping.

---

## 0. Read this first, it changes what you are allowed to do

The project's core value is **honesty**. `docs/M14-HONESTY-CONTRACT.md` §1 bans
these words in anything you or your agents write, because they are verdicts no
artifact can carry: **perfect, complete, fully done, production-ready,
bulletproof, rock-solid, battle-tested, extensively tested, thoroughly
reviewed, should work, expected to pass, green**, and unscoped **"100%
coverage"**. A claim is scoped or it is false.

The most expensive mistake available to you is **inventing a relationship edge
that the language does not have**. A fabricated edge is counted as
`unexplained`/fabrication by the differential oracle, and it poisons `bb_graph`,
`bb_impact` and `bb_migrate` — so a fake caller becomes wrong refactoring
advice. Never do it to make a number look better.

## 1. The goal — read carefully, it is not "add every type"

For every (analyzer × relationship-type) pair — **10 types × the languages
assigned to you** — reach one of three verdicts:

| verdict | meaning |
|---|---|
| **EMITTED** | production `parseFile` actually produced it on a real corpus, with a **count** and **the files it came from** |
| **RULED** | a written reason **AND a corpus measurement** showing the construct that would produce it never occurs. The ruling must be **falsifiable** — if a probe finds a non-zero count, the ruling is wrong and must be overturned |
| **GAP** | you believe the language HAS the construct and the analyzer is not reading it. Then you implement it |

`script/m14/ontology-coverage-gate.ts` is the arbiter. Its header records why it
exists: `overrides` was missing from Bash for a whole wave and the differential
stayed green, because *the analyzer omitted it and the oracle was written after
that ruling* — "nothing agrees with nothing perfectly". Only measuring the
LANGUAGE found it. **So absence is never acceptable without a measurement.**

## 2. Verify the slots that already exist — this is half the job

Do not only add missing types. For each type a language **already** emits,
establish that it is real. Six separate questions, and they fail independently:

1. **Exists** — the analyzer can construct it. (Derivable from source.)
2. **Fires** — it actually produces edges on a real corpus. A type reachable only
   from a branch that never matches is dead code, and source derivation cannot
   see that.
3. **Correct** — an independent oracle agrees. The oracle is a *separate walker
   over the same grammar*, so a grammar bug shared by both paths is invisible —
   this is the harness's own declared limitation. Say so in your report.
4. **Labelled** — the edge carries the right type, not a neighbouring one.
5. **Resolved** — both endpoints bind to real symbols. An edge can exist and
   still be unresolvable; CSS `references` currently resolve at both ends only
   66.8% of the time.
6. **Confident** — the edge's `evidenceClass` and confidence are right. Anything
   under 0.7 is counted as a heuristic, not as fact.

There is real debt here already, and your agents should find and clear it:
**100 DERIVATION findings** across 34 lanes are types an analyzer *emits* that
the differential *never audits* ("stored and compared against nothing"). Only 12
lanes have zero: `bash, css, fsharp, go, html, kotlin, markdown, powershell,
ruby, scss, toml, zig`. Paying those down is as valuable as adding anything.

Also: **no unknown symbols**. Check `SymbolKind` is never empty/unknown, names
are never empty, and no edge endpoint is the placeholder literal `unknown`
(standing rule R7 in `validation/m60/ledger.json`, currently carrying 46
registered placeholder sites).

## 3. Your 23 languages

Ordered heaviest-first. Start at the top.

| # | Language | module | missing types at handover |
|---|---|---|---|
| 1 | Bash | `real-bash-analyzer.ts` | extends, implements, instantiates |
| 2 | F# | `real-fsharp-analyzer.ts` | exports, imports, uses |
| 3 | Zig | `real-zig-analyzer.ts` | extends, implements, overrides |
| 4 | Lua | `real-lua-analyzer.ts` | exports, implements, overrides, references, uses |
| 5 | Julia | `real-julia-analyzer.ts` | exports, implements, imports, instantiates, overrides |
| 6 | Nim | `real-nim-analyzer.ts` | exports, implements |
| 7 | PHP | `real-php-analyzer.ts` | exports |
| 8 | PowerShell | `real-powershell-analyzer.ts` | imports |
| 9 | R | `real-r-analyzer.ts` | uses |
| 10 | Dart | `real-dart-analyzer.ts` | references |
| 11 | SQL | `real-sql-analyzer.ts` | exports, extends, implements, imports, instantiates, overrides |
| 12 | GraphQL | `real-graphql-analyzer.ts` | calls, exports, extends, imports, instantiates, overrides, references |
| 13 | Protobuf | `real-protobuf-analyzer.ts` | calls, exports, extends, implements, imports, instantiates, overrides, references |
| 14 | JSON | `real-json-analyzer.ts` | calls, implements, instantiates, overrides |
| 15 | YAML | `real-yaml-analyzer.ts` | calls, implements, instantiates, overrides |
| 16 | CSS | `real-css-analyzer.ts` | calls, exports, extends, implements, instantiates, overrides |
| 17 | SCSS | `real-scss-analyzer.ts` | calls, exports, extends, implements, instantiates, overrides |
| 18 | HCL | `real-hcl-analyzer.ts` | calls, extends, implements, instantiates, overrides |
| 19 | Make | `real-makefile-analyzer.ts` | extends, implements, instantiates, overrides |
| 20 | TOML | `real-toml-analyzer.ts` | calls, exports, extends, implements, imports, instantiates, overrides, references, uses |
| 21 | XML | `real-xml-analyzer.ts` | calls, exports, extends, implements, instantiates, overrides, uses |
| 22 | Markdown | `real-markdown-analyzer.ts` | calls, exports, extends, implements, imports, instantiates, overrides, references |
| 23 | Clean | `real-clean-analyzer.ts` | extends, overrides |

**The tail is mostly RULED, not implemented.** TOML, Markdown, Protobuf, JSON,
YAML, XML, CSS, SCSS and GraphQL are data or markup formats where most types
have no construct at all. TOML's own contract says its vocabulary *is*
`contains` and "inventing one would be worse than a thin graph". Your job there
is the **corpus measurement that proves the ruling** — that is real work and it
is what makes the claim defensible. Do not manufacture edges to fill a table.

**Do not touch any language not in this list.** The other laptop owns TypeScript,
JavaScript, Svelte, Vue, HTML, Python, Rust, Go, Java, Kotlin, Scala, Groovy,
C++, C, Objective-C, C#, Visual Basic, Swift, Elixir, Erlang, Clojure, Ruby,
Perl, Haskell.

## 4. Branch strategy

- Base: `origin/main`. **Fetch and merge `origin/main` before you start** — it
  carries repairs to the differential harness and the mutation harness that your
  agents depend on. Re-merge when you start a language that is weeks in.
- Create your own branch: `analyzers/ontology-laptop-b`.
- Each language gets its **own branch off your branch**: `analyzer/BASH`,
  `analyzer/F_SHARP`, `analyzer/LUA`, … so a language can be reviewed and
  reverted alone.
- Merge each finished language branch into `analyzers/ontology-laptop-b` as it
  completes. Never let twenty languages land in one commit.
- **Never merge to `main`.** The owner does that when both laptops are done.

## 5. Corpus

`$HOME/fixtures/repositories/` is where corpus git repos live. If it is
missing or thin, **clone code-heavy repos yourself** — shallow is fine
(`git clone --depth 1`). Disk is tight; check `df -h /` before cloning and
delete build artifacts, never source. `du -sh` the corpus and keep it under
about 8 GB.

Your agents need real code for the language they are working on. A ruling with
no corpus is worthless.

## 6. The co-agent protocol

**One agent per language. Seven at a time. Never more — beyond seven the agents
start contradicting each other and hallucinating.**

Launch each with:

```bash
opencode run --model openrouter/stealth/space-bunny-alpha \
             --agent build --auto \
             --title "<LANGUAGE IN CAPITALS>" "<the task>"
```

- `--auto` is required. Agents stop dead asking for permission — an outside
  directory, a network fetch, a write outside the repo. Grant everything up
  front so that never happens.
- The session title is the language in CAPITALS (`BASH`, `TOML`, `LUA`,
  `SQL`, `MARKDOWN`, `C_SHARP`, `F_SHARP`, `HCL`, `PHP`, `R`) so the session
  list is a status board.
- Give each agent the full task every time: review what exists, establish what
  is missing, fix it, test it, verify it, document it, report back, commit.
- **One agent, one analyzer, one branch.** No two agents touch the same module.

### Tell every agent, in its task:

1. Read `docs/M14-HONESTY-CONTRACT.md` and `docs/analyzers/real-<lang>-analyzer.md`
   before writing anything. Also the shared contract at
   `docs/analyzers/ONTOLOGY-WORKSTREAM.md` if it exists on your branch.
2. **Establish before you change.** Read the analyzer, run the production entry
   (`parseFile`, not `analyze()`), and get real numbers off a real corpus.
3. For each type: **EMITTED** (with count + files) / **RULED** (with a corpus
   measurement) / **GAP** (implement it). Never guess. Never assert from a doc.
4. Verify the types the analyzer **already** emits — §2's six questions.
5. No unknown symbols, no empty names, no placeholder-literal endpoints.
6. Re-run the lane's payload/latency check. More edges means bigger graphs and
   these are budgeted: `bb_graph`'s un-narrowed default is measured at 2.5–4.8×
   a filtered one. If your addition regresses a green budget, report it — do not
   quietly re-baseline.
7. Document in `docs/analyzers/real-<lang>-analyzer.md`: what each type means in
   this language, what was ruled and why, with the measurement.
8. Commit only files nobody else owns, on your language branch, with a message
   that says what changed and what was measured.
9. Report back: per-type verdicts with numbers, what you could not settle and
   why, and anything you found broken outside your language.

### Shared files — you (master) own these, not the agents

Agents **report a need**; you make the change:

- `script/m14/differential.ts`, `script/m14/mutate-analyzer.ts` and anything in
  `script/m14/` that is shared machinery
- `validation/m14/differential-baseline.json`, `validation/m14/results/*.json`
- `validation/m60/ledger.json`, `validation/m60/results/rel-type-coverage*.json`
- `script/m60/rel-type-coverage-gate.ts`, `script/m14/ontology-coverage-gate.ts`
- `src/ast/types.ts`, `src/ast/engine.ts`
- `website/src/data/brain-languages.ts` (it holds the per-family `emits` array —
  it is **derived** from the analyzers, so it is regenerated, never hand-edited)
- `package.json` scripts

Per-language files the agent **does** own: `src/ast/real-<lang>-analyzer.ts`,
`docs/analyzers/real-<lang>-analyzer.md`, and that lane's fixtures under
`test/` or `validation/m14/fixtures/<lang>/`.

## 7. Supervise forever — the loop that matters

**You never stop. The owner is asleep and the work continues because you do.**

```
while true:
    sleep 240            # 3–5 minutes
    for each of the 7 agents:
        - is the process still alive?
        - has it produced output in the last N minutes?
        - did it stop to ask a question or request permission?
          -> re-prompt it immediately, with --auto already set,
             telling it to proceed and not to wait
        - did it print "done" / exit?
          -> read its report, REVIEW the work, then start the NEXT language
             from §3 in that slot
    keep exactly 7 slots busy at all times
```

An agent that has gone quiet is almost never finished — it asked a question and
is waiting. Re-prompt it. An agent that exits without a report did not finish;
send it back with what is missing.

**Review, do not just collect.** For each finished language:

- Did it produce a number for every verdict, or prose?
- Did it add an edge the language cannot express? (Read the analyzer.)
- Do its fixtures actually assert the new behaviour?
- Does the lane still pass mutation testing and the differential?
- Are its measurements reproducible from a clean corpus?

Reject and re-run anything that is prose instead of evidence. That is the whole
job: **the greatest, biggest, best, perfect work** — which here means measured,
reproducible, and not a single invented edge.

## 8. Report to the owner

Per language: per-type verdicts with counts, corpus used, gates re-run and their
results, files changed, and anything unresolved with the reason. Never report a
task complete without numbers behind it.

---

# ADDENDUM — issued after the firing-check round (read this first)

## 1. Our coverage claims were wrong. Here is the correction.

Laptop A ran every analyzer through the **production path**
(`getParser` → `parse` → `analyze`) on 120 real corpus files per language and
tallied which relationship types **actually fire**.

Source-derivation — counting which `RelationshipType` symbols appear in a file —
answers only *"is this type constructible"*. It does **not** answer *"does it
fire"*. For a week we reported "14 lanes at 10/10" on the strength of that check.
It was wrong and is withdrawn.

Real results for Laptop A's 24: **TypeScript and Go fire all ten. Haskell nine.
Eight lanes fire eight, seven fire seven, five fire five or six. Nothing else is
complete.** `overrides` never fires in 9 lanes, `exports` in 12.

For your 23 lanes, expect the same shape: several will be well short of 10/10 and
source inspection will not reveal it.

**Every number you report must come from `script/m14/firing-check.mjs`.** Add your
23 languages to that script and run it. A source count is not evidence.

## 2. NEW HARD RULE — no regex, anywhere

**Not one regular expression** in any analyzer, census script, or oracle. Regex
over source text matches comments and string literals, misses nested syntax, and
breaks silently on the next grammar version. Everything programmatic: walk the
tree-sitter AST via cursor/node APIs, inspect `node.type` and named children.

This is enforced mechanically by `script/m14/no-regex-gate.sh`, which currently
fails with 192 violations across the fleet. It will be a CI gate. Do not argue
that a regex is convenient; replace it with a tree walk.

## 3. Coverage is reported as APPLICABLE, never as a flat 10

A language that genuinely supports only four relationship types is **complete at
`4/4`**, not deficient at `4/10`. Reporting `1/10` for TOML — which has no
inheritance at all — misrepresents finished work as broken work.

Rules:
- **Complete** → `N/N` (e.g. `1/1`, `4/4`, `6/6`, `10/10`)
- **Incomplete** → `3/4`, `2/10` — a real shortfall
- The denominator may only shrink via a **RULED** verdict carrying a **corpus
  measurement** proving the construct never occurs. Prose does not shrink it.
- Numerator and denominator must come from **different sources**: the numerator
  from what measurably fires, the denominator from measured non-applicability. An
  agent supplying both is grading its own homework.

TOML, JSON, YAML, XML and Markdown should genuinely be small-`N` languages.
That is the correct answer for them, not a defect.

## 4. INCOMING relationships — new workstream, both machines

Every number from the firing check is **outgoing only**: one file in, edges out.
We are now measuring the other direction.

Relevant facts, from the code:
- `src/lsp/impact.ts` already performs **bounded reverse-dependency traversal**,
  with declared budgets, depth limits, truncation disclosure, and verifier gates.
- But reverse traversal works by **scanning outgoing edges and matching
  targets** — **no inbound edge is stored anywhere.** The schema holds none.
- Member-name targets resolve through their **owning declaration** when the
  member itself has no stored reverse edges (M44.U5). That resolution path is
  real and must be verified, not assumed.

We will build `incoming-check.mjs`, reporting per relationship type:
- `RESOLVED` — target matched a unique indexed symbol
- `VIA-OWNER` — matched through the owning declaration
- `AMBIGUOUS` — name matched N symbols
- `UNRESOLVED` — no target at all ← **this is the number that matters**

An unresolved outgoing edge is a lie the graph tells.

## 5. Third laptop (C) owns the shared base

C takes the database, graph, indexer, parallel workers and the incoming
infrastructure, so A and B stay purely on analyzers. Ownership by directory is
clean and will not conflict.

**One constraint, and it is binding:** C builds **additively against the frozen
contract.** No edits to `src/ast/types.ts` or `src/ast/engine.ts` signatures while
A and B are running. If C changes how symbols are keyed for resolution mid-flight,
all 47 analyzers may need revisiting. Contract changes are announced and
coordinated, never silent.

## 6. Frameworks are NOT covered by the language analyzers

Direct answer to the question, since **CSS and Dart are yours**:

| Framework | Reality today |
|---|---|
| **React** | TS analyzer carries 69 react/jsx/hook references — a language base, not framework semantics |
| **Flutter** | `real-dart-analyzer.ts` only *tags* `package:flutter/` in metadata. The widget tree and navigation are **not modeled at all** |
| **Tailwind** | `flex items-center gap-2` means nothing to the CSS analyzer in isolation. Its meaning comes from the design-system rules — a framework layer |

A language analyzer covers a **language**, not the frameworks built on it. We are
adding a framework-analyzer layer that consumes language-analyzer output rather
than re-parsing. Tailwind is the pilot because it is most self-contained and you
already have the CSS analyzer to build on.

## 7. Your 10 agents, same contract as ours

Up to 10 concurrent agents, one analyzer each, in **isolated git worktrees**
(`/tmp/opencode/wt/<LANE>`) — seven agents sharing one checkout is how work got
lost here, interleaved in a single file, uncommitted. Commit early and often: one
commit per verdict, the moment you have the number. Nothing ships unverified.

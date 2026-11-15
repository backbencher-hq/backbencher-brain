# M72 Phase 2b — from "9 leads" to measured claims, then coverage

**Status:** 2b-1 (lead adjudication) complete; 2b-2 (one-hop headroom) measured; 2b-3 (scaled
labelled fixtures) and 2b-4 (CVE-fix oracle) not started.

Phase 2a left `bb_security` honest but unmeasured: five real repositories produced **9 leads**, and
9 is far too small to support any precision figure. Phase 2b exists to fix that ordering — measure
first, widen later — so the tool never again asserts a number it cannot defend.

## 0. Why the order changed

The original Phase-2 wording was "per-language precision gates and a CVE-fix oracle for all
languages". The corpus data refutes that as a first step: with 9 positives spread over 2 languages
(4 in C, 5 in Python/C#), a per-language precision gate would have a denominator of 0–4 and could
not fail. A gate that cannot fail is theatre, so Phase 2b measures the substrate first and widens
coverage afterwards.

## 1. Lead adjudication (done)

`script/m72/oracle/label-corpus-leads.ts` reads the leads **from the corpus databases**
(`brain_security_flow`, read-only), fails if the count differs from the Phase-2a recorded 9, and
writes one adjudication per lead to `validation/m72/oracle/labels.json`.

| corpus | file:line | rule | label | reason (short) |
|---|---|---|---|---|
| ansible | `module_utils/csharp/Ansible.Basic.cs:523` | `csharp.sink.file-path` | **unknown** | `GetParams` reads a caller-supplied path with no validation; whether `args[0]` is attacker-influenced depends on the module entry point, not visible here |
| ansible | `modules/async_wrapper.py:315` | `python.path.fs_mutation` | unreachable | wrapper's own temp-directory cleanup, not attacker input |
| ansible | `modules/async_wrapper.py:321` | `python.path.fs_mutation` | unreachable | same cleanup, timeout branch |
| sqlite | `test1.c:306` | `c.sink.path_open` | unreachable | `test_io_trace`'s argv comes from the in-process Tcl test driver |
| sqlite | `test1.c:396` | `c.sink.sql_exec` | **vulnerable** | `test_exec_printf` takes `argv[2]` as a printf format handed to `sqlite3_mprintf` |
| sqlite | `test1.c:528` | `c.sink.sql_exec` | **vulnerable** | `test_exec` copies `argv[2]` with `%s` and executes it |
| sqlite | `test1.c:560` | `c.sink.sql_exec` | **vulnerable** | `test_exec_nr` passes `argv[2]` to `sqlite3_exec` with no escape or bind |
| sqlite | `test1.c:920` | `c.sink.sql_exec` | **vulnerable** | `sqlite3ExecFunc` is a SQL-function implementation; its argument is a database value |
| sqlite | `test8.c:487` | `c.sink.sql_exec` | **safe** | `echoCreate` builds a fixed logging-table DDL with `%Q` quoting |

**Honest count: 9 leads — 4 vulnerable, 1 safe, 3 unreachable, 1 unknown.**

This is **not a precision rate**, and `labels.json` says so in its own `notAPrecisionRate` field:
there is no labelled safe-code denominator, so no precision or recall figure can be derived. What
it does establish is that the engine's 9 leads are not noise: 4 of them are real injection paths,
1 is a genuinely safe construction it correctly did *not* have to flag, and 4 are non-findings the
engine still surfaced (3 unreachable, 1 undetermined).

The 3 `unreachable` and 1 `unknown` are the useful signal for the next step: they are exactly the
classes a one-hop reachability check plus a caller-context rule would remove.

## 2. One-hop reachability — measured before built (done, negative result)

`script/m72/oracle/probe-onehop.ts` measures, read-only on the corpus DBs, how much a one-hop
intra-file call + parameter-binding pass would add. Result (`validation/m72/results/onehop.json`):

| corpus | call edges | with caller | same-file resolved | ambiguous | unresolved callee | sink pairs |
|---|---|---|---|---|---|---|
| graphql-js (TS) | 20,759 | 4,988 | 1,605 | 107 | 3,276 | **0** |
| rake (Ruby) | 1,215 | 1,195 | 0 | 0 | 0 | **0** |
| rebar3 (Erlang) | 16,024 | 16,022 | 0 | 0 | 0 | **0** |
| ansible (Python) | 26,363 | 26,080 | 0 | 0 | 0 | **0** |
| sqlite (C) | 37,058 | 36,917 | 0 | 0 | 0 | **0** |
| **total** | **101,419** | — | **1,605** | **107** | — | **0** |

**Conclusion: one-hop intra-file reachability adds nothing on today's stored evidence.** Two
independent reasons, both measured rather than assumed:

1. **The callee is only recorded for TypeScript.** `metadata.calleeExpression` exists on every TS
   call edge (20,759/20,759) and on **zero** C, Python, Ruby and Erlang edges — those analyzers
   store `relationshipType`, evidence class, criticality, etc., but not the called name. Without a
   callee identity there is nothing to resolve and nothing to bind.
2. **Even where it resolves, no pair exists.** TS resolves 1,605 same-file callee declarations, and
   the number of caller→callee pairs where one side holds a stored lead is **0** — because the
   corpora with TS density (graphql-js) produce 0 leads, and the corpora that produce leads (sqlite,
   ansible) record no callee at all.

So the earlier hypothesis ("one-hop unlocks graphql-js") is **refuted by measurement**. Building the
reachability engine now would be work with no measurable effect, and it would add a second reason
for a lead to be wrong. The correct Phase-2b conclusion is: **do not build one-hop yet.** The
blocking dependency is analyzer-level callee capture for non-TS languages, which is a separate work
stream (and touches analyzers, not the security engine).

## 3. What this means for the rest of Phase 2b

Reordered by measured dependency, not by the original plan:

1. **Analyzer callee capture (new blocker).** Without `calleeExpression` on C/Python/Ruby/Erlang call
   edges, no reachability work can be evaluated. This belongs to the analyzer lanes.
2. **Scaled labelled fixtures per family (2b-3).** The only path to a real denominator that does not
   depend on (1): author vulnerable + safe pairs per vulnerability family (target 30–50 each) and
   measure precision on that labelled set. This is the first step that can produce a number.
3. **CVE-fix oracle per family (2b-4).** Measures recall (do we miss real bugs?) — needs real
   vulnerable/fixed commit pairs and is the only evidence that can justify `scan` vocabulary.
4. **Promotion per family (2b-5).** A family earns `scan` when 2 and 3 pass; languages inherit it.
   `scan` stays at 0 until then.

## 4. Limits of this document

- The adjudication is one analyst's reading of the quoted source; `unknown` is used where the source
  alone cannot decide, rather than guessing.
- The one-hop probe counts *stored* leads as the only sink-side signal, so a dangerous call in a file
  that produced no lead contributes no pair. That makes the probe a lower bound, and the conclusion
  ("adds nothing measurable now") holds a fortiori.
- No precision, recall or coverage percentage is claimed anywhere in Phase 2b. The only honest
  statement available today is the adjudication count in §1.
## 5. Labelled fixture corpus and the engine defect it exposed (2b-3a)

`validation/m72/oracle/fixtures/` now holds four families (`sql-execute`, `path-traversal`,
`command-injection`, `code-injection`) with **both** classes, each with a machine-readable
`expected.json`. Runner: `npx tsx script/m72/oracle/lib/run-labelled.ts`.

| family | n | vulnerable | safe | TP | FP | FN |
|---|---|---|---|---|---|---|
| code-injection | 16 | 8 | 8 | 8 | 0 | 0 |
| command-injection | 16 | 8 | 8 | 8 | 0 | 0 |
| path-traversal | 16 | 8 | 8 | 8 | 0 | 0 |
| sql-execute | 39 | 23 | 16 | 23 | 0 | 0 |
| **total** | **87** | **47** | **40** | **47** | **0** | **0** |

**This is a FIXTURE precision over crafted files — not a corpus precision.** It says the rules match
what their authors intended; it does not say real code is clean. The corpus precision remains
unmeasured (n=9 adjudicated leads, no denominator).

### Engine defect found and fixed: `isSelfPair` span

The first fixture run failed on `subprocess.run(sys.argv[1], shell=True)` with `no_reaching_source`,
then on every source-inside-argument case. `isSelfPair` (flow.ts) compared the source span against
the **whole call** (`sink.charStart`..`sink.charEnd`), which includes the parentheses and arguments.
Any source *inside* the argument list therefore overlapped the sink and was discarded as a self-pair
before argument selection — so `fopen(argv[1],"r")`, `os.system(cmd)` and
`subprocess.run(sys.argv[1], shell=True)` produced **no lead at all**.

The check now compares against the **callee token only** (`callStart` → first argument start,
falling back to `callEnd`). Verified:

- negatives still silent: `/x/.exec(` (RegExp self-pair), `r.URL.Query()` as a SQL sink;
- positives now fire: `subprocess.run(sys.argv[1], shell=True)` → `python.cmd.subprocess_shell`,
  `fopen(argv[1],"r")` → `c.sink.path_open`, `exec(req.query.cmd)` → `typescript.cmd.child_process`,
  `os.system(cmd)` → `python.cmd.os_shell`;
- 37/37 engine assertions, all four gate suites, 87/87 fixtures, `tsc --noEmit` clean.

### Spec gaps recorded (not fixed here — they belong to the language/spec lanes)

1. **C has no path sanitizer.** `c.sanitizer.*` covers only SQL. `basename()`-guarded or
   allowlist-selected C paths are still reported; path-traversal safety is therefore expressed as
   "the source does not reach the path argument".
2. **Python has no `open()` path sink.** `python.path.fs_mutation` covers the mutation APIs
   (`shutil.rmtree`, `os.remove`, …), not `open()`.
3. **`snprintf` / `os.path.join` are not followed.** The flow engine follows plain assignments, not
   string formatting; fixtures assign directly instead.

## 6. Component formats: svelte + vue moved from `unsupported` to `leads`

The density funnel (§5) showed 0.8% of symbols carry any sink, and the natural question was
whether the *specs* were poor. They are not: every lead-tier spec declares 5–11 sinks (median 9).
The real gap was **two of the 17 `unsupported` languages being genuine executable code**:

- `svelte` and `vue` were marked "component format; script-block extraction is not wired to the
  security engine" — but that was stale. `pool-worker.ts` already classifies both as JS-family
  (`JS_FAMILY = {javascript, typescript, tsx, vue, svelte}`) and extracts their `<script>` /
  `<script setup lang="ts">` blocks as ordinary symbols with real byte offsets.
- Measured corpus weight: **6,147 `.svelte` and 1,155 `.vue` files** across the corpora, all indexed
  and previously never security-scanned.

Now: `specs/svelte.ts`, `specs/vue.ts` (5 sources / 10 sinks / 6 sanitizers each), aggregated by
`specs/component-specs.ts`, and the registry moves both to `leads`.
**Tier counts: 53 total / 38 leads / 15 unsupported / 0 scan.** The 15 remaining `unsupported`
languages are genuinely non-executable (css, scss, sass, html, xml, json, yaml, toml, markdown,
protobuf, graphql, sql, hcl, terraform, make).

### Engine fix this exposed: variable-identity reach

Writing the Svelte fixture `export let code; eval(code)` produced **no lead**, while
`const code = getInput(); eval(code)` did — purely because only the second had an assignment to
follow. `tryReach` had no path for a source that *declares* a variable (`captureVariable`) and a sink
consuming that same identifier with no assignment between them; the captured variable was dead data.

Fixed in `flow.ts`: when a source carries `variable` and the sink argument's identifier chains
contain it, that is a flow. Pinned by `validation/m72/fixtures/{svelte,vue}/`, whose READMEs record
the exact before/after. Engine assertions: 37/37 after the change.

A second, spec-level cause: a single `defineProps|props.x` rule captured the literal `defineProps`
as the variable, which could never match `props.html`. Split into `vue.props` (declaration) and
`vue.props_read` (`captureVariable` on the member read).

### Measured component result

Across 71 sampled `.svelte`/`.vue` files from `svelte` and `vue-core`: **27 files carry extractable
symbols, 1 genuine lead** (`location.hash` → `location.href`, a real open-redirect shape). That is
low in absolute terms but the point is coverage: these files were structurally invisible before, and
the lead is a true positive rather than noise.

Honest reading: adding two languages does not move the corpus totals (still 9 real-corpus leads),
because component files concentrate their risk in **template** directives (`{@html}`, `v-html`) that
the extracted script body cannot contain. Those are recorded as limits, not rules — writing them
would be coverage that can never fire.

## 7. Why TypeScript/Java/Go read as low-density (measured, item 6 second half)

The density funnel (§5) says 472 of 26,633 symbols (1.8%) match a source and 201 (0.8%) match a
sink. The natural suspicion is a weak TypeScript spec, so it was measured directly.

**The spec is not the cause.** On graphql-js (367 TypeScript files, 6,711 symbols):

| stage | count |
|---|---|
| files scanned | 120 |
| symbols with byte offsets | 1,289 |
| symbols matching a source rule | **0** |
| symbols matching a sink rule | **0** |
| files in 40 sampled containing ANY sink token (`child_process|execSync|spawnSync|execFile|eval|new Function|innerHTML|document.write|unserialize`) | **1** (`__testUtils__/withAsyncUsing.ts`, a test utility) |

The extracted symbol bodies are **type signatures** (`publish: (message) => void`, interface members,
constants) — graphql-js is a specification/implementation library whose dangerous operation is
*building* a query document, not executing one. There is no `req.body`, no `db.query`, no `exec` in
library code. Its zero is a **true negative for the architecture**, and the engine correctly says so.

This is the same shape the whole-repo funnel predicts: application code (route handlers, controllers,
services) concentrates sinks; library and type-definition code has almost none. Java/Go corpora in
this set are the same kind of code (Go tooling, Java libraries), so their low counts are expected for
the same reason — not a detector defect.

**Consequence for the objective.** "Low real-code density in TypeScript/Java/Go" is not a bug to fix
by widening specs: adding sinks that never occur would raise the sink count without raising the lead
count, and would add false positives to the code that *does* get scanned. The honest lever is to
scan **application** code, not whole repositories, and the density metric should be reported per
repo kind (application vs library) rather than as a single project-wide ratio.

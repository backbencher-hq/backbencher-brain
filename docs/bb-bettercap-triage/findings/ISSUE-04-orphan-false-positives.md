# ISSUE-04 — Orphan false positives: `jsOnEventFunc` flagged orphaned at 70% while it is referenced as a function value

Lane: `go-callgraph` · Issue 4 of the bettercap "Still broken" report · Product: bb **0.1.6** ·
Repo HEAD **`be4c0ef25d`** (`be4c0ef25`, subject "Release 0.1.6: five analyzers, one graph") ·
Campaign date **2026-11-18** · Bettercap index projectId `4c7590f1cba319aac298a50453c0ec440f2dc857`
(1972/1973 files, 55,785 symbols, DB 393 MB; fixed specimen, never reindexed).

## Verdict

**`REAL-BUT-MISDESCRIBED`** — severity **high**.

The user-visible defect is real: `bb_patterns scope=orphaned` reports

```
orphaned_function jsOnEventFunc — session/script_builtin_runtime.go:39 (70%)
```

while the same file family references `jsOnEventFunc` as a function value at
`session/session.go:336`. That reference produces **no relationship row of any type** in the index, so
the orphan rule has literally nothing to consume. The report's stated mechanism and its conflation of
two different surfaces are wrong, though:

| Sub-claim of report item 4 | Verdict | Evidence |
|---|---|---|
| `jsOnEventFunc` is flagged orphaned at 70% despite the reference at `session/session.go:336` | **REAL** | `bb_patterns scope=orphaned` row #1; 0 incoming rows of any type in DB |
| The reference is a call the call graph missed (`bb_analyze callers` returns 0) | **FALSE / misdescribed** | The reference is a function *value* assigned to a map entry, not a call; `callers` = call-graph edges, 0 is correct semantics — the missing edge is `uses`, not `calls` |
| The orphan formula ignores non-call edges | **FALSE** | `orphans.ts:49` `USAGE_TYPES` already includes `uses`, `references`, `imports`, `instantiates`, `extends`, `implements`, `overrides`, `renders`, `decorates`, `mixes_in`; `:876` also consults a name channel |
| Totals: 4,385 orphan candidates (2,739 functions, 1,644 files); 4,697 total pattern findings | **REAL, exact** | census lines below; the split omits 2 `orphaned_class` candidates (2,739+1,644+2 = 4,385) |
| "Asset noise remains" | **REAL but by design, and huge** | 1,573 of 1,644 `orphaned_file` candidates (95.7%) are vendored `modules/ui/ui/assets/**` files (1,581 of the 1,972 indexed files!) |

The underlying defect is a **Go-analyzer edge gap**, not an orphan-detector bug: the GO1
bare-identifier `uses` pass only emits when the identifier names a value declared **in the same file**
(`src/ast/real-go-analyzer.ts:5020-5030` + gate `:5382`). Cross-file function-value references are
therefore invisible to every consumer of the graph (`bb_graph`, `bb_impact`, `bb_patterns`,
`bb_visualize`), not only to the orphan rule.

Why it matters to a user: an external agent reading the orphan list is told seven `session/js*Func`
callbacks are dead code; acting on it would delete functions that `session.go` registers into
`plugin.Defines` at startup. The finding's own JSON evidence contains a "COVERAGE GAP INDICATOR"
saying the analyzer probably missed a reference, but the CLI text surface does not render it (see
Adjacent defect A4.1).

---

## Ground truth at the pivot

`/home/ishaq2321/bettercap/session/session.go:328-340` — the reference is a **map-entry assignment of a
function value**, inside `(*Session).Setup`; no call syntax exists at the site:

```go
	s.Events.Add("session.started", nil)

	// register js functions here to avoid cyclic dependency between
	// js and session
	plugin.Defines["env"] = jsEnvFunc
	plugin.Defines["run"] = jsRunFunc
	plugin.Defines["fileExists"] = jsFileExistsFunc
	plugin.Defines["loadJSON"] = jsLoadJSONFunc
	plugin.Defines["saveJSON"] = jsSaveJSONFunc
	plugin.Defines["saveToFile"] = jsSaveToFileFunc
	plugin.Defines["onEvent"] = jsOnEventFunc          // <- line 336
	plugin.Defines["removeEventListener"] = jsRemoveEventListenerFunc
	plugin.Defines["session"] = s
```

The declared function it names (`/home/ishaq2321/bettercap/session/script_builtin_runtime.go:39`):

```go
func jsOnEventFunc(call otto.FunctionCall) otto.Value {
	argv := call.ArgumentList
	argc := len(argv)
	cb := otto.NullValue()
	filterExpr := ""
	...
```

So the relationship the graph should carry is `uses` (optionally `references`) from the enclosing
`(*Session).Setup` symbol to `session/script_builtin_runtime.go:39:jsOnEventFunc`. It must never be a
`calls` edge (nothing invokes it directly from indexed code; otto invokes it dynamically through
`plugin.Defines`). The same construct registers **seven sibling callbacks**, all from this one file
(`jsEnvFunc` is declared in a third file, `session/script_builtin.go:8`).

---

## Reproduce

```bash
cd /home/ishaq2321/mcp/backbencher-brain
# (1) the reference site
sed -n '328,340p' /home/ishaq2321/bettercap/session/session.go
# (2) callers answer (Lead reproduced; lane reproduced)
node bin/bb tool bb_analyze --dir /home/ishaq2321/bettercap \
  --args '{"mode":"callers","target":"jsOnEventFunc"}'
# (3) any edge kind, two hops
node bin/bb tool bb_graph --dir /home/ishaq2321/bettercap \
  --args '{"symbol":"jsOnEventFunc","direction":"both","maxDepth":2,
           "relationshipTypes":["calls","uses","references","imports","instantiates","overrides","extends","implements"]}'
# (4) the orphan page (jsOnEventFunc is row #1: highest LOC among 70% candidates)
node bin/bb tool bb_patterns --dir /home/ishaq2321/bettercap \
  --args '{"scope":"orphaned","limit":500}'
# (5) all-scope census
node bin/bb tool bb_patterns --dir /home/ishaq2321/bettercap \
  --args '{"scope":"all","limit":10}'
```

Bounded observed output (full files under `docs/bb-bettercap-triage/evidence/go-callgraph/`):

```
# (2) a1-analyze-callers-jsOnEventFunc.json
"root": { "id": "4c7590f1…:session/script_builtin_runtime.go:jsOnEventFunc:39",
          "name": "jsOnEventFunc", "symbolType": "function",
          "file": "session/script_builtin_runtime.go", "line": 39, "lineEnd": 118,
          "language": "go", "complexity": 17, "isExternal": false },
"rootCandidates": 1, "rootMatch": "exact",
"callers": [],
"callees": [],
…
"summary": { "totalCallers": 0, "totalCallees": 0, …
             "relationshipTypesUsed": ["calls","extends","implements","uses","instantiates",
               "overrides","contains","references","imports","exports","decorates","renders",
               "mixes_in","part_of"] … }

# (3) a2-graph-jsOnEventFunc-allkinds.json  — 122 KB, emits incoming: n/a, outgoing callees to
#     external otto leaves only. `callers` array is empty; no `uses`/`references` row points at it.

# (4) a3-patterns-orphaned-limit500.txt
orphaned code (4385 found):
  orphaned_function jsOnEventFunc — session/script_builtin_runtime.go:39 (70%)
  orphaned_function httpGrabber — modules/syn_scan/http_grabber.go:30 (70%)
  orphaned_function mdnsParser — modules/net_sniff/net_sniff_mdns.go:16 (70%)
  …
  orphaned_function jsRemoveEventListenerFunc — session/script_builtin_runtime.go:120 (70%)
  …
  orphaned_function jsEnvFunc — session/script_builtin.go:8 (70%)
  orphaned_function jsSaveJSONFunc — session/script_builtin_runtime.go:177 (70%)
  orphaned_function jsLoadJSONFunc — session/script_builtin_runtime.go:202 (70%)
  orphaned_function jsSaveToFileFunc — session/script_builtin_runtime.go:156 (70%)
  orphaned_function jsRunFunc — session/script_builtin_runtime.go:21 (70%)
  orphaned_function jsFileExistsFunc — session/script_builtin_runtime.go:226 (70%)
  …
  orphaned_file modules/ui/ui/assets/fontawesome/svgs/brands/facebook-f.svg … (55%)
  …
[scan: 4385 orphan candidate(s) (orphaned_function=2739 orphaned_file=1644 orphaned_class=2); showing 500]
[suppressed: testPath=731 entryPointName=42 nonCodeFile=18564 manifestFile=1]
[usage-evidence: refused 32353 row(s) (selfLoop=106, inferred=138, lowConfidence=32109); imports: 1908 row(s), 1900 attributed to a file, 0 resolved, 0 file(s) cleared]
[provenance: static_finding via orphans@intelligence; scanned 23929 symbol(s) in 1902 file(s); limitations: 4]

# (5) a5-patterns-all-limit10.txt
patterns (4697 found):
[scan: 4697 finding(s) across orphaned_function=2739 orphaned_file=1644
 high-complexity-function=196 god-class=69 long-parameter-list=38 framework-detected=9
 orphaned_class=2; showing 10]
```

Direct index proof (byte-read-only sqlite on the fixed specimen DB —
`b1-db-jsonEventFunc-rows.txt`, `b3-db-identifier-fns-and-filecov.txt`):

```
# every relationship row that names jsOnEventFunc — ANY type, anchored or by name:
SELECT … FROM brain_relationship WHERE target_symbol_id LIKE '%:jsOnEventFunc:%';
  (0 rows)
SELECT … FROM brain_relationship WHERE target_external LIKE '%jsOnEventFunc%';
  (0 rows)

# the 7 sibling callbacks registered at session.go:330-338 — incoming rows:
jsEnvFunc 0 | jsFileExistsFunc 0 | jsLoadJSONFunc 0 | jsOnEventFunc 0 |
jsRemoveEventListenerFunc 0 | jsRunFunc 0 | jsSaveJSONFunc 0 | jsSaveToFileFunc 0

# the shared analyzer pass's whole footprint on bettercap:
identifier_usage rows: 366 total, 366 anchored, 0 leaf, 0 cross-file.
  by target kind: variable 230, constant 126, function 10  (all same-file)
```

### Expected vs observed

| Question | Expected (correct graph) | Observed |
|---|---|---|
| `bb_analyze mode=callers jsOnEventFunc` | 0 (no direct call exists) | 0 — **correct semantics, not the defect** |
| `bb_graph` incoming of ANY kind | 1 `uses` row from `(*Session).Setup` | 0 rows |
| `bb_patterns scope=orphaned` | not a candidate | `orphaned_function … (70%)`, row #1 |
| `bb_impact jsOnEventFunc relationshipTypes:["uses"]` | 1 dependent | 0 (same empty row set) |
| The other 7 `plugin.Defines` callbacks | same `uses` rows | all 8 absent; all 8 appear at 70% in the orphan page |

---

## Root cause (quoted code)

### 1. The Go analyzer's bare-identifier `uses` pass is deliberately same-file-only — this is the bug

`src/ast/real-go-analyzer.ts:5015-5030`:

```ts
  private analyzeGoBareIdentifierUses(
    rootNode: Node,
    relationships: ASTEngine.UniversalRelationship[],
    symbols: ASTEngine.UniversalSymbol[],
  ): void {
    const fileValues = new Set<string>()
    for (const s of symbols) {
      if (
        !s.ownerName &&
        (s.kind === ASTEngine.SymbolKind.Variable ||
          s.kind === ASTEngine.SymbolKind.Constant ||
          s.kind === ASTEngine.SymbolKind.Function)
      ) {
        fileValues.add(s.name)
      }
    }
```

`symbols` here is the symbols **parsed from this one file** (call site
`src/ast/real-go-analyzer.ts:3006-3008`, right after the selector-uses pass). The emission gate is
`src/ast/real-go-analyzer.ts:5382`:

```ts
          !isShadowed(name) &&
          fileValues.has(name)
        ) {
          const src = this.resolveGoWorkSource(node)
          const key = `${src}::uses::${name}`
          if (!emitted.has(key)) {
            emitted.add(key)
            relationships.push({
              source: src,
              target: name,
              type: ASTEngine.RelationshipType.Uses,
              confidence: 1.0,
              … metadata: { relationshipType: "identifier_usage", … }
```

For `plugin.Defines["onEvent"] = jsOnEventFunc` at `session/session.go:336`, `jsOnEventFunc` is **not**
in `session/session.go`'s `fileValues` (it is declared in `script_builtin_runtime.go`), so the pass
emits nothing at all — no anchored row, no leaf row, not even a `target_external` that the orphan
engine's name channel could consume.

The analyzer's own reason-code vocabulary says this case is understood and expected to be *emitted as
a leaf*, then left for a resolver — `src/ast/real-go-analyzer.ts:188-189`:

```ts
  // A used identifier is a plain name; the file that declares it is not read.
  "uses|identifier_usage": "used_identifier_recorded_as_a_leaf_whose_declaring_file_is_out_of_scope",
```

and the pass's own doc comment (`:4666-4670`) states the scope as "file-visible VALUE". The
`var C = someOtherFunc` shape is explicitly named as *not claimed* by the declaration pass
(`:2269-2271`) because it "needs a symbol resolution" — the identifier pass was supposed to be that
solution but its same-file gate defeats it for exactly this shape.

Data corroborates: on bettercap, **all 366 emitted `identifier_usage` rows are anchored and
same-file; 0 are cross-file.** Same-file value reads do work (e.g. 10 function targets) — the failure
is strictly cross-file (this isolated differential is what the fix's gate must pin).

### 2. The orphan detector is NOT call-only; its semantics are correct for the rows it receives

`src/intelligence/patterns/orphans.ts:36-49`:

```ts
// Relationship types that can express "somebody uses this symbol".
…
const USAGE_TYPES = ["calls", "instantiates", "extends", "implements", "uses", "references", "imports", "overrides", "renders", "decorates", "mixes_in"]
```

Decision and confidence (`orphans.ts:876`, `:885-913`):

```ts
    const used = usedIds.has(sym.id) || (usedNames.has(sym.name) && !ambiguousNames.has(sym.name))
    if (used) continue
    …
    //   name unique in the reporting scope : 2,581 candidates,  0.0% false positive
    //   name ambiguous                      : 6,113 candidates, 14.4% false positive
    //   file IS cross-file referenced       : 7,234 candidates, 11.4% false positive
    //   file is NOT cross-file referenced   : 1,460 candidates,  3.7% false positive
    let confidence = 0.5
    confidence += nameAmbiguous ? -0.15 : 0.15
    confidence += fileReferenced ? -0.05 : 0.05
    if (confidence < 0.3) confidence = 0.3
    if (confidence > 0.7) confidence = 0.7
```

`jsOnEventFunc` is unique in the reporting scope (+0.15) and its file
`session/script_builtin_runtime.go` has no incoming *cross-file* clean usage edge (−0.05 ⇒ 0.70 cap):
**0.5 + 0.15 + 0.05 = 0.70 exactly** what was reported. The 70% is the *maximum* the rule can emit —
the report says "despite the reference" but the finding's confidence is the cap, i.e. the rule
believes it strongly.

The engine *does* already disclose the coverage gap: `orphans.ts:822-826` and `:916-921` build a
`COVERAGE GAP INDICATOR` evidence block whenever the symbol has no incoming row but its file does.
`session/script_builtin_runtime.go` has 3 incoming `uses` rows to `jsRuntime` (2) and `jsListeners`
(1), so the JSON finding for `jsOnEventFunc` **does** carry "this symbol has no incoming usage edge
at all, but its file receives 3 incoming usage edge(s)" — but see Adjacent defect A4.1.

### 3. Measured non-causes (tested, negative)

- **(ii) orphan formula ignoring non-call edges — FALSE.** `USAGE_TYPES` includes `uses`/`references`
  and the ID + name channels both accept them; the block is that no row exists.
- **(iii) asset files analyzed as first-party — REAL for orphaned_file noise, but NOT the cause of
  this finding.** `jsOnEventFunc` is a `function` candidate from `session/`, not an asset file. The
  asset problem is separate and quantified below.
- Secondary, tool-wide contributor to orphan false positives worth flagging (not this symbol): the
  engine refuses usage rows below `MIN_EDGE_CONFIDENCE = 0.7` (`orphans.ts:100`). On bettercap, the
  census itself reports **32,109 low-confidence row(s) refused**, of which 32,107 are `uses` rows
  published by the *relationship-enrichment* pass at confidence 0.6 with
  `evidenceClass:"usage_contextual"` (e.g. `defineIcons → icon`). Those rows are not about
  `jsOnEventFunc`, but any orphan candidate whose only evidence is such a row stays a candidate by
  design — a separate calibration question the Lead may want filed.

---

## Re-derived totals vs the report

| Metric | Report | Lane observed (`bb_patterns`) | Drift |
|---|---|---|---|
| Orphan candidates | 4,385 | **4,385** (`orphaned code (4385 found)`) | 0 |
| — functions | 2,739 | **2,739** (`orphaned_function=2739`) | 0 |
| — files | 1,644 | **1,644** (`orphaned_file=1644`) | 0 |
| — classes | (not stated) | **2** (`orphaned_class=2`) | report omits 2; 2739+1644+2 = 4385 |
| Total pattern findings | 4,697 | **4,697** (`patterns (4697 found)`): orphaned_function 2739 + orphaned_file 1644 + high-complexity 196 + god-class 69 + long-parameter-list 38 + framework-detected 9 + orphaned_class 2 | 0 |
| Index files | 1972/1973 | 1972 `brain_file` rows, index `status=complete` while health warns `[INCOMPLETE_INDEX]` (issue 11's lane) | consistent |

Suppression/evidence accounting from the same run (quoted above): `testPath=731 entryPointName=42
nonCodeFile=18564 manifestFile=1`; refused usage evidence `selfLoop=106 inferred=138
lowConfidence=32109`; imports `1908 seen / 1900 attributed / 0 resolved / 0 files cleared`
(imports coupling is issue 3's lane).

## "Asset noise" — quantified (REAL)

`brain_file` = 1,972 rows, of which **1,581 are under `modules/ui/ui/assets/` (1,577 fontawesome
SVGs)** — i.e. the vendored FontAwesome asset tree is **80% of the indexed files**. The
`orphaned_file` rule reports non-code files as whole files by design
(`orphans.ts` header: non-code languages "are still indexed and still checked as whole files"), and
the import channel resolved **0 files** on this Go project, so nothing clears them. Reconstructing
the engine's candidate query from the DB (`b7-db-filecandidate-recon.txt`):

```
bucket        candidates
rest_of_repo  70
ui_assets     1573        (reconstruction ±1 vs engine's 1644; simplified path exclusions)
```

⇒ **1,573 of 1,644 `orphaned_file` candidates (95.7%) are vendored UI assets**, and they are
**35.9% of all 4,385 orphan candidates**. They rank at 55% (below real code) but the page cap is 500,
so in practice the orphan tail is almost entirely minified/vendored asset noise. This is the report's
"asset noise remains", measured. It is a design/usability defect (no vendor/asset exclusion for the
file rule), distinct from the missing-edge root cause above.

---

## Generality

`bb index` of fresh fixtures is BLOCKED in this sandbox (cannot mkdir under `~/.bb/projects`), and
`/tmp` is per-call ephemeral, so the language×repo matrix below is assembled from the one Go index
built with the current analyzer (bettercap), analyzer-source contracts, and the pre-existing
workspace index with the staleness caveat stated. Cells that could not be measured say so.

| language | project / fixture | repro | same class? | evidence |
|---|---|---|---|---|
| Go | bettercap (current analyzer) | `plugin.Defines["onEvent"] = jsOnEventFunc` cross-file value | **YES — reproduced** (0 incoming rows; orphan 70%) | `a1`, `a2`, `a3`, `b1`, `b3` |
| Go | bettercap (same file control) | same-file value reads (e.g. `jsOnEventFunc -> jsListeners` line 66) | NO — same-file `uses` rows DO emit (366 anchored, 0 cross-file) | `b3`, `b4` |
| Go | any Go project | analyzer gate `fileValues.has(name)` is repo-independent (per-file parse) | **YES by construction** — cannot empirically index a second Go repo (blocked); describe as analyzer-wide | source quote `real-go-analyzer.ts:5020-5030,5382` |
| Go | workspace `.corpus/consul`, `.corpus/vault` | MCP probes attempted | **CANNOT-VERIFY** — workspace index is 2026-11-17/partial and predates the GO1 pass: only **11** `identifier_usage` rows in the entire 506,841-symbol project (0 in `.corpus` Go repos), so it cannot test current analyzer behavior | `b4-workspace-identifier-usage-by-repo.txt` |
| JS/TS | `.corpus/axios`, `.corpus/express` | `bb_graph httpAdapter` (file-scoped) ⇒ "Symbol 'httpAdapter' not found"; index stale/partial | **OPEN/CANNOT-VERIFY** — JS analyzer *does* emit `Uses` (5 emission sites) and `References` (1) per `src/ast/real-javascript-analyzer.ts`, and cross-file anchoring is resolver-based, so the same class is expected NOT to reproduce; unmeasured under the sandbox constraint | MCP failure + analyzer source grep |
| Python | analyzer source | — | **OPEN/CANNOT-VERIFY** (no Python index available; `real-python-analyzer.ts` emits `Uses` at 1 site + `References`) | analyzer source grep |
| Rust | analyzer source | — | **OPEN/CANNOT-VERIFY** (no Rust index available; `real-rust-analyzer.ts` emits `Uses` at 2 sites + `References` at 2) | analyzer source grep |
| all languages | orphan rule itself | USAGE_TYPES + name channel accept non-call kinds in every language | tool-wide design is sound for the kinds it receives; the failure mode is analyzer-specific (Go) | `orphans.ts:49,876`, docs/BB_PATTERNS.md |

Conclusion of the generality analysis: this is **a Go-analyzer edge gap** (the GO1 pass's same-file
gate), surfacing through a tool-wide orphan definition that is itself correct. Any language whose
analyzer resolves cross-file value reads (JS/Python/Rust emitters exist) should not show this class.

---

## Fix sketch

**Primary (Go analyzer, `src/ast/real-go-analyzer.ts`):** when the GO1 pass sees a genuine identifier
read (all existing exclusions already applied — not a callee, not an assignment LHS write, not
shadowed, not a composite key, not a channel operand, not a label/path) whose name is **not**
in `fileValues`, emit the row as a **leaf value read** instead of dropping it:

```ts
// today:  … !isShadowed(name) && fileValues.has(name)
// fix:    … !isShadowed(name) && (fileValues.has(name) || isCrossFileValueReadCandidate(name))
relationships.push({
  source: src, target: name,
  type: ASTEngine.RelationshipType.Uses,
  confidence: fileValues.has(name) ? 1.0 : 0.9,
  metadata: {
    relationshipType: "identifier_usage",
    bindReason: "used_identifier_recorded_as_a_leaf_whose_declaring_file_is_out_of_scope",
  },
})
```

Precision rules to avoid the junk-edge failure the same-file gate was protecting against:
1. Only identifiers in **value position** (the pass's existing gate already excludes callee/LHS/
   declaration positions).
2. Suppress names that are Go builtins/stdlib-qualified (`isGoBuiltin`, `hasGoQualifiedAncestor` —
   both already exist) and names the file's import table binds (dot-import leniency GO3 already
   handled).
3. Emit as **leaf** (`target` = bare name; no invented `target_symbol_id`) at 0.9 — the same shape
   and reason-code the vocabulary already declares for this exact case (`:188-189`). A post-pass
   cross-file arbiter can anchor it to the declaring symbol when a unique declaration exists; when it
   cannot, the orphan engine's **name channel** (`orphans.ts:514-543`) already consumes clean
   `target_external` rows and will clear a uniquely-named candidate, so even an unanchored leaf fixes
   the false positive.
4. Do not emit when the identifier resolves to a local binding in any enclosing scope (existing
   `isShadowed`/scope stack keeps this).

**Secondary (orphan confidence calibration, separate issue):** `USAGE_TYPES` is right, but
`MIN_EDGE_CONFIDENCE = 0.7` refuses 32,107 enrichment-published `uses` rows at 0.6 on bettercap; the
enrichment tier's `usage_contextual` rows are lower-trust than analyzer rows and probably deserve
their own (lower) threshold or their own evidence channel rather than being silently refused. Not
part of this fix's blast radius; file separately if the Lead wants it.

**Tertiary (asset noise, separate issue):** the `orphaned_file` rule should either exclude vendored
asset trees (path-convention exclusion, e.g. `*_assets/`, `*/assets/fontawesome/`, `*.svg` non-code
bulk) from the *page* or aggregate them into one counted row ("1,573 vendored asset files have no
incoming references"). Deleting/inspecting 1,573 SVGs one by one is not an actionable "orphan" claim.

## Gate proposal (the test that would have caught it)

1. **Analyzer gate (`script/m14/mutate-analyzer.ts` + `validation/m14/fixtures/go/`)** — the existing
   GO1 fixture `validation/m14/fixtures/go/bare-value-reads.go` is deliberately **single-file**
   ("file-visible VALUE"). Add a two-file fixture package
   `validation/m14/fixtures/go/cross-file-value-reads/{a.go,b.go}` with:
   ```go
   // a.go
   package reads
   func callback(v int) int { return v }
   // b.go
   package reads
   var Registry = map[string]func(int) int{}
   func setup() { Registry["x"] = callback }   // cross-file function VALUE, no call
   ```
   Expectation: `expectRelationships` contains `{type:"uses", from:"setup", target:"callback"}`
   (and/or leaf `target_external:"callback"` with the out-of-scope-declaring-file reason code).
   A mutation ("drop every bare identifier_usage edge") must fail the fixture, exactly like the
   existing Z3 regression. Run via `script/go-arm-runner.sh`/mutation harness.
2. **Orphan gate (`script/m13/verify-patterns-orphans.ts` or `script/verify-patterns.ts`)** — index
   the same two-file fixture and assert `detectOrphans` does **not** emit a candidate for `callback`
   (i.e. the registered callback is not called dead code). This is the user-visible contract the
   report broke. Keep `bb_analyze callers` asserted at 0 in the same gate to pin the
   `calls` vs `uses` distinction so nobody "fixes" it by mislabelling the edge a call.
3. **Evidence-surface gate** — assert the CLI `bb_patterns` text surface renders the coverage-gap
   indicator (see A4.1), so a future missing edge is visible where the reporter looks.

## Adjacent defect found (also appended to `findings/UNLOCKED.md`)

**A4.1 — Orphan findings carry a "COVERAGE GAP INDICATOR" that the CLI text surface never renders.**
`orphans.ts:812-827` builds per-finding `evidence[]` including the coverage-gap disclosure, and
`:916-921` computes `fileUsage`; the JSON/engine contract exposes it, but
`node bin/bb tool bb_patterns` prints only the one-line row + confidence (`a3` output). The exact
caveat a reader needs — "this symbol's file receives 3 incoming usage edges; the analyzer likely
missed this one" — exists in the payload and is invisible on the surface the external agent used.
Severity: medium (honesty-of-surface class, same family as issue 10/12); owner lane suggestion:
`payload-honesty`.

## Limitations / cannot-verify

- `bb index` of new fixtures is blocked by the sandbox (`ENOENT mkdir ~/.bb/projects/<hash>`) and
  `/tmp` is per-call ephemeral; language×repo generality cells above are therefore
  analyzer-source + one current Go index, with the workspace `.corpus` index flagged stale/partial
  (11 `identifier_usage` rows total — pre-GO1 analyzer).
- The full per-finding JSON (`evidence[]`, `limitations[]`, `candidatesTotal`) is not exposed by the
  CLI text surface; the engine code that constructs it is quoted instead. `bb_patterns` page max is
  500, so the JS-on-asset share above is reconstructed from the DB + engine queries
  (`b7`), ±1 on 1,644.
- Bettercap index was not reindexed or written in any way. All DB reads used
  `sqlite3 -readonly`; all bb invocations were read-only tools.

## Evidence files

All under `docs/bb-bettercap-triage/evidence/go-callgraph/`:

| file | content |
|---|---|
| `a1-analyze-callers-jsOnEventFunc.json` | full `bb_analyze mode=callers` answer (root resolved, callers [], callees [], summary/provenance) |
| `a2-graph-jsOnEventFunc-allkinds.json` | full `bb_graph` two-hop answer with 8 relationship kinds (122 KB, callers empty) |
| `a3-patterns-orphaned-limit500.txt` | full orphaned page: jsOnEventFunc row #1 at 70%, census, suppression/refusal/import lines |
| `a4-projects.txt`, `a6-workspace-project-row.txt`, `a7-workspace-stats.txt` | project identity/DB paths + workspace stats (staleness caveat) |
| `a5-patterns-all-limit10.txt` | all-scope census: 4,697 findings, full breakdown |
| `b1-db-jsonEventFunc-rows.txt` | sqlite: jsOnEventFunc symbol row; 0 incoming rows any type; 0 name-channel rows; bettercap relationship-kind census |
| `b2-db-identifier-usage-and-filecov.txt` | identifier_usage anchored/leaf/cross-file stats; file coverage for runtime file; session.go relationship rows |
| `b3-db-identifier-fns-and-filecov.txt` | identifier_usage target kinds; the 3 incoming rows into `script_builtin_runtime.go`; the 8-callback zero-incoming table |
| `b4-workspace-identifier-usage-by-repo.txt` | workspace `.corpus` identifier_usage rows (stale index ⇒ not usable for generality) |
| `b5-db-assets-uses-conf.txt` | 1,581 UI asset files / 1,972; uses confidence distribution (32,123 @0.6); gate-refused row counts |
| `b6-db-uses-06-samples.txt` | samples of the 32k `uses`@0.6 enrichment rows (secondary observation) |
| `b7-db-filecandidate-recon.txt` | referencedFiles set (272) and file-candidate reconstruction (ui_assets 1,573 / rest 70) |

Source references: `src/ast/real-go-analyzer.ts:188-189, 2269-2271, 3006-3008, 5015-5030, 5357-5398`;
`src/intelligence/patterns/orphans.ts:36-49, 100, 514-543, 812-827, 876, 885-921, 1002-1029`;
`src/ast/analysis-exclusions.ts`; `docs/BB_PATTERNS.md` ("Confidence is derived from evidence",
"Non-code files … checked as whole files"); `docs/BB_ANALYZE.md:34,201`;
`validation/m14/fixtures/go/bare-value-reads.go` + `.expectation.json`; `script/m14/mutate-analyzer.ts:5131-5197`.

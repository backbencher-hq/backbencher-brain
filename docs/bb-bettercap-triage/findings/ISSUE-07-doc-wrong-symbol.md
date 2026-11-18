# ISSUE-07 — `bb_doc` symbol mode documents an ambiguous-name UNION as one subject (`Session`)

Lane: retrieval. Date: 2026-11-18. Product: bb 0.1.6, HEAD `be4c0ef25d9856b4ab09f448fec9e95ea2007c88`
(subject `Release 0.1.6: five analyzers, one graph`), CLI `node bin/bb`. Specimen: bettercap,
projectId `4c7590f1cba319aac298a50453c0ec440f2dc857` (never reindexed, read-only).

## Verdict

**PARTIAL** — the report's conclusion (wrong symbol documented, `quality.passed:true`) reproduces in a
sharper and different form than stated. Sub-claims:

| # | Report sub-claim | Adjudication | What was measured |
|---|---|---|---|
| a | doc "centers on the embedded property `Session` in `session/module.go:35` and `modules/c2/c2.go:46`" | **PARTIAL** | Those two ARE the first two API/Behavior claims (doc order is `ORDER BY line_start`, so 35 then 46), but the doc is not "centered" on one symbol: it is a **union of all 5 exact-name copies**, each receiving the same 2 API claims / 2 Behavior claims. And `module.go:35` / `c2.go:46` are **named fields** (`Session *Session`, `Session *session.Session`), not embedded properties; only the two `*_test.go` copies are embedded (`*session.Session`). |
| b | doc "never [documents] the canonical struct at `session/session.go:72`" | **FALSE at defaults** | The struct IS in scope and cited 7 times (API, Behavior, Tests, Limitations; Sources `[7](session/session.go#L72-L98) — symbol: Indexed struct Session`). It is listed 4th of 5 because ordering is by `line_start` (35, 46, 67, 72, 110). With the **documented `limit` option**, however, the claim becomes literally true (see d). |
| c | "documents the wrong symbol" | **REAL as a class, misdescribed as a single wrong pick** | Symbol mode resolves a target by exact **NAME only** across the whole project and documents the union. Title (`symbol: Session`), `reference.canonicalPath` (`Session`) and the whole document imply one subject; nothing declares "this document covers 5 distinct symbols". A **fully-qualified** target (`session.Session`) still returns all 5 copies. On another Go repo a qualified target leads with an unrelated symbol (generality table). |
| d | `quality.passed: true` despite the wrong scope | **REAL (reproduced) / REAL-BUT-MISDESCRIBED in intent** | `passed:true` reproduced for every ambiguous call. It is the documented conjunction of four consistency terms (factuality, references, budget, section completeness) — it has **no scope/subject term**, so it cannot detect this. The pass flag is therefore internally honest but a misleading "verdict" for a document whose subject was never resolved. Under `limit:1` the doc is 100% about the `session/module.go:35` *field* and still `passed:true`, 5/5 sections. |

Severity: **medium**. Why it matters: `bb_doc` is a **cited documentation generator** whose output is
cached by websites keyed on `projectId/snapshotId/mode/target` and `reference.canonicalPath`
(`docs/BB_DOC.md` §Website reference metadata). A caller asking to document a type receives an
internally consistent document about a union of a type, three struct fields and an embedded field —
and on a qualified target the leading claim can be about a different symbol entirely. The
report's specific wording ("never the canonical struct") is false, which must not be fixed as if the
struct were missing.

## Reproduce (read-only; one bb CLI process at a time)

```bash
cd /home/ishaq2321/mcp/backbencher-brain
B=/home/ishaq2321/bettercap
# 1) default ambiguous call (markdown + json)
node bin/bb tool bb_doc --dir $B --args '{"mode":"symbol","target":"Session"}' \
  > docs/bb-bettercap-triage/evidence/retrieval/07-doc-session-bettercap.md
node bin/bb tool bb_doc --dir $B --args '{"mode":"symbol","target":"Session","format":"json"}' \
  > docs/bb-bettercap-triage/evidence/retrieval/07-doc-session-bettercap.json
# 2) qualified target does NOT disambiguate
node bin/bb tool bb_doc --dir $B --args '{"mode":"symbol","target":"session.Session","format":"json"}' \
  > docs/bb-bettercap-triage/evidence/retrieval/07-doc-qualified-session-bettercap.json
# 3) limit:1 silently picks the FIRST line-ordered copy (a field) as the whole subject
node bin/bb tool bb_doc --dir $B --args '{"mode":"symbol","target":"Session","limit":1,"format":"json"}' \
  > docs/bb-bettercap-triage/evidence/retrieval/07-doc-session-limit1-bettercap.json
# 4) control: unique symbol documents correctly
node bin/bb tool bb_doc --dir $B --args '{"mode":"symbol","target":"LoadModules","format":"json"}' \
  > docs/bb-bettercap-triage/evidence/retrieval/07-doc-loadmodules-bettercap.json
# 5) generality: another Go repo, same defect (struct+property+variable)
D=/home/ishaq2321/bb_tests/repositories/gh-cli/internal
node bin/bb tool bb_doc --dir $D --args '{"mode":"symbol","target":"Options","format":"json"}' \
  > docs/bb-bettercap-triage/evidence/retrieval/07-generality-ghcli-doc-Options.json
node bin/bb tool bb_doc --dir $D --args '{"mode":"symbol","target":"config.Options","format":"json"}' \
  > docs/bb-bettercap-triage/evidence/retrieval/07-generality-ghcli-doc-qualified-Options.json
# 6) generality: workspace multi-language project (TS/JS/JSON)
W=/home/ishaq2321/mcp/backbencher-brain
node bin/bb tool bb_doc --dir $W --args '{"mode":"symbol","target":"Session","format":"json"}' \
  > docs/bb-bettercap-triage/evidence/retrieval/07-generality-workspace-doc-Session.json
```

## Bounded observed output

bettercap, `{"mode":"symbol","target":"Session"}` (full answer in evidence; 9,312-byte markdown /
25,122-byte JSON):

```
# symbol: Session
5 file(s) and 5 symbol(s) in scope, 50 cited claim(s) across 5 section(s) from 250 source(s).
## API
- property Session: *Session is defined in session/module.go at lines 35-35.[1]
- property Session: *session.Session is defined in modules/c2/c2.go at lines 46-46.[3]
- property Session: session.Session is defined in modules/net_probe/net_probe_test.go at lines 67-67.[5]
- struct Session is defined in session/session.go at lines 72-98.[7]
- property Session: session.Session is defined in modules/arp_spoof/arp_spoof_test.go at lines 110-110.[9]
## Quality
- passed: true
- factuality: true (0 uncited claim(s)) / references: true (0 broken, 0 stale, 0 missing)
- completeness: true (5/5 required sections, 2 unknown(s))
```

JSON quality block for the same call: `passed:true`, `completeness {covered:5, expected:5}`,
`references {stale:0, missing:0}`, `budget {estimatedTokens:6281, maxTokens:8000}`,
`reference.canonicalPath:"Session"`, `freshness.passed:true`.

Qualified target `session.Session` (evidence `07-doc-qualified-session-bettercap.json`): identical
scope — `"5 file(s) and 5 symbol(s) in scope"`, `canonicalPath:"session.Session"`, and the API facts
still lead with the `session/module.go:35` property.

`limit:1` (evidence `07-doc-session-limit1-bettercap.json`):

```json
{"title":"symbol: Session","summary":"1 file(s) and 1 symbol(s) in scope, 5 cited claim(s) across 5 section(s) from 28 source(s).",
 "canonicalPath":"Session","passed":true,
 "api":["property Session: *Session is defined in session/module.go at lines 35-35."],
 "symbol citations":["session/module.go:35 Session"]}
```

Control `LoadModules` (unique, 1 copy): `1 file(s) and 1 symbol(s) in scope`,
`API: function LoadModules(sess: *session.Session) is defined in modules/modules.go at lines 42-78`,
`passed:true` — correct. So the defect is ambiguity handling, not symbol-mode documentation per se.

`New` on bettercap (2 copies) mixes a **property** (`session/session_routing.go:20`) and the
**function** (`session/session.go:155`) into one "symbol: New" document, property first; passed:true
(`07-doc-new-bettercap.json`). NB: `LoadModules` unique vs `New` ambiguous is exactly the control
pair that shows the mechanism turns on name multiplicity.

## Expected vs observed

- Expected (contract): `bb_doc` mode `symbol` target = "symbol name, qualified name, or its last
  dotted/`::` segment" (`docs/BB_DOC.md:121`); a document about a symbol. `module` mode explicitly
  "refuses rather than falls back … Answering with project-wide inventory would be a document about a
  different subject" (`docs/BB_DOC.md:131-133`) — the spec already holds that subject identity
  matters, but `symbol` mode has no equivalent guard or declaration.
- Observed: every exact-name copy is unioned, no kind/declaration preference, order = `line_start`,
  title/`canonicalPath` claim a single subject, and `quality.passed` cannot see it.
- Expected: a `limit` mistake only reduces per-section evidence. Observed: in symbol mode it also
  selects the symbol SET (`targetSymbols(..., limit)`), so lowering the evidence cap silently changes
  **which symbol is documented** (the first one by line number) while the title stays `symbol: Session`.

## Root cause (file:line + quoted code)

`src/intelligence/documentation/doc-engine.ts:713-741` — symbol target resolution is a name-IN scan
over the whole project, ordered by line, spliced with a qualified-name lookup that is only appended
*after* the name matches and never preferred:

```ts
if (request.mode === "symbol") {
  const short = target.split("::").pop() ?? target
  const leaf = short.split(".").pop() ?? short
  const names = [...new Set([target, short, leaf])].filter((name) => name.length > 0)
  const columns = "SELECT s.*, f.path, f.relative_path, ... FROM brain_symbol s JOIN brain_file f ON f.id=s.file_id"
  const byName = queryRows(raw,
    `${columns} WHERE s.project_id=? AND s.name IN (...) ORDER BY s.line_start LIMIT ?`,
    projectId, ...names, limit)
  if (byName.length >= limit) return { symbols: byName, feature: null }
  const byQualified = queryRows(raw, `${columns} WHERE s.project_id=? AND s.qualified_name IN (...) ORDER BY s.line_start LIMIT ?`, ...)
  const symbols = [...byName, ...byQualified.filter(...)].slice(0, limit)
  return { symbols, feature: null }
}
```

Consequences, all traceable to those 8 lines: (1) `leaf` fallback means `session.Session` and
`config.Options` still match every bare `name` first; (2) `ORDER BY s.line_start` is the only ranking —
no `symbol_type` preference for a defining declaration (struct/class/interface/type/function) over a
field/variable, so bettercap's `session/module.go:35` field wins and gh-cli's `skills/installer.go:26`
struct leads a `config.Options` target; (3) `LIMIT limit` makes the per-section evidence cap the
subject-set cap; (4) no scope field distinguishes single-subject vs union answers.

`src/intelligence/documentation/doc-engine.ts:2192,2202` — the identity surface never states the kind
or copy; `canonicalPath` is simply the normalised request target:

```ts
const canonicalPath = request.target ? normalizeTarget(String(request.target)) : mode
...
title: request.target ? `${mode}: ${request.target}` : `${mode} documentation`,
```

`src/intelligence/documentation/doc-engine.ts:2593-2597` — the only hint is a count in the summary
(`"N file(s) and N symbol(s) in scope"`), which is presented as a bound, not as "these are different
symbols". There is no `unknowns` entry for multi-copy scope.

`src/intelligence/documentation/doc-engine.ts:2290-2304` — `quality.passed` has no scope term:

```ts
const covered = REQUIRED_SECTION_IDS[mode].filter((id) => result.sections.some((section) => section.id === id)).length
const factualityPassed = uncitedClaims === 0 && hasEvidence
const referencesPassed = missing === 0 && broken === 0
...
passed: factualityPassed && referencesPassed && budgetPassed && covered === expected,
```

Spec confirms this is by definition, not a code slip:
`docs/BB_DOC_REFERENCE.md:57-60` — "`quality.passed` is the conjunction of four measured terms:
factuality (every claim cited AND the result has evidence), references (no broken/missing emitted
citations), budget (payload within `maxTokens`), completeness (all required sections present)."

So the report's "worse, quality.passed: true" is reproduced; what it proves is that the verdict is a
**consistency** verdict over an unresolved subject, not a subject-correctness verdict. The defect to
fix is upstream (ambiguous resolution/declaration), plus an honest scope term.

## Generality table

| language | project (index) | repro | same class? | evidence |
|---|---|---|---|---|
| Go | bettercap `4c7590f1…` (1,973 files / 55,785 syms) | `target:"Session"` → 5 copies (4 property + 1 struct), struct 4th; `target:"session.Session"` → same 5; `limit:1` → field only, passed=true | **YES** (the reported case) | `evidence/retrieval/07-doc-session-bettercap.{md,json}`, `07-doc-qualified-session-bettercap.json`, `07-doc-session-limit1-bettercap.json` |
| Go | bettercap (control) | `target:"LoadModules"` → 1 symbol, `modules/modules.go:42-78`, passed=true | NO (correct control) | `07-doc-loadmodules-bettercap.json` |
| Go | bettercap (ambiguous control) | `target:"New"` → 2 copies, property first + function; passed=true | YES | `07-doc-new-bettercap.json` |
| Go | gh-cli/internal `572ba871…` (145 files / 2,737 syms) | `target:"Options"` → struct + property + variable in 3 files, passed=true; `target:"config.Options"` → **same 3**, struct in `skills/installer/installer.go:26` leads although the target names `config.Options`; `limit:1` → that struct only | **YES, and worse for qualified targets** | `07-generality-ghcli-doc-Options.json`, `07-generality-ghcli-doc-qualified-Options.json`, `07-generality-ghcli-doc-Options-limit1.json`, `07-generality-ghcli-candidates.txt` |
| TypeScript + JSON | workspace `1d3d5710…` (34,385 files / 506,841 syms) | `target:"Session"` → 3 copies: `type` in socket.io-adapter TS, `interface` in `script/m13/verify-visualize-browser.ts`, and a **property in a JSON data file** (`webpack/test/cases/json/weird-properties/globals.json:1467`); passed=true | **YES** (multi-language, and JSON non-source property included) | `07-generality-workspace-doc-Session.json`, `07-generality-workspace-symbol-Session.json` |

Mechanism is **language-independent**: the resolution is one SQL `name IN (…)` query, so it is not the Go
analyzer — it is `bb_doc`'s ambiguity handling. It also exists for ambiguous names in every analyzer.

## Fix sketch

1. **Resolve a subject before documenting it** (`doc-engine.ts` `targetSymbols`, symbol branch):
   - exact `qualified_name` match first (use the whole target; do not fall back to the leaf when the
     target contains `.`/`::` and a qualified row exists);
   - then exact `name` matches, but rank declaration kinds (`struct|class|interface|type|enum|
     function|method`) before data-like kinds (`property|variable|constant`), then `line_start`;
   - when >1 exact-name copy remains, document the union **but declare it**: title/summary must say
     "5 symbols named Session" and `reference.canonicalPath` must not imply one subject; add a
     `scope` field to `DocResult.reference` (`{ mode: "single"|"union", copies: [...], selectedBy:
     "qualified-name"|"name+kind"|"union" }`) and an `unknowns` entry of reason `multi-copy-scope`.
2. **Stop overloading `limit`**: in symbol mode, use a separate subject/selection bound (or require
   the caller to pass a disambiguator); never let the per-section evidence cap silently change the
   documented subject. If kept, `limit:1` on an ambiguous target must refuse (or declare
   `scope.mode:"union-truncated"`) rather than return one copy as "the symbol".
3. **Make `quality` speak to scope**: add a fifth term `scope` whose meaning is measured and
   declared — e.g. `passed` iff (single resolved declaration) OR (union explicitly declared with
   every copy cited). A document that cannot name its subject cannot pass.
4. Exclude pure data/property symbols from default `symbol`-mode subject selection when a declaration
   kind with the same name exists (otherwise document them only when requested by kind/file).
5. Optional: accept `filePath` for symbol-mode `bb_doc` (the disambiguator `bb_search` already has).

## Gate proposal

- Engine gate: a fixture with the same name as a struct + 2 fields + a variable; assert default
  `symbol` doc either selects the declaration (kind-preference) or declares a union; assert
  `reference.canonicalPath`/`quality.scope` are consistent with the number of cited symbol copies.
- Qualified-target gate: for a symbol indexed with `qualified_name`, assert `target:"pkg.Name"`
  documents exactly that symbol and not its same-named copies in other files.
- `limit` gate: assert symbol-mode `limit` does not change the set of symbol citations in an
  ambiguous document (only the per-section claim bound), or that the answer declares the truncation.
- Quality gate: assert `quality.passed` is `false` (or `quality.scope.declared === true`) for an
  ambiguous-name document that does not declare the union — i.e. make a scope-wrong document go red.
- Goldens: `bun run script/m20/verify-doc-truth.ts`/`verify-doc-modes.ts` extended with the
  ambiguity fixture above (existing gates check citation resolution, not subject identity).

## Evidence paths

- `docs/bb-bettercap-triage/evidence/retrieval/07-doc-session-bettercap.md` / `.json`
- `docs/bb-bettercap-triage/evidence/retrieval/07-doc-qualified-session-bettercap.json`
- `docs/bb-bettercap-triage/evidence/retrieval/07-doc-session-limit1-bettercap.json`
- `docs/bb-bettercap-triage/evidence/retrieval/07-doc-loadmodules-bettercap.json`
- `docs/bb-bettercap-triage/evidence/retrieval/07-doc-new-bettercap.json`
- `docs/bb-bettercap-triage/evidence/retrieval/07-generality-ghcli-doc-Options{,qualified,limit1}.json`,
  `07-generality-ghcli-candidates.txt`
- `docs/bb-bettercap-triage/evidence/retrieval/07-generality-workspace-doc-Session.json`,
  `07-generality-workspace-symbol-Session.json`

bb 0.1.6 · HEAD `be4c0ef25` · 2026-11-18.

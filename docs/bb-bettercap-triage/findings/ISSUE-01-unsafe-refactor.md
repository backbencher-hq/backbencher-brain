# ISSUE-01 — `bb_edit` refactor misses a package-qualified caller: success reported, rename would not compile

Status: COMPLETE
Lane: `edit-safety`
Product: repo `/home/ishaq2321/mcp/backbencher-brain`, HEAD **`be4c0ef25`** (subject `Release 0.1.6: five analyzers, one graph`), `bb --version` **0.1.6**, local dist build 2026-11-18
Date: **2026-11-18**
Specimen: `/home/ishaq2321/bettercap` (index projectId `4c7590f1cba319aac298a50453c0ec440f2dc857`, 55,785 symbols), queries READ-ONLY

---

## 1. Verdict

**REAL — severity `critical`. Confidence: high.**

The report's behavioural claim is reproduced exactly at HEAD, byte-for-byte at the current index:

- `bb_edit mode=refactor symbolName=LoadModules newName=LoadModulesRenamed dryRun=true` plans **2 files / 2 sites** —
  `modules/modules.go` (declaration) and `modules/modules_test.go` (same-package test call) — and returns
  `warnings: ["refactor LoadModules → LoadModulesRenamed: 2 site(s) across 2 file(s)"]`, i.e. **success**.
- The package-qualified caller `modules.LoadModules(sess)` at `/home/ishaq2321/bettercap/main.go:47` is **not renamed and not mentioned**.
- Applying the plan leaves `main.go` calling a name that no longer exists. This is verified as a *compile* failure on a
  faithful two-package Go module replaying the measured plan shape: `./main.go:13:10: undefined: modules.LoadModules`.
- No verification gate exists between plan and commit that would notice: post-write "validation" is AST **syntax** parsing
  only (`src/intelligence/edit/edit-engine.ts:926-931`), and a declaration rename + stale qualified call is perfectly valid syntax.
  `validated: true` is returned.

One cause-level correction (this does **not** change the verdict, it refines the first-pass hypothesis in the charter):
the miss is **not** primarily "Go imports are unresolved, so refactor's import evidence finds no importer." The index **has**
the caller edge `main.go:main:1 --calls--> modules/modules.go:LoadModules:42` (`callSite line 47`, confidence 0.8) —
`bb_analyze mode=callers target=LoadModules` returns it. Refactor had caller evidence and still produced zero sites in
`main.go`, twice-silently:

1. **The caller edge's stored source span is the 12-byte `package main` clause, not `func main`.** The `calls` row's
   `source_symbol_id` is `…:main.go:main:1` (symbol_type `module`, line 1, bytes **0–12**); the function symbol
   `…:main.go:main:20` (bytes **315–2610**) has **0** relationship rows. Refactor renames AST sites only *inside the
   caller's source-symbol byte span* (`edit-engine.ts:1988-2006`), so its search window is bytes `[0,12)` — line 47 is far
   outside it and no site is found.
2. **Even with a correct span, the site would be dropped by the reference classifier.** Go's `modules.LoadModules` parses as
   `selector_expression` whose field is a `field_identifier`; `isMemberNameNode()` returns `true` for `field_identifier`
   (`src/ast/safety-primitives.ts:226-232,265-266`), and `isReferenceSite()` returns `false` for any `isMemberName`
   occurrence (`edit-engine.ts:640-647`). This is language-general for dotted/namespaced references, proven independently below
   on a symbol whose caller spans **are** correct (`NewSessionModule`: 46 package-qualified caller functions ⇒ plan 1 file/1 site)
   and on TypeScript namespace imports (`Log.create(...)` × 36 sites ⇒ plan 1 file/1 site).

The safety failure the report asks about is the third layer: **a caller file whose evidence produced zero rename sites is
silently dropped from the plan** (`edit-engine.ts:2061`), because the plan-completeness residual check only covers files that
carry declaration/import evidence *in the same file* (`edit-engine.ts:2051`). So "tool knows a caller exists" and "tool reports
a complete rename" are not coupled. This contradicts the documented contract (`docs/BB_EDIT.md:195-203`).

### Why it matters to a user

`bb_edit refactor` is advertised as the *safe* mutation door (docs/BB_EDIT.md §Safety: "a rename never silently under-reports
itself"). On Go — the specimen language — it silently under-reports every cross-package qualified reference. A caller following
the tool's own success message commits a non-compiling tree; the answer says `validated: true`, `reindexed: true`, `renamedSites: 2`.
The same class hits TypeScript/JavaScript namespace imports, i.e. ordinary code in this very repository.

---

## 2. Repro (exact commands, bounded observed output)

All runs at HEAD `be4c0ef25`, bb 0.1.6, 2026-11-18. Bettercap index untouched/read-only; every `bb_edit` call `dryRun: true`.

### 2a. The unsafe plan (reproduces the report)

```bash
cd /home/ishaq2321/mcp/backbencher-brain
node bin/bb tool bb_edit --dir /home/ishaq2321/bettercap \
  --args '{"mode":"refactor","symbolName":"LoadModules","newName":"LoadModulesRenamed","dryRun":true}'
```

Observed (raw: evidence `01-bettercap-refactor-dryrun.json`; same bytes as Lead's
`evidence/lead/issue01-refactor-dryrun.json`):

```json
{"mode":"refactor","dryRun":true,
 "changes":[
   {"path":"/home/ishaq2321/bettercap/modules/modules.go","before":"…","after":"…"},
   {"path":"/home/ishaq2321/bettercap/modules/modules_test.go","before":"…","after":"…"}],
 "formatted":false,"validated":false,"reindexed":false,
 "warnings":["refactor LoadModules → LoadModulesRenamed: 2 site(s) across 2 file(s)"],
 "summary":{"renamedFiles":2,"renamedSites":2}}
```

2 files, 2 sites, no warning, `main.go` never named. The graded source: `modules.LoadModules(sess)` sits at
`main.go:47` (`package main` imports `github.com/bettercap/bettercap/v2/modules` at `main.go:13`).

### 2b. The reference that must have been renamed, and the evidence the tool had

```bash
node bin/bb tool bb_analyze --dir /home/ishaq2321/bettercap --args '{"mode":"callers","target":"LoadModules"}'
```

Observed (raw: `02-bettercap-callers-loadmodules.json`; Lead's copy `evidence/lead/issue01-callers-loadmodules.json`):

```json
{"rootTrace":{"id":"4c7590f1cba319aac298a50453c0ec440f2dc857:modules/modules.go:LoadModules:42", …},
 "callers":[
   {"from":"4c7590f1cba319aac298a50453c0ec440f2dc857:main.go:main:1",
    "to":"…:modules/modules.go:LoadModules:42",
    "relationshipType":"calls","confidence":0.8,
    "callSite":{"kind":"call-site","file":"main.go","line":47},
    "rowId":"…main.go:main:1:LoadModules:calls:47"},
   {"from":"…:modules/modules_test.go:TestLoadModulesWithNilSession:7", "line":16, …}]}
```

The index saw the call. `bb_analyze` names its call site as `main.go:47`.

### 2c. Raw index rows — the span-layer defect

Read-only sqlite (full transcript: `03-bettercap-db-rows.txt`):

```
# symbols
…:main.go:main:1    main  module     line 1–1    bytes    0–12
…:main.go:main:20   main  function   line 20–99  bytes  315–2610
…:modules/modules.go:LoadModules:42  function  line 42–78  bytes 1902–3419

# relationship targeting LoadModules
source_symbol_id = …:main.go:main:1   type=calls  conf=0.8  line=47
  metadata={"relationshipType":"go_function_call","callExpression":"modules.LoadModules",
            "isPackageQualified":true,"evidenceClass":"usage_contextual", …}

# relationship rows per source symbol in main.go
…:main.go:main:1   -> 44 rows
…:main.go:main:20  ->  0 rows
```

So the `calls` row that refactor consumes points at the **12-byte module symbol**; the enclosing function that actually
contains line 47 is a different symbol and owns no edges.

### 2d. Raw index rows — the fallback (importer) route is blind to Go (ISSUE-03 coupling, secondary)

`brain_import` rows for `main.go` (same transcript):

```
imported_name | imported_as | import_path                                | is_external | line
fmt           |             | fmt                                        | 1           | 4
os            |             | os                                         | 1           | 6
modules       |             | github.com/bettercap/bettercap/v2/modules  | 1           | 13
session       |             | github.com/bettercap/bettercap/v2/session   | 1           | 14
…
```

Every Go import is `is_external=1`. Refactor's importer query requires `i.is_external = 0 AND i.imported_name = <symbolName>`
(`edit-engine.ts:1874-1884`) — Go rows name a *package* (`modules`), never a symbol (`LoadModules`), and would fail
`resolveImportToFile` anyway (`non-relative specifier → return false`, `edit-engine.ts:838-862`). So the caller-span route was
the only route that could have covered `main.go`, and it was fed a 12-byte window.

### 2e. Compile consequence (the report's "would not compile")

Real-repo build verification is **blocked in this sandbox**: bettercap's `go.mod` pulls a newer toolchain and the module cache is
not writable/complete —

```
$ cd /home/ishaq2321/bettercap
$ GOCACHE=…/.tools/triage-tmp/edit-safety/gocache GOPROXY=off GOFLAGS=-mod=mod go build ./modules/
go: downloading go1.25.0 (linux/amd64)
go: download go1.25.0: mkdir /home/ishaq2321/go/pkg/mod/cache/download/golang.org: read-only file system
```

Instead, a minimal two-package Go module replays the **measured plan shape** exactly (declaration + same-package test call
renamed; package-qualified caller untouched), stdlib only, offline:

```
baseline (pristine):            go build ./...   →  BASELINE BUILD OK
after plan-shaped rename:       go build ./...   →
    # example.com/refactor-demo
    ./main.go:13:10: undefined: modules.LoadModules
```

Raw: `06-fixture-build-error.txt`, fixture sources + README `08-go-fixture-plan-shape/`. This is the compiler verdict for the
snapshot the dry-run would have committed; a whole-repo build is a `CANNOT-VERIFY` (toolchain/network), recorded in §8.

### 2f. The classifier defect, independent of the span defect

`NewSessionModule` (`session/module.go:51`) is a unique Go function with **46 distinct package-qualified caller functions**
whose source spans correctly enclose their call lines, e.g. `modules/any_proxy/any_proxy.go:20-24` `NewAnyProxy` at
bytes 357–1667 calling `session.NewSessionModule(...)` at line 22 (raw `07-NewSessionModule-qualified-callers.txt`).

```bash
node bin/bb tool bb_edit --dir /home/ishaq2321/bettercap \
  --args '{"mode":"refactor","symbolName":"NewSessionModule","newName":"NewSessionModuleRenamed","dryRun":true}'
```

Observed (`05-bettercap-refactor-NewSessionModule-dryrun.json`):

```json
{"changes":[{"path":"/home/ishaq2321/bettercap/session/module.go", …}],
 "warnings":["refactor NewSessionModule → NewSessionModuleRenamed: 1 site(s) across 1 file(s)"],
 "summary":{"renamedFiles":1,"renamedSites":1}}
```

One file, one site — the declaration. All 46 correctly-spanned qualified call sites were dropped by
`isReferenceSite()`, exactly as the code path predicts. (This probe also proves the silent-drop amplifier: the plan does not
mention any of those caller files.)

### 2g. Same tool, different language (TypeScript/JavaScript namespace import)

Workspace project (root `/home/ishaq2321/mcp/backbencher-brain`, READ-ONLY dry run):
`src/tool/brain-log.ts:6` exports `create`; **36** cross-file sites call it through a namespace import
`import * as Log from "../tool/brain-log"` → `Log.create(...)` (full list `10-generality-ts-namespace-import.txt`).

```bash
node bin/bb tool bb_edit --dir /home/ishaq2321/mcp/backbencher-brain \
  --args '{"mode":"refactor","symbolName":"create","filePath":"src/tool/brain-log.ts","newName":"createLog","dryRun":true}'
```

Observed (`09-workspace-ts-namespace-import-refactor-dryrun.json`):

```json
{"changes":[{"path":"…/src/tool/brain-log.ts", …}],
 "summary":{"renamedFiles":1,"renamedSites":1},
 "warnings":["refactor create → createLog: 1 site(s) across 1 file(s)"]}
```

36 namespace-qualified usages, zero planned, zero warning — the same class in this repository's own TypeScript, not a Go-only bug.

---

## 3. Expected vs observed

| # | Expected (documented contract) | Observed at HEAD | Where |
|---|---|---|---|
| 1 | Refactor renames every reference site of the symbol; cross-file reach "built on two independent sources" incl. index caller edges (`docs/BB_EDIT.md:48-56,181-205`) | Plans 2/2; `main.go:47` untouched though a `calls` row with `callSite line 47` exists | §2a, 2b |
| 2 | "a plan that would leave a reference it has **evidence about** unrenamed is refused rather than reported as a complete rename" (`docs/BB_EDIT.md:195-203`) | Reports success (`2 site(s) across 2 file(s)`), no refusal, no warning; `main.go` never named | §2a |
| 3 | Rename response is auditable: `summary.renamedSites/renamedFiles` reflect reach | They do — but there is no field/warning saying "1 caller file with evidence yielded zero sites" | §2a |
| 4 | Writes validated before commit (`validated:true`) should mean the edit is sound | Validation is syntax-only (`/syntax error/i` filter); declaration rename + stale qualified call passes it | §4D |
| 5 | A symbol whose caller spans are correct should have its caller sites renamed | `NewSessionModule`: 46 such callers, 0 renamed; `create` (TS): 36 namespace-import usages, 0 renamed | §2f, 2g |

---

## 4. Root cause (file:line + quoted code)

The miss is the intersection of **two independent gaps**, either of which alone is sufficient to lose the site, plus a
**silent-drop** amplifier and a **missing gate**.

### A. Classifier: qualified references are classified as member names (language-general)

`src/ast/safety-primitives.ts:226-232, 265-266`:

```ts
export const MEMBER_NODE_TYPES = new Set([
  "property_identifier",
  "field_identifier",          // ← Go selector_expression's field: modules.LoadModules
  "shorthand_property_identifier",
  "statement_identifier",
  "label_name",
])
…
export function isMemberNameNode(node: any): boolean {
  if (MEMBER_NODE_TYPES.has(node.type)) return true
```

`src/intelligence/edit/edit-engine.ts:640-647`:

```ts
export function isReferenceSite(o: IdentifierOccurrence, _relType: string): boolean {
  if (o.isMemberName) return false
  if (isBindingParentType(o.parentType)) { … }
  return true
}
```

`src/intelligence/edit/edit-engine.ts:1996-2006` (caller-span rename step):

```ts
for (const o of parsed.occurrences) {
  if (o.text !== symbolName) continue
  if (o.startIndex < span.start || o.endIndex > spanEnd) continue
  if (!isReferenceSite(o, span.relType)) continue      // ← Go/TS/Java qualified ref dies here
  …
  sites.add(o.startIndex)
}
```

The `field_identifier`/`property_identifier` exclusion is right for *member names of values* (`user.name`) and for object
literal keys, but wrong for a reference qualified by an imported **module/namespace/package**. The classifier is
language-agnostic and has no notion of "the receiver is a package": for Go the emitted edge even records
`"callExpression":"modules.LoadModules","isPackageQualified":true` (see §2c) and the classifier still says "member name".

### B. Caller-span window: the stored source symbol for `main.go` is the package clause

Go analyzer emits a `Module` symbol named after the package clause (`src/ast/real-go-analyzer.ts:561-566`):

```ts
// PHASE 0: Extract package declaration as a Module symbol
const packageClause = this.findGoPackageClause(rootNode)
const packageName = packageClause ? this.goPackageClauseName(packageClause) : undefined
if (packageName && packageClause) {
  symbols.push({ name: packageName, kind: ASTEngine.SymbolKind.Module, range: this.nodeToRange(packageClause), … })
```

Every `package main` file therefore has **two symbols named `main`**: the module (package clause, bytes 0–12) and the function.
The relationship persister resolves the analyzer's source **name** to a symbol id with a first-wins map
(`src/ast/parallel-indexer.ts:4351-4360`):

```ts
// nameToSymbol: first symbol with each name (mirrors Array.find semantics).
for (const s of result.symbols) {
  …
  const nm = s.name || ""
  if (nm && !nameToSymbol.has(nm)) nameToSymbol.set(nm, s)
```

and container kinds sort first (`src/ast/parallel-indexer.ts:3486-3491`, `module: 0 … function: 1`; applied by
`result.symbols.sort(...)` at :4342). So `nameToSymbol.get("main")` is the **module**, and
`src/ast/parallel-indexer.ts:5239` binds every edge from that file to it:

```ts
sourceSymbol = nameToSymbol.get(sourceName) ?? nameToSymbol.get(sourceLeaf)
```

Measured consequence: 44/44 relationships from `main.go` attribute to `…:main.go:main:1` (bytes 0–12); **0** to the
function `…:main.go:main:20` (bytes 315–2610) — even though the analyzer's own `callExpression`/line metadata is correct
(`line_number: 47`). Refactor's window then renames nothing in that file, because §4A's per-occurrence site search is bounded
by that span:

```ts
// src/intelligence/edit/edit-engine.ts:1856-1862 (caller rows: file + source-symbol byte span)
"SELECT DISTINCT f.id AS fileId, f.path AS path, s.byte_start AS byteStart, s.byte_end AS byteEnd, …
 FROM brain_relationship r LEFT JOIN brain_symbol s ON s.id = r.source_symbol_id …
 WHERE r.target_symbol_id = ? AND r.relationship_type IN ('calls','instantiates','references','uses')"
```

This is a **Go package-`main` class**: the collision is structural (a Go program necessarily has `package main`; most repos
have exactly one such file), and it makes *every* cross-file call emitted from that file unusable to span-based consumers.
It is not specific to `LoadModules`.

### C. Silent-drop amplifier: a caller file that yields zero sites disappears from the plan

`src/intelligence/edit/edit-engine.ts:2048-2061`:

```ts
// D2b: what this file's evidence covers but the plan does not rename. …
const fileHasEvidence = ranges.declaration != null || (ranges.imports?.length ?? 0) > 0
if (fileHasEvidence) {
  for (const o of parsed.occurrences) { … unrenamed.push(…) }
}
…
if (sites.size === 0) continue          // ← main.go (caller evidence, 0 sites) dropped, no warning
```

A file reached *only* through caller rows sets `fileHasEvidence = false` (no `declaration`, no `imports`), so its survivor
scan is skipped; then zero sites makes it `continue`. The closing warnings only count `renamedSites` and
`sourcelessCallerRows` (rows with **no** source symbol, `edit-engine.ts:1868, 2100-2108`) — `main.go`'s row is *locatable*, so it
is neither renamed nor reported. This is why the answer is a clean success message over unexamined evidence, and why it
contradicts `docs/BB_EDIT.md:195-203`.

### D. No verification gate: commit "validation" is syntax-only

`src/intelligence/edit/edit-engine.ts:926-931` (called at commit, :2279; `validated:true` returned at :2300):

```ts
async function validateFile(filePath: string, content: string): Promise<void> {
  const result = await ASTEngine.parseFile(filePath, content)
  const errors = (result.errors ?? []).filter((error: any) => /syntax error/i.test(error.message ?? ""))
  if (errors.length > 0) throw new Error(`validation failed for ${filePath}: ${errors[0].message}`)
}
```

A renamed declaration plus a stale `pkg.OldName` call parses cleanly, so `validated:true`, `reindexed:true` and a success
summary are returned for a tree that does not compile. The plan-time refusals that do exist (`edit-engine.ts:2071-2098`:
zero sites overall; unrenamed evidence *in covered files*; new-name collision) are all zero/one-file conditions — there is no
"caller file with evidence produced zero sites" refusal and no build/type-check anywhere in plan or commit.

### E. Secondary coupling with ISSUE-03 (not the primary cause)

The importer fallback cannot rescue Go for three independent reasons (see §2d and quotes): `brain_import.is_external=1` for
every Go import (ISSUE-03), Go import rows name a *package* not a symbol so `imported_name = <symbolName>` never matches, and
`resolveImportToFile` returns false for every non-relative specifier. The docs' "two independent sources" are in practice
**one** source for Go (caller spans), and that source was mis-spanned. The report's first-pass suspicion in the charter
("refactor's cross-file import evidence finds no importer") describes only this fallback route; the measured failure happened
on the route that *did* have data.

---

## 5. Generality table

| language | project / fixture | repro | same class? | evidence |
|---|---|---|---|---|
| Go (package-qualified call, span correct) | bettercap `session/module.go:51` | dry-run refactor `NewSessionModule`; 46 qualified caller functions in index, plan = 1 file/1 site | **YES** — classifier (A) alone loses every qualified site | `05-…NewSessionModule-dryrun.json`, `07-…qualified-callers.txt` |
| Go (`package main` source attribution) | bettercap `main.go` | DB rows: 44/44 edges on module `main:1` (bytes 0–12), 0 on `func main:20` (315–2610) | **YES** — span (B) class, structural for `package main` | `03-bettercap-db-rows.txt` |
| Go (exact report site) | bettercap `main.go:47` | dry-run `LoadModules`: 2 files/2 sites, caller untouched | **YES** — report reproduces | `01-…`, `02-…` |
| Go (compile consequence) | `/tmp`-style two-package fixture replaying measured plan shape (in `.tools/…`, copied to evidence) | rename declaration+test call, leave qualified caller → `go build ./...` | **YES** — `undefined: modules.LoadModules` | `06-fixture-build-error.txt`, `08-go-fixture-plan-shape/` |
| TypeScript / JavaScript namespace import | workspace repo `src/tool/brain-log.ts` (`import * as Log`) | dry-run refactor `create→createLog`; 36 `Log.create(...)` sites, plan 1/1 | **YES** — same classifier (A); `property_identifier` mirror of Go `field_identifier` | `09-…ts-namespace-import…json`, `10-…txt` |
| TypeScript named import `import { f }`, unqualified call | workspace repo / docs' own probe cases | documented + probed in `script/m71/probe-refactor-completeness.ts` cases A–H | No (covered path) | code `edit-engine.ts:1924-2045` |
| Python `import mod; mod.f()` | — | fresh-index creation is blocked in this sandbox (Lead-verified `ENOENT` on `~/.bb/projects`); no Python in an available index | **CANNOT-VERIFY** — code path predicts same class: `attribute` field name is `isMemberName` via `MEMBER_ACCESS_NAME_FIELDS` (`safety-primitives.ts:242-244, 265-287`) | code reading only; marked OPEN |
| Java `Type.staticMethod()` | bettercap has no Java; workspace index has no Java symbol asserted | — | **CANNOT-VERIFY** (code predicts same: `method_invocation.name` fills a member-name field) | code reading only; marked OPEN |
| Rust `crate::f()` / `mod::f()` | — | — | **OPEN** (scoped paths may not be classified member; not measured) | — |

No generality table cell is asserted beyond its evidence; Python/Java/Rust are explicitly incomplete.

---

## 6. Blast radius

- **Every Go rename of a function/const/var whose call sites are package-qualified** (`pkg.Fn`) misses those call sites and
  reports success — i.e. the normal cross-package call in Go. Same for the declaration file's own selector references.
- **Every Go file whose top-level function shares the package name** (`package main`) has *all* its call edges mis-attributed
  to the module symbol, so span-based consumers (refactor, and any future caller-span gate) see a 12-byte window. Bettercap:
  44 edges / 1 file; every Go program has such a file.
- **TypeScript/JavaScript namespace imports** (`import * as ns`) — 36 measured sites in this repository alone.
- Same tool surface: **no build/type-check gate** anywhere in `write/update/insert/delete/refactor/batch`; the only "validation"
  is syntax. A silent-bad-edit of this shape cannot be caught by the tool.
- Not affected: same-package unqualified calls (measured: `modules_test.go` call was renamed), named TS imports with unqualified
  call sites (docs + existing probe cases), aliased TS import specifiers (specifier-only rename by design).

---

## 7. Fix sketch (implementation-ready)

**F1 — package-aware reference classification (the actual rename correctness).**
Do not blanket-trust `MEMBER_NODE_TYPES` in refactor. Add a qualifier-resolution step for occurrence sites whose parent is a
dotted access (`selector_expression`/`member_expression`/`attribute`/`method_invocation`):
- For Go: if the access's operand is an identifier that names a **package import** of this file (namespace clause of the file's
  `brain_import` rows: import `github.com/…/modules` → local name `modules`; honor `import x "path"` aliases), then
  `qualifier.Field` is a package-qualified symbol reference and `Field` is renameable. If the operand is a value/type in scope
  (local var, param, receiver), keep the member-name exclusion.
- Generalize by the same evidence: TypeScript/JavaScript namespace import (`import * as ns from …` → `ns.member`), Python
  `import mod as m` / `from pkg import mod`, Java static/qualified `Type.member`. The rule is "receiver resolves to a MODULE,
  not a value".
- Keep the shadow guard already collected per file (`collectShadowScopes`) so a local `modules := …` shadow still wins.
- Apply this classification in `isReferenceSite`-equivalent form for both step 2 (declaration file) and step 3 (caller spans);
  a site found by span but classified "member" must be re-checked against qualifier evidence, not dropped.

**F2 — enclosing-span source attribution in the index (fixes the 12-byte window).**
In `src/ast/parallel-indexer.ts` source resolution (:5235-5248), when `rel.line_number` is present, choose the source symbol
candidate **whose extent encloses that line** before the first-wins name map — the machinery already exists for `contains`
(`enclosingStoreableIdByName`, :5222-5233); reuse `storeableSpans`/`enclosingSpanId` for the source of `calls`/`uses`/`references`.
Guard: if no same-name candidate encloses the line, keep today's behaviour (first-wins), so nothing is invented. Also exclude
`module`/`package` symbols as call sources when a function/method of the same name encloses the line. Add a regression probe:
`package main` file calling a qualified function ⇒ stored `source_symbol_id` must be `…:main.go:main:<func line>` and
`byte_start/end` must cover the call line. (Coordinate with `go-imports`/`go-callgraph` lanes — same persister.)

**F3 — plan completeness: refuse (or hard-fail the plan) when evidence yields zero sites.**
In the per-file loop (`edit-engine.ts:2039-2066`): track `filesWithCallerEvidence`. After the loop, for each such file with zero
`changes`, either
- (preferred, matches documented contract) **refuse before writing** with the file, the evidence row, and the call-site line:
  `refactor X → Y: main.go has caller evidence (calls, line 47) but 0 rename site(s) were found — the caller site would keep the
  old name; reindex/fix evidence or rename manually`; or
- at minimum mark the plan incomplete (`summary.complete=false`, `unresolvedCallerFiles:[…]`) and make the MCP/CLI answer
  `ok:false`; a success message over known-uncovered evidence is the defect.
Extend the D2b residual check to caller-evidenced files (`fileHasEvidence ||= callerRowsForFile > 0`) so `unrenamed` fires for
this shape.

**F4 — verification gate (the report's explicit ask).**
Add an optional-but-default-on pre-commit verification for multi-file refactors: after the plan is built, stage the planned
content and run the language toolchain on the changed compilation units, refusing (nothing written) on non-zero exit:
Go `go build ./<changed package dirs>` (skip if no `go` binary or module cache unavailable — then declare `verification.skipped`
with the reason, never claim `validated:true`); TS `tsc --noEmit -p <nearest tsconfig>`; Rust `cargo check`; Python
`python -m compileall -q <files>`. Emit `verification: {ran, tool, command, ok, outputTail}` and make `validated` mean
"type/build-checked when a checker was available", not "parsed". This gate directly catches F1/F2 regressions and the reported
non-compiling outcome. (Design note: dry runs must not pay the build; the gate belongs at commit, after the pre-image check,
before rename-in-place — the engine already snapshots bytes for rollback, so it can write staged content, check, and restore.)

---

## 8. Gate / test proposal (what would have caught it)

1. **`script/m71/probe-refactor-completeness.ts` — new cases (the existing file has only TS import shapes + YAML/Makefile):**
   - `go: package-qualified caller` — 2-package module (`pkg` declares `target`, `main` calls `pkg.target()`); assert the plan
     renames the caller file's `target` (or refuses by name). This is the reported case in miniature.
   - `go: package main nested/collision` — single `package main` file with `func main(){ pkg.target() }`; assert the stored
     caller row's `source_symbol_id` is the function, not the 12-byte module (`F2` regression).
   - `ts: namespace import` — `import * as m from './a'; m.target()`; assert rename of `target` reaches the caller (or refuses).
   - `python: module-qualified` — `import mod; mod.target()` (fixture needs Python indexing to be available; mark skipped-with-reason
     in environments where `bb index` cannot create the project).
   - `negative control` — value receiver `obj.target` where `target` is a member of another symbol must NOT be renamed (protects
     against over-renaming in F1).
2. **`script/m71/verify-refactor-build.ts` (new)** — tiny Go/TS modules, index → refactor commit → assert the project still
   builds (`go build ./...` / `tsc --noEmit`). This is the "build/verification gate" in test form; it fails today for Go.
3. **Unit test for the classifier** — `isReferenceSite`/qualifier resolver: Go `pkg.Field` with `pkg` an import ⇒ reference;
   Go `value.Field` ⇒ member; TS `ns.member` with `ns` namespace import ⇒ reference; `obj.member` ⇒ member.
4. **Plan-honesty test** — a caller row whose file yields zero sites ⇒ plan must refuse/incomplete (assert answer is not a success).
5. Docs contract test (`script/m13/verify-edit-docs.ts` already checks §refactor sentences): the §195-203 sentence
   "a plan that would leave a reference it has evidence about unrenamed is refused" must be executable-tested, not prose-only.

---

## 9. Evidence paths

All under `docs/bb-bettercap-triage/evidence/edit-safety/` unless noted:

| file | contents |
|---|---|
| `01-bettercap-refactor-dryrun.json` (+`.err`) | raw dry-run plan for `LoadModules` (2 files/2 sites, no warning) — canonical repro |
| `02-bettercap-callers-loadmodules.json` | `bb_analyze callers LoadModules` incl. `main.go:main:1` → `calls`, `callSite main.go:47` |
| `03-bettercap-db-rows.txt` | read-only sqlite: symbol spans (module `main` 0–12 vs func `main` 315–2610), relationship rows + metadata, `brain_import` rows (all Go imports `is_external=1`), 44/0 attribution counts |
| `04-bettercap-refactor-Fatal-dryrun.json` (+`.err`) | disambiguation refusal observed while selecting symbols (context only) |
| `05-bettercap-refactor-NewSessionModule-dryrun.json` (+`.err`) | classifier proof: 46 correctly-spanned qualified callers, plan 1 file/1 site |
| `06-fixture-build-error.txt` | `undefined: modules.LoadModules` after replaying the measured plan shape |
| `07-NewSessionModule-qualified-callers.txt` | caller symbol spans + call-site source lines |
| `08-go-fixture-plan-shape/` | fixture `go.mod`, `main.go`, `modules/modules.go`, `modules/modules_test.go` (post-plan state) + `README.txt` |
| `09-workspace-ts-namespace-import-refactor-dryrun.json` (+`.err`) | TS/JS namespace-import plan (1/1 despite 36 qualified sites) |
| `10-generality-ts-namespace-import.txt` | 36 `Log.create(...)` sites + namespace imports + captured MCP `bb_edit` dist-chunk failure (adjacent defect, UNLOCKED) |
| `docs/bb-bettercap-triage/evidence/lead/issue01-refactor-dryrun.json` | Lead's identical plan capture (cross-check) |
| `docs/bb-bettercap-triage/evidence/lead/issue01-callers-loadmodules.json` | Lead's caller-edge capture (cross-check) |

Product-source citations are by file:line against HEAD `be4c0ef25`:
`src/intelligence/edit/edit-engine.ts:640-647, 838-862, 926-931, 1856-1862, 1874-1884, 1988-2006, 2048-2066, 2071-2098, 2100-2108, 2279-2300`;
`src/ast/safety-primitives.ts:226-232, 242-244, 265-287`;
`src/ast/parallel-indexer.ts:3486-3491, 4342-4360, 5222-5248`;
`src/ast/real-go-analyzer.ts:561-566`;
`docs/BB_EDIT.md:48-56, 139-157, 181-205, 350-374`.

---

## 10. Residual unknowns / honest gaps

- **Whole-repo bettercap build `CANNOT-VERIFY`**: `go build` needs go1.25.0 toolchain download and a writable module cache; sandbox
  has neither (`read-only file system` on `~/go/pkg/mod/cache`). The compile verdict was reproduced on a stdlib-only two-package
  module replaying the measured plan shape; the compiler error is the same construct (`undefined: pkg.Name`).
- **Fresh-index fixtures (Go/TS/Python/Java) `CANNOT-VERIFY`**: `bb index <new dir>` cannot create `~/.bb/projects/<hash>` in this
  sandbox (Lead-measured `ENOENT`). Generality rows that need an unindexed fixture are marked OPEN; TS/JS generality was instead
  measured on the already-indexed workspace project.
- Python/Java/Rust cells are code-reading predictions only (mechanism visible in the shared classifier/reference path), not
  measurements — flagged OPEN in §5.
- The `main.go` span mis-attribution (B) is reported as part of this root cause because it is *this* plan's first blocker; its
  consumer is shared with graph/impact surfaces, so the go-imports/go-callgraph lanes should co-own the fix. No separate
  contradicting evidence found.
- MCP `bb_edit` itself refused with a stale-dist-chunk error on the workspace project
  (`Cannot find module dist/database-HE6EE3VA.js`); CLI engine path used for all probes. Recorded in `findings/UNLOCKED.md`
  as an adjacent defect.

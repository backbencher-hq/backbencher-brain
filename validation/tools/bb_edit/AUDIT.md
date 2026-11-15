<!--
Author: Muhammad Ishaq Khan

WHAT THIS DOCUMENT IS — the Phase A audit of bb_edit: every mode, option, safety
  property, doc claim, gate and regex in the tool's surface, measured against
  fixture projects, with each defect named and its evidence path.
WHO IT IS FOR — the Lead reviewing the bb_edit lane, and the owner in Phase B who
  must fix each finding without re-discovering it.
EDIT TOGETHER WHEN THIS CHANGES — validation/tools/bb_edit/LATENCY.json, the
  evidence JSONs under validation/tools/bb_edit/artifacts/, and every file the
  findings name (src/intelligence/edit/**, src/ast/**, src/mcp/tools/bb_edit/**,
  docs/BB_EDIT.md, script/tool-docs/curation/bb_edit.ts, the edit gate scripts).
-->

# bb_edit — Phase A audit

State at audit start: `backbencher-brain` 0.3.0, HEAD `c43282e92`; the audit was
finished after the module-per-tool split landed (descriptor/handler moved to
`src/mcp/tools/bb_edit/`). Working tree shared with the fleet; audit output is
confined to `validation/tools/bb_edit/**` except for the gate evidence JSONs the
gate scripts themselves rewrite (named in §8).

## 0 · Phase B status

Every finding below is closed in code, with a gate that goes red without the fix.
Commit `dc9a52c9d` carries F1/F2/F3; `d321cc23d` carries F4-F7 and F12-F15; the
final sweep commit carries the gate, header and narration work (F8-F11).

| finding | severity | fix |
|---|---|---|
| F1 delete import-pruner corruption | CRITICAL | regex pruner REMOVED; pruning is AST-only for TS/JS, every other language byte-identical and DECLARED skipped (`importPruning.attempted:false` + language + reason + warning). 26/26 pruning probe; `script/verify-edit.ts` Haskell byte-identity + TS removal/kept-binding checks. |
| F2 TS/JS pruning branch dead | HIGH | pruning runs through `ASTEngine.parseTree`; dead named/default bindings removed, aliased/namespace/used bindings kept, default+namespace positive cases in the probe. |
| F3 regex gate cannot fail / wrong census | HIGH | rewritten as a TypeScript-AST census vs `validation/tools/bb_edit/regex-surface.json` (13 reviewed operations, each with a written reason), `--selftest`, policy-baseline cross-check; red on a planted mutant, green after removal. |
| F4 plan-stage refusal had no envelope | HIGH | every refusal carries the per-file envelope; a plan-stage refusal carries the EMPTY one plus `refusedBeforeWriting: true`. Wire and matrix assertions flipped from "missing" to "present and empty". |
| F5 formatter rewrites CRLF on `.go` | MEDIUM | after formatting, a CRLF file's ending is restored and declared (`formatting[].lineEndingRestored`); probe-format 6/6 (previously red). |
| F6 `reindexed:true` unconditional | MEDIUM | measured from the reindex result; per-file failures keep the validated edit, set `reindexed:false`, name the files in a `reindex:` warning. |
| F7 no protected-path policy | MEDIUM | `.git/`, `.hg/`, `.svn/`, `node_modules/`, and the index data directory are refused by resolved path with a named error; matrix covers all four shapes plus "nothing was written". |
| F8 hand page described retired tools/implementation | MEDIUM | `docs/BB_EDIT.md` rewritten: retired names called retired, AST body-node insertion, TS/JS-only import cleanup with declared skip, formatter ending repair, measured commit cost; 10 new contract sentences pinned by E12 (83/83). |
| F9 generated-page defects | LOW | duplicate error bullet removed, milestone/issue citation removed, defaults unchanged (registry), contradictory `refresh=false` sentence is in the shared generator and needs the one-line change listed in the Phase B report. |
| F10 m15 arithmetic/tautologies | LOW | denominators now include negatives (37/37, 57/57, 31/31), the constant-condition evidence check reads the evidence directory, e2e-docs names the registry's six modes (update and batch included) instead of five with `format` as a mode. |
| F11 missing headers + §9 narration | LOW | §8 headers on import-pruner, edit-engine, safety-primitives, brain-surgical-patcher, handler, descriptor, and all 20 edit gates; milestone IDs, issue numbers, campaign words and the historical "used to" narration removed from code, docs, curation and gates. |
| F12 refactor onto an existing name | HIGH | refused at plan time by file and line; the collision probe asserts the declaration file keeps ONE declaration (previously red). |
| F13 same-name rename reported | LOW | refused by name before planning; probe asserts the refusal. |
| F14 forced delete silent about callers | MEDIUM | forced delete always reports the indexed callers `force` bypassed, including the namespace-import call site that leaves no textual leftover (probe-delete-warn green). |
| F15 commit latency undeclared | MEDIUM | `docs/BB_EDIT.md` and the generated page carry the measured p50/p95 table, the seconds-vs-milliseconds shape and the 30 s client ceiling; `LATENCY.json` is the machine-readable record. |

`F7` and `F15` were approved by the Lead before implementation; `F1`'s contract
change (no regex may rewrite source; unsupported languages skip and declare) was
approved with the hard rule that a language without an AST-safe routine must
never be pattern-edited. `T2` measurement stays blocked: this is a write tool and
the shared index must not be mutated to measure it.

## 1 · How this was measured

- **No write call ever touched this repository or `.bb-data`.** Every behavioural
  probe ran through `executeEdit` / the MCP server against fixture projects under
  `validation/tools/bb_edit/work/fx/` and `work/run/`, with
  `BB_DATA_DIR=$PWD/validation/tools/bb_edit/bbdata` and `BB_NO_AUTO_REFRESH=1`.
- **Engine probes** (`work/probe-matrix.ts`, `probe-pruner.ts`, `probe-format.ts`,
  `probe-validate.ts`, `probe-mcp.ts`) call the production path. The matrix and
  wire probes write machine-readable results to `artifacts/*.json`.
- **Gate probes** run each existing verifier from the working tree
  (`artifacts/run-gates.sh`), capturing exit code, wall time and output under
  `artifacts/gates/`.
- **Latency** (`work/measure-latency.ts`) measures T0/T1 on lane-local COPIES of
  the fixtures, warm, five runs; results in `LATENCY.json`.
- Commands are quoted with their environment in §5/§7; a claim with no command
  behind it is marked `unknown`.
- `validation/tools/bb_edit/artifacts/` is gitignored (regenerable output, per the
  campaign commit policy). Every file cited there is produced by
  `work/probe-*.ts` or `work/run-gates.sh`; the committed record is this document,
  `LATENCY.json` and the probe/gate scripts themselves.

The behavioural matrix (`artifacts/matrix.json`) currently reports **138 checks,
137 passed, 20 negative**, with exactly one failing check — the measured assertion
of defect F4 (a plan-stage refusal carries no `envelope`). Coverage map: each mode
(write/update/insert/delete/refactor/batch) × each option (`dryRun`, `lineStart`,
`content`/`newContent`, `targetSymbolName`, `position`, `newName`, `force`,
`format`, `overwrite`), plus atomicity → byte-identical rollback, stale-bounds
handling, AST validation, project-root path protection, formatting effects, batch
atomicity, plan→commit pre-image refusal, index-free bootstrap, and the boundary
mode×option refusals.

## 2 · Contested surface, as split

| Piece | Path | Owner |
|---|---|---|
| descriptor | `src/mcp/tools/bb_edit/descriptor.ts` | this lane |
| handler | `src/mcp/tools/bb_edit/handler.ts` | this lane |
| engine | `src/intelligence/edit/edit-engine.ts` (2227 lines) | this lane |
| splice/format | `src/ast/brain-surgical-patcher.ts` | this lane |
| AST safety primitives | `src/ast/safety-primitives.ts` | this lane |
| import pruner (delete) | `src/ast/import-pruner.ts` | this lane |
| mode×option boundary | `src/mcp/tool-validation.ts` | Lead |
| index gate | `src/mcp/server.ts` | Lead |
| curated text | `script/tool-docs/curation/bb_edit.ts` | this lane |
| generated page | `docs/tools/bb_edit.md` | generated |
| hand page | `docs/BB_EDIT.md` | this lane |

## 3 · Findings

Severity: **critical** = silent source corruption by the tool; **high** = a claim
the tool/gates make that is false and a caller would act on; **medium** = wrong
behaviour or wrong docs with a bounded blast radius; **low** = documentation,
arithmetic or hygiene.

### F1 · CRITICAL — `delete` can corrupt source it was not asked to change (ImportPruner, non-TS/JS languages)

`delete` runs `ImportPruner.prune` on the declaration file. For every language
except TS/JS the pruner is a table of 30+ regexes; each one matches only part of
an import statement, extracts a name, and then deletes what it matched when the
name is not found in the remaining text.

Measured (`artifacts/pruner.json`, fixture `work/run/pruner-*`):

| language | input | result | verdict |
|---|---|---|---|
| Haskell | `import qualified Data.Map as M` + `keep y = M.lookup y` surviving | deletes only `import qualified Data.Map`, leaving ` as M` — file becomes `module Main where\n\n as M\n\nkeep y = M.lookup y` | **corrupted, reported `ok`, `validated: true`, `reindexed: true`** |
| Groovy | `import com.example.Util as U` + `U.call()` surviving | whole import line deleted while `U.call()` remains | **corrupted silently** |
| Python | `from mod import a, b`, `b` used by a surviving function | whole line deleted, `b` gone with it | **corrupted silently** |
| Elixir | `alias Foo.Bar, as: Baz` | delete refused by the syntax validator after the plan | safe refusal (but delete on Elixir symbols is effectively unusable) |
| TS (control) | `import { a as aliasedA }` used by survivor | import preserved | correct |

Root causes, all in `src/ast/import-pruner.ts`: (a) the regexes match a *fragment*
of the import statement, not the statement; (b) usage is checked by text search of
the extracted module-name segment, not by the language binding (`M`, `U`, `b`);
(c) there is no post-prune validation of the semantic result — the file merely has
to parse.

Compounding blindness: the corrupted Haskell file is **not** detected by
`validateFile` — measured in `artifacts/validation+path.json`,
`ASTEngine.parseFile` returned `errors: []` for `module Main where\n\n as M\n\nkeep
y = M.lookup y`. So the validator cannot be relied on as a backstop for
pruner-shaped damage in every grammar.

Fix direction: stop pruning imports with regexes for languages that have an AST
handle, or gate pruning behind an explicit `pruneImports: false` default; at
minimum, refuse to prune where the extracted specifier cannot be shown to
correspond to a whole import statement, and validate the pruned file semantically
(definedness of remaining bindings), not just syntactically.

### F2 · HIGH — the TS/JS import-pruning branch is dead code

`ImportPruner.prune` does `const { tree: ast } = await ASTEngine.parseFile(...)`
and then `ast.rootNode`. `ASTEngine.parseFile`'s `ParseResult` has no `tree`
member (measured: keys are `language,symbols,relationships,imports,exports,
errors,rawContent,metadata` — `work/debug-parsefile.mjs`), so the destructure is
`undefined`, the access throws, and `prune`'s `catch { return fileContent }`
silently returns the file unchanged. Every TS/JS `delete` therefore leaves dead
imports behind; `docs/BB_EDIT.md` says "Import cleanup runs after deletion", which
is false for the two most common languages.

Fix direction: use `parseForSafety` (which owns the tree lifetime) or a dedicated
`parseTree` call, and add a test asserting a dead import IS removed on TS.

### F3 · HIGH — `verify-edit-regex.ts` is a gate that cannot go red, and its census is wrong by 53 regexes

`script/m15/verify-edit-regex.ts` does not scan the source for regexes. It
declares a local array of four entries, asserts `runtimeRegexes.length === 4`, and
checks each entry's `category`/`justification` — facts about the gate's own
literals. It mentions `edit-engine.ts` (425 lines when written; 2227 now) only via
`src.includes(...)` string checks.

Measured with the TypeScript AST (`work/regex-census.mjs`):

| file | runtime regex operations | gate's claim |
|---|---|---|
| `src/intelligence/edit/edit-engine.ts` | **11** | "exactly 4" |
| `src/ast/import-pruner.ts` | **44** | not examined |
| `src/ast/brain-surgical-patcher.ts` | **2** | not examined |
| `src/ast/safety-primitives.ts` | 0 | (correct) |
| total edit surface | **57** | 4 |

Two of the seven undocumented engine regexes are **code classification by regex**
(`/method|constructor/i.test(symbolType)`, `/function|method/i.test(declarationType)`),
exactly the pattern charter §7 exists to prevent; neither appears in the gate or in
`m13/verify-edit-honesty.ts`, which claims to enumerate "every remaining regex".
The gate also prints an impossible fraction (`25/24 passed`) because its `total` is
`passed + negativePassed` while `checks` counts only positive checks.

The Lead's policy gate (`script/tools/verify-regex-policy.ts`, run in Phase A)
PASSES with `0 allowlisted, 112 frozen debt, 0 new` — but its `SCAN_DIRS` are
`src/mcp`, `src/intelligence`, `src/lsp`, `src/brain`, `src/security`, so only the
11 engine regexes are frozen debt; the 46 in `src/ast/import-pruner.ts` and
`src/ast/brain-surgical-patcher.ts` are outside its scan roots entirely. Reported
to the Lead as a policy-scope gap (that file is Lead-owned).

Fix direction (Phase B): make the L-thnamed gate count regex literals/`new RegExp`
by parsing the source (the census script above is the prototype), fail on any use
not in `validation/tools/regex-allowlist.json`, and align its file set with the
policy gate — including the `src/ast` edit-path files, which are where the delete
path's 44 regexes live.

### F4 · HIGH — docs/generated page claim the envelope is on refusals; plan-stage refusals carry none

`docs/tools/bb_edit.md` (Returns) and the descriptor: "`envelope` … on the answer
and on a refusal alike". The handler attaches `e.envelope` only when the engine
attached one, and the engine builds envelopes inside `commitPlan` — a refusal
raised while PLANNING (overwrite guard, unresolved symbol, path escape, batch entry
rejection) throws before any envelope exists. Measured over the wire
(`artifacts/wire.json`): the overwrite-guard refusal body is
`{ok:false, mode, error, rolledBack:true}` with no `envelope` key.

Fix direction: either attach a plan-stage envelope (the refused plan's file set,
nothing committed/restored — the honest shape) or correct the two docs; the
envelope is the field a caller holding a half-applied batch reaches for, so
attaching it is the better contract.

### F5 · MEDIUM — the default formatter rewrites CRLF files to LF for `.go`, and the hand page says it does not

Measured (`artifacts/formatting.json`): a CRLF `.go` file, one `update` with
default `format: true`, comes back with `crlf=0 loneLf=5` and
`formatted: true, formatter: gofmt`. With `format: false` the same edit keeps
CRLF (`crlf=5 loneLf=0`) — the engine's own splice is correct; the formatter
undoes it. `docs/BB_EDIT.md` states "gofmt / rustfmt / clang-format preserve
endings natively", which gofmt does not on this machine.

Fix direction: detect the file's ending after formatting and restore it (or pass
the formatter an option that preserves), or state the real behaviour in the page.

### F6 · MEDIUM — `reindexed: true` is asserted, not measured

`commitPlan` returns `reindexed: true` unconditionally after
`reindexFilesParallel`; that function RETURNS `{errors, errorDetail, skipped}`
instead of throwing, and the engine ignores all of them. A partial reindex is
therefore reported as a successful reindex. `validated: true` is likewise a
constant after the validate loop (that one is honest: a failure throws).
Evidence: `src/intelligence/edit/edit-engine.ts` lines 2135/2143 + the
`reindexFilesParallel` signature. Not reproduced with a forced reindex failure —
recorded as `unknown` in §10 and asserted only as a code-read defect.

### F7 · MEDIUM — no protected-path policy: `bb_edit` writes inside `.git/` and index directories

`resolveSafeEditPath` enforces containment in the project, not exclusion of
VCS/index trees. Measured (`artifacts/validation+path.json`):
`write` to `.git/hooks/pre-commit.ts` succeeded (committed, reindexed) and
`.bb-data/projects/x.ts` was created. A typo'd `filePath` can therefore modify
version-control state or the index directory; the `.git/config` shape happened to
be refused only because its extension has no grammar ("Unsupported file type"
after the write, then rollback).

Fix direction: refuse writes under `.git/`, `.hg/`, `.svn/`, and the data dir
(`BB_DATA_DIR` / `.bb-data`), naming the policy; that is a Lead-shared decision
because it changes the tool contract.

### F8 · MEDIUM — `docs/BB_EDIT.md` describes tools that do not exist and an implementation that no longer does

Measured claims vs current code:

| claim in `docs/BB_EDIT.md` | reality |
|---|---|
| "The legacy `bb_write`, `bb_update`, `bb_insert`, `bb_delete`, `bb_refactor` names remain adapters over the same engine." | They are retired ghosts: `RETIRED_GHOST_TOOL_NAMES` in `src/cli/onboard.ts` says "Kept ONLY so gates can prove they are gone"; registry `aliases: []`. |
| "`insert` body positions use code-aware brace matching, preserving nested braces and ignoring strings/comments." | The implementation finds body nodes via tree-sitter (`findSymbolBody`/`bodyRanges`), not a brace scan; the sentence describes the retired approach. |
| "Import cleanup runs after deletion." | Dead for TS/JS (F2); corrupting for several other languages (F1). |
| "gofmt / rustfmt / clang-format preserve endings natively." | False for gofmt here (F5). |
| "Regardless of `force`, any reference sites that survive the deletion … are reported in `warnings`" | Without `force` the delete is REFUSED (error, no warnings); with `force` warnings appear. The distinction matters to a caller deciding what to read. |
| Title "Unified Editing (M9.13)", body "(M13)/M59.A11/#890/#889" | Process/milestone narration; charter §9 bans it. |

### F9 · LOW — generated page defects and stale defaults

- `docs/tools/bb_edit.md` lists the same error bullet twice ("Symbol renamed or
  removed since the target file was indexed") — duplicated in the curation
  `errors[2]`/`errors[3]`.
- The generated Staleness section says "No freshness flags are returned" and then
  quotes the shared remediation "reads auto-refresh stale files within budget when
  enabled — disable with … refresh=false": `bb_edit` has no `refresh` option, and
  its stale-target handling is a one-file refresh inside the engine, which the
  same paragraph does describe. The quoted shared sentence contradicts it.
- Registry `documentation.defaults` is `{dryRun:false, format:true, force:false}`;
  the real default `position: "after"` is prose-only, and `overwrite` (undefined
  three-state) is unstated. The generated `Defaults:` line omits `position`.
- Limitation bullet contains "(M59.A11, #890)" (banned narration) and a
  "Measured before the guard existed … (script/m71/probe-edit-review.ts, case H4)"
  citation whose script path does not exist in this tree (`script/m71/` absent) —
  a dangling evidence citation.

### F10 · LOW — evidence arithmetic in the m15 harness gates

`script/m15/verify-edit-regex.ts` prints `E2: VERIFIED (25/24 passed …)` and
`script/m15/verify-edit-classification.ts` prints `E1: VERIFIED (37/35 …)`: their
`passed` is `positive + negative passed` while `checks` is the positive count.
The verdict logic (failed===0) is sound; the fraction is not. Also
`script/m15/verify-edit-crossfile.ts`'s E8 "all E issues closed on GitHub" leg is
`nk(..., expectedEvidence.length === 5)` — a tautology over a local array — and
`script/m15/verify-edit-e2e-docs.ts`'s "all 5 modes in implementation" checks
`["write","insert","delete","refactor","format"]` for substring presence — `update`
is absent from the list and `format` is not a mode.

### F11 · LOW — authorship/comments (§8/§9)

- The four core code files carry **no §8 header**: `src/intelligence/edit/edit-engine.ts`,
  `src/ast/brain-surgical-patcher.ts`, `src/ast/safety-primitives.ts`,
  `src/ast/import-pruner.ts` (the last starts with a 3-line note). `docs/BB_EDIT.md`
  has no markdown header. The new `descriptor.ts`/`handler.ts` have headers but omit
  the "WHY IT IS SHAPED THIS WAY" line of the template.
- Banned narration spans the surface: milestone IDs in `edit-engine.ts` (36 `.`-IDs,
  19 bare `Mnn`), `safety-primitives.ts`, `descriptor.ts`, `handler.ts` (M28.T1,
  M48.P1/C2, M55.T5, M66, M71.D13, #624, #696, #700), `curation/bb_edit.ts`
  (M59.A11, #890), `docs/tools/bb_edit.md` (M59.A11, #890, MEASURED), `docs/BB_EDIT.md`
  (M9.13, M13), `script/verify-edit.ts` (M9.13, M59.A11, #889), all 18 edit gate
  scripts and `script/m16/verify-edit-real-repo.ts` (M13/M15/M16 IDs, "the lane",
  "the fleet", "shipped" as process history). §9 keeps technical uses ("owner
  cascade") and plain measured facts; those are kept.

### F12 · HIGH — `refactor` renames ONTO an existing name, silently producing a duplicate declaration

Measured (`artifacts/collision.json`): with `function target` and `function
existing` in one file, `refactor target → existing` was ACCEPTED
(`summary.renamedSites = 1`) and the file then contains **two** declarations named
`existing`. Nothing checks that the new name is free in the declaration file (or in
any file the rename writes), so the tool reports success over source that no longer
type-checks/compiles. This is the mirror image of the delete-caller protection: a
rename is exactly the operation whose contract is "every reference now names the
new declaration", and two declarations with that name break it.

Fix direction: before committing a refactor, parse each planned change for an
existing declaration of `newName` (excluding the declaration being renamed) and
refuse with the name and file; test it as a negative.

### F14 · MEDIUM — a FORCED delete does not warn about the indexed callers it bypassed

The descriptor and the generated page say `force` "allows removal when indexed
callers or live references survive; leftovers are reported as warnings". Measured
(`artifacts/delete-warn.json`, fixture `work/run/delete-warn-namespace`): one
function `lone` called from another file through a namespace import
(`import * as a from "./a"; a.lone()`). Without `force` the delete is refused with
"cannot delete lone: 1 indexed caller(s)" — so the engine knows. With
`force: true` the delete succeeds and `warnings` is **`[]`**: the indexed caller is
neither refused nor reported, because the warning path only counts AST leftovers
in the declaring file and import SPECIFIERS in importing files; a namespace
imported use names no specifier occurrence.

Fix direction: when `force` bypasses an indexed-caller refusal, always emit a
warning naming the caller count and what could not be verified; a forced delete
must never be silent about the evidence it overrode.

### F13 · LOW — a rename to the SAME name is reported as a successful rename

Measured (`artifacts/collision.json`): `refactor target → target` returned
`rename: 1 site(s) across 1 file(s)`, wrote identical bytes and reindexed. The
zero-site rule ("a rename that covers nothing is a failure") does not cover the
covered-but-identical case, so a caller is told a rename happened when nothing
changed. Fix direction: refuse `newName === symbolName` by name, before planning.

### F15 · MEDIUM — a commit's latency is dominated by reindex and carries no declared bound

Measured in the table above: T1 update commit p50 4500.7 ms / p95 7052.3 ms; T0
update commit p50 1801.5 ms. The same edit as a dry run is 11-71 ms p50, so the
cost is the reindex/validate/format cycle, not planning. The descriptor and the
generated page state that formatting/validation/reindexing run once per call but
never name a bound; a 30 s MCP client timeout is the only ceiling, and a timeout
on a write call leaves the caller unable to tell committed from restored. Phase B
should (a) record the measured cost in the page and (b) decide with the Lead
whether a commit should declare a time budget or surface `derived.pass` progress;
T2 measurement remains forbidden for this lane.

## 4 · Behaviour confirmed correct (selected, with evidence)

From `artifacts/matrix.json` and `artifacts/wire.json` (every check has a name and
a detail string there):

- write create / alias `newContent` / nested-dir create / dry-run no-write;
  overwrite guard three-state at PLAN time (41→1 refused, 6→1 refused, 41→21
  allowed, `true` replaces, `false` create-only) and the refusal names both ways
  forward; the refused write leaves bytes identical.
- update full declaration vs body fragment decided by the parse; `content` alias;
  body-fragment refusal on Python/Ruby with the remedy named; declaration widening
  on Java/Kotlin (no duplicated return type / `fun`).
- lineStart disambiguation works exactly (`ambiguous` without it, selects the
  second declaration with it, a wrong line is refused).
- insert before/after/inside-top/inside-bottom; Python soft body; Elixir inside-top
  refused loudly.
- refactor: declaration + in-file call sites + cross-file import specifiers; local
  same-name untouched; namespace import untouched; aliased import specifier
  rewritten while the local alias is left alone; summary/warnings; invalid
  `newName` refused; stale caller aborts before writing; zero-site rename refused.
- delete: indexed-caller refusal with evidence, `force` warnings, importing-file
  refusal, unknown symbol refused.
- rollback: post-write validation failure leaves byte-identical bytes (including an
  invalid-UTF-8 file — the byte snapshot works), restores the 0755 mode, no
  `.bb-edit-*` temp leaks, envelope reports committed+restored, original error
  preserved.
- plan→commit pre-image check: a file changed in the window is refused with both
  hashes and nothing written; a file that appears at a create target is refused;
  a vanished target is not recreated.
- batch: mixed edits and fan-out land once each with one formatting pass/one
  reindex; validation failure in the last entry rolls all three files back
  byte-identically; plan-stage refusal writes nothing (`batch entry N` named);
  two entries on one file refused by entry index; cap enforced; dry-run plans only.
- index-free: `write` works with no index and its reindex bootstraps the symbol
  modes; before that, `update` names the missing index and the remedy.
- boundary: every per-mode irrelevant option is refused with the accepted set,
  including inside a batch entry (entry index named); unknown options, blank
  required strings, non-integer/negative `lineStart`, bad enums, per-entry
  `dryRun`/`format`, nested batch, repeated `files` path, `files`+`filePath`
  conflict, and >200 planned edits.
- paths: `../`, absolute-outside and symlink escapes refused (with distinct
  wording), in-project nested creates resolve inside, project root itself allowed.
- CRLF: engine splice preserves the file's ending (format:false control).

## 5 · Latency

Measured (T0 = lane copy of `test/fixtures/polyglot`, T1 = lane copy of
`.perf-fixtures/bb-scale/n100`, warm, five runs, `BB_DATA_DIR` lane-local,
`BB_NO_AUTO_REFRESH=1`, shared machine at load average 24-32 so these are upper
bounds):

| tier | operation | p50 | p95 | charter budget | within |
|---|---|---|---|---|---|
| T0 | update dryRun | 11.5 ms | 11.8 ms | 250 ms | yes |
| T0 | delete dryRun (force) | 26.1 ms | 32.0 ms | 250 ms | yes |
| T0 | batch dryRun (2 write entries) | 0.7 ms | 0.9 ms | 250 ms | yes |
| T0 | update commit | 1801.5 ms | 2062.9 ms | — (write path) | — |
| T0 | insert inside-top commit | 1554.7 ms | 1702.1 ms | — | — |
| T0 | write create commit | 1879.6 ms | 3070.6 ms | — | — |
| T1 | update dryRun | 71.0 ms | 76.8 ms | 1000 ms | yes |
| T1 | delete dryRun (force) | 260.7 ms | 300.4 ms | 1000 ms | yes |
| T1 | batch dryRun (2 write entries) | 0.5 ms | 0.5 ms | 1000 ms | yes |
| T1 | update commit | 4500.7 ms | 7052.3 ms | — | — |
| T1 | insert inside-top commit | 4614.7 ms | 6975.9 ms | — | — |
| T1 | write create commit | 2388.1 ms | 3722.9 ms | — | — |

Read-shaped calls (dry runs) are cheap and within both budgets: 12-72 ms p50,
because a plan parses the target file and never reindexes. **Commits are 1.5-7 s**
and dominated by the synchronous `reindexFilesParallel` + bounded derived pass that
every commit runs; the charter's read-tool budgets do not cover a write commit, but
the tool declares no time bound and commits here already reach 7 s p95 on a
100-file project under load. On a large index that cost is unbounded from the
caller's side and the 30 s MCP client timeout is the only ceiling — see F15.

`LATENCY.json` is the machine-readable record (commands, environment, skipped
operations). T2 is not measured for this tool (writes against the shared index are
forbidden); the T0/T1 copies are used so the measurement never touches the repo's
own fixture trees or the shared index.

## 6 · Gate inventory and results

Final Phase B sweep (`validation/tools/bb_edit/work/run-final-sweep.sh`, logs under
`artifacts/final-sweep/`; env `BB_DATA_DIR=<lane>/bbdata`, `BB_NO_AUTO_REFRESH=1`,
`BB_REPOSITORIES_REPO=/home/ishaq2321/bb_tests/repositories`). **Every entry exits 0.**

| gate | verdict |
|---|---|
| `m13/verify-edit-boundary.ts` (E1) | VERIFIED 151/151, 33 neg |
| `m13/verify-edit-rename.ts` (E2) | VERIFIED 84/84, 21 neg |
| `m13/verify-edit-mask.ts` (E3) | VERIFIED 130/130, 88 neg |
| `m13/verify-edit-body.ts` (E4) | VERIFIED 39/39, 9 neg |
| `m13/verify-edit-freshness.ts` (E5) | VERIFIED 14/14, 5 neg |
| `m13/verify-edit-atomicity.ts` (E6) | VERIFIED 14/14, 1 neg |
| `m13/verify-edit-unit.ts` (E7) | VERIFIED 107/107, 25 neg |
| `m13/verify-edit-integration.ts` (E8) | VERIFIED 17/17, 1 neg |
| `m13/verify-edit-e2e.ts` (E9) | VERIFIED 34/34, 14 neg (wire legs unblocked by passing the child env) |
| `m13/verify-edit-corpus.ts` (E10) | VERIFIED 9/9, 3 neg |
| `m13/verify-edit-honesty.ts` (E11) | VERIFIED 10/10, 1 neg |
| `m13/verify-edit-docs.ts` (E12) | VERIFIED 83/83, 2 neg (generator check scoped to bb_edit) |
| `m13/verify-edit-batch.ts` (E13) | VERIFIED 61/61, 19 neg |
| `m15/verify-edit-classification.ts` (E1) | VERIFIED 37/37, 2 neg |
| `m15/verify-edit-regex.ts` (E2) | VERIFIED 9/9, 1 neg (AST census, 13 reviewed operations, selftest) |
| `m15/verify-edit-mask.ts` (E3) | VERIFIED 57/57, 1 neg |
| `m15/verify-edit-crossfile.ts` (E4/E5/E8) | E4 31/31 (8 neg), E5 5/5, E8 8/8 (1 neg) |
| `m15/verify-edit-e2e-docs.ts` (E7) | VERIFIED 11/11 |
| `script/verify-edit.ts` | PASS (includes the import-pruning checks) |
| `m16/verify-edit-real-repo.ts` | E1 9/9, E1b 4/4, E2 1/1, E3 4/4, E4 5/5, E5 2/2 — all VERIFIED |
| probes | matrix 146/146 (23 neg), wire 29/29, import-pruning 26/26, formatting 6/6, collision 3/3, forced-delete warnings 5/5, validation+path 9/9 |

Compared with the Phase A sweep (§ the earlier table in this file's history was
replaced by this one): E9 25/34 → 34/34, E13 54/61 → 61/61, E12 72/73 → 83/83,
m15 crossfile 8/7 → the full evidence set, m15 e2e-docs BLOCKED → 11/11. The two
wire gates were not failing on the engine: the MCP SDK does not inherit the
parent environment, so the server child never saw `BB_DATA_DIR` and tested the
default data dir — fixed by passing `env` to `StdioClientTransport`. The corpus
gate now passes the env var its own message names, and the shared resolver gained
the `../../bb_tests/<name>` candidate.

## 7 · Blocked legs

Only two things remain out of reach in this lane, and neither is code evidence:

1. **T2 latency is not measured, by design.** `bb_edit` is a write tool; a commit
   touches the index, and measuring it against the shared 3.4 GB index would mutate
   the very database the campaign is auditing. T0/T1 copies (5 and 100 files) are
   the measured tiers; the shape and the 30 s client ceiling are documented in
   `docs/BB_EDIT.md` and `LATENCY.json`.
2. **The generated page's Staleness paragraph still quotes `refresh=false`**, a
   control `bb_edit` does not have. That sentence is produced by
   `script/verify-tool-docs.ts` (`stalenessSection`, the `bb_edit` branch) and
   quoting `FRESHNESS_REMEDIATION.dir` puts the auto-refresh wording into a tool
   that has no refresh flag. One-line change for the generator owner: inline the
   manual remediation there, the way the `bb_health` branch already does.

## 7 · Blocked legs (exact commands and reasons)

1. **MCP-wire legs of `m13/verify-edit-e2e.ts` (9 failures) and `m13/verify-edit-batch.ts` (7 failures).**
   Command: `BB_DATA_DIR=$PWD/validation/tools/bb_edit/bbdata BB_NO_AUTO_REFRESH=1 npx tsx script/m13/verify-edit-e2e.ts` (and `…verify-edit-batch.ts`).
   Reason: both gates spawn the MCP server through `StdioClientTransport({ command, args, cwd, stderr })` without `env`. The MCP SDK defaults the child environment to `getDefaultEnvironment()` — `HOME`, `LOGNAME`, `PATH`, `SHELL`, `TERM`, `USER` only (`node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js`, `DEFAULT_INHERITED_ENV_VARS`) — so `BB_DATA_DIR` is dropped, the child looks in `~/.bb`, and on this machine `~/.bb` is read-only. Measured: `No index found for /tmp/bb-edit-e2e-…` (indexed legs) and `ENOENT: no such file or directory, mkdir '/home/ishaq2321/.bb/projects/…'` (write legs). Failure lists in `artifacts/gates/m13-verify-edit-e2e.log` / `…-batch.log`. The wire verdict ALSO depends on the child seeing the same data dir as the in-process indexer — in CI it only works because the default dir is writable and shared. Fix (Phase B; both gate files are in scope): pass `env: { ...process.env }` explicitly.
2. **`m13/verify-edit-docs.ts` (E12) red as a CASCADE.** Command: `npx tsx script/m13/verify-edit-docs.ts`. Its one failure is `evidence: e9.json … known-gap`, i.e. §7.1's blocked leg feeding the evidence-completeness check. Measured independently: with the committed evidence in place E12 is `VERIFIED (73/73, 2 negatives)`. Not an independent defect, but it means one blocked wire leg turns TWO gates red in this environment.
3. **`m15/verify-edit-e2e-docs.ts` (E6/E7) BLOCKED — declared, exit 2.** Command:
   `BB_REPOSITORIES_REPO=/home/ishaq2321/bb_tests/repositories npx tsx script/m15/verify-edit-e2e-docs.ts` → `BLOCKED: repositories is not present on this machine. Set BB_REPOSITORIES_REPO to its checkout. Searched: /home/ishaq2321/repositories, /home/ishaq2321/mcp/bb_tests/repositories, /home/ishaq2321/mcp/repositories, /home/ishaq2321/mcp/backbencher-brain/repositories` (exit 2), while the corpus IS at `/home/ishaq2321/bb_tests/repositories` (graphql-js present). Two defects behind the block: (a) `script/lib/optional-corpus.ts`'s candidate list has `path.resolve(cwd, "../bb_tests/<name>")` = `/home/ishaq2321/mcp/bb_tests/…`, one directory above the real layout, and no absolute `/home/ishaq2321/bb_tests/…` candidate; (b) the gate calls `resolveOptionalCorpus("repositories")` WITHOUT the env-var argument, so the `BB_REPOSITORIES_REPO` its own message names is never read (proved by the command above). `script/lib/optional-corpus.ts` is shared (Lead-owned); the gate call is in this lane's scope.
4. **Corpus legs generally: NOT blocked.** `m13/verify-edit-corpus.ts` resolves the corpus through `script/lib/corpus-root.ts` (which does search the real path) and ran 9/9; `m16/verify-edit-real-repo.ts` ran the rake suite on a temp copy.
5. **T2 latency.** Not run by design (writes against the shared index are forbidden); recorded in §5.

## 8 · Regex audit (§7 contract)

[[PENDING REGEX TABLE]]

What the named gate proves: that four literal patterns hard-coded IN THE GATE
have categories and justifications, and that `edit-engine.ts` contains the strings
`parseForSafety`, `isReferenceSite`, `isBindingParentType`, `IdentifierOccurrence`.
It does not read a regex out of any source file; its line references (122/251/
312/336) belong to a 425-line file that is now 2227 lines; it cannot report a new
regex; and it does not touch `safety-primitives.ts`, `brain-surgical-patcher.ts`,
`import-pruner.ts`, the handler or the descriptor.

What the Lead's policy gate proves for this lane: `script/tools/verify-regex-policy.ts`
passes as `0 allowlisted, 112 frozen debt, 0 new` — 11 of those frozen rows are the
engine's regexes, and the `src/ast` files in the delete/format path (46 operations)
are outside its `SCAN_DIRS`. `validation/tools/regex-allowlist.json` is empty, so
no bb_edit regex has a reasoned allowlist row with edge-case tests; the 11 engine
rows exist only as frozen debt in `validation/tools/regex-baseline.json`
(Lead-owned).

## 9 · Unknowns (claims I could not measure, stated as unknown)

- Whether a REAL reindex error (lock, I/O) leaves the index stale while
  `reindexed: true` — code-read defect F6, not reproduced.
- Whether `rusfmt`/`clang-format`/`black` rewrite line endings — only gofmt is
  installed on this machine (F5 measured on gofmt only).
- The `force` delete warning behaviour on a language whose grammar exposes a
  surviving reference inside a deleted comment/string (the AST leftover scan is
  grammar-dependent).
- Behaviour of `write` on files >5 MB, binary content, or a `filePath` that names a
  FIFO/device — not exercised.
- Refactor name-collision behaviour (renaming onto an existing name in the same
  file) — not exercised in Phase A; candidate defect to test in Phase B.

## 10 · Phase B plan (ordered by severity)

1. F1 + F2: import pruning — stop the regex path from deleting live imports for
   any language (make it conservative or AST-driven), fix the dead TS branch, add
   falsifiable tests that fail on the measured corruptions.
2. F3: rewrite `verify-edit-regex.ts` as a real source census + allowlist gate;
   prove it red on a planted regex first.
3. F4: attach a plan-stage envelope on refusals (engine) + tests over the wire.
4. F5/F6: formatting ending-preservation and measured `reindexed`/`errors`
   surfacing; docs follow the code.
5. F7: propose the protected-path policy to the Lead (contract change) and
   implement if approved.
6. F8/F9/F11: rewrite `docs/BB_EDIT.md` and the curation in author voice with the
   markdown header; add the §8 headers to the four core code files; replace banned
   narration with plain facts; fix the duplicate bullet, the stale section and the
   dangling citation; regenerate the page with
   `npx tsx script/verify-tool-docs.ts --only bb_edit --write` and verify with
   `--only bb_edit`.
7. F10: fix the m15 arithmetic and the two tautological checks; add the missing
   `env` to the two MCP gates (§7.1) so both can run in a sandbox.
8. Re-run all gates, record before/after in `artifacts/`, update `LATENCY.json`.

<!--
Author: Muhammad Ishaq Khan

WHAT THIS DOCUMENT IS — the language × tool matrix gate: what it proves about the
  tool layer over every registered analyzer language, what it deliberately does not
  prove, the measured capability boundaries it records, and the exact steps to extend
  it when a language, grammar or tool is added.
WHO IT IS FOR — the tool owners and any contributor touching an analyzer, a tool
  handler, or the language routing tables; this page is the contract for the gate.
WHY IT EXISTS — the tools answer from the index, so "the tools work for every
  language" has to be a measurement. The gate derives the language set from the
  engine, indexes one real fixture per language, and calls the real tool handlers.
WHERE ITS EVIDENCE LIVES — validation/languages/results/tool-matrix.json; the gate is
  `npm run verify:language-matrix` and is a member of the `npm run verify:tools`
  launch gate (group `languages`).
EDIT TOGETHER WHEN THIS CHANGES — src/ast/engine.ts (language table),
  src/ast/language-detection.ts (extension routing), validation/m12/fixtures/
  (the canonical fixture per language), script/verify-language-tool-matrix.ts.
CONTRACTS IT MUST NOT BREAK — the language list is derived, never spelled out; a
  missing fixture is a FAILURE, not a skip; write probes are dry-run only; the
  scratch tree (`.langmatrix/`) is the only place anything is written.
-->

# Language × tool matrix

The sixteen tools read stored index rows; the analyzers are what produce those rows.
This gate is the bridge between the two claims. It derives every language the engine
registers, indexes one real fixture of each language, and then asks the real public
tools over that language's own symbol.

## What it proves

For **every derived language**, in one isolated scratch index:

1. **indexed** — the fixture is admitted, stored under that language, and yields at
   least one symbol;
2. **search** — `bb_search` finds that language's symbol and returns its declared
   `[match-set]` line;
3. **graph** — `bb_graph` answers with the canonical graph root record;
4. **impact** — `bb_impact` answers, or declines with its *declared* non-traversable-
   root refusal (module/file-level declarations and markup headings are not roots);
5. **doc** — `bb_doc` file mode documents the fixture and cites it;
6. **annotations** — `bb_annotations` answers with a declared set;
7. **edit** — `bb_edit` dry-run plans or refuses **typed**; a crash fails the gate;
8. **migrate** — `bb_migrate` returns its `plans`/`unsupported` arrays (declared gaps
   included, never a crash);
9. **cross_language** — `bb_cross_language` answers the stored-fact JSON shape.

Once, for the whole matrix: `bb_health`, `bb_analyze` stats, `bb_patterns`,
`bb_security`, `bb_visualize` project scope, `bb_index` reindex, and an
`bb_annotate` → `bb_annotations` round-trip. Five negatives prove the checks can go
red: an unknown symbol is refused by `bb_graph`, a blank migration target is refused,
an unrouted fixture would fail the route check, the matrix must cover every derived
language, and the fixture-bearing check is the strict form of the missing-fixture
predicate.

The language set comes from `ASTEngine.supportedLanguageNames()`; the extensions come
from `languageExtensionEntries()`. Neither is written down in the gate, so a new
analyzer/grammar joins the matrix automatically — and if it has no fixture, the gate
**fails** and names the missing language instead of silently skipping it.

## What it deliberately does not prove

- **Analyzer accuracy.** A language with sparse relationship extraction still passes
  `indexed`; graph/impact answers over it are honestly sparser. That accuracy is the
  per-language analyzer campaign's own evidence (`docs/analyzers/*`, `script/m14/*`).
- **Language-specific rules inside tools.** `bb_security`'s AST sink/source rules are
  TypeScript-only by declaration (token rules cover the rest); `bb_patterns` framework
  rules are ecosystem-specific; `bb_migrate`'s dictionary is library-keyed. The matrix
  asserts the *declared behaviour* (typed refusal, declared gap), not a finding count.
- **Write-path breadth.** `bb_edit` dry-runs are counted per language; a typed refusal
  is honest behaviour for a language the edit engine does not support yet, and the
  evidence records the split (see below) so a future extension can move languages from
  refused to planned without changing this gate's contract.

## Measured boundaries (recorded in the evidence)

The gate writes a per-language row and capability counters into
`validation/languages/results/tool-matrix.json`:

- **Languages:** every language `SUPPORTED_LANGUAGES` registers (53 at the time of
  writing, including `tsx`, `sass`, `terraform` and `make`), one fixture each.
- **Checks:** 548 checks including 5 negatives; wall time ≈ 15 s; indexing is the bulk
  of it (one real index of 53 files).
- **`editSupport`:** the dry-run update plans for some languages and is refused
  (typed) for others; the counter is in the evidence, so the boundary is visible and
  moves only when the edit engine gains a language.
- **`migrateShapes`:** every language returns `plans`/`unsupported` arrays.
- **`nichePairs`:** the TypeScript↔Haskell pair is probed explicitly. A plan is
  returned with the missing-dictionary gap declared (never an invented mapping), and
  the reverse direction reports a typed `unsupported` entry; both observations are
  stored per run.

## Extending it

**A new language** (new analyzer or grammar):
1. add the language to `src/ast/engine.ts` `SUPPORTED_LANGUAGES` (and its extension to
   `src/ast/language-detection.ts` if new — the routing gate will hold it);
2. add one real fixture under `validation/m12/fixtures/<language>/` (the gate derives
   the language from the routed extension, not from the directory name; a `.m` MATLAB
   fixture is detected by its unambiguous `classdef`/`function` forms);
3. run `bun run script/verify-language-tool-matrix.ts --only=<language>`; the row must
   PASS, then run the full gate and commit the refreshed evidence.

**A new tool or a new check** on the tool layer:
1. add it to the per-language loop (strict) or the project-wide section (single call);
2. decide the contract it asserts: a declared refusal is a pass only when the tool
   declares it — never convert a crash into a skip;
3. add a negative control for any new predicate (the gate must be able to go red);
4. regenerate the evidence and run `npm run verify:tools`.

**Developer commands**

```bash
bun run script/verify-language-tool-matrix.ts --list          # derive & print languages
bun run script/verify-language-tool-matrix.ts --only=python   # one row while editing
bun run script/verify-language-tool-matrix.ts --verbose       # pass-row evidence too
bun run script/verify-language-tool-matrix.ts --keep          # keep .langmatrix/ scratch
npm run verify:language-matrix                                # the gate
npm run verify:tools                                          # includes it (group languages)
```

Everything is written under `.langmatrix/` (fixture copies and the isolated brain DB);
the user's real index is never touched and the scratch tree is removed unless
`--keep` is passed.

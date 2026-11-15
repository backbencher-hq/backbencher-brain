# PROPOSAL — adjudicate `rust/use-import-edges` (the lane's 4th failing fixture)

**Author:** Muhammad Ishaq Khan · **Lane:** rust (`rs`) · **Date:** 2026-10-17
**Owner of the decision:** the Lead / the lane owner (a fixture expectation is a CONTRACT, not a
convenience — this lane will not edit it to match the analyzer without a ruling).
**Status:** the fixture has failed since before this session (the baseline records `rust: 4`), and
nothing in this session touched it. It is an honest defect finding, not a harness error.

---

## 1 · The failure, exactly

`bun run script/m14/run-fixtures.ts --lang rust` → `rust/use-import-edges` reports 5 missing
expectation rows (the fixture's other rows pass):

```
expected relationship not found:
  { type: imports, from: "use-import-edges", target: "std::collections::HashMap",
    meta.evidenceClass: "import_based", meta.relationshipType: "use_import",
    meta.importScope: "file", meta.items: ["HashMap"] }
  { type: imports, from: "use-import-edges", target: "std::io", meta.items: ["Read","W"] }
  { type: imports, from: "inner", target: "crate::outer::Helper", meta.importScope: "module" }
  { type: imports, from: "scoped", target: "std::path::Path", meta.importScope: "function" }
  { type: imports, from: "use-import-edges", target: "std::collections::HashMap", line_number: 25 }
```

The analyzer actually emits (same file, `import-row-dump.mts`):

| written source | emitted source | emitted target | emitted metadata |
| --- | --- | --- | --- |
| `use std::collections::HashMap;` | `(file)` + `fileLevel: true` | `std::collections` | `relationshipType: "use_declaration"`, `items`, `modulePath`, `moduleKind`, `evidenceClass: "import_based"` |
| `use std::io::{Read, Write as W};` | `(file)` | `std::io` | same, `items: ["Read","W"]` |
| `use crate::outer::Helper;` inside `mod inner` | `inner` | `crate::outer` | `moduleKind`, `items` |
| `use std::path::Path;` inside `fn scoped` | `scoped` | `std::path` | same |

So the disagreement is FOUR decisions, not one:

1. **source spelling** — the fixture pins the file's stem (`use-import-edges`); the analyzer publishes
   `(file)` with `fileLevel: true`.
2. **target spelling** — the fixture pins the PATH AS WRITTEN (`std::collections::HashMap`,
   `crate::outer::Helper`, `std::path::Path`); the analyzer publishes the MODULE PREFIX
   (`std::collections`, `crate::outer`, `std::path`), because a path's leaf is a binding, not the
   dependency (`rustImportRows`' own contract, and the rule the file claim's arithmetic is built on).
3. **relationshipType** — fixture `use_import`; analyzer `use_declaration`.
4. **importScope** — fixture pins `file`/`module`/`function`; the analyzer publishes `fileLevel` for
   the file case and nothing for the other two. (`importScope` appears nowhere in `src/ast/*.ts`; no
   lane emits `use_import` — both spellings exist only in this expectation.)

## 2 · Which side is the current contract?

Both decisions the fixture disagrees with are LATER rulings with recorded measurements:

* **Source `(file)` + `fileLevel` is R7's contract.** `src/ast/real-rust-analyzer.ts` (`RUST_FILE_SOURCE`)
  and `parallel-indexer.ts`'s `fileLevel` branch rewrite `source_external` to the project-relative path;
  the literal `global` was removed because it named no declaration (measured: 503 of 610 ripgrep
  `imports` rows). The file-stem spelling predates R7.
* **Target = module prefix is the dependency contract.** The comment on `rustImportRows` states it —
  "A path's LEAF is never the dependency. `use crate::flags::Flag` depends on `crate::flags`" — and the
  M14 file claim (`metadata.importProjectFile`) resolves the MODULE to its file. Re-spelling targets to
  the written path would require re-deriving the claim arithmetic and would change 1,751 `imports`
  targets on the cap-400 population.
* `evidenceClass: "import_based"` IS implemented (the post-pass that sets `md.evidenceClass`, `real-rust-analyzer.ts` — `grep -n "md.evidenceClass"`);
  the missing keys are `relationshipType: "use_import"` and `importScope`.

## 3 · The options, with their costs

| option | what it costs | what it buys |
| --- | --- | --- |
| **(A) Re-author the expectation to the current contract** — superseding file (the repo's `.expectation.superseded-<sha>.json` convention), new rows pin the source `(file)`+`fileLevel`, the module-prefix target, `use_declaration`, `items` alias-awareness, the path line, and KEEP the two forbid rows (`global`, empty items) | a fixture edit; needs the ruling that R7 supersedes D31's source and the module-prefix target is intentional. The observed rows are already correct by those rules. | 27 pass / 3 fail; the imports edge becomes PINNED instead of permanently failing, and the pre-existing `use-import-edges` mutants (`RUST-D31 revert`, `global` source, `usage_contextual` tier) become live again |
| **(B) Implement D31 as written** — file-stem source, written-path target, `use_import`, `importScope` | contradicts R7 (re-introduces a source spelling the store's `fileLevel` machinery replaced); changes 1,751 targets; the file claim must map the written path's MODULE (drop the leaf) and re-derive; fixture pins elsewhere that assert `(file)`/`fileLevel` (if any) break | the fixture passes verbatim; a spelling that matches the ImportInfo channel |
| **(C) Leave it failing** | the lane carries a permanent 4th failure; three mutants stay pinned to a contract nobody implements | nothing |

**Recommendation: (A).** The fixture's two structural rows (source, target) are superseded by
measurements recorded in the analyzer itself; its metadata rows (`use_import`, `importScope`) were
never implemented. Re-authoring keeps the fixture's real purpose — "a `use` produces an `imports`
edge, scoped to its enclosing module/function, with alias-aware bindings and the path's line" — while
pinning the spelling the lane actually publishes. Option (B) would undo R7 to satisfy a pre-R7 file,
and option (C) leaves a fixture that cannot fail for the right reason.

**What this lane will NOT do without the ruling:** edit the expectation to match observed output
(that would turn a test into a mirror), or implement (B) because a fixture says so.

# Decision needed — dead assets shipped in every install

Found by `script/verify-language-registration.ts` (A5) and
`script/verify-columns-written.ts`. Both are audits, not opinions: each item below
was verified unreferenced by exhaustive search, and each is reported rather than
deleted because removing a shipped asset changes what users receive.

Nothing here is a correctness bug. These are packaging decisions that have
accumulated because nothing asserted against them.

## 1. Eleven tree-sitter grammars nothing loads — 14.3 MB per install

`wasm/` ships 67 grammars; **56 are referenced, 11 are referenced nowhere** —
not in `src/`, `script/`, `test/`, `docs/`, or `package.json`.

| Grammar | Size | Analyzer exists? |
|---|---|---|
| `tree-sitter-tlaplus.wasm` | 4.88 MB | no |
| `tree-sitter-ocaml.wasm` | 5.02 MB | no |
| `tree-sitter-fsharp_signature.wasm` | 3.14 MB | no |
| `tree-sitter-php_only.wasm` | 1.00 MB | no |
| `tree-sitter-rescript.wasm` | 0.68 MB | no |
| `tree-sitter-elm.wasm` | 0.15 MB | no |
| `tree-sitter-elisp.wasm` | 0.05 MB | no |
| `tree-sitter-systemrdl.wasm` | 0.08 MB | no |
| `tree-sitter-embedded_template.wasm` | 0.01 MB | no |
| `tree-sitter-core_schema.wasm` | 0.01 MB | no |
| `tree-sitter-json_schema.wasm` | 0.002 MB | no |

Total **14.3 MB**, about **11%** of the `wasm/` payload, in every install.

They are genuinely never loaded: `resolveWasm("tree-sitter-<x>.wasm")` resolves
by name, and no code path scans the directory to discover grammars. The only
`readdirSync(wasmDir)` calls are asset-lookup helpers and audit scripts.

Two reasons this is worth a decision rather than a shrug:

- A user with a `.rescript` or `.el` file gets no signal that the language is
  unsupported. Shipping a grammar implies support that does not exist.
- `tree-sitter-php_only.wasm` and `tree-sitter-fsharp_signature.wasm` are the
  riskiest: a reader could reasonably believe `php` and `fsharp` route through
  them. They do not — `php` and `fsharp` have their own analyzers and their own
  grammar entries. Leaving a second, unused grammar for the same language is
  exactly the sort of thing that gets "fixed" wrongly one day.

**Recommendation:** delete all 11, then re-run `verify-language-registration.ts`
and the full suite. Saves 14.3 MB per install and removes a misleading signal.
Deferring is defensible only if a language is actively being added.

## 2. `brain_query_cache` — a cache with nothing in it

Seven columns, **no INSERT and no SELECT anywhere in `src/`**. The only
statements touching the table are `DELETE FROM brain_query_cache`, run on
reindex and on project removal. Verified 0 rows in a real indexed database.

It is allocated, never populated, and periodically cleared. Every read from it
can only ever miss — so it is not a cache with a cold start, it is a table that
costs schema and disk and returns nothing.

Two possibilities, and the difference matters:

- **A writer is missing.** Something was meant to read from this table and never
  got its cache. In that case the absence is a real (silent) performance
  defect — `bb_search` and `bb_ask` recompute instead of reusing.
- **It is vestigial.** Query caching was abandoned and the table was left behind.

**Recommendation:** decide which. If vestigial, drop the table and its two
DELETE statements; if a writer is missing, that missing write is a bug worth
its own task. This audit cannot distinguish the two from source alone, which is
why it is here rather than acted on.

## 3. Columns that exist but are never written

From `script/verify-columns-written.ts` (129 columns audited, 14 unwritten):

- `brain_import.package_name`, `brain_import.is_dynamic` — never written
- `brain_index_status.languages_detected`, `frameworks_detected`,
  `last_incremental_index` — never written
- `brain_taint_flow.mitigation_steps` — never written

Unlike `brain_index_status.total_relationships` — which was a counter that read
0 while its neighbours read correctly, and so was silently WRONG — these are
simply unused. Nothing reads them either, so nothing is misled today. They are
listed so the choice to keep or drop is explicit rather than accidental.

`brain_index_status.languages_detected` is the one worth a look: the indexer
knows every language it just parsed, so storing them is nearly free and would
make "which languages are in this index" answerable without a query.

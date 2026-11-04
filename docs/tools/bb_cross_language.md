<!--
Author: Muhammad Ishaq Khan

WHAT THIS DOCUMENT IS — the generated reference for bb_cross_language: contract, input schema, returns, examples, errors, limitations, performance, safety and evidence semantics.
WHO IT IS FOR — callers of bb_cross_language through any MCP host, the CLI (`bb tool bb_cross_language`), or a library.
EDIT TOGETHER WHEN THIS CHANGES — src/mcp/tools/bb_cross_language/descriptor.ts, src/mcp/tools/bb_cross_language/handler.ts, script/tool-docs/curation/bb_cross_language.ts; regenerate with `npx tsx script/verify-tool-docs.ts --only bb_cross_language --write`.
-->
# `bb_cross_language`

Cross-language facts for one symbol from stored brain_relationship rows only (is_cross_language = 1), per-pair with bridge mechanism and evidence tier. Every fact names both ends — the copy of the requested name it came from and the other symbol's name, file, language and line — plus the stored row id. A name is many symbols (the index holds one per file/name/line), so facts are the union over every copy; `copies` names them and `ambiguous` says so. SEPARATELY, `memberFacts` holds the rows on the copies' MEMBERS: each fact's `self` is the MEMBER the stored row names, `owner` is the copy of the asked name it was attributed through, and `pair` is exactly `self.language → other.language` (null when the two are equal or unknown, and then the row is counted in `unpairableRowCount` rather than given a pair). Member rows are the MEMBER's edges, never absorbed into the symbol's — `ownFactCount`, `memberFactCount` and `silentItselfButNotItsMembers` tell the two apart. Absence is a property of the store: it is declared only when neither the copies nor their direct members hold a stored row. A row that exists but cannot name a language pair is NOT absence — it is counted in `unpairableRowCount` and named in `pairlessRowNote`, while `storedRowCount` still reports it. Rows on descendants at depth 2 or deeper are counted in `deeperDescendantRowCount` (both directions) and deliberately not cascaded. Counts name what they count: `factCount` facts in this answer, `pairCount` DISTINCT language pairs, `signatureCount` distinct (pair, direction, bridge, tier); `memberCount` is the distinct members that contributed BEFORE the limit while `memberFactCount` is what was shown, and `ownFactsTruncated`/`memberFactsTruncated` say which section a limit cut. The answer is bounded by `limit` (default 200, max 1000) with `truncated` and `totalCountIfKnown` declared, and the copy list has its own declared cap. This tool never infers, guesses, or aspires. Same source and laws as the editor's cross-language hover section.

## Contract

- Category: `graph`
- Mutability: `read`
- Requires index: `true`
- Modes: `cross-language`
- Planned modes (roadmap, not executable): (none)
- Defaults: `{"limit":200}`

## Input Schema

```json
{
  "type": "object",
  "properties": {
    "symbol": {
      "type": "string",
      "description": "symbol name to fetch cross-language facts for (`target`/`symbolName`/`query` are accepted as aliases)"
    },
    "limit": {
      "type": "number",
      "description": "max facts to return (default 200, max 1000); truncation is declared, never silent. Refused below 1 or above 1000 rather than clamped",
      "default": 200,
      "minimum": 1,
      "maximum": 1000
    }
  },
  "required": [
    "symbol"
  ]
}
```

## Returns

- One fact per stored cross-language row about the name. `facts` holds the rows on the copies themselves; `memberFacts` holds the rows on their MEMBERS. Every fact names both ends — `self` (symbol, file, language, line) and `other` — plus the stored `rowId`, direction, bridge, evidence tier and confidence. **The fact-shape invariant:** `self` is the endpoint the STORED ROW NAMES (the copy for `match: "exact"`, the member for `match: "owner-cascade"`), so `pair` is always exactly `self.language → other.language` and any consumer can re-derive it. A member fact also carries `owner` — the copy of the asked name it was attributed through — and `matchedMember`/`matchedMemberId`, which are the member end and its stored id (a mirror of `self`, kept so either name reads the same)
- `copies`: every indexed symbol carrying the name, with file, language, line and cross-row count, plus `ambiguous` and `ambiguityNote`. `limit` governs FACTS; the copy list has its own cap — `copiesCap`, with `copiesTruncated` and a `copiesNote` when it bites. `copyCount` is always the TRUE total from its own query, never the length of a capped array, so `ambiguous` cannot be silenced by the cap
- Counts name what they count: `factCount` is the number of facts in this answer; `pairCount` is the number of DISTINCT language pairs in it (`"java → kotlin"` is one pair however many rows carry it); `signatureCount` is the number of distinct (pair, direction, bridge, tier) signatures; `totalCountIfKnown` is the number of facts that exist before the limit. `ownFactCount` and `memberFactCount` are the facts shown per section, and `ownFactsTruncated` / `memberFactsTruncated` say which section the budget cut. `memberCount` is the distinct members that contributed a member fact BEFORE the limit, so it can exceed `memberFactCount`
- Declared absence is a property of the STORE, not of the emitted facts: `declaredAbsent` is true only when neither the copies nor their direct members hold a stored cross-language row, and `absenceNote` says so — scoped to the project, because that is what the row queries searched. A row that exists but cannot name a language pair is NOT absence: it is counted in `unpairableRowCount`, the empty fact set is explained in `pairlessRowNote`, and `storedRowCount` still reports it
- `deeperDescendantRowCount` counts stored cross-language rows on descendants at depth 2 or deeper, BOTH directions, and does not cascade them into the facts (a descendant's edges are the descendant's). When the owner itself is silent but such rows exist, the absence note names the count instead of claiming the index holds nothing
- Declared truncation: `truncated`, `truncationReason` and `totalCountIfKnown` when the `limit` bounded the facts. `collapsedRowCount` counts a row matched from both directions and emitted once; a row that is counted there is never emitted twice

## Examples

`{"symbol":"Warehouse"}`

`{"symbol":"Iterate"}`

`{"symbol":"invoke","limit":50}`

## Errors

- Missing or blank symbol (refused, not defaulted)
- Symbol not found in the index — a declared error, not an empty set
- limit outside the declared 1..1000 range, a fractional limit, or a non-number limit — refused, never clamped silently

## Limitations

- THE MEMBER CASCADE IS ONE LEVEL DEEP. A member's rows are reported as the member's, with the owner named; a grandchild's rows are counted in `deeperDescendantRowCount` and deliberately not emitted as the owner's or the member's. Ask about the descendant directly to see them
- Stored rows only. Nothing here infers an edge, a bridge mechanism or a tier. Every fact traces to a `brain_relationship` row with `is_cross_language = 1`, filtered by the ROW's own project id in this tool and in the editor's cross-language hover section, so a row minted for another project cannot appear as a fact about this one
- The absence note is scoped to ONE PROJECT: the same name indexed in another project may hold rows for it, and `absenceNote` says which store it searched rather than claiming anything about the whole index
- `bridge` is stored data, not an inference about communication. On indexed corpora almost every row carries the indexer's name-resolution placeholder, so a bridge value names how the row was minted, not a verified interop mechanism. A row with no stored mechanism renders a fixed `unnamed bridge` text rather than an invented one
- A name held by many symbols is answered as the UNION over all of them; every fact names the copy it came from, so an agent can narrow, but the tool never chooses one copy on the agent's behalf and does not resolve which copy a human means
- Rows that cannot name a pair are counted, not dropped: an endpoint whose file has no detected language, or two endpoint languages that are equal, produces no fact and increments `unpairableRowCount`. No shipped corpus reaches that state today, so it is verified by seeding the state rather than assumed — and a row that exists but cannot name a pair is reported as `pairlessRowNote`, never as absence
- `memberCount` describes the whole answer, while `memberFactCount` describes what the limit showed. When the two differ, `memberFactsTruncated` is true and `truncationReason` names the budget
- Tier classification is a stored-vs-derived contract: when the indexer stored `metadata.evidenceClass` the stored class is rendered; otherwise the derived rule in `src/lsp/evidence_tier.ts` is used. `confidence` is the stored row confidence and is rendered beside the tier, never instead of it

## Performance

Measured with `validation/tools/bb_cross_language/work/latency.mts` (warm, five runs, p50/p95, machine load recorded) and `work/latency-t2-handler.mts` on a COPY of the 6,452-file reference index (6452 files, 310,423 symbols, 820,040 relationships). Tiny fixture (5 files, 5 stored cross-language rows): p50 8.3 ms / p95 8.6 ms. Synthetic 97-file single-language repository (the absence path): p50 38.9 ms / p95 59.7 ms. Reference index, handler against the copy, default arguments: `Command` p50 7.6 ms / p95 7.8 ms; `file` (3,457 copies) p50 112 ms / p95 169 ms; `type` (5,392 copies) p50 278 ms / p95 328 ms — 15x inside the 5 s ceiling. The two by-name statements and the depth>=2 count are index-driven on purpose: written naively they scanned the project's 820,040 relationship rows (measured 3.8–17.6 s per statement, p50 3.3–6.5 s per call, one sample at 33.6 s). Forcing the walking order to start at the symbol-name index and at the recursive descendant table — with every predicate preserved, proved row-set identical on a 692-file corpus with 714 stored rows — took one name from 14,641 ms to 26 ms and the depth count from 1.4–1.7 s to 5–36 ms. Both the pre-fix and post-fix rounds stay in `LATENCY.json` as the regression baseline.

## Safety

Read-only. It does not modify source files or index data.

## Evidence Semantics

Only `brain_relationship` rows with `is_cross_language = 1`, filtered by the ROW's own project id — in both this tool and the editor cross-language hover section — and by nothing else: no graph walk, no lexical id-prefix cascade, no inferred pair. Every fact carries the stored row id and both ends, so a reader can re-check it against the store without trusting the tool. Tiers are delegated to the single classifier in `src/lsp/evidence_tier.ts` over the declared derivation, so the same stored row cannot render two different tiers on two surfaces. Member rows follow the store's `owner_symbol_id` ownership edge, while `bb_graph`'s cascade is a lexical id-prefix range, so the two counts differ by design; the answer states which rule it used rather than reconciling the numbers. Cross-checked on a 692-file, 8-language corpus with 714 stored cross-language rows (403 checks, 16 planted defects all caught), against seeded store states no corpus reaches (43 seeded checks, 8 planted defects including a ROW-LEVEL project-predicate leak, each caught by a probe proved false on the unmutated code), and against the editor's hover projection (21 checks, 5 planted defects; both surfaces read the same owner module). See validation/m63/results/CL1.json, validation/tools/bb_cross_language/results/GATE.json and validation/m26/results/W3.json.

## Relationship to other tools

For same-language callers/callees use `bb_graph`; this tool reports stored cross-language pairs and bridges (declared absent when none).

## Deep guides

- [Cross-language facts: what is stored and what is not](../BB_CROSS_LANGUAGE.md)

## Staleness

This tool does not report per-file index staleness and does not auto-refresh. Output reflects the index as of the last index run; when files changed after indexing, refresh first: run: bb index --changed (or the bb_index tool with the project path — incremental, changed files only).

This page is generated from the executable registry and curated documentation. Run `npm run docs:generate` to update it, or `npx tsx script/verify-tool-docs.ts --only <tool> --write` for a single page.

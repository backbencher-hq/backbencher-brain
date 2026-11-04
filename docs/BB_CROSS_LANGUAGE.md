<!--
Author: Muhammad Ishaq Khan

WHAT THIS DOCUMENT IS — the hand-written guide to bb_cross_language: exactly which
  stored rows become facts, how member facts are attributed, what "declared
  absent" means, and the bounds a caller must read before trusting a quiet answer.
WHO IT IS FOR — anyone reading polyglot interop facts, and the gates that hold this
  page to the registry and the stored-row contract.
EDIT TOGETHER WHEN THIS CHANGES — src/mcp/tools/bb_cross_language/descriptor.ts,
  src/mcp/tools/bb_cross_language/handler.ts, src/lsp/cross_language.ts,
  src/ast/cross-language.ts, and the tool's curation file.
-->

# Cross-language facts — stored rows, never inferences

`bb_cross_language` reports the cross-language relationship facts the indexer
stored for a name. Nothing here is inferred at read time: every emitted fact names
a `brain_relationship` row with `is_cross_language = 1`, filtered by the row's own
project id. The tool does not guess an edge, a bridge mechanism or a tier.

## Parameters

| Parameter | Type | Meaning |
| --- | --- | --- |
| `symbol` | string (required) | Symbol name to fetch facts for. `target`, `symbolName` and `query` are accepted spellings of the same option. |
| `limit` | number | Maximum facts returned (default 200, max 1000). Out-of-range, fractional or non-number values are refused, never clamped. `limit` governs FACTS; the per-name copy list has its own declared cap. |

## What an answer declares

- **`facts`** — the stored rows on the copies of the asked name. **`memberFacts`** —
  the rows on those copies' direct members. Every fact names both ends (`self` and
  `other`) with symbol, file, language and line, plus `rowId`, direction, bridge,
  evidence tier and confidence. The fact-shape invariant: `self` is the endpoint
  the STORED ROW names, so `pair` is always exactly `self.language → other.language`
  and a consumer can re-derive it. A member fact also carries `owner` (the copy it
  was attributed through) and `matchedMember`/`matchedMemberId`.
- **`copies`** — every indexed symbol carrying the name, with file, language, line
  and cross-row count, plus `ambiguous` and `ambiguityNote`. `copyCount` is always
  the TRUE total from its own query, never the length of a capped array, so
  ambiguity cannot be silenced by the copy cap.
- **Counts that name what they count**: `factCount` facts in this answer;
  `pairCount` distinct language pairs (`"java → kotlin"` is one pair however many
  rows carry it); `signatureCount` distinct (pair, direction, bridge, tier)
  signatures; `totalCountIfKnown` facts before the limit; `ownFactCount` /
  `memberFactCount` facts shown per section; `ownFactsTruncated` /
  `memberFactsTruncated` say which section the budget cut. `memberCount` is the
  distinct members that contributed a member fact BEFORE the limit, so it can
  exceed `memberFactCount`.
- **Declared absence** is a property of the STORE, not of the emitted facts:
  `declaredAbsent` is true only when neither the copies nor their direct members
  hold a stored cross-language row, and `absenceNote` names the store it searched.
  A row that exists but cannot name a language pair is NOT absence: it is counted
  in `unpairableRowCount`, the empty fact set is explained in `pairlessRowNote`,
  and `storedRowCount` still reports it.
- **Depth boundary**: `deeperDescendantRowCount` counts stored cross-language rows
  on descendants at depth 2 or deeper, in BOTH directions, and deliberately does
  not emit them as the owner's or the member's facts.
- **Truncation**: `truncated`, `truncationReason` and `totalCountIfKnown` when the
  limit bounded the facts; `collapsedRowCount` counts a row matched from both
  directions and emitted once.

## The member cascade, and where it stops

The member cascade is ONE LEVEL DEEP. A member's rows are reported as the
member's, with the owner named; a grandchild's rows are counted in
`deeperDescendantRowCount` and not cascaded. Ask about the descendant directly to
see them. `ownFactCount` and `memberFactCount` keep the two sections distinct, so
a member's edge is never absorbed into the symbol's count.

## What this tool deliberately does not do

- It does not infer a bridge. `bridge` is stored data; on indexed corpora almost
  every row carries the indexer's name-resolution placeholder, so a bridge value
  names how the row was minted, not a verified interop mechanism. A row with no
  stored mechanism renders a fixed "unnamed bridge" text rather than an invented
  one.
- It does not choose a copy for the caller. A name held by many symbols is
  answered as the UNION over all of them; every fact names the copy it came from,
  so an agent can narrow, but the tool never picks one on the agent's behalf.
- It does not compare languages: `pair` is derived from the two endpoint
  languages, and rows whose endpoints are equal or whose file has no detected
  language are counted as unpairable rather than emitted as facts.
- It does not turn absence into a project-wide claim: the absence note is scoped
  to one project, and the same name in another project may hold rows for it.

## Refusals

- Missing or blank symbol — refused, not defaulted.
- A symbol not found in the index — a declared error, not an empty set.
- `limit` outside 1..1000, fractional, or non-number — refused with the rule named.

## Measured cost

Warm five-run p50/p95 on the declared tiers (raw runs in
`validation/tools/bb_cross_language/LATENCY.json`): tiny fixture 8.3 / 8.6 ms;
synthetic 97-file single-language repository (the absence path) 38.9 / 59.7 ms;
reference index, default arguments: 7.6 / 7.8 ms for a single-copy name,
112 / 169 ms for a name with 3,457 copies and 278 / 328 ms for 5,392 copies.
The by-name statements and the depth count are index-driven on purpose; a naive
form scanned the project's 820,040 relationship rows and took seconds per
statement. The fixture-tier numbers are the regression baseline.

## Verifying this page

```bash
npx tsx script/verify-tool-docs.ts --only bb_cross_language
bun run script/m20/verify-cross-tool-parity.ts
bun run script/m65/verify-edge-kind-scoping.ts
```

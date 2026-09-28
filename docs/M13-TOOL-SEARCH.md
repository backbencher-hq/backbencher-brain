# Tool Milestone 1 — `bb_search`

Status: **verified within the declared retrieval contract**

This is the first milestone in the tool-first trust rebuild. It does not claim
that the analyzers, other tools, or the complete intelligence system are
finished. Search can only be as complete as the indexed AST facts it receives;
an analyzer omission remains an omission in search and is not silently repaired.

## Contract fixed

The public `bb_search` surface has four modes:

- `symbols` — indexed symbol-name retrieval with exact, prefix, and substring
  ranking.
- `content` — indexed symbol/documentation-corpus retrieval using FTS5 BM25
  when available and a weighted lexical fallback otherwise.
- `symbol` — exact indexed symbol lookup through the AST/database identity path.
- `file` — current source retrieval for one indexed project-relative file.

The `regex: true` option remains the public compatibility route to regex symbol
search. Empty queries are rejected for symbols/content/regex. File mode requires
`filePath`; the path is canonicalized and confined to the project root.

## Defects corrected

1. Empty public symbol queries previously returned arbitrary symbols because the
   handler converted an absent/empty query into a broad database search.
2. File mode previously ran symbol search and filtered the resulting symbol rows
   by path. It did not return file source despite the documented file-retrieval
   contract.
3. File mode had no explicit project-root traversal protection in the public
   read path.
4. The MCP/CLI boundary did not have dedicated tests for these semantics.

File mode now returns a JSON envelope containing:

- `searchMode`, project-relative `file`, indexed `fileId`, and `language`;
- current `content` with a hard 100,000-character bound;
- `contentLength` and `truncated`;
- `stale`, computed by comparing current bytes with the indexed file hash.

## Verification evidence

Machine-readable evidence:

- `validation/m13/results/search.json`

Focused script:

```bash
bun script/verify-search-modes.ts
```

The script verifies engine and public-boundary behavior:

- exact, prefix, substring, duplicate disambiguation, and pagination;
- regex match, non-match, invalid-pattern, and compatibility routing;
- content/FTS retrieval and mode metadata;
- language and symbol-kind filters;
- empty-query and mode-specific validation;
- public file-source envelope and freshness metadata;
- project-root traversal rejection.

Transport checks:

- `bun script/verify-cli-surface.ts` tests the compiled Node CLI.
- `bun script/verify-mcp.ts` tests a real MCP stdio session.

The verified run passed all focused checks. `npm run typecheck`, `npm run build`,
and `npm run docs:verify` also passed.

## Explicit limitations

- Search does not prove that an analyzer found every valid symbol or relationship.
- Content mode searches indexed symbol names, qualified names, and docstrings,
  not arbitrary raw-file text.
- Regex mode is intentionally a symbol-name scan with a bounded candidate cap.
- File mode requires the file to be indexed; it reports stale source rather than
  pretending that stale indexed symbols are current.
- This milestone does not fix `bb_ask`, `bb_health`, `bb_patterns`,
  `bb_security`, `bb_visualize`, `bb_migrate`, `bb_analyze`, `bb_doc`, or
  `bb_edit`.
- The broader duplicate-contract drift remains an open system-level issue and
  must be resolved in the contract/governance portion of the tool milestones.

## Evidence standard

This milestone is called verified only for the behaviors listed above, against
both direct engine tests and real CLI/MCP boundaries. It is not a declaration of
system-wide completion, analyzer perfection, or universal language correctness.

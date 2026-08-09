# Architecture

Backbencher Brain separates indexed evidence, intelligence engines, and delivery
adapters so MCP, CLI, and library consumers share behavior.

## Layers

1. `src/ast/` parses supported languages and extracts symbols, imports, calls,
   complexity, framework evidence, and security-flow inputs.
2. `src/storage/` persists canonical `brain_*` tables in a project-specific
   SQLite database. Semantic vectors are tagged by model and dimension.
3. `src/intelligence/` owns strict search, semantic, graph, analysis, pattern,
   security, testing, documentation, visualization, migration, edit, and health
   engines. Internal engines are implementation details, not additional public tools.
4. `src/mcp/tool-registry.ts` defines the public contracts. Shared handlers route
   both MCP and `bb tool` CLI calls to the intelligence engines.
5. `src/mcp/server.ts` advertises exactly the ten public tools and validates
   arguments before dispatch. The `0.3.0` breaking release removed all hidden aliases.

## Evidence

Indexed source locations and relationships are primary evidence. Semantic matches
discover candidates but do not prove claims. Static analysis findings carry
confidence and limitations. Stale evidence is reported rather than silently
refreshed. `bb_doc` preserves extracted, inferred, generated, and unknown states.

## Mutation

`bb_edit` is the only advertised mutation surface. It confines paths to the project,
rejects stale symbol bounds, protects referenced deletions, writes atomically,
validates syntax, rolls back failures, formats affected files, and reindexes changes.
Read-only tools never modify source; explicit health refresh changes index data only.

## Documentation Contract

`docs/data/public-tools.json` is the standalone website-ready artifact. It combines
executable registry schemas/defaults/examples with curated return, error, limitation,
performance, safety, and evidence guidance. `docs/tools/` contains generated human
references. `npm run docs:verify` fails on drift, and both artifact sets are included
in the published package without requiring consumers to import server runtime code.

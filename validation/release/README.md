<!--
Author: Muhammad Ishaq Khan

WHAT THIS DIRECTORY IS — the release battery for the 16 public backbencher-brain
MCP tools: a REAL multi-language corpus (copied from real open-source repositories,
not fixtures) indexed into an isolated data dir, then every tool exercised against
it. It answers the release question "do the tools work on real code in real
languages" with commands and numbers instead of a claim.

WHAT LIVES HERE — `workspace/` (gitignored: the corpus copies), `data/`
(gitignored: the isolated index), `raw/*.out|*.err` (the captured outputs of the
recorded calls), `REAL-CORPUS-SEED.json` (the machine-readable record: index
population, per-tool invocation, output size, parsed summary).

HOW TO REBUILD (from the repository root):
  # 1. workspace: copy real corpora (JS/TS + Ruby + Erlang)
  #    graphql-js/src, rake/lib, rebar3/apps from /home/ishaq2321/bb_tests/repositories
  # 2. index it in isolation (never the shared .bb-data or ~/.bb)
  HOME=$PWD/.tmp-rel-home BB_DATA_DIR=$PWD/validation/release/data \
    npx tsx src/cli/index.ts index "$PWD/validation/release/workspace"
  # 3. run a tool through the same handlers the MCP door uses
  HOME=$PWD/.tmp-rel-home BB_DATA_DIR=$PWD/validation/release/data \
    npx tsx src/cli/index.ts tool bb_graph \
      --dir "$PWD/validation/release/workspace" \
      --args '{"symbol":"GraphQLSchema","maxDepth":2,"maxEdges":50}'

CURRENT SEED (see REAL-CORPUS-SEED.json for the exact record and timestamp):
  corpus 622 indexed files / 173,217 lines / 13,386 symbols / 73,073 relationships,
  languages TypeScript, JavaScript, Ruby, Erlang.
  all 12 read tools answered with rc=0 through the CLI tool door: bb_health,
  bb_search, bb_graph, bb_impact, bb_analyze, bb_patterns, bb_security,
  bb_cross_language, bb_ask, bb_visualize, bb_migrate, bb_doc.

WHY IT IS SEPARATE FROM LANE EVIDENCE — each lane proves its own tool against
fixtures and its own real-corpus leg under `validation/tools/<tool>/`; this battery
is the ONE place where all sixteen tools meet the SAME real index, so cross-tool
behaviour (shared store, shared handlers, shared read-only boundary) is exercised
end to end. It is refreshed at release integration on the settled tree.

EDIT TOGETHER WHEN THIS CHANGES — docs/tools-campaign/CHARTER.md (release
definition-of-done), validation/tools/*/REAL-CORPUS.json (per-lane legs).
-->

# Release battery — real-corpus seed

Purpose, reproduction commands and the current measured population are in the
header comment above. The machine-readable record is
[`REAL-CORPUS-SEED.json`](REAL-CORPUS-SEED.json); the captured outputs are in
`raw/`.

Rules this battery follows:

1. **Real code only.** The workspace is copied from real repositories under
   `/home/ishaq2321/bb_tests/repositories`; nothing here is a fixture.
2. **Isolated data.** `HOME` and `BB_DATA_DIR` are redirected under
   `validation/release/`, so the shared `.bb-data` / `~/.bb` indexes are never
   opened for write by this battery.
3. **The shipped door.** Calls go through the same handler map the MCP server
   uses (`bb tool`), so a green battery is a statement about the product, not
   about a test harness.
4. **Refreshed on the settled tree.** This seed is captured while the campaign is
   still landing Phase B changes; the release integration pass re-runs it and
   replaces the seed. A stale seed is visible by its `generatedAt`/`head` fields.

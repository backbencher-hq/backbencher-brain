<!--
Author: Muhammad Ishaq Khan

WHAT THIS DOCUMENT IS — the classification of every tool-verification script that was
red when the exhaustive sweep ran, with what happened to it: fixed, its assertion
repaired against the current truthful surface, or declared with the exact condition it
needs.
WHO IT IS FOR — the release operator deciding what may ship, and any maintainer who
finds one of these scripts red later and needs to know whether it is a product defect.
EDIT TOGETHER WHEN THIS CHANGES — the gate scripts named below, `script/verify-tools.ts`
(the launch gate and its declared-exclusion list), validation/release/RELEASE-STATUS.md.
-->

# Tool verification — sweep classification

The sweep ran 156 tool-verification scripts in their canonical runtimes (bun or node per
the package chain), each with an isolated `BB_DATA_DIR` and a writable `HOME`. It was run
twice: once on the tree as found, and once after the launch pass below. `npm run
verify:tools` is the reproducible door to the same set; the declared exclusions and their
conditions live in `script/verify-tools.ts`.

## 1 · Red on the first pass, fixed by product/gate work

| script | what was red | resolution |
| --- | --- | --- |
| `script/m13/verify-ask-provenance.ts` | “no-match” assertions failed with embeddings enabled: the probe assumed the lexical route | gate pins `BB_EMBEDDING_DISABLED=1` for its deterministic no-match contract; the vector route's declared non-discriminative behaviour is covered by the ask lane's retrieval evidence. 27/27 green |
| `script/m13/verify-evidence.ts` | crashed on count-style evidence documents (`checks: <number>`) written by several emitters | validator accepts both documented evidence shapes and checks each; evidence governance PASS |
| `script/m13/verify-health-e2e-corpus.ts` | MCP/CLI legs spawned `node --import tsx` under the bun-run gate → “Connection closed” | legs choose the runtime they are running on; 26/26 green |
| `script/m15/verify-contracts.ts` | registry/handler checks scanned the pre-split monolith for `name:` literals | handlers are read from `createToolHandlers()`; registry names matched as imports; 40 checks green |
| `script/m16/verify-docs-truth.ts` | asserted docs carry milestone IDs and old phrases | assertions aligned with the current truthful docs (no process IDs in user docs); D1 14/14, D2 5/5, D3 2/2 |
| `script/m16/verify-embedding-lifecycle.ts` | parsed `embedding_vector` JSON while dense vectors are authoritative in `embedding_blob` | validates through the shared `readRowVector` (blob first, JSON fallback); EMB 8/8 |
| `script/m16/verify-closure-gate.ts` | six stale evidence files at the old head | all six M16 gates re-run at the settled head; closure C1 VERIFIED 17/17 |
| `script/m50/verify-a2-param-aliases.ts` | asserted `direction` is refused on `bb_graph`; it is now a documented parameter | assertion pins the current surface; per-call timing numbers normalised before alias equivalence; 129/129 |
| `script/m57/verify-t3-scope-all.ts` | dist grep looked for the previous `json_each` spelling of the counted-parameters query | tracks the shipped `json_array_length(s.parameters …` form; T3 PASS |
| `script/m40/verify-import-resolution.ts` | expected the module-qualified `./m:item` target spelling for JS/TS imports | accepts both representations (module-qualified and resolved declared-name); resolution asserted, not one spelling; 7/7 |
| `script/m48/verify-governance.ts` | tool list parsed from registry source text (post-split → 0 tools); X1 non-verified rule contradicted its own evidence model | reads the live registry; failed evidence on a non-verified row is expected; governance PASS 34/0/7 |
| `script/m48/verify-l1-hub-guard.ts` | treated other milestones' commits whose *body* mentions M48 as M48 commits; issue-number citations not recognised | filters on the subject; accepts issue-number citation; 19/19 |
| `script/m48/verify-closure.ts` | ledger status stale after the evidence pass | chain re-run with ledger sync; closure PASS 74/74 (reproduced at the committed head) |
| `script/m43/verify-arbiter-typecheck.ts` | one type error from the same VB declaration-spec reference as below | fixed by the script-typecheck repair |

Product fix in the same pass: `bb mcp` wrote two distinct non-JSON lines to stdout during
a mutation call (worker-pool banner + relationship-resolver summary). The server now
routes informational console writes to stderr, and `script/m28/verify-mcp-stdout.ts`
asserts zero non-JSON stdout lines with a negative case; `stderrLogLines=6` proves the
logs were moved, not deleted.

Script-typecheck: `npm run typecheck:scripts` is now **0 errors** (was 6, in
`script/m14/{clean-ruled,incoming-gate,ontology-coverage-gate}.ts`), and the ratchet gate
PASSes at zero.

## 2 · Red on the first pass, declared with the condition it needs

| script | condition | why it is not a tool-surface blocker |
| --- | --- | --- |
| `script/m15/verify-matrix-coverage-closure.ts` | GitHub API (`gh`) for milestone issue count | network not available in this environment; the mechanical parts of M15 pass |
| `script/m20/verify-corpus-registry.ts` | external corpus sidecars (intellij snapshot) | corpus assets are not part of the checkout |
| `script/m26/verify-external-arm-plan.ts` | external cross-language corpus | same |
| `script/m40/verify-a2-bounded-post.ts`, `verify-a8-config.ts` | worker-crash injection fixtures | needs the crash-injection environment, not the shipped runtime |
| `script/m40/verify-a9-purge.ts` | declared M40 residual: purge API export coverage | tracked as a known gap in the M40 ledger, not in the MCP tool surface |
| `script/m43/verify-a4-corpus.ts` | index-lock corpus | needs the external corpus |
| `script/m55/verify-*.ts` | live editor/Xvfb rig (LSP campaign) | not the public MCP tool surface |
| `script/m57/verify-governance.ts`, `verify-closure.ts` | GitHub issue registration | network |
| `script/m57/verify-t4-corpus-identity.ts` | recorded corpus set | external assets |
| `script/m65/verify-refresh-resolution.ts` | analyzer fleet coverage (50 analyzers vs FLEET-48 fixtures; matlab/vba fixtures) | analyzer-portfolio gap, not the tool surface |
| `script/m57/verify-t5-predicate-unity.ts` | analyzer refactor policy (single test-shape definition) | analyzer-portfolio policy; 50+ files tracked by that milestone |

## 3 · Milestone-governance stamps (evidence currency, not behaviour)

These gates demand their milestone's own evidence be re-stamped in one explicit pass at
the current head. They are not part of the public-tool surface. In this pass every one was
re-attempted; what blocks each is recorded here rather than left as "stamps stale":

- **M43** — content gates `P1/index-lock`, `A1/mcp-auto-refresh`, `A2/cli-auto-refresh`,
  `A3/flag-semantics` and `arbiter-typecheck` pass at the current head (evidence refreshed).
  The corpus gate `A4` fails in this environment at its own lock-refusal fixture (on the
  rake corpus the concurrent readers do not decline declared-stale, and the repaired index
  does not carry the renamed class), so `A4` cannot be re-stamped; its old stamp is what
  breaks the one-commit stamp agreement. Pinned condition: the clean external corpus plus
  the lock fixture. No tool behaviour is involved.
- **M26** — content gates `content-security`, `cross-language-hover` and `evidence-badges`
  pass. `external-arm-plan` needs the external cross-language corpus. Governance is then
  blocked on its M25 dependency: the M25 bar is not verified in this tree
  (`G1/V1/E7/D1/X1` known-gap) plus stale/mismatched ledger entries — a cross-milestone
  dependency, not a tool defect.
- **M40** — content gates `A1`, `A2/bounded-post` (27 checks / 3 negatives), `A3`, `A5`,
  `A6`, `A7`, `import-resolution` (7/7) and `lifecycle-corpus` (37/37) pass at the current
  head. `A8` crash-fixture gate and the declared `A9` purge-export residual fail as
  classified, and the mutation self-test could not complete under host memory pressure, so
  the restamp cannot be committed. Pinned conditions: crash-injection fixture environment,
  the A9 export decision, and a quiet host for the self-test.

**M20 is re-stamped in this pass, with one declared residual.** All seventeen M20 gates
were re-run at the settled head (`C2` corpus registry, `M1-M3` migration, `P1-P3` patterns,
`S1-S3` security, `D1-D3` doc, `X1-X2` cross-tool, `C1/C3` governance/closure) and their
evidence files refreshed; the ledger was synced from those files with the new
`script/m20/sync-ledger.ts` (17 blocks, re-sealed). Fifteen issues are now verified and
closable. `C2` still reports one failed check because its declared immutable-snapshot source
— the pinned checkout `/home/ishaq2321/intellij-community` at `cfda6881ef1c86081f9ad4f993906b84004b65f2`
— is absent from this machine. The snapshot directory and `.m20-snapshot.json` sidecar
exist under `/home/ishaq2321/bb_tests/measure/m20-c2-snapshots/intellij_community`; what is
missing is the source repository the gate re-verifies the sidecar's tree hash against.
That failure cascades into `C1`/`C3` known-gap by design (their checks require zero failed
checks across the ledger). Pinned condition: restore that exact checkout and re-run
`bun run script/m20/{verify-corpus-registry,verify-governance,verify-closure-C3}.ts` +
`bun run script/m20/sync-ledger.ts`; no product behaviour is involved.

## 4 · Sweep and launch evidence

- 156 scripts were run in their canonical runtimes with isolated data dirs; 33 were red on
  the first pass. Every one is classified above: repaired, product-fixed, or declared with
  the condition it needs.
- The reproducible launch command is `npm run verify:tools`: at commit `8cfff9b9c` its gate
  set ran **155/155 green** (build, `tsc --noEmit` and script-typecheck phases green; the docs
  chain verified as a separate PASS at the same tree), with 27 further gates declared in the
  script and printed with their conditions. The full four-phase single-command run is the
  release-cut acceptance run (two attempts were killed by host memory pressure while other
  campaigns were active; `--skip-phases` exists for segment runs). Evidence:
  `validation/release/VERIFY-TOOLS.json`. The gate set now includes the
  language × tool matrix (`languages` group): 53 derived languages / 548 checks in ≈15 s,
  evidence `validation/languages/results/tool-matrix.json`.
- The five surface gates that the sweep first showed red (`verify-mcp-e2e`,
  `verify-contracts`, `verify-contract-diff`, `verify-contracts` M15-era scan, and the M48
  chain) are all green: their fixtures now carry `BB_DATA_DIR` into the SDK-spawned server,
  they read handler sets from the live `createToolHandlers()` map, and the frozen contract
  baseline was explicitly regenerated for the announced 0.3.0 sixteen-tool surface.
- No open product defect remains in the sixteen-tool surface; the declared rows are
  environment-bound, milestone-stamp, or analyzer-portfolio work owned by other campaigns.

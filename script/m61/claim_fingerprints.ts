// script/m61/claim_fingerprints.ts — the DECLARED COVERAGE of every §8.4
// `sourceFingerprint` in the LSP program, keyed by claim.
//
// The rule itself (what a fingerprint is, and why it is a fold over a declared
// path list rather than a hash of the verifier) lives in
// script/m61/source_fingerprint.ts. THIS file is the other half the rule cannot
// supply on its own: WHICH files each claim's fingerprint covers. The rule says
// how to fold; this says what to fold, and a declaration nobody can audit is not
// a declaration, so every entry below is reviewable in one sitting and the gate
// script/m61/verify-claim-fingerprints.ts re-derives each digest from it.
//
// WHY A TABLE AND NOT A LIST INSIDE EACH VERIFIER: the gate must be able to
// re-derive a record's digest from a declaration it can read. If each verifier
// held its own list, the gate would either trust the verifier (checking nothing)
// or parse the verifier's source (a second, weaker copy of this table). One
// declared table, read by the verifier AND by the gate, is the m61/m62
// projection shape: the ledger and the record cannot disagree about the coverage
// because there is only one place it is written.
//
// THE CONSTRUCTION RULE for every `covers` entry (a claim reaches its component
// three ways and all three are in the list):
//
//   1. the claim's OWN ORACLE first — the `script/<lane>/verify-*.ts` its record
//      names in `verifierCommand`. A digest that omits the oracle would let the
//      harness change and the evidence still read fresh (definition 2, rejected
//      as the definition; see source_fingerprint.ts).
//   2. the COMPONENT under test — every `src/`, `ide/`, `docs/`, `grammars/`,
//      `website/` path the oracle imports or names as a literal, plus the ones
//      it can only reach through a SPAWNED server or a driver script (hand-added;
//      `script/m26/verify-graph-transport.ts` never imports `src/lsp/server.ts`,
//      it spawns it).
//   3. the lane's OWN FIXTURES and probes — the `script/<lane>/*.ts` modules the
//      oracle imports. For m26.W1/W6 and m29.R1 the fixture IS the component
//      (the ONE renderer core, the webview shell, the wave protocol), which is
//      why "no non-script subject" is not a defect by itself.
//
// TWO DECLARED EXCLUSIONS, stated because an exclusion nobody can see is a
// silent narrowing of every fingerprint in the file:
//
//   `script/lib/evidence.ts`  the shared write path (seal + atomic write). It is
//       in almost every gate, so covering it would make all 69 claims stale the
//       moment anyone edits one infrastructure file, and a fingerprint nobody can
//       keep current is one everybody learns to ignore. Its integrity is
//       m61's own subject matter: script/m61/verify-sealing.ts (V1).
//   `validation/**`           other lanes' RECORDS. Every record carries
//       declared-volatile fields (`generatedAt`, `bbSeal.sealedAt`,
//       `currentCommit` — script/m61/reproducibility-sample.json), so a digest
//       that covered one would change on every re-run and §8.2's
//       byte-identical-regeneration demand would become unsatisfiable by
//       construction. A closure gate's real inputs are the sibling GATES and the
//       DOCS (m24.X1, m26.X1, m29.X1, m62.X1 all list those), not the records
//       the sibling gates re-write.
//
// THE `unFingerprintable` ENTRIES are claims that CANNOT carry a discriminating
// fingerprint, declared here with the reason instead of given a decorative value.
// Every one of them is a record the repository ALREADY classifies as an ARTIFACT
// in script/m61/gate-registry.json `declaredArtifactRecords` — measurement data
// or bookkeeping, produced by a runner or a compiler, with no check list and no
// can-fail suite behind it. A fingerprint over such a record would attest to a
// measurement that never ran. (Two of them were missing from that registry and
// are added there by the same change: `validation/m29/results/wave-java.json`
// and `validation/m44/results/KNOWN-GAPS.json`, whose m42 twin already carried
// the declaration. The undeclared pair was a real hole: 30 records were declared
// artifacts and their 31st and 32nd siblings were not.)

import { type Coverage } from "./source_fingerprint.ts"

export type ClaimDeclaration = { covers: Coverage } | { unFingerprintable: string; covers?: Coverage }

/** The lanes whose claims this program OWNS the fingerprints for: the LSP/IDE
 *  program scope (contract §0 plus the amendments that name their own lanes) and
 *  the governance lanes whose records this fix converts. Every OTHER lane's
 *  claims are censused and DECLARED out of scope by
 *  script/m61/verify-claim-fingerprints.ts — counted, never passed. */
export const IN_SCOPE_LANES = ["m24", "m26", "m27", "m28", "m29", "m42", "m44", "m55", "m62"] as const

/**
 * The declaration. `covers` is ORDERED and the order is part of the digest
 * (the rule folds paths in sequence), so a list is never re-sorted at hash time:
 * oracle, then component, then fixture — the order a reader thinks in.
 */
export const CLAIM_COVERAGE: Readonly<Record<string, ClaimDeclaration>> = {
  "m24.CALLSITE-AGREEMENT": { covers: ["script/m24/verify-callsite-agreement.ts", "src/intelligence/graph/line-address.ts", "src/lsp/navigation.ts", "src/lsp/positions.ts", "src/lsp/relations.ts", "script/m24/portability.ts"] },
  "m24.D1": { covers: ["script/m24/verify-docs.ts", "docs/m24/M24-MASTER-PLAN.md"] },
  "m24.L1": { covers: ["script/m24/verify-server.ts", "src/lsp/server.ts", "script/m24/mutant-anchor-gate.ts"] },
  "m24.L2": { covers: ["script/m24/verify-hover.ts", "src/lsp/hover.ts", "src/lsp/launch_languages.ts", "script/m24/mutant-anchor-gate.ts"] },
  "m24.L3": { covers: ["script/m24/verify-navigation.ts", "src/lsp/navigation.ts", "script/m24/no-inline-position-arithmetic.ts"] },
  "m24.L4": { covers: ["script/m24/verify-symbols.ts", "src/brain/freshness.ts", "src/lsp/call_hierarchy.ts", "src/lsp/symbols.ts", "script/m24/position-inline-gate.ts"] },
  "m24.L5": { covers: ["script/m24/verify-call-hierarchy.ts", "src/brain/freshness.ts", "src/lsp/call_hierarchy.ts", "src/lsp/symbols.ts", "script/m24/position-inline-gate.ts"] },
  "m24.P1": { covers: ["script/m24/verify-positions.ts", "src/lsp/positions.ts", "script/m24/portability.ts", "script/m24/verify-hover.ts"] },
  "m24.P2": { covers: ["script/m24/verify-freshness.ts", "src/brain/freshness.ts", "src/lsp/freshness.ts", "script/m24/portability.ts"] },
  "m24.POSITION-OWNERSHIP": { covers: ["script/m24/verify-position-arithmetic.ts", "src/lsp/navigation.ts", "script/m24/no-inline-position-arithmetic.ts"] },
  "m24.V1": { covers: ["script/m24/verify-harness.ts", "src/lsp/server.ts", "script/m24/lsp_harness.ts"] },
  "m24.X1": { covers: ["script/m24/verify-closure.ts", "docs/m24/TOOL-DOC.md", "script/m24/verify-call-hierarchy.ts", "script/m24/verify-docs.ts", "script/m24/verify-freshness.ts", "script/m24/verify-harness.ts", "script/m24/verify-hover.ts", "script/m24/verify-navigation.ts", "script/m24/verify-positions.ts", "script/m24/verify-server.ts", "script/m24/verify-symbols.ts"] },
  "m26.A1": { covers: ["script/m26/verify-polyglot-e2e.ts", "src/ast/parallel-indexer.ts", "src/cli/index.ts", "src/lsp/cross_language_hover.ts"] },
  "m26.D1": { covers: ["script/m26/verify-graph-docs.ts", "docs/m26/GRAPH.md", "src/lsp/graph_request.ts", "src/lsp/impact.ts", "script/m26/ambient-reality.ts", "script/m26/graph-core.ts"] },
  "m26.V1": { covers: ["script/m26/verify-webview-harness.ts", "script/m26/graph-core.ts", "script/m26/webview-harness.ts"] },
  "m26.W1": { covers: ["script/m26/verify-webview-core.ts", "script/m26/graph-core.ts"] },
  "m26.W2": { covers: ["script/m26/verify-graph-transport.ts", "src/lsp/graph_request.ts", "src/lsp/server.ts"] },
  "m26.W3": { covers: ["script/m26/verify-cross-language-hover.ts", "src/lsp/cross_language_hover.ts", "script/m26/ambient-reality.ts"] },
  "m26.W3-pairs": { covers: ["script/m26/verify-cross-language-hover.ts", "src/lsp/cross_language_hover.ts", "script/m26/ambient-reality.ts"] },
  "m26.W4": { covers: ["script/m26/verify-evidence-badges.ts", "src/lsp/evidence_tier.ts", "src/lsp/hover.ts", "script/m26/graph-core.ts"] },
  "m26.W5": { covers: ["script/m26/verify-impact-mode.ts", "src/lsp/impact.ts"] },
  "m26.W6": { covers: ["script/m26/verify-content-security.ts", "script/m26/webview-html.ts"] },
  "m26.X1": { covers: ["script/m26/verify-closure.ts", "docs/m26/GRAPH-TRANSPORT.md", "docs/m26/GRAPH.md", "ide/vscode/src/extension.ts", "script/m25/run-fork-e2e.mts", "script/m26/verify-content-security.ts", "script/m26/verify-cross-language-hover.ts", "script/m26/verify-evidence-badges.ts", "script/m26/verify-graph-docs.ts", "script/m26/verify-graph-transport.ts", "script/m26/verify-impact-mode.ts", "script/m26/verify-webview-core.ts", "script/m26/verify-webview-harness.ts"] },
  "m27.H1": { covers: ["script/m27/verify-helix.ts", "src/lsp/server.ts", "script/m24/lsp_harness.ts", "script/m27/server-caps.ts"] },
  "m27.J1": { covers: ["script/m27/verify-lsp4ij.ts", "src/lsp/server.ts", "script/m24/lsp_harness.ts", "script/m27/server-caps.ts"] },
  "m27.N1": { covers: ["script/m27/verify-nvim.ts", "src/lsp/server.ts", "script/m27/nvim-driver.lua"] },
  "m27.V1": { covers: ["script/m27/verify-matrix.ts", "docs/m27/FORK-CAPABILITY-MATRIX.md", "src/lsp/server.ts"] },
  "m27.Z1": { covers: ["script/m27/verify-zed.ts", "src/lsp/server.ts", "script/m24/lsp_harness.ts", "script/m27/server-caps.ts"] },
  "m28.A1": { covers: ["script/m28/verify-annotation-store.ts", "src/brain/database.ts", "src/brain/schema-ddl.ts", "src/mcp/tool-handlers.ts"] },
  "m28.A2": { covers: ["script/m28/verify-annotation-ui.ts", "src/lsp/annotation_ui.ts", "src/lsp/graph_request.ts", "src/lsp/hover.ts"] },
  "m28.T1": { covers: ["script/m28/verify-mcp-tools.ts", "src/mcp/tool-handlers.ts", "src/mcp/tool-registry.ts"] },
  "m28.U1": { covers: ["script/m28/verify-union.ts", "src/intelligence/graph/graph-engine.ts", "src/lsp/cross_language_hover.ts", "src/lsp/hover.ts", "src/lsp/impact.ts", "src/mcp/tool-handlers.ts"] },
  "m28.U2": { covers: ["script/m28/verify-surface-parity.ts", "src/intelligence/documentation/doc-engine.ts", "src/lsp/cross_language_hover.ts", "src/lsp/evidence_tier.ts", "src/lsp/identity.ts", "src/lsp/signature.ts", "src/mcp/tool-handlers.ts"] },
  "m28.V1": { covers: ["script/m28/verify-mcp-surface.ts", "docs/m28/MCP-SURFACE.md", "src/mcp/tool-registry.ts"] },
  "m29.D1-verify": { covers: ["script/m29/verify-m29-docs.ts", "docs/m29/PRECISION-LEDGER.md", "docs/m29/WAVE-PROTOCOL.md", "ide/vscode/README.md", "script/m29/generate-precision-ledger.ts", "script/m29/generate-wave-doc.ts"] },
  "m29.R1": { covers: ["script/m29/verify-wave-protocol.ts", "script/m29/generate-wave-doc.ts", "script/m29/wave-protocol.ts"] },
  "m29.R2": { covers: ["script/m29/verify-wave-execution.ts", "src/ast/real-java-analyzer.ts", "script/m29/wave-editor-driver.lua", "script/m29/wave-execute.ts", "script/m29/wave-protocol.ts"] },
  "m29.R3": { unFingerprintable: "DECLARED ARTIFACT in script/m61/gate-registry.json — latency measurement output produced by the declared runner script/m29/giant-repo-budget.ts; the VERDICT record is R3-verify.json" },
  "m29.R3-verify": { covers: ["script/m29/verify-giant-repo.ts", "src/brain/brain.sql.ts", "src/brain/schema-ddl.ts", "src/lsp/cross_language_hover.ts", "src/lsp/hover.ts", "script/m25/feature-assertions.ts", "script/m29/giant-repo-budget.ts"] },
  "m29.R4-verify": { covers: ["script/m29/verify-precision-ledger.ts", "docs/m29/PRECISION-LEDGER.md", "ide/vscode/README.md", "script/m29/generate-precision-ledger.ts", "script/m29/wave-protocol.ts"] },
  "m29.R5-verify": { covers: ["script/m29/verify-precision-improvements.ts", "src/lsp/evidence_tier.ts", "src/lsp/hover.ts", "script/m29/r5-tier-fixture.ts"] },
  "m29.V1-verify": { covers: ["script/m29/verify-wave-harness.ts", "docs/m29/PRECISION-LEDGER.md", "script/m29/verify-giant-repo.ts", "script/m29/verify-precision-improvements.ts", "script/m29/verify-precision-ledger.ts", "script/m29/verify-wave-protocol.ts"] },
  "m29.X1": { covers: ["script/m29/verify-closure.ts", "docs/IDE-HONESTY-CONTRACT.md", "docs/m29/PRECISION-LEDGER.md", "docs/m29/WAVE-PROTOCOL.md", "script/m24/verify-governance.ts", "script/m25/verify-governance.ts", "script/m26/verify-governance.ts", "script/m27/verify-governance.ts", "script/m28/verify-governance.ts", "script/m29/generate-precision-ledger.ts", "script/m29/generate-wave-doc.ts", "script/m29/verify-giant-repo.ts", "script/m29/verify-m29-docs.ts", "script/m29/verify-precision-improvements.ts", "script/m29/verify-precision-ledger.ts", "script/m29/verify-wave-execution.ts", "script/m29/verify-wave-harness.ts", "script/m29/verify-wave-protocol.ts"] },
  "m29.analyzer-relevance": { covers: ["script/m29/verify-analyzer-relevance.ts", "src/lsp/hover.ts", "src/lsp/launch_languages.ts", "src/lsp/navigation.ts", "src/lsp/server.ts", "src/lsp/symbols.ts", "script/m29/wave-execute.ts", "script/m29/wave-protocol.ts"] },
  "m29.wave-c": { unFingerprintable: "DECLARED ARTIFACT in script/m61/gate-registry.json — per-language wave-execution record produced by the declared runner script/m29/wave-execute.ts (its verdict records belong to the wave harness gate)" },
  "m29.wave-cpp": { unFingerprintable: "DECLARED ARTIFACT in script/m61/gate-registry.json — per-language wave-execution record produced by the declared runner script/m29/wave-execute.ts (its verdict records belong to the wave harness gate)" },
  "m29.wave-editor-c": { unFingerprintable: "DECLARED ARTIFACT in script/m61/gate-registry.json — per-language wave-execution record produced by the declared runner script/m29/wave-execute.ts (its verdict records belong to the wave harness gate)" },
  "m29.wave-editor-cpp": { unFingerprintable: "DECLARED ARTIFACT in script/m61/gate-registry.json — per-language wave-execution record produced by the declared runner script/m29/wave-execute.ts (its verdict records belong to the wave harness gate)" },
  "m29.wave-editor-go": { unFingerprintable: "DECLARED ARTIFACT in script/m61/gate-registry.json — per-language wave-execution record produced by the declared runner script/m29/wave-execute.ts (its verdict records belong to the wave harness gate)" },
  "m29.wave-editor-groovy": { unFingerprintable: "DECLARED ARTIFACT in script/m61/gate-registry.json — per-language wave-execution record produced by the declared runner script/m29/wave-execute.ts (its verdict records belong to the wave harness gate)" },
  "m29.wave-editor-java": { unFingerprintable: "DECLARED ARTIFACT in script/m61/gate-registry.json — per-language wave-execution record produced by the declared runner script/m29/wave-execute.ts (its verdict records belong to the wave harness gate)" },
  "m29.wave-editor-javascript": { unFingerprintable: "DECLARED ARTIFACT in script/m61/gate-registry.json — per-language wave-execution record produced by the declared runner script/m29/wave-execute.ts (its verdict records belong to the wave harness gate)" },
  "m29.wave-editor-kotlin": { unFingerprintable: "DECLARED ARTIFACT in script/m61/gate-registry.json — per-language wave-execution record produced by the declared runner script/m29/wave-execute.ts (its verdict records belong to the wave harness gate)" },
  "m29.wave-editor-python": { unFingerprintable: "DECLARED ARTIFACT in script/m61/gate-registry.json — per-language wave-execution record produced by the declared runner script/m29/wave-execute.ts (its verdict records belong to the wave harness gate)" },
  "m29.wave-editor-rust": { unFingerprintable: "DECLARED ARTIFACT in script/m61/gate-registry.json — per-language wave-execution record produced by the declared runner script/m29/wave-execute.ts (its verdict records belong to the wave harness gate)" },
  "m29.wave-editor-scala": { unFingerprintable: "DECLARED ARTIFACT in script/m61/gate-registry.json — per-language wave-execution record produced by the declared runner script/m29/wave-execute.ts (its verdict records belong to the wave harness gate)" },
  "m29.wave-editor-svelte": { unFingerprintable: "DECLARED ARTIFACT in script/m61/gate-registry.json — per-language wave-execution record produced by the declared runner script/m29/wave-execute.ts (its verdict records belong to the wave harness gate)" },
  "m29.wave-editor-typescript": { unFingerprintable: "DECLARED ARTIFACT in script/m61/gate-registry.json — per-language wave-execution record produced by the declared runner script/m29/wave-execute.ts (its verdict records belong to the wave harness gate)" },
  "m29.wave-editor-vue": { unFingerprintable: "DECLARED ARTIFACT in script/m61/gate-registry.json — per-language wave-execution record produced by the declared runner script/m29/wave-execute.ts (its verdict records belong to the wave harness gate)" },
  "m29.wave-editor-zig": { unFingerprintable: "DECLARED ARTIFACT in script/m61/gate-registry.json — per-language wave-execution record produced by the declared runner script/m29/wave-execute.ts (its verdict records belong to the wave harness gate)" },
  "m29.wave-go": { unFingerprintable: "DECLARED ARTIFACT in script/m61/gate-registry.json — per-language wave-execution record produced by the declared runner script/m29/wave-execute.ts (its verdict records belong to the wave harness gate)" },
  "m29.wave-groovy": { unFingerprintable: "DECLARED ARTIFACT in script/m61/gate-registry.json — per-language wave-execution record produced by the declared runner script/m29/wave-execute.ts (its verdict records belong to the wave harness gate)" },
  "m29.wave-java": { unFingerprintable: "DECLARED ARTIFACT in script/m61/gate-registry.json — per-language wave-execution record produced by the declared runner script/m29/wave-execute.ts (its verdict records belong to the wave harness gate)" },
  "m29.wave-javascript": { unFingerprintable: "DECLARED ARTIFACT in script/m61/gate-registry.json — per-language wave-execution record produced by the declared runner script/m29/wave-execute.ts (its verdict records belong to the wave harness gate)" },
  "m29.wave-kotlin": { unFingerprintable: "DECLARED ARTIFACT in script/m61/gate-registry.json — per-language wave-execution record produced by the declared runner script/m29/wave-execute.ts (its verdict records belong to the wave harness gate)" },
  "m29.wave-python": { unFingerprintable: "DECLARED ARTIFACT in script/m61/gate-registry.json — per-language wave-execution record produced by the declared runner script/m29/wave-execute.ts (its verdict records belong to the wave harness gate)" },
  "m29.wave-rust": { unFingerprintable: "DECLARED ARTIFACT in script/m61/gate-registry.json — per-language wave-execution record produced by the declared runner script/m29/wave-execute.ts (its verdict records belong to the wave harness gate)" },
  "m29.wave-scala": { unFingerprintable: "DECLARED ARTIFACT in script/m61/gate-registry.json — per-language wave-execution record produced by the declared runner script/m29/wave-execute.ts (its verdict records belong to the wave harness gate)" },
  "m29.wave-svelte": { unFingerprintable: "DECLARED ARTIFACT in script/m61/gate-registry.json — per-language wave-execution record produced by the declared runner script/m29/wave-execute.ts (its verdict records belong to the wave harness gate)" },
  "m29.wave-typescript": { unFingerprintable: "DECLARED ARTIFACT in script/m61/gate-registry.json — per-language wave-execution record produced by the declared runner script/m29/wave-execute.ts (its verdict records belong to the wave harness gate)" },
  "m29.wave-vue": { unFingerprintable: "DECLARED ARTIFACT in script/m61/gate-registry.json — per-language wave-execution record produced by the declared runner script/m29/wave-execute.ts (its verdict records belong to the wave harness gate)" },
  "m29.wave-zig": { unFingerprintable: "DECLARED ARTIFACT in script/m61/gate-registry.json — per-language wave-execution record produced by the declared runner script/m29/wave-execute.ts (its verdict records belong to the wave harness gate)" },
  "m42.H1": { covers: ["script/m42/verify-highlight.ts", "src/ast/safety-primitives.ts", "src/brain/database.ts", "src/brain/freshness.ts", "src/lsp/document_highlight.ts", "src/lsp/hover.ts", "src/lsp/positions.ts", "script/m42/h1-fixture.ts", "script/m42/parse-guard-scan.ts"] },
  "m42.H2": { covers: ["script/m42/verify-rich-hover.ts", "src/brain/database.ts", "src/lsp/positions.ts", "src/lsp/relations.ts", "src/lsp/rich_hover.ts", "src/util/project-id.ts", "script/m42/h2-fixture.ts"] },
  "m42.H3": { covers: ["script/m42/verify-enrichment-surface.ts", "src/lsp/enrichment.ts", "script/m42/h2-fixture.ts"] },
  "m42.H4": { covers: ["script/m42/verify-hover-actions.ts", "ide/vscode/README.md", "ide/vscode/package.json", "ide/vscode/src/hover-commands.ts", "src/brain/database.ts", "src/lsp/enrichment.ts", "src/lsp/impact.ts", "src/lsp/impact_request.ts", "src/lsp/navigation.ts", "src/lsp/rich_hover.ts", "script/m26/graph-core.ts", "script/m42/h2-fixture.ts"] },
  "m42.H6": { covers: ["script/m42/verify-hub-navigation.ts", "docs/m42/HUB-PROTOCOL.md", "ide/vscode/src/hub-navigation-core.ts", "src/lsp/graph_usages.ts", "src/lsp/hub_protocol.ts", "script/m26/graph-core.ts"] },
  "m42.KNOWN-GAPS": { unFingerprintable: "DECLARED ARTIFACT in script/m61/gate-registry.json — the milestone's known-gaps register — a declaration of what is NOT done, not a gate verdict" },
  "m42.board-closure": { unFingerprintable: "DECLARED ARTIFACT in script/m61/gate-registry.json — m42 board closure receipt (milestones + closed issue ids) — a bookkeeping artifact" },
  "m44.KNOWN-GAPS": { unFingerprintable: "DECLARED ARTIFACT in script/m61/gate-registry.json — the milestone's known-gaps register — a declaration of what is NOT done, not a gate verdict (the m42 twin of the same artifact, whose declaration this entry extends)" },
  "m44.U1": { covers: ["script/m44/verify-usages-groups.ts", "src/brain/database.ts", "src/intelligence/graph/graph-engine.ts", "src/lsp/graph_request.ts", "src/lsp/graph_usages.ts", "src/util/project-id.ts"] },
  "m44.U2": { covers: ["script/m44/verify-hub-list.ts", "script/m44/hub-list-derivation.ts", "script/m44/u2-declaration.json"] },
  "m44.U4": { covers: ["script/m44/verify-legend.ts", "docs/m44/LEGEND.md", "ide/vscode/src/hub-panel.ts", "src/brain/database.ts", "src/lsp/freshness.ts", "src/lsp/graph_request.ts", "src/util/project-id.ts", "script/m26/graph-core.ts", "script/m26/webview-harness.ts"] },
  "m44.U5": { covers: ["script/m44/verify-impact-resolution.ts", "src/brain/database.ts", "src/lsp/identity.ts", "src/lsp/impact.ts", "src/util/project-id.ts", "script/m26/graph-core.ts", "script/m44/u5-fixture.ts"] },
  "m55.EVID-TREE": { covers: ["script/m55/verify-evidence-tree-clean.ts", "script/m24/verify-call-hierarchy.ts", "script/m24/verify-hover.ts", "script/m26/verify-content-security.ts", "script/m26/verify-cross-language-hover.ts", "script/m26/verify-evidence-badges.ts", "script/m26/verify-graph-transport.ts", "script/m26/verify-impact-mode.ts", "script/m26/verify-polyglot-e2e.ts", "script/m26/verify-webview-core.ts", "script/m26/verify-webview-harness.ts"] },
  "m55.HOV-COVERAGE": { covers: ["script/m55/verify-hover-coverage.ts", "docs/HOVER-KNOWLEDGE-AUDIT.md", "src/intelligence/graph/line-address.ts", "src/lsp/hover.ts", "src/lsp/relations.ts", "src/lsp/rich_hover.ts", "src/mcp/tool-registry.ts", "src/storage/db.node.ts", "script/m55/hover-coverage-fixture.ts"] },
  "m55.HOV-REDTEAM": { covers: ["script/m55/verify-hover-coverage-redteam.ts", "src/lsp/evidence_tier.ts", "src/lsp/relations.ts", "src/lsp/rich_hover.ts", "script/m55/verify-hover-coverage.ts"] },
  "m55.P1": { covers: ["script/m55/verify-panel-placement.ts", "ide/vscode/package.json", "ide/vscode/src/graph-panel.ts", "ide/vscode/src/hub-panel.ts", "ide/vscode/src/impact-panel.ts", "ide/vscode/src/panel-placement.ts"] },
  "m55.T1": { covers: ["script/m55/verify-identity.ts", "ide/vscode/src/identity-label.ts", "src/brain/database.ts", "src/lsp/identity.ts", "script/m26/graph-core.ts", "script/m55/lsp-wire.ts", "script/m55/t1-fixture.ts"] },
  "m55.T2": { covers: ["script/m55/verify-call-hierarchy.ts", "src/brain/database.ts", "src/lsp/call_hierarchy.ts", "src/util/project-id.ts", "script/m55/t2-fixture.ts"] },
  "m55.T3": { covers: ["script/m55/verify-relations.ts", "src/brain/database.ts", "src/lsp/graph_usages.ts", "src/lsp/hover.ts", "src/lsp/navigation.ts", "src/lsp/relations.ts", "src/lsp/rich_hover.ts", "script/m55/lsp-wire.ts", "script/m55/t3-fixture.ts"] },
  "m55.T4": { covers: ["script/m55/verify-signatures.ts", "src/lsp/signature.ts", "script/m55/lsp-wire.ts", "script/m55/t4-fixture.ts"] },
  "m55.T5": { covers: ["script/m55/verify-tiers.ts", "src/lsp/cross_language_hover.ts", "src/lsp/evidence_tier.ts", "src/lsp/hover.ts", "script/m26/graph-core.ts", "script/m55/lsp-wire.ts", "script/m55/t5-fixture.ts"] },
  "m55.V1": { covers: ["script/m55/verify-live-surface.ts", "docs/m55/FRAME-FINDINGS.md", "src/lsp/evidence_tier.ts", "script/m26/graph-core.ts", "script/m36/verify-verify-fast.ts", "script/m55/lsp-wire.ts", "script/m55/navigation.ts", "script/m55/screenshot-protocol.ts", "script/m55/wire-probe.ts"] },
  "m55.V1-action-args": { covers: ["script/m55/verify-action-args.ts", "ide/vscode/src/hover-action-args.ts", "ide/vscode/src/hover-commands.ts", "src/lsp/rich_hover.ts"] },
  "m55.V1-status-panel": { covers: ["script/m55/verify-status-panel.ts", "ide/vscode/package.json", "ide/vscode/src/extension.ts", "ide/vscode/src/status-markup.ts"] },
  "m62.A1": { covers: ["script/m62/verify-address.ts", "src/brain/database.ts", "src/intelligence/graph/graph-engine.ts", "src/intelligence/graph/line-address.ts", "src/lsp/positions.ts", "src/util/project-id.ts", "script/m62/a1-fixture.ts"] },
  "m62.A3": { covers: ["script/m62/verify-arrival.ts", "docs/m62/LINE-ADDRESS.md", "src/brain/database.ts", "src/intelligence/graph/graph-engine.ts", "src/lsp/graph_usages.ts", "src/mcp/tool-handlers.ts", "src/util/project-id.ts", "script/m62/a1-fixture.ts"] },
  "m62.D1": { covers: ["script/m62/verify-docs.ts", "docs/m62/LINE-ADDRESS.md", "src/intelligence/graph/line-address.ts", "script/m62/a2-fixture.ts"] },
  "m62.G1": { covers: ["script/m62/verify-governance.ts", "docs/m62/M62-MASTER-PLAN.md", "script/m62/governance_core.ts"] },
  "m62.X1": { covers: ["script/m62/verify-closure.ts", "docs/m62/LINE-ADDRESS.md", "docs/m62/M62-MASTER-PLAN.md", "src/brain/database.ts", "src/intelligence/graph/graph-engine.ts", "src/lsp/hover.ts", "src/mcp/tool-handlers.ts", "script/m62/a1-fixture.ts", "script/m62/governance_core.ts"] },
}

/** The declaration for one claim, or undefined when the claim is not declared
 *  at all. `undefined` is a GATE FAILURE, never a default: an undeclared claim
 *  has no coverage, so any digest on its record is decorative. */
export function declarationFor(claim: string): ClaimDeclaration | undefined {
  return CLAIM_COVERAGE[claim]
}

/** The declared coverage of one claim, or null when the claim is undeclared or
 *  declared un-fingerprintable. */
export function coverageFor(claim: string): Coverage | null {
  const d = CLAIM_COVERAGE[claim]
  return d && "covers" in d && d.covers ? d.covers : null
}

/** Why a claim cannot carry a discriminating fingerprint, or null when it can
 *  (or when it simply was never declared — an undeclared claim is a gate
 *  finding, not a reason). */
export function unFingerprintableReason(claim: string): string | null {
  const d = CLAIM_COVERAGE[claim]
  return d && "unFingerprintable" in d && typeof d.unFingerprintable === "string" ? d.unFingerprintable : null
}

/** Every declared claim, sorted — the census's denominator, so a claim that
 *  vanishes from the table cannot vanish from the count. */
export function declaredClaims(): string[] {
  return Object.keys(CLAIM_COVERAGE).sort()
}


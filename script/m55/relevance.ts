// script/m55/relevance.ts — the M55 freshness map, in ONE place.
//
// Why this module exists: G1 (script/m55/verify-governance.ts) and X1
// (script/m55/verify-closure.ts) must apply the SAME freshness rule — an issue's
// evidence is fresh while none of ITS relevant files changed since the evidence
// commit (the M24.G1 relevance rule this milestone mirrors). The rule lived
// inside the governance gate, which is a SCRIPT: importing it to share the map
// executed that gate's whole body (found the hard way — the closure gate hung
// running a second copy of the governance run). So the map is data, in a pure
// module, and both gates import it.
//
// Every entry also carries THIS FILE: a change to the map changes what "fresh"
// means, so it invalidates every issue's evidence rather than silently
// redefining the rule.

/** The map, before the map's own file is appended to every entry. */
const RAW_RELEVANT_FILES: Record<string, string[]> = {
  G1: ["script/m55/verify-governance.ts", "docs/m55/M55-MASTER-PLAN.md", "docs/m55/SCREENSHOT-PROTOCOL.md"],
  T1: [
    "src/lsp/identity.ts",
    "src/lsp/impact.ts",
    "src/lsp/graph_request.ts",
    "ide/vscode/src/identity-label.ts",
    "ide/vscode/src/graph-panel.ts",
    "script/m55/verify-identity.ts",
    "script/m55/t1-fixture.ts",
  ],
  T2: ["src/lsp/call_hierarchy.ts", "src/lsp/positions.ts", "script/m55/verify-call-hierarchy.ts", "script/m55/t2-fixture.ts"],
  // M55.T3: the vocabulary itself plus the two surfaces that consume it (the
  // hover's list/count and the references door) — a change to any of them
  // invalidates the T3 evidence, which is exactly the claim it makes.
  T3: ["src/lsp/relations.ts", "src/lsp/rich_hover.ts", "src/lsp/navigation.ts", "script/m55/verify-relations.ts", "script/m55/t3-fixture.ts"],
  // M55.T4: the renderer owner plus every surface that renders through it.
  T4: ["src/lsp/signature.ts", "src/lsp/hover.ts", "src/lsp/call_hierarchy.ts", "script/m55/verify-signatures.ts", "script/m55/t4-fixture.ts"],
  // M55.T5: the classifier owner, every surface that consumes it, and the
  // import-pure mirror in the renderer core (its drift gate is T5's own P1).
  T5: [
    "src/lsp/evidence_tier.ts",
    "src/lsp/hover.ts",
    "src/lsp/cross_language_hover.ts",
    "script/m26/graph-core.ts",
    "script/m55/verify-tiers.ts",
    "script/m55/t5-fixture.ts",
  ],
  P1: [
    "ide/vscode/src/panel-placement.ts",
    "ide/vscode/src/hub-panel.ts",
    "ide/vscode/src/impact-panel.ts",
    "ide/vscode/src/graph-panel.ts",
    "ide/vscode/package.json",
    "script/m55/verify-panel-placement.ts",
  ],
  V1: ["script/m55/verify-live-surface.ts", "script/m55/screenshot-protocol.ts", "script/m55/wire-probe.ts", "script/m55/pixel-read.py"],
  X1: ["script/m55/verify-closure.ts", "docs/m55/HANDOFF-cross-language.md"],
}

export const RELEVANCE_MODULE = "script/m55/relevance.ts"

export const ISSUE_RELEVANT_FILES: Record<string, string[]> = Object.fromEntries(
  Object.entries(RAW_RELEVANT_FILES).map(([code, files]) => [code, [...files, RELEVANCE_MODULE]]),
)

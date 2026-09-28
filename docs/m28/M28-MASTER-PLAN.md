# M28 — The Union (MCP + agent) — Master Plan

> **STATUS: DRAFT — awaiting owner review.**
> Nothing below is a verified claim. Every claim becomes one only when an
> issue's ledger cell pins a verifier, a run, and a machine (contract §2).

Program: [IDE Program Decision Record](../IDE-PROGRAM-DECISIONS.md) (v4 —
"Agent and developer share one truth"). Governing contract:
[IDE Honesty Contract](../IDE-HONESTY-CONTRACT.md). Parent status:
[IDE Program Status](../IDE-PROGRAM-STATUS.md).

## Purpose

v0–v3 built one index and put it in front of humans in five editor families.
v4 points the same index at agents — and lets agents write back. The union is
not two surfaces; it is **one truth read through two doors**:

1. **MCP tools expose what the IDE shows.** An agent asking for a symbol's
   graph, impact, or cross-language facts gets the *same* numbers, the *same*
   evidence tiers, the *same* declared truncation the developer sees in the
   editor — from the *same* components. Differential gates prove the two
   doors agree; "the agent sees different facts" is a failed gate, not a
   footnote.
2. **The agent annotates the human's graph.** Agent-authored notes land in
   the index (schema migration), carry author provenance, and surface where
   the human works — hover sections and graph-webview badges. An annotation
   is an *opinion layered on evidence*: it must always name its author and
   never masquerade as index-derived fact.

## Decisions

| # | Decision | Rationale |
|---|---|---|
| D-1 | **One truth, two doors**: new MCP tools reuse the exact components the LSP uses (`src/lsp/impact.ts`, `src/lsp/cross_language_hover.ts`, graph engine tier rules). No reimplementation. | Divergence between agent-facing and human-facing facts is the failure mode v4 exists to kill. |
| D-2 | **Three new read tools**: `bb_graph` (per-symbol graph with per-edge evidence tiers), `bb_impact` (bounded impact with declared truncation/declared total), `bb_cross_language` (per-pair facts with declared absence). | Minimal honest surface; each maps 1:1 to an IDE feature the human already sees. |
| D-3 | **Annotations are provenance-bound**: new `brain_annotation` table (additive migration); `bb_annotate` (agent write) and `bb_annotations` (read); every row records author (`agent`/`human`), tool identity, and timestamp. | An agent note is a claim by an actor, not an index fact; provenance is the honesty boundary. |
| D-4 | **Schema migrations are additive-only and versioned** (existing `brain_schema_version` discipline). | The index is shared by five editors and every verifier; destructive migrations are a program-level risk. |
| D-5 | **Union differential gate**: same fixture workspace; MCP tool output and the corresponding LSP/IDE surface must agree on counts, tiers, and truncation declarations — asserted by one verifier (U1). | "One truth" becomes a machine-checked fact (the milestone's core proof). |
| D-6 | **Annotations surface in the IDE** (hover section + graph webview badge, author-labeled) — an agent note with no IDE surface is a letter into a drawer. | Closes the loop: agent writes where the human reads. |

## Issues (planned order)

| Code | Issue | Deliverable | Acceptance criteria (abridged) |
|---|---|---|---|
| G1 | [#623](https://github.com/backbencher-hq/backbencher-brain/issues/623) | Governance | Ledger, map, gate, M27-bar ladder audit |
| T1 | [#624](https://github.com/backbencher-hq/backbencher-brain/issues/624) | MCP read tools | `bb_graph`, `bb_impact`, `bb_cross_language` over existing components |
| U1 | [#625](https://github.com/backbencher-hq/backbencher-brain/issues/625) | Union differential gate | MCP ≡ IDE on the shared fixture |
| A1 | [#626](https://github.com/backbencher-hq/backbencher-brain/issues/626) | Annotation store | `brain_annotation` migration + `bb_annotate`/`bb_annotations` with provenance |
| A2 | [#627](https://github.com/backbencher-hq/backbencher-brain/issues/627) | Annotations in the IDE | Hover section + graph badge (author-labeled), in-editor verified |
| V1 | [#628](https://github.com/backbencher-hq/backbencher-brain/issues/628) | Generated MCP surface doc | `docs/m28/MCP-SURFACE.md` from the registry + evidence |
| X1 | [#629](https://github.com/backbencher-hq/backbencher-brain/issues/629) | Closure gate | Full suite, v4 completion bar, regeneration |

## v4 completion bar (X1 audits this)

1. The three new MCP tools verified, each reusing its IDE-side component.
2. The union differential gate proves MCP ≡ IDE on the shared fixture.
3. Annotation write/read verified with enforced provenance.
4. Annotations visible in-editor (hover + graph) with author labels.
5. M27 bar re-audit passes inside this gate (ladder).
6. No silent legs; every generated doc drift-gated.

## Non-goals (v4)

- No agent auto-indexing policy changes (M25's machine stands).
- No annotation auth/multi-user model — provenance is author-class, not identity.
- No precision waves (v5).
- No changes to the five editor adapters' launch configs (M27 surface frozen).

## Risks

- **Schema migration** touching a db every editor reads — mitigated by
  additive-only D-4 and the full M24–M27 suite re-run at the closure gate.
- **MCP output shape drift** vs IDE shapes — mitigated by U1's differential
  assertions, not by convention.
- **Annotation spam** (an agent flooding notes) — read tools carry limits;
  volume policy is deferred to v5 if it bites.

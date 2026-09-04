# M28: The Union (IDE Program v4)

Status: `open`
GitHub milestone: `28` (IDE program v4 — "The Union")
Parent program: [IDE Program Decision Record](../IDE-PROGRAM-DECISIONS.md)
Governing contract: [IDE Honesty Contract](../IDE-HONESTY-CONTRACT.md)
Prerequisite: M27 completion bar met (verified by G1).

## Purpose

The claim nobody else can make: the agent and the developer see the same
graph. MCP tools expose exactly what the IDE shows — same brain.db, same
relationship rows, same evidence tiers, same staleness markers — and the
agent can annotate the human's graph (findings, notes, confirmed/refuted
edges) with provenance, so that what the agent learns is visible where the
developer hovers.

## Issue groups

| Code | Issue | Deliverable |
|------|-------|-------------|
| G1 | Governance + v3-bar check | ledger; closure gate; M27 bar still green |
| U1 | Shared truth contract | one schema for "what the IDE shows" = "what MCP returns": same rows, same tiers, same staleness; a differential gate proves parity (MCP response vs LSP response for the same symbol must agree) |
| U2 | MCP surface extension | bb_analyze/graph modes return the same node/edge/evidence model the webview renders; versioned, documented |
| U3 | Agent annotations | annotation store (typed: finding/note/confirm/refute) with provenance (agent id, commit, evidence); written via MCP, rendered in IDE. Schema ships as a versioned migration for existing brain.db installs; upgrade path tested against a pre-M28 database copy |
| U4 | Annotation honesty | annotations never mutate index rows; they are a separate layer with their own staleness; UI renders them as agent-originated, never as index truth |
| V1 | Verifier harness | parity differential harness (LSP vs MCP for N sampled symbols across the five languages); annotation round-trip harness; mutation set (parity break, annotation spoofing as index truth) |
| D1 | Docs | the union contract documented; what the agent may and may not claim |
| X1 | Gate | closure gate |

## Protocol

Same as prior milestones, plus:

1. Parity is differential and sampled (M14 L3 pattern): sampling rate stated,
   discrepancies either fixed or filed — sampling never zero.
2. Annotations carry agent identity and are visually distinct from index
   evidence in the UI; a mutation that renders an annotation as index truth
   must fail the suite.
3. The agent's claims about code are bounded by the same contract vocabulary
   — an agent annotation is a claim with a level, not a verdict.

## Completion bar for v4 (M29 may not start until ALL are true)

1. Parity gate green: for sampled symbols across the five languages, MCP and
   LSP responses agree on nodes, edges, tiers, staleness — recorded per
   sample.
2. Annotation round-trip verified: MCP-written annotation renders in the IDE
   with provenance and correct visual class.
3. Annotation layer proven non-mutating to index truth (mutation-tested).
4. Docs state the union contract and its limits.
5. Closure gate green; ledger clean.

## Negative list

- No claim that MCP and LSP agree beyond the sampled, evidenced scope.
- No annotation mechanism that can overwrite or masquerade as index rows.
- No agent verdicts ("this code is correct") — annotations are claims with
  evidence pointers, per the contract vocabulary.

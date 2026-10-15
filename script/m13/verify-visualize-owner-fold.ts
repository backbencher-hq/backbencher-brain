// script/m13/verify-visualize-owner-fold.ts — M13.62 (V8).
//
// THE GATE FOR F3: the tool may claim the owner fold only while it performs it.
//
// The registry description used to end "Same owner-cascade semantics as bb_graph:
// member-level relationships are attributed to the owner class", and `bb_visualize`
// never imported the graph engine — it built its own projection from
// brain_relationship with exact endpoint joins. MEASURED before the fix, on one
// index: `bb_graph {symbol:"Api", direction:"callers", relationshipTypes:["calls"]}`
// returned 2 callers, both `match:"owner-cascade"`; `bb_visualize {scope:"symbol",
// target:"Api", relationshipTypes:["calls"]}` returned ONE node, ZERO links and no
// absence note, while printing "complete for this node set". The class was drawn
// isolated while the index stored two call rows on its members.
//
// The fix implements a narrow fold and declares it, so the claim and the code are
// the same object again:
//
//   * a relationship stored on a member of a SELECTED class-like symbol is
//     attributed to that symbol, and the edge is MARKED (`ownerCascade` plus
//     `matchedMembers` naming the member it came through) — an attributed edge is
//     never presented as one the index stored between the two drawn nodes;
//   * the fold never touches `contains`, and an exact edge is always preferred to
//     an attributed one;
//   * the symbol at the other end is ADDED to the node set so the folded edge has
//     two ends to draw;
//   * `considered.ownerCascade` declares whether it ran, how many members it
//     scanned, how many rows it folded and whether a cap truncated it — so
//     "the fold ran and found nothing" is distinguishable from "the fold never ran".
//
// Every assertion here is a property of the ANSWER (nodes/links/considered, and the
// text reply a caller gets without asking). The description sentence is asserted
// against the behaviour beside it, because the defect this gate exists for was a
// claim with no implementation behind it.

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../../src/cli/index"
import { indexProjectParallel } from "../../src/ast/parallel-indexer"
import { createToolHandlers } from "../../src/mcp/tool-handlers"
import { PUBLIC_TOOL_DESCRIPTORS } from "../../src/mcp/tool-registry"
import { Harness } from "./harness"

const harness = new Harness({
  issue: "M13.62", code: "V8", tool: "bb_visualize",
  title: "bb_visualize: the owner fold is performed, marked, and declared",
  layers: ["unit", "integration"],
  decisions: {
    fixture: "one class with two methods that each call the same helper, plus a free function that calls one of the methods — so a fold and an exact edge are both present and must not be confused",
    marking: "a folded edge names the member it came through (matchedMembers) and an exact edge carries no mark",
    contrast: "project scope reports applied=true with rowsFolded=0, which is the measurement that makes 'found nothing' different from 'never ran'",
    text: "the JSON counters and the text reply must state the same number, so a caller who never asked for JSON is not told a different story",
  },
  limitations: [
    "One fixture shape (a TypeScript class with method members); the fold's cap (`capped`) is not driven to its limit here.",
    "The fold is asserted through the handler, which is the door a caller uses; the engine's own helper is not called directly.",
  ],
})

const root = mkdtempSync(path.join(tmpdir(), "bb-viz-v8-"))
mkdirSync(path.join(root, "src", "core"), { recursive: true })
writeFileSync(path.join(root, "src", "core", "service.ts"), [
  "export class Service {",
  "  run(): number { return helper() }",
  "  other(): number { return helper() }",
  "}",
  "export function helper(): number { return 1 }",
  "export function caller(): number { return new Service().run() }",
  "",
].join("\n"))
const projectId = getProjectId(root)
await indexProjectParallel(projectId, root, {})

const handlers = createToolHandlers() as any
const ctx = { projectPath: root, projectId }
const reply = async (args: Record<string, unknown>): Promise<string> =>
  (await handlers.bb_visualize(args, ctx)).content[0].text as string
const json = async (args: Record<string, unknown>): Promise<any> =>
  JSON.parse(await reply({ ...args, format: "json" }))
const byId = (r: any): Record<string, string> =>
  Object.fromEntries(r.nodes.map((n: any) => [n.id, `${n.name}:${n.type}`]))

// ── the fold happens, and it is marked ────────────────────────────────────────
{
  const r = await json({ scope: "symbol", target: "Service", relationshipTypes: ["calls"] })
  const names = byId(r)
  const folded = r.links.filter((l: any) => l.ownerCascade === true)
  harness.check("fold: a selected class draws the calls its members make", folded.length > 0, `folded=${folded.length} links=${r.links.length}`)
  harness.check(
    "fold: the folded edge is attributed to the class, not to the member",
    folded.some((l: any) => names[l.source] === "Service:class" && names[l.target] === "helper:function"),
    folded.map((l: any) => `${names[l.source]}->${names[l.target]}`).join(","),
  )
  const withMembers = folded.filter((l: any) => Array.isArray(l.matchedMembers) && l.matchedMembers.length > 0)
  harness.check(
    "fold: every folded edge names the member it came through",
    withMembers.length === folded.length,
    JSON.stringify(folded.map((l: any) => l.matchedMembers ?? null)).slice(0, 160),
  )
  harness.check(
    "fold: and the member name is the one that stores the row",
    folded.some((l: any) => (l.matchedMembers ?? []).some((m: string) => m.startsWith("run:"))),
    JSON.stringify(folded.flatMap((l: any) => l.matchedMembers ?? [])).slice(0, 160),
  )
  harness.check(
    "fold: the symbol at the other end is added so the edge has two ends",
    r.nodes.some((n: any) => n.name === "helper"),
    r.nodes.map((n: any) => n.name).join(","),
  )

  // ── the fold declares itself ────────────────────────────────────────────────
  const c = r.considered.ownerCascade
  harness.check("fold: considered.ownerCascade says it ran", c && c.applied === true, JSON.stringify(c).slice(0, 140))
  harness.check("fold: it reports the owners and members it scanned", c.owners === 1 && c.membersScanned >= 2, `owners=${c.owners} membersScanned=${c.membersScanned}`)
  harness.check("fold: it reports the rows it folded", c.rowsFolded > 0, String(c.rowsFolded))
  harness.check("fold: and that it was not capped", c.capped === false, String(c.capped))
  harness.check(
    "fold: the selection sentence admits the fold rather than presenting it as stored edges",
    String(r.considered.relationshipSelection).includes("folded onto the owner"),
    String(r.considered.relationshipSelection).slice(-120),
  )

  // ── the text format tells the same story as the JSON ──────────────────────
  const textReply = await reply({ scope: "symbol", target: "Service", relationshipTypes: ["calls"], format: "text" })
  const line = textReply.split("\n").find((l) => l.startsWith("owner cascade:")) ?? ""
  const number = Number((line.match(/owner cascade: (\d+)/) ?? [])[1])
  harness.check("fold: the text reply declares the fold", line.length > 0, textReply.split("\n").slice(0, 3).join(" | ").slice(0, 120))
  harness.check("fold: text and JSON report the same count", number === c.rowsFolded, `text=${number} json=${c.rowsFolded}`)
  harness.negative("fold: the text reply does not hide the fold behind a silent edge set", line.includes("marked ownerCascade"), line.slice(0, 140))
}

// ── an exact edge is never mislabelled, and the fold never touches contains ───
{
  const r = await json({ scope: "project" })
  const names = byId(r)
  const exactMemberEdge = r.links.find((l: any) => names[l.source] === "run:method" && names[l.target] === "helper:function")
  harness.check("exact: the member's own stored edge is drawn when the member is in the set", !!exactMemberEdge, r.links.map((l: any) => `${names[l.source]}->${names[l.target]}`).join(","))
  harness.negative("exact: and it is NOT marked as folded", !!exactMemberEdge && !exactMemberEdge.ownerCascade, JSON.stringify(exactMemberEdge ?? {}).slice(0, 140))
  const mislabelled = r.links.filter((l: any) => l.ownerCascade && (!Array.isArray(l.matchedMembers) || l.matchedMembers.length === 0))
  harness.negative("exact: no edge claims a fold without naming the member", mislabelled.length === 0, JSON.stringify(mislabelled).slice(0, 140))
  const foldedContains = r.links.filter((l: any) => l.ownerCascade && l.type === "contains")
  harness.negative("exact: the fold never rewrites a containment edge", foldedContains.length === 0, JSON.stringify(foldedContains).slice(0, 140))

  // ── "ran and found nothing" vs "never ran" ─────────────────────────────────
  const c = r.considered.ownerCascade
  harness.check("declared: project scope reports that the fold ran", c.applied === true, JSON.stringify(c).slice(0, 120))
  harness.check("declared: with nothing to fold it reports zero rows", c.rowsFolded === 0, String(c.rowsFolded))
  const memberScope = await json({ scope: "symbol", target: "run" })
  harness.check(
    "declared: a non-class-like target reports the fold as not applied",
    memberScope.considered.ownerCascade.applied === false,
    JSON.stringify(memberScope.considered.ownerCascade).slice(0, 120),
  )
  harness.negative(
    "declared: so `applied` is not just a restatement of `rowsFolded`",
    memberScope.considered.ownerCascade.applied !== r.considered.ownerCascade.applied,
    JSON.stringify([memberScope.considered.ownerCascade.applied, r.considered.ownerCascade.applied]),
  )
  harness.check(
    "declared: it is reported even when the fold found nothing",
    r.considered.ownerCascade.rule.length > 0 && c.rule.includes("member"),
    String(c.rule).slice(0, 120),
  )
}

// ── the claim in the descriptor, checked against the behaviour above ─────────
{
  const descriptor = PUBLIC_TOOL_DESCRIPTORS.find((t) => t.name === "bb_visualize")!
  const description = descriptor.description
  const engine = readFileSync(path.join(import.meta.dir, "..", "..", "src", "intelligence", "visualization", "visualization-engine.ts"), "utf8")
  const doc = readFileSync(path.join(import.meta.dir, "..", "..", "docs", "tools", "bb_visualize.md"), "utf8")
  harness.negative(
    "claim: the bb_graph cascade sentence is gone from the description",
    !description.includes("Same owner-cascade semantics as bb_graph"),
    description.slice(-120),
  )
  harness.negative("claim: and from the generated docs page", !doc.includes("Same owner-cascade semantics as bb_graph"), "")
  harness.check("claim: the description names the mark a folded edge carries", description.includes("ownerCascade") && description.includes("matchedMembers"), "")
  harness.check("claim: and the counter a caller can audit", description.includes("considered.ownerCascade"), "")
  harness.check("claim: and states the fold is not bb_graph's traversal", description.includes("NOT bb_graph"), "")
  harness.check(
    "claim: the engine implements the mark the description promises",
    engine.includes("ownerCascade") && engine.includes("matchedMembers") && engine.includes("rowsFolded"),
    "",
  )
  harness.negative(
    "claim: the description's narrow rule is statement-shaped, not a general claim",
    !/Same owner-cascade semantics/.test(description) && description.includes("deliberately narrow"),
    description.slice(-260, -120),
  )
}

rmSync(root, { recursive: true, force: true })
harness.emit()

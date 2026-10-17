// script/m13/verify-visualize-options.ts — M13.59 (V5).
//
// THE GATE THAT WOULD HAVE CAUGHT F1, AND THE ONE PROPERTY EVERY OTHER V-GATE
// LACKED: a REGISTERED OPTION MUST CHANGE THE ANSWER.
//
// V1-V4 check the contract text and happy paths — enums, defaults, docs freshness,
// no dangling links, truncation arithmetic — and all four stayed green while
// `excludePatterns` and `includeTests` were published in the descriptor, the
// schema AND the docs, read by the engine, implemented by the renderer, and
// dropped by the handler's request literal. MEASURED before the fix, through the
// handler: `excludePatterns: ["src"]` left every src/ symbol in the answer with an
// `excluded` block whose patterns list contradicted the argument, and
// `includeTests: false` still returned test/app.test.ts with
// `includesTestFiles: true`.
//
// Everything here goes through the HANDLER, because that is where the defect was:
// the engine's own behaviour was already correct, so a gate that called
// `visualizeProject` directly would have passed on the broken revision.
//
// Each option is checked two ways:
//   - behaviourally: an argument that must change the answer, asserted on
//     nodes/links/excluded/considered/truncation, with a NEGATIVE control proving
//     the change is caused by the argument and not by the fixture; and
//   - structurally: every property in the published inputSchema must be read by
//     the handler, so an option added to the descriptor can never be
//     accepted-and-ignored again.
//
// M13.F5/F6/F7/F17 (#701) — the second batch, added to the same gate because it is
// the same property ("what the descriptor publishes is what the caller gets"):
//   - a BOUND out of range is REFUSED, naming the accepted range, never clamped
//     (`maxNodes: 0` used to return one node and echo `truncation.maxNodes: 1`);
//   - `languages`/`relationshipTypes`/`symbolKinds` are FOLDED case-insensitively
//     against the index's own spellings, and an unknown value is an ERROR naming the
//     stored set — never a zero-node answer that reads like an empty project;
//   - `symbolKinds` exists at all, so a caller can ask for the architecture instead of
//     taking whatever the ranking returns first (measured: 124 of 200 nodes are
//     constants/properties), and the composition is stated in `considered.kindCensus`
//     rather than living only inside the HTML panel.

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../../src/cli/index"
import { indexProjectParallel } from "../../src/ast/parallel-indexer"
import { createToolHandlers } from "../../src/mcp/tool-handlers"
import { PUBLIC_TOOL_DESCRIPTORS } from "../../src/mcp/tool-registry"
import { visualizeProject } from "../../src/intelligence/visualization/visualization-engine"
import { Harness } from "./harness"

const harness = new Harness({
  issue: "M13.59", code: "V5", tool: "bb_visualize",
  title: "bb_visualize: every published option changes the answer (handler-level)",
  layers: ["unit", "integration"],
  decisions: {
    level: "through createToolHandlers(), because the options were dropped in the handler while the engine honoured them",
    causality: "every option assertion carries a control run without the option",
    vocabulary: "languages/relationshipTypes are echoed in considered, so the applied filter is visible",
  },
  limitations: [
    "The vocabulary assertions are made through the handler against a fixture whose stored values are known; a value the index would hold in another project is not enumerated here.",
    "Small fixture; the option matrix is about plumbing, not about scale.",
  ],
})

const root = mkdtempSync(path.join(tmpdir(), "bb-viz-v5-"))
const write = (rel: string, body: string): void => {
  mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
  writeFileSync(path.join(root, rel), body)
}
write("src/api/handlers.ts", "import { parse } from './parse'\nexport function handleRequest(): string { return parse() }\nexport function unusedHelper(): string { return 'unused' }\n")
write("src/api/parse.ts", "export function parse(): string { return 'x' }\n")
write("src/util/edit_distance.ts", "export function editDistance(): number { return 1 }\n")
write("src/utilities/format_helpers.ts", "export function formatHelper(): number { return 2 }\n")
write("vendor/lib.ts", "export function vendoredThing(): number { return 3 }\n")
write("test/app.test.ts", "export function testApp(): number { return 4 }\n")
write("src/pricing.py", "def discount(rate):\n    return rate\n")

const projectId = getProjectId(root)
await indexProjectParallel(projectId, root, {})

const handlers = createToolHandlers() as any
const ctx = { projectPath: root, projectId }
const raw = async (args: Record<string, unknown>): Promise<{ text: string; isError: boolean }> => {
  const result = await handlers.bb_visualize({ format: "json", ...args }, ctx)
  return { text: result.content[0].text as string, isError: result.isError === true }
}
const run = async (args: Record<string, unknown>): Promise<any> => JSON.parse((await raw(args)).text)
const fileOf = (node: any): string => String(node.filePath ?? node.file ?? "")
const files = (result: any): string[] => [...new Set((result.nodes as any[]).map(fileOf))]

// ── the controls first, so every exclusion below is attributable ──────────────
const base = await run({})
harness.check("control: project scope returns the fixture's symbols", base.nodes.length > 0, String(base.nodes.length))
harness.check("control: src/ symbols are present by default", files(base).some((f) => f.startsWith("src/")), files(base).join(","))
harness.check("control: the test symbol is present by default", files(base).some((f) => f.includes("test/")), files(base).join(","))
harness.check("control: vendor/ is excluded by the DEFAULT patterns", !files(base).some((f) => f.startsWith("vendor/")) && (base.excluded?.byPattern?.vendor ?? 0) >= 1, JSON.stringify(base.excluded?.byPattern))
harness.check("control: default patterns are the documented twelve", JSON.stringify(base.excluded?.patterns) === JSON.stringify(["node_modules", ".git", ".next", ".turbo", ".cache", "coverage", "dist", "build", "out", "target", "vendor", "__pycache__"]), JSON.stringify(base.excluded?.patterns))

// ── excludePatterns (F1) ─────────────────────────────────────────────────────
{
  const scoped = await run({ excludePatterns: ["src"] })
  harness.check("excludePatterns: no returned symbol sits under the excluded segment", !files(scoped).some((f) => f.startsWith("src/")), files(scoped).join(","))
  harness.check("excludePatterns: the exclusion is attributed to the caller's segment", (scoped.excluded?.byPattern?.src ?? 0) >= 1, JSON.stringify(scoped.excluded?.byPattern))
  harness.check("excludePatterns: `patterns` is the caller's list, not the defaults", JSON.stringify(scoped.excluded?.patterns) === JSON.stringify(["src"]), JSON.stringify(scoped.excluded?.patterns))
  harness.negative("excludePatterns: the option is what removed src/ (control kept it)", base.nodes.length > scoped.nodes.length && files(base).some((f) => f.startsWith("src/")), `${base.nodes.length} -> ${scoped.nodes.length}`)
  // excludePatterns are path SEGMENTS by contract ("matched on whole segments,
  // never as substrings"), so the composition test excludes the module's own last
  // segment and expects the scope's symbols to be filtered out of the answer while
  // the SQL count still reports what the scope matched.
  const nested = await run({ scope: "module", target: "src/api", excludePatterns: ["api"] })
  harness.check("excludePatterns: composes with scope (the scope matched, the filter removed)", nested.totalNodesAvailable > 0 && nested.nodes.length === 0, `available=${nested.totalNodesAvailable} nodes=${nested.nodes.length}`)
  harness.check("excludePatterns: the scoped-away symbols are declared, not silently empty", nested.declaredAbsent === true && String(nested.absenceNote ?? "").includes("none survived the projection"), String(nested.absenceNote ?? ""))
  const segmentControl = await run({ scope: "module", target: "src/api" })
  harness.negative("excludePatterns: the segment is what removed them (control kept the module)", segmentControl.nodes.length > 0, `nodes=${segmentControl.nodes.length}`)
}

// ── includeTests (F1) ────────────────────────────────────────────────────────
{
  const noTests = await run({ includeTests: false })
  harness.check("includeTests:false removes the test symbol", !files(noTests).some((f) => f.includes("test/")), files(noTests).join(","))
  harness.check("includeTests:false is declared on `excluded`", noTests.excluded?.includesTestFiles === false, String(noTests.excluded?.includesTestFiles))
  harness.check("includeTests:false counts the removed test symbols", (noTests.excluded?.symbols ?? 0) > (base.excluded?.symbols ?? 0), `${base.excluded?.symbols} -> ${noTests.excluded?.symbols}`)
  harness.negative("includeTests:false is what removed it (control returned it)", files(base).some((f) => f.includes("test/")) && base.excluded?.includesTestFiles === true, files(base).join(","))
  const keepTests = await run({ includeTests: true })
  harness.check("includeTests:true keeps test sources and says so", files(keepTests).some((f) => f.includes("test/")) && keepTests.excluded?.includesTestFiles === true, files(keepTests).join(","))
}

// ── languages (F6: folded, and an unknown value is an error) ────────────────
{
  const only = await run({ languages: ["typescript"] })
  harness.check("languages: every returned node is of the requested language", only.nodes.length > 0 && (only.nodes as any[]).every((n) => n.group === "typescript"), JSON.stringify([...new Set((only.nodes as any[]).map((n) => n.group))]))
  harness.check("languages: the applied filter is echoed", JSON.stringify(only.considered?.languagesConsidered) === JSON.stringify(["typescript"]), JSON.stringify(only.considered?.languagesConsidered))
  harness.check("languages: the filter narrows the declared available count", only.totalNodesAvailable < base.totalNodesAvailable, `${base.totalNodesAvailable} -> ${only.totalNodesAvailable}`)
  // MEASURED before: ["TypeScript"] returned 0 nodes and declared "no indexed symbol matches",
  // because the stored form is "typescript" and the filter was a raw string comparison.
  const shouted = await run({ languages: ["TypeScript"] })
  harness.check("languages: the value is folded to the index's own spelling", shouted.nodes.length === only.nodes.length && JSON.stringify(shouted.considered?.languagesConsidered) === JSON.stringify(["typescript"]), `${only.nodes.length} vs ${shouted.nodes.length} / ${JSON.stringify(shouted.considered?.languagesConsidered)}`)
  harness.negative("languages: folding is what saved it (the mixed-case value is not stored verbatim)", shouted.considered?.languagesConsidered?.[0] !== "TypeScript", JSON.stringify(shouted.considered?.languagesConsidered))
  const unknown = await raw({ languages: ["klingon"] })
  harness.check("languages: an unknown value is refused", unknown.isError === true, unknown.text.slice(0, 120))
  harness.check("languages: and the refusal names the stored set", unknown.text.includes("unknown languages: klingon") && unknown.text.includes("typescript"), unknown.text.slice(0, 200))
  harness.negative("languages: an unknown value is never answered as an empty project", !unknown.text.includes("absence declared"), unknown.text.slice(0, 120))
}

// ── relationshipTypes (F7: vocabulary rejection + the applied filter echoed) ─
{
  const calls = await run({ relationshipTypes: ["calls"] })
  harness.check("relationshipTypes: only the requested kind is drawn", calls.links.length > 0 && (calls.links as any[]).every((l) => l.type === "calls"), JSON.stringify([...new Set((calls.links as any[]).map((l) => l.type))]))
  harness.check("relationshipTypes: the applied filter is echoed", JSON.stringify(calls.considered?.relationshipTypesConsidered) === JSON.stringify(["calls"]), JSON.stringify(calls.considered?.relationshipTypesConsidered))
  harness.negative("relationshipTypes: no filter means no filter is claimed", calls.considered?.relationshipTypesConsidered !== (base.considered?.relationshipTypesConsidered ?? null) || base.considered?.relationshipTypesConsidered === null, JSON.stringify(base.considered?.relationshipTypesConsidered))
  harness.negative("relationshipTypes: the filter bites (default draws other kinds too)", (base.links as any[]).some((l) => l.type !== "calls") || base.links.length !== calls.links.length, `${base.links.length} -> ${calls.links.length}`)
  const folded = await run({ relationshipTypes: ["Calls"] })
  harness.check("relationshipTypes: the value is folded to the index's own spelling", JSON.stringify(folded.considered?.relationshipTypesConsidered) === JSON.stringify(["calls"]), JSON.stringify(folded.considered?.relationshipTypesConsidered))
  // MEASURED before: ["call"] (a typo) left the nodes and emptied the edge set, and the answer
  // still called itself "complete for this node set" without naming the filter that did it.
  const typo = await raw({ relationshipTypes: ["call"] })
  harness.check("relationshipTypes: an unknown kind is refused", typo.isError === true, typo.text.slice(0, 120))
  harness.check("relationshipTypes: the refusal names the stored vocabulary", typo.text.includes("unknown relationshipTypes: call") && typo.text.includes("calls"), typo.text.slice(0, 240))
  harness.negative("relationshipTypes: a typo is not answered as `complete for this node set` with no edges", !typo.text.includes("complete for this node set"), typo.text.slice(0, 140))
}

// ── symbolKinds (F17: the filter exists, and the composition is declared) ───
{
  // The fixture's symbols are all `function` (the indexer's kind for a top-level TypeScript
  // `export function`), which is exactly why the CENSUS is the assertion that matters here: a
  // filter can only be shown to bite against kinds the index holds.
  const kinds = await run({ symbolKinds: ["function"] })
  const returned = [...new Set((kinds.nodes as any[]).map((n) => n.type))]
  harness.check("symbolKinds: only the requested kinds are returned", kinds.nodes.length > 0 && returned.every((k) => String(k) === "function"), JSON.stringify(returned))
  harness.check("symbolKinds: the applied filter is echoed", JSON.stringify(kinds.considered?.symbolKindsConsidered) === JSON.stringify(["function"]), JSON.stringify(kinds.considered?.symbolKindsConsidered))
  const shoutedKind = await run({ symbolKinds: ["Function"] })
  harness.check("symbolKinds: the value is folded to the index's own spelling", JSON.stringify(shoutedKind.considered?.symbolKindsConsidered) === JSON.stringify(["function"]) && shoutedKind.nodes.length === kinds.nodes.length, JSON.stringify(shoutedKind.considered?.symbolKindsConsidered))
  const unknownKind = await raw({ symbolKinds: ["wizard"] })
  harness.check("symbolKinds: an unknown kind is refused, naming the stored set", unknownKind.isError === true && unknownKind.text.includes("unknown symbolKinds: wizard") && unknownKind.text.includes("function"), unknownKind.text.slice(0, 240))
  // The kind the fixture does NOT have is the interesting one: before this batch it returned
  // zero nodes and declared an absence, which reads exactly like an empty project.
  const absentKind = await raw({ symbolKinds: ["class"] })
  harness.check("symbolKinds: a kind this index does not hold is an error, not an empty graph", absentKind.isError === true && absentKind.text.includes("this index stores function"), absentKind.text.slice(0, 200))
  harness.negative("symbolKinds: and it does not claim the project is empty", !absentKind.text.includes("absence declared"), absentKind.text.slice(0, 140))
  // The census is the fix for the MEASURED composition (124 of 200 nodes were constants and
  // properties on this repository) — it has to be in the ANSWER, in both formats.
  const censusSum = Object.values(base.considered?.kindCensus ?? {}).reduce((a: number, b: any) => a + Number(b), 0)
  harness.check("kindCensus: the census accounts for every returned node", censusSum === base.nodes.length, `census=${censusSum} nodes=${base.nodes.length}`)
  const asText = async (view: string): Promise<string> => (await handlers.bb_visualize({ scope: "project", view, format: "text" }, ctx)).content[0].text as string
  const censusText = await asText("graph")
  harness.check("kindCensus: the DEFAULT text format states the composition", censusText.includes("returned kinds:"), censusText.split("\n").find((l) => l.startsWith("returned kinds:")) ?? "")
  harness.check("kindCensus: with no kind filter it says so", censusText.includes("no kind filter was passed"), "")
  const filteredText = (await handlers.bb_visualize({ scope: "project", symbolKinds: ["function"], format: "text" }, ctx)).content[0].text as string
  harness.check("kindCensus: a filtered answer names the filter beside the census", filteredText.includes("filtered by symbolKinds=[function]"), filteredText.split("\n").find((l) => l.startsWith("returned kinds:")) ?? "")
  harness.check("kindCensus: the language census is stated too", censusText.includes("returned languages:"), censusText.split("\n").find((l) => l.startsWith("returned languages:")) ?? "")
}

// ── maxNodes / maxLinks: applied when in range, REFUSED when not (F5) ────────
{
  const bounded = await run({ maxNodes: 3 })
  harness.check("maxNodes: the node budget is applied", bounded.nodes.length <= 3, String(bounded.nodes.length))
  harness.check("maxNodes: the cut is declared", bounded.truncation?.truncated === true && bounded.truncation?.maxNodes === 3, JSON.stringify(bounded.truncation))
  harness.check("maxNodes: the three numbers stay distinct", bounded.truncation.totalNodesAvailable > bounded.truncation.originalNodes, JSON.stringify(bounded.truncation))
  harness.negative("maxNodes: an in-range budget is NOT reported as adjusted", bounded.truncation?.boundsAdjusted === undefined, JSON.stringify(bounded.truncation?.boundsAdjusted ?? null))
  const boundedLinks = await run({ maxLinks: 1 })
  harness.check("maxLinks: the link budget is applied", boundedLinks.links.length <= 1, String(boundedLinks.links.length))
  harness.negative("maxLinks: the budget is what cut the edges (the control drew more)", base.links.length > boundedLinks.links.length, `${base.links.length} -> ${boundedLinks.links.length}`)
  // MEASURED before: `maxNodes: 0` returned ONE node and echoed `truncation.maxNodes: 1`. The
  // project already ruled on this shape twice (bb_health sampleSize:0, bb_analyze limit:0) and
  // both times the ruling was refusal, not a clamp.
  for (const [label, args] of [["zero", { maxNodes: 0 }], ["negative", { maxNodes: -5 }], ["above the ceiling", { maxNodes: 2001 }], ["fractional", { maxNodes: 1.5 }]] as Array<[string, Record<string, unknown>]>) {
    const refused = await raw(args)
    harness.check(`maxNodes: ${label} is refused`, refused.isError === true, refused.text.slice(0, 120))
    harness.check(`maxNodes: the ${label} refusal names the accepted range`, refused.text.includes("between 1 and 2000") && refused.text.includes(JSON.stringify(args.maxNodes)), refused.text.slice(0, 200))
    harness.negative(`maxNodes: ${label} is not silently answered with a different page`, !refused.text.includes("\"nodes\""), refused.text.slice(0, 120))
  }
  const linkZero = await raw({ maxLinks: 0 })
  harness.check("maxLinks: zero is refused with the accepted range", linkZero.isError === true && linkZero.text.includes("between 1 and 20000"), linkZero.text.slice(0, 160))
  const linkCeiling = await run({ maxLinks: 20000 })
  harness.check("maxLinks: the ceiling itself is ACCEPTED (the range is inclusive)", linkCeiling.links.length >= 0 && linkCeiling.truncation?.maxLinks === 20000, JSON.stringify(linkCeiling.truncation))
  const nodeCeiling = await run({ maxNodes: 2000 })
  harness.check("maxNodes: the ceiling itself is ACCEPTED", nodeCeiling.truncation?.maxNodes === 2000, JSON.stringify(nodeCeiling.truncation))
}
// ── offset: a scope bigger than one page can be WALKED ───────────────────────
//
// MEASURED as a gap, not a defect: `maxNodes` selects the top-N and there was no
// `offset`, no `startAfter` and no id list, so on a project larger than the default
// page a symbol past the cut could not be asked for at all — while `bb_search` has
// `offset` and `bb_migrate` has `symbolIds`. The property that makes paging real is
// not "offset changes something"; it is that consecutive pages TILE the same order:
// page 1 followed by page 2 is exactly the first two pages' worth of the unpaged
// answer, with nothing repeated and nothing skipped. An order with ties cannot do
// that, which is why every ORDER BY in the engine now ends with `s.id`.
{
  const ids = (result: any): string[] => (result.nodes as any[]).map((node) => String(node.id))
  const whole = await run({ maxNodes: 4 })
  const p1 = await run({ maxNodes: 2 })
  const p2 = await run({ maxNodes: 2, offset: 2 })
  harness.check("offset: the page block declares where this answer sits", p1.considered?.page?.offset === 0 && p1.considered?.page?.number === 1 && p1.considered?.page?.limit === 2 && p1.considered?.page?.returned === 2, JSON.stringify(p1.considered?.page))
  harness.check("offset: the answer names the NEXT page instead of leaving it to arithmetic", p1.considered?.page?.nextOffset === 2, JSON.stringify(p1.considered?.page))
  harness.check("offset: page 2 begins where page 1 ended", ids(p2).every((id, index) => ids(whole)[index + 2] === id), `whole=${ids(whole).join(",")} p2=${ids(p2).join(",")}`)
  harness.negative("offset: the cursor is what moved (page 2 is not page 1 again)", JSON.stringify(ids(p1)) !== JSON.stringify(ids(p2)), `p1=${ids(p1).join(",")} p2=${ids(p2).join(",")}`)
  harness.check("offset: consecutive pages TILE the unpaged answer — nothing repeated, nothing skipped", JSON.stringify([...ids(p1), ...ids(p2)]) === JSON.stringify(ids(whole)), `p1+p2=${[...ids(p1), ...ids(p2)].join(",")} whole=${ids(whole).join(",")}`)
  harness.check("offset: paging does not change the denominator", p1.considered?.page?.total === whole.considered?.page?.total && p2.considered?.page?.total === whole.considered?.page?.total, `${p1.considered?.page?.total} / ${p2.considered?.page?.total} / ${whole.considered?.page?.total}`)
  harness.check("offset: truncation carries the cursor too", p2.truncation?.offset === 2 && p2.truncation?.nextOffset === 4, JSON.stringify(p2.truncation))
  // The LAST page must say it is the last one. The fixture projects seven symbols (`vendor/`
  // is excluded by the default segment rule), so offset 6 is the final one.
  const last = await run({ maxNodes: 2, offset: 6 })
  harness.check("offset: the last page reports nextOffset null", last.considered?.page?.nextOffset === null && last.considered?.page?.returned === 1, JSON.stringify(last.considered?.page))
  harness.check("offset: and it is not reported as absent", last.declaredAbsent === false, String(last.declaredAbsent))
  // An empty PAGE is not an empty project — the distinction the whole tool is built on.
  const past = await run({ maxNodes: 2, offset: 8 })
  harness.check("offset: a page past the end is declared an empty PAGE", past.declaredAbsent === true && String(past.absenceNote ?? "").includes("empty PAGE"), String(past.absenceNote ?? ""))
  harness.negative("offset: and it does NOT claim the project has no symbols", !String(past.absenceNote ?? "").includes("no indexed symbol matches"), String(past.absenceNote ?? ""))
  // The DEFAULT text format has to say it too, or the reply a caller gets without asking is
  // the one that cannot be walked.
  const pagedText = (await handlers.bb_visualize({ scope: "project", maxNodes: 2, offset: 2, format: "text" }, ctx)).content[0].text as string
  harness.check("offset: the text format states the page and the next cursor", /^page: symbols 3-4 .*offset 2.*next page: offset=4$/m.test(pagedText), pagedText.split("\n").find((line) => line.startsWith("page:")) ?? "(no page line)")
  const pastText = (await handlers.bb_visualize({ scope: "project", offset: 8, format: "text" }, ctx)).content[0].text as string
  harness.check("offset: the text format calls an out-of-range page empty rather than absent", pastText.includes("empty PAGE") && !pastText.includes("no indexed symbol matches"), pastText.split("\n").find((line) => line.startsWith("absent:")) ?? pastText.slice(0, 120))
  // A page cursor is not a budget and is not normalised: it is refused, like every other
  // parameter whose silent reinterpretation would hand the caller a different page.
  const negativeOffset = await raw({ offset: -2 })
  harness.check("offset: a negative cursor is refused", negativeOffset.isError === true && negativeOffset.text.includes("whole number >= 0"), negativeOffset.text.slice(0, 200))
  const fractionalOffset = await raw({ offset: 1.5 })
  harness.check("offset: a fractional cursor is refused", fractionalOffset.isError === true && fractionalOffset.text.includes("whole number >= 0"), fractionalOffset.text.slice(0, 200))
  harness.negative("offset: a refusal is not answered with a page", !fractionalOffset.text.includes("\"nodes\""), fractionalOffset.text.slice(0, 120))
  // The handler is one door; the engine is the other one (the CLI and every gate call it
  // directly). Neither may hand a caller a different page without saying so, and the engine's
  // door is where a normalisation would otherwise be silent.
  const directNegative = await visualizeProject(projectId, { scope: "project", offset: -3, maxNodes: 2 })
  harness.check("offset: a direct engine caller is TOLD its cursor was normalised", directNegative.considered?.page?.offset === 0 && (directNegative.truncation.boundsAdjusted ?? []).some((note) => note.includes("offset")), JSON.stringify(directNegative.truncation.boundsAdjusted ?? null))
  const directFractional = await visualizeProject(projectId, { scope: "project", offset: 1.5, maxNodes: 2 })
  harness.check("offset: and a fractional one is normalised the same way, with the note", directFractional.considered?.page?.offset === 0 && (directFractional.truncation.boundsAdjusted ?? []).some((note) => note.includes("offset")), JSON.stringify(directFractional.truncation.boundsAdjusted ?? null))
  harness.negative("offset: a valid cursor is NOT reported as adjusted", (p1.truncation.boundsAdjusted ?? []).length === 0, JSON.stringify(p1.truncation.boundsAdjusted ?? null))
}


// ── view (F4a: the text format names the picture it describes) ───────────────
{
  const asText = async (view: string): Promise<string> => (await handlers.bb_visualize({ scope: "project", view, format: "text" }, ctx)).content[0].text as string
  for (const view of ["graph", "codemap", "class"]) {
    const text = await asText(view)
    harness.check(`view: text names ${view}`, text.includes(`view: ${view} `), text.split("\n").slice(0, 3).join(" | ").slice(0, 160))
    harness.negative(`view: ${view} text does not claim another view`, !["graph", "codemap", "class"].filter((v) => v !== view).some((v) => new RegExp(`view: ${v} `).test(text)), "")
    const parsed = await run({ view })
    harness.check(`view: json carries ${view}`, parsed.view === view, String(parsed.view))
  }
}

// ── structural: no published option can be accepted and ignored ──────────────
{
  const descriptor = PUBLIC_TOOL_DESCRIPTORS.find((t) => t.name === "bb_visualize")
  const properties = Object.keys((descriptor?.inputSchema as any)?.properties ?? {})
  harness.check("registry: bb_visualize publishes its input properties", properties.length >= 10, String(properties.length))
  const source = readFileSync(path.resolve(import.meta.dir, "..", "..", "src", "mcp", "tool-handlers.ts"), "utf8")
  const section = source.slice(source.indexOf("bb_visualize:"), source.indexOf("bb_migrate:"))
  const requestLiteral = section.slice(section.indexOf("const request: VisualizationRequest"), section.indexOf("const result = await visualizeProject"))
  // Every published property must be a KEY of the request the handler builds. The
  // value side is checked separately below, and `scope` is deliberately read from a
  // validated local (`const scope = String(args.scope ?? "project")` plus the enum
  // check) rather than from `args` directly.
  const missingKeys = properties.filter((property) => !new RegExp(`(^|[\\s{,])${property}\\s*:`).test(requestLiteral))
  harness.check("handler: every published property is a key of the request", missingKeys.length === 0, missingKeys.length ? `missing: ${missingKeys.join(",")}` : properties.join(","))
  // The read is checked across the WHOLE handler section rather than the request literal, because
  // M13.F5/F6/F7/F17 moved three of them: `languages`, `relationshipTypes` and `symbolKinds` are
  // validated and FOLDED before the literal is built, and the literal then carries the folded
  // values. What must not happen is a property that is never read at all.
  const unread = properties.filter((property) => property !== "scope" && !section.includes(`args.${property}`))
  harness.check("handler: every published property is read from args", unread.length === 0, unread.length ? `ignored: ${unread.join(",")}` : properties.filter((p) => p !== "scope").join(","))
  harness.check(
    "handler: the request carries the VALIDATED filter values, not the raw arguments",
    ["relationshipTypes: relationshipFilter.folded", "languages: languageFilter.folded", "symbolKinds: symbolKindFilter.folded"].every((needle) => requestLiteral.includes(needle)),
    requestLiteral.slice(requestLiteral.indexOf("relationshipTypes"), requestLiteral.indexOf("relationshipTypes") + 120),
  )
  harness.check("handler: scope is validated against the five scopes before it is used", section.includes('["project", "file", "module", "symbol", "feature"].includes(scope)'), "scope validation missing")
  harness.negative("handler: the request names the two options that were dropped before", requestLiteral.includes("args.excludePatterns") && requestLiteral.includes("args.includeTests"), requestLiteral.slice(0, 120))
}

rmSync(root, { recursive: true, force: true })
harness.emit()

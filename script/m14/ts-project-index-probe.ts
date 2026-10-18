/**
 * TS PROJECT-INDEX PROBE — the executable pin for `applyProjectIndexClaims` over a REAL index.
 *
 * ## Why this is a script and not only a fixture
 *
 * The decision this pass makes (`module:item` -> bare item, or a cited external claim, or nothing)
 * needs a COMPLETE `ProjectIndex` — a per-file fixture gets `projectIndex: undefined` from the
 * shared fixture runner unless the fixture is a sub-directory, and a sub-directory fixture's
 * `projectRoot` is not passed either today. So the pass would have no executable check at all.
 * This probe builds the index the way production does (`buildProjectIndexFromDisk` with the real
 * `TYPESCRIPT_DECLARATION_SPEC`) over the fixture project and hands the analyzer the SAME context
 * shape production does (`{ projectIndex, projectRoot }`).
 *
 * ## What it asserts, each with its control
 *
 * Over one consumer file (fixture `project-index-imports/consumer.ts`), the three outcomes this
 * pass may produce and the two refusals:
 *
 *   RESOLVE   a project-local item declared EXACTLY ONCE -> bare target + resolvedViaProjectIndex
 *             (both the type channel and the FS-P17 name-only channel, i.e. a free function)
 *   REFUSE    a project-local item declared TWICE -> target unchanged + projectIndexAmbiguous
 *   REFUSE    a project-local module whose item is NOT declared -> no claim at all
 *   CLAIM     an external package / node builtin -> module-namespace claim with its specifier
 *   UNTOUCHED an already-bare relative import
 *
 * THE CONTROL: the same source with NO index must produce ZERO re-spellings and ZERO claims —
 * the fail-closed contract. If the control run changes anything, the pass is not fail-closed and
 * the probe says so rather than printing a clean line.
 *
 * Usage: bun run script/m14/ts-project-index-probe.ts
 */
import * as fs from "node:fs"
import * as path from "node:path"
import { ASTEngine } from "../../src/ast/engine"
import { RealTypeScriptAnalyzer } from "../../src/ast/real-typescript-analyzer"
import { resolveWasmAsset } from "../../src/util/wasm"

const ROOT = path.resolve((import.meta as any).dirname ?? path.dirname(Bun?.main ?? process.argv[1] ?? "."), "..", "..")
const PROJECT = path.join(ROOT, "validation", "m14", "fixtures", "typescript", "project-index-imports")
const CONSUMER = path.join(PROJECT, "consumer.ts")

type Outcome = { what: string; ok: boolean; detail: string }
const outcomes: Outcome[] = []
const check = (what: string, ok: boolean, detail: string) => outcomes.push({ what, ok, detail })

function importsRows(result: any): any[] {
  return (result.relationships ?? []).filter((r: any) => String(r.type) === "imports")
}
function findImport(rows: any[], target: string): any | undefined {
  return rows.find((r: any) => String(r.target) === target)
}

const content = fs.readFileSync(CONSUMER, "utf8")
const parser = await ASTEngine.getParser("typescript" as any)
const tree = parser.parse(content)
if (tree === null) {
  console.error("PROBE FAILED — tree-sitter returned no tree for the fixture source; nothing can be measured")
  process.exit(1)
}
const analyzer = new RealTypeScriptAnalyzer()

// ── CONTROL ARM FIRST: no context at all. The pass must be a no-op. ──────────────────────────────
const withoutIndex: any = analyzer.analyze(tree.rootNode, content, path.join("validation", "m14", "fixtures", "typescript", "project-index-imports", "consumer.ts"))
const ctrlRows = importsRows(withoutIndex)
const ctrlRespelled = ctrlRows.filter((r: any) => r.metadata?.resolvedViaProjectIndex === true).length
const ctrlClaims = ctrlRows.filter((r: any) => r.metadata?.isExternalTarget === true).length
const ctrlAmbiguous = ctrlRows.filter((r: any) => r.metadata?.projectIndexAmbiguous === true).length
check(
  "CONTROL (no index): zero re-spellings, zero claims, zero ambiguity markers",
  ctrlRespelled === 0 && ctrlClaims === 0 && ctrlAmbiguous === 0,
  `respelled=${ctrlRespelled} claims=${ctrlClaims} ambiguous=${ctrlAmbiguous}`,
)
check(
  "CONTROL (no index): the module:item spellings are still module:item",
  findImport(ctrlRows, "@fixture/utils:WidgetOptions") !== undefined && findImport(ctrlRows, "vue:vueOnly") !== undefined,
  `targets=${JSON.stringify(ctrlRows.map((r: any) => r.target))}`,
)

// ── THE REAL ARM: a REAL index over the fixture project, complete === true. ─────────────────────
const projectFiles: string[] = []
const collect = (dir: string) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) collect(p)
    else if (entry.name.endsWith(".ts")) projectFiles.push(p)
  }
}
collect(PROJECT)
projectFiles.sort()

const mod: any = await import("../../src/ast/project-index")
const wasm = resolveWasmAsset("tree-sitter-typescript/tree-sitter-typescript.wasm")
const projectIndex = await mod.buildProjectIndexFromDisk(wasm, projectFiles, mod.TYPESCRIPT_DECLARATION_SPEC)
mod.buildResolutionTables(projectIndex)
// The gate/production stamp this bit from the caller's own knowledge (`whole`); the probe KNOWS the
// file set is the whole project, so it stamps it too — an index is never allowed to vouch for itself.
projectIndex.complete = true

const counts: Map<string, number> = projectIndex.symbolCounts
console.log(`fixture project: ${projectFiles.length} file(s) indexed · symbolCounts[WidgetOptions]=${counts.get("WidgetOptions")} · [makeWidget]=${counts.get("makeWidget")} · [Twice]=${counts.get("Twice")} · [missingThing]=${counts.get("missingThing") ?? "absent"}`)
check("index: WidgetOptions declared once", counts.get("WidgetOptions") === 1, `count=${counts.get("WidgetOptions")}`)
check("index: makeWidget declared once through the name-only channel", counts.get("makeWidget") === 1, `count=${counts.get("makeWidget")}`)
check("index: Twice declared twice", counts.get("Twice") === 2, `count=${counts.get("Twice")}`)
check("index: missingThing not declared", (counts.get("missingThing") ?? 0) === 0, `count=${counts.get("missingThing") ?? 0}`)

const withIndex: any = analyzer.analyze(tree.rootNode, content, path.join("validation", "m14", "fixtures", "typescript", "project-index-imports", "consumer.ts"), {
  projectIndex,
  projectRoot: PROJECT,
})
const rows = importsRows(withIndex)

const widget = findImport(rows, "WidgetOptions")
check(
  "RESOLVE: project-local interface declared once -> bare target + resolvedViaProjectIndex",
  widget !== undefined && widget.metadata?.resolvedViaProjectIndex === true,
  widget ? `target=${JSON.stringify(widget.target)} resolvedViaProjectIndex=${widget.metadata?.resolvedViaProjectIndex}` : "no bare WidgetOptions row",
)
const makeWidget = findImport(rows, "makeWidget")
check(
  "RESOLVE: project-local FREE FUNCTION declared once (FS-P17 name-only channel) -> bare target",
  makeWidget !== undefined && makeWidget.metadata?.resolvedViaProjectIndex === true,
  makeWidget ? `target=${JSON.stringify(makeWidget.target)}` : "no bare makeWidget row",
)
const twice = findImport(rows, "@fixture/utils:Twice")
check(
  "REFUSE: declared TWICE -> target unchanged + projectIndexAmbiguous, and NO bare Twice row",
  twice !== undefined && twice.metadata?.projectIndexAmbiguous === true && findImport(rows, "Twice") === undefined,
  twice ? `target=${JSON.stringify(twice.target)} ambiguous=${twice.metadata?.projectIndexAmbiguous}` : "row missing",
)
const missing = findImport(rows, "@fixture/utils:missingThing")
check(
  "REFUSE: project module, item NOT declared -> no claim, no re-spelling",
  missing !== undefined && missing.metadata?.isExternalTarget !== true && missing.metadata?.projectIndexItemNotDeclared === true,
  missing ? `target=${JSON.stringify(missing.target)} external=${missing.metadata?.isExternalTarget} notDeclared=${missing.metadata?.projectIndexItemNotDeclared}` : "row missing",
)
const vue = findImport(rows, "vue:vueOnly")
check(
  "CLAIM: external package -> module-namespace claim with its specifier",
  vue !== undefined && vue.metadata?.isExternalTarget === true && vue.metadata?.externalReason === "module-namespace" && vue.metadata?.externalSpecifier === "vue",
  vue ? `externalReason=${vue.metadata?.externalReason} specifier=${vue.metadata?.externalSpecifier}` : "row missing",
)
const nodePath = findImport(rows, "node:path:join")
check(
  "CLAIM: node builtin -> module-namespace claim",
  nodePath !== undefined && nodePath.metadata?.isExternalTarget === true && nodePath.metadata?.externalSpecifier === "node:path",
  nodePath ? `externalReason=${nodePath.metadata?.externalReason} specifier=${nodePath.metadata?.externalSpecifier}` : "row missing",
)
const local = findImport(rows, "localThing")
check(
  "UNTOUCHED: an already-bare relative import stays bare and unmarked",
  local !== undefined && local.metadata?.resolvedViaProjectIndex !== true && local.metadata?.isExternalTarget !== true,
  local ? `target=${JSON.stringify(local.target)}` : "row missing",
)
check(
  "ALL CASES PRESENT: the consumer's imports all emitted",
  rows.length >= 7,
  `${rows.length} imports rows: ${JSON.stringify(rows.map((r: any) => String(r.target).replace(/\u0000/g, "\\0")))}`,
)

const failed = outcomes.filter((o) => !o.ok)
for (const o of outcomes) console.log(`${o.ok ? "  ok  " : "  FAIL"}  ${o.what} — ${o.detail}`)
console.log(`\nVERDICT: ${failed.length === 0 ? "PASS" : "FAIL"} — ${outcomes.length - failed.length}/${outcomes.length} checks · control arm ${ctrlRespelled === 0 && ctrlClaims === 0 ? "clean (fail-closed)" : "DIRTY — the pass is not fail-closed"}`)
process.exit(failed.length === 0 ? 0 : 1)

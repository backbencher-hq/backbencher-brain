/**
 * PROJECT-INDEX IMPORTS — the pinned probe for the analyzer-side `context.projectIndex` wiring.
 *
 * WHY A PROBE AND NOT A FLAT FIXTURE. The behaviour under test is exactly the capability
 * `AnalyzeContext.projectIndex` describes, and it is FAIL-CLOSED on
 * `projectIndex.complete === true` — a flat fixture (and every sampled/index-less run) supplies
 * no index, so the pass is a deliberate no-op there and a flat fixture could only prove the
 * no-op. A sub-directory fixture gets an index, but `buildProjectIndexFromDisk` never states
 * completeness (the caller does), so the sub-directory runner hands the analyzer `complete`
 * UNSET — again the no-op. This probe builds the index itself, states `complete = true` (which
 * is true: it indexes every file of the synthetic project), and asserts the three operations:
 *
 *   RESOLUTION  a file's own absolute import names a module the COMPLETE index proves this
 *               project ships, and the imported ITEM is declared exactly ONCE -> the edge's
 *               target becomes the ITEM (the symbol the edge refers to), module kept in
 *               metadata. A TWICE-declared name is NOT retargeted (the same-named
 *               false-binding class this lane already refused: 5 py / 432 ts / 276 js).
 *   CLAIM       the complete index proves the project does not ship the module -> the imports
 *               edge carries `isExternalTarget` + `externalReason: "module-namespace"` +
 *               `externalSpecifier` (the arbiter's moduleNamespace claim kind).
 *   SUPPRESSION a name whose module the index proves is the project's OWN code keeps NO
 *               external claim (a claim of externality on project code is a false statement).
 *   DOT RULE    a RELATIVE import is never asked about and never claimed — the leading dot is
 *               part of the rule (the 6-false-verified-external-edges defect this lane records).
 *
 * The probe also pins the FAIL-CLOSED direction: with `complete` unset or false, the analyzer
 * output must be byte-identical to the pre-capability behaviour (no retarget, no claim).
 *
 * Usage: bun run validation/m14/fixtures/python/project-index-import-edge.mts
 * Exit 0 iff every assertion holds; 1 otherwise (a pin that cannot fail proves nothing, so the
 * probe prints each EXPECTED/ACTUAL pair on failure).
 */
import { mkdirSync, writeFileSync, rmSync } from "node:fs"
import * as path from "node:path"
import { readFileSync } from "node:fs"

const ROOT = path.resolve((import.meta as any).dir ?? path.dirname(Bun?.main ?? process.argv[1] ?? "."), "..", "..", "..", "..")
const PROJ = path.join(ROOT, ".tmp-py", "probe-proj")

// ── the synthetic project: two packages, one third-party import, one relative import ─────────
const FILES: Record<string, string> = {
  "app/__init__.py": "",
  "app/handlers.py": [
    "class Handler:",
    "    def run(self):",
    "        return 1",
    "",
    "def helper():",
    "    return 2",
    "",
  ].join("\n"),
  "app/models.py": [
    "class Widget:",
    "    pass",
    "",
    "# A SECOND declaration of the same name, in another module: the item a `from` import binds",
    "# must not be retargeted onto one of these by presence alone.",
    "class Twin:",
    "    pass",
    "",
  ].join("\n"),
  "app/other.py": [
    "class Twin:",
    "    pass",
    "",
  ].join("\n"),
  "lib/__init__.py": "",
  "lib/local.py": "VALUE = 3\n",
}

const MAIN = [
  "from app.handlers import Handler, helper", // 1: project-local, declared once -> retarget to Handler; helper -> suppression case below
  "from app.models import Twin",             // 2: project-local, declared TWICE -> no retarget
  "from third.party import Widget, widget_fn", // 3: absent from project -> moduleNamespace claim
  "from third.party import widget_fn as wf",
  "from lib.local import VALUE",             // 4: project-local, VALUE is not an indexed declaration -> no retarget
  "from . import sibling",                   // 5: relative -> never asked, never claimed
  "",
  "def use():",
  "    helper()",                               // 6: project-local binding -> claim SUPPRESSED
  "    wf()",                                   // 7: third-party binding -> claim ADDED (control)
  "    return Handler().run() + use_member()",
  "",
  "def use_member():",
  "    return Handler().run()",
  "",
].join("\n")

type Edge = { type: string; target: string; source: string; metadata: Record<string, any> }
type Check = { id: string; ok: boolean; detail: string }
const checks: Check[] = []
const expect = (id: string, ok: boolean, detail: string) => checks.push({ id, ok, detail })

function findEdge(edges: Edge[], pick: (e: Edge) => boolean): Edge | undefined {
  return edges.find(pick)
}

async function main(): Promise<number> {
  rmSync(PROJ, { recursive: true, force: true })
  for (const [rel, content] of Object.entries(FILES)) {
    const abs = path.join(PROJ, rel)
    mkdirSync(path.dirname(abs), { recursive: true })
    writeFileSync(abs, content)
  }
  const mainPath = path.join(PROJ, "main.py")
  writeFileSync(mainPath, MAIN)

  const engine: any = await import("../../../../src/ast/engine")
  const projectIndex: any = await import("../../../../src/ast/project-index")
  const analyzerMod: any = await import("../../../../src/ast/real-python-analyzer")
  const wasm = path.join(ROOT, "wasm", "tree-sitter-python.wasm")
  const projectFiles = Object.keys(FILES).map((rel) => path.join(PROJ, rel))

  const index = await projectIndex.buildProjectIndexFromDisk(wasm, projectFiles, projectIndex.PYTHON_DECLARATION_SPEC)
  // THE CALLER STATES COMPLETENESS, because the builder cannot see the run. This index covers
  // every file of the synthetic project, which is what the bit means.
  index.complete = true
  const parser = await engine.ASTEngine.getParser("python")
  const tree = parser.parse(MAIN)
  if (!tree) throw new Error("parse returned no tree")
  const analyzer = new analyzerMod.RealPythonAnalyzer()
  const result = await analyzer.analyze(tree.rootNode, MAIN, mainPath, { projectIndex: index })
  const edges: Edge[] = result.relationships ?? []

  // ── A: RESOLUTION — project-local + declared once -> target becomes the ITEM ─────────────
  const handler = findEdge(edges, (e) => e.type === "imports" && String(e.target).includes("Handler"))
  expect(
    "A/project-local-retarget",
    handler !== undefined && handler.target === "Handler" && handler.metadata.projectIndexResolution === "item-declared-once",
    `imports edge for Handler: ${JSON.stringify(handler && { target: handler.target, md: handler.metadata })}`,
  )
  expect(
    "A/module-kept",
    handler !== undefined && handler.metadata.module === "app.handlers",
    `metadata.module must stay app.handlers; got ${JSON.stringify(handler?.metadata?.module)}`,
  )
  expect(
    "A/qualified-written-route",
    handler !== undefined && handler.metadata.qualified === "app.handlers.Handler",
    `metadata.qualified must carry the written route; got ${JSON.stringify(handler?.metadata?.qualified)}`,
  )

  // ── B: TWICE-declared item is NOT retargeted (the false-binding class) ───────────────────
  const twin = findEdge(edges, (e) => e.type === "imports" && String(e.target).includes("Twin"))
  expect(
    "B/twice-declared-not-retargeted",
    twin !== undefined && twin.target === "app.models:Twin" && twin.metadata.projectIndexResolution === undefined,
    `Twin must keep its module:item spelling; got ${JSON.stringify(twin && { target: twin.target, md: twin.metadata })}`,
  )

  // ── C: THIRD-PARTY -> the moduleNamespace claim ──────────────────────────────────────────
  const third = findEdge(edges, (e) => e.type === "imports" && String(e.target).includes("Widget"))
  expect(
    "C/third-party-module-namespace-claim",
    third !== undefined &&
      third.metadata.isExternalTarget === true &&
      third.metadata.externalReason === "module-namespace" &&
      third.metadata.externalSpecifier === "third.party",
    `third-party imports edge: ${JSON.stringify(third && { target: third.target, md: third.metadata })}`,
  )

  // ── D: RELATIVE import untouched (the dot is part of the rule) ──────────────────────────
  const relative = findEdge(edges, (e) => e.type === "imports" && JSON.stringify(e.metadata ?? {}).includes("sibling"))
  expect(
    "D/relative-never-claimed",
    relative === undefined || (relative.metadata.isExternalTarget !== true && relative.metadata.externalReason !== "module-namespace"),
    `relative import must carry no external claim; got ${JSON.stringify(relative && { target: relative.target, md: relative.metadata })}`,
  )

  // ── E: SUPPRESSION — a name bound to the project's OWN module keeps NO external claim ────
  // Two directions, because suppression alone could also be produced by a certifier that
  // claims nothing at all: `helper` is bound to `app.handlers` (project code -> NO claim) and
  // `wf` is bound to `third.party` (outside the project -> the claim MUST appear).
  const helperCall = findEdge(edges, (e) => e.type === "calls" && String(e.target) === "helper")
  expect(
    "E/no-external-claim-on-project-local-module",
    helperCall !== undefined && helperCall.metadata?.isExternalTarget !== true,
    `calls helper bound to app.handlers must carry NO external claim; got ${JSON.stringify(helperCall?.metadata)}`,
  )
  const wfCall = findEdge(edges, (e) => e.type === "calls" && String(e.target) === "wf")
  expect(
    "E/control-third-party-claim-still-landed",
    wfCall !== undefined && wfCall.metadata?.isExternalTarget === true && wfCall.metadata?.externalSpecifier === "third.party",
    `control: calls wf bound to third.party MUST carry the external claim; got ${JSON.stringify(wfCall?.metadata)}`,
  )

  // ── F: FAIL-CLOSED — complete absent/false must be byte-identical to no-index ────────────
  const withoutComplete = await projectIndex.buildProjectIndexFromDisk(wasm, projectFiles, projectIndex.PYTHON_DECLARATION_SPEC)
  // THE BUILDER EXPLICITLY WRITES `complete: false` (emptyProjectIndex), so the ABSENT case —
  // an older payload, or an index whose completeness nobody stated — is simulated by deleting
  // the field. Both must be no-ops; the contract says a reader tests `=== true`, never truthiness
  // and never `=== false`, because `undefined === false` is FALSE and a `=== false` guard would
  // let an unstated index drive the retarget/claim passes.
  delete (withoutComplete as any).complete
  const tree2 = parser.parse(MAIN)
  const result2 = await analyzer.analyze(tree2.rootNode, MAIN, mainPath, { projectIndex: withoutComplete })
  const edges2: Edge[] = result2.relationships ?? []
  const anyRetarget = edges2.some((e) => e.metadata?.projectIndexResolution !== undefined)
  const anyNamespace = edges2.some((e) => e.metadata?.externalReason === "module-namespace")
  expect(
    "F/fail-closed-without-complete",
    !anyRetarget && !anyNamespace,
    `index without complete=true must be a no-op; retargets=${anyRetarget} namespaceClaims=${anyNamespace}`,
  )
  const tree3 = parser.parse(MAIN)
  const result3 = await analyzer.analyze(tree3.rootNode, MAIN, mainPath, undefined)
  const edges3: Edge[] = result3.relationships ?? []
  const key = (e: Edge) => `${e.type}|${e.target}|${JSON.stringify(e.metadata ?? {})}`
  const set2 = new Set(edges2.map(key))
  const set3 = new Set(edges3.map(key))
  expect(
    "F/index-fragment-equals-no-index",
    set2.size === set3.size && [...set2].every((k) => set3.has(k)),
    `unstated-completeness index must equal no index: ${set2.size} vs ${set3.size} edge signatures`,
  )

  // ── report ──────────────────────────────────────────────────────────────────────────────
  const failed = checks.filter((c) => !c.ok)
  for (const c of checks) console.log(`${c.ok ? "PASS" : "FAIL"}  ${c.id}${c.ok ? "" : ` — ${c.detail}`}`)
  const indexStats = `index: ${index.stats.files} files · ${index.modules.size} module entries · ${index.symbolCounts.size} counted names`
  console.log(`\n${indexStats}`)
  console.log(`edges ${edges.length} (main.py), checks ${checks.length - failed.length}/${checks.length} pass`)
  if (failed.length > 0) {
    console.error(`PROBE FAILED: ${failed.length} check(s)`)
    return 1
  }
  console.log("PROBE PASS")
  return 0
}

const code = await main()
// Clean up the synthetic project: it is scratch, and `.tmp-py/` is gitignored.
rmSync(PROJ, { recursive: true, force: true })
process.exit(code)

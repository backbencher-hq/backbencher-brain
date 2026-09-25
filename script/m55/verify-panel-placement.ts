// script/m55/verify-panel-placement.ts — M55.P1 verifier + mutation suite
// (issue #776).
//
// Truth Rule 6 (§15): space is the user's. The defect was structural, not
// cosmetic — three panel files each hardcoded `ViewColumn.Beside` and none set
// `preserveFocus`, so two hover actions in one session produced four editor
// columns and moved the cursor out of the file. A suite that only inspected one
// panel would have missed it, so this one checks:
//
//   P1 decision:   the ONE vscode-free placement rule (ide/vscode/src/
//                  panel-placement.ts) over the setting matrix — default =
//                  current group, `beside` honored, and every value this
//                  extension CANNOT honor resolved to the default WITH a
//                  declared warning (never a silent no-op).
//   P2 reuse:      the registry + key rules — one panel per symbol+file, the
//                  same click twice is the same panel, key cleanup on dispose.
//   P3 structure:  the three panel files, read as text: no column literal, the
//                  object showOptions with preserveFocus on every create, a
//                  reuse path that reveals without stealing focus, and the
//                  setting actually CONTRIBUTED by the extension manifest (a
//                  setting nobody can set is not a setting).
//   P4 mutants:    a reintroduced hardcoded column, an ignored setting, a lost
//                  preserveFocus and a silent fallback must each fail.
//
// The in-editor leg (column count unchanged + active editor still the source
// file, in a pinned VS Code) is the closure requirement this suite cannot
// satisfy headlessly; it belongs to V1's rig and is recorded as remaining.
//
// Run: npx tsx script/m55/verify-panel-placement.ts
// Evidence: validation/m55/results/P1.json (machine-emitted)

import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { writeSealed } from "../lib/evidence.ts"
import { parseSealedRecord } from "../lib/evidence.ts"

const ROOT = path.resolve(import.meta.dirname, "../..")
const MODULE = path.join(ROOT, "ide/vscode/src/panel-placement.ts")
const PANELS = {
  hub: path.join(ROOT, "ide/vscode/src/hub-panel.ts"),
  impact: path.join(ROOT, "ide/vscode/src/impact-panel.ts"),
  graph: path.join(ROOT, "ide/vscode/src/graph-panel.ts"),
} as const
const MANIFEST = path.join(ROOT, "ide/vscode/package.json")
const EVIDENCE = path.join(ROOT, "validation/m55/results/P1.json")

let checks = 0
let passed = 0
const failures: string[] = []
let mutantsCaught = 0
let mutantsTotal = 0
function check(label: string, ok: boolean, detail = ""): void {
  checks++
  if (ok) passed++
  else failures.push(detail ? `${label}: ${detail}` : label)
  console.log(`  ${ok ? "✓" : "✗"} ${label}${ok || !detail ? "" : ` — ${detail}`}`)
}
function mutant(label: string, caught: boolean, detail = ""): void {
  mutantsTotal++
  if (caught) mutantsCaught++
  check(`${label} [mutant]`, caught, detail)
}

const currentCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
const dirty = execFileSync("git", ["status", "--porcelain"], { cwd: ROOT, encoding: "utf8" })
  .split("\n")
  .filter((l) => l.trim() !== "")
  .map((l) => l.slice(3))

const mod = (await import(pathToFileURL(MODULE).href)) as typeof import("../../ide/vscode/src/panel-placement.ts")
const { resolvePanelPlacement, PanelRegistry, panelKey, DEFAULT_PANEL_PLACEMENT, PANEL_PLACEMENT_SETTING } = mod

// The editor's column numbers (ViewColumn.Active = -1, Beside = -2 in vscode;
// declared here as plain numbers so this suite stays editor-free).
const COLUMNS = { Active: -1, Beside: -2 }

// --- P1: the decision matrix -------------------------------------------------
console.log("P1: the placement decision (vscode-free)")
const dflt = resolvePanelPlacement(undefined, COLUMNS)
check("P1: the default opens in the CURRENT group (owner decision, 2026-09-12)", dflt.viewColumn === COLUMNS.Active && dflt.mode === DEFAULT_PANEL_PLACEMENT, JSON.stringify(dflt))
check("P1: the default keeps the cursor (informational panel, preserveFocus)", dflt.preserveFocus === true, JSON.stringify(dflt))
check("P1: the declared default is activeGroup", DEFAULT_PANEL_PLACEMENT === "activeGroup", DEFAULT_PANEL_PLACEMENT)
const explicit = resolvePanelPlacement("activeGroup", COLUMNS)
check("P1: an explicit activeGroup behaves as the default", explicit.viewColumn === COLUMNS.Active && explicit.warning === undefined, JSON.stringify(explicit))
const beside = resolvePanelPlacement("beside", COLUMNS)
check("P1: beside is honored for a user who wants a split", beside.viewColumn === COLUMNS.Beside && beside.mode === "beside" && beside.warning === undefined, JSON.stringify(beside))
const keyboard = resolvePanelPlacement(undefined, COLUMNS, { takesKeyboardInput: true })
check("P1: a panel that takes keyboard input may keep focus (the rule is declared, not blanket)", keyboard.preserveFocus === false, JSON.stringify(keyboard))
for (const v of ["panel", "secondarySidebar"] as const) {
  const d = resolvePanelPlacement(v, COLUMNS)
  check(
    `P1: '${v}' (not implementable for webview panels) falls back to the default AND declares it`,
    d.viewColumn === COLUMNS.Active && typeof d.warning === "string" && d.warning.includes(v),
    JSON.stringify(d),
  )
}
const bogus = resolvePanelPlacement("nonsense", COLUMNS)
check(
  "P1: an unknown value is a DECLARED fallback, never a silent one",
  bogus.viewColumn === COLUMNS.Active && typeof bogus.warning === "string" && bogus.warning.includes("nonsense"),
  JSON.stringify(bogus),
)

// --- P2: reuse ------------------------------------------------------------------
console.log("\nP2: reuse (one panel per symbol+file)")
const reg = new PanelRegistry<{ reveal?: (...a: never[]) => void }>()
check("P2: an empty registry holds nothing", reg.get("hub:main") === null && reg.size === 0, "")
reg.set("hub:main", {})
check("P2: a registered key is found (the reuse path)", reg.get("hub:main") !== null && reg.size === 1, "")
reg.delete("hub:main")
check("P2: a disposed panel leaves no stale handle", reg.get("hub:main") === null && reg.size === 0, "")
check(
  "P2: the same symbol+file is the SAME key (a second click reuses the panel)",
  panelKey("hub", "main", "/w/src/app.ts") === panelKey("hub", "main", "/w/src/app.ts"),
  "",
)
check(
  "P2: the same member from a DIFFERENT file is a different panel (one constructor per class)",
  panelKey("impact", "constructor", "/w/src/store.ts") !== panelKey("impact", "constructor", "/w/src/cache.ts"),
  "",
)
check("P2: an absent file still produces a stable key", panelKey("graph", "main") === panelKey("graph", "main"), panelKey("graph", "main"))

// --- P3: the structure of the panels -------------------------------------------
console.log("\nP3: the panel files (read as text — the defect was structural)")
/** The structural rule, as a pure function so a mutant can be run through it. */
function lintPanelSource(name: string, src: string): string[] {
  const v: string[] = []
  // The ONE declared injection point: resolvePlacementFromSettings hands the
  // editor's own column numbers to the vscode-free rule. Everywhere ELSE a
  // column name is a defect — that is what "no per-panel fork" means.
  const withoutInjection = src.replace(/export function resolvePlacementFromSettings[\s\S]*?\n}\n/, "")
  if (/ViewColumn\./.test(withoutInjection)) v.push(`${name}: names a column (must ask the placement helper)`)
  if (!/PanelRegistry/.test(src)) v.push(`${name}: no reuse registry (a click could open a second panel)`)
  if (!/panelKey\(/.test(src)) v.push(`${name}: no reuse key`)
  if (!/resolvePlacementFromSettings\(\)/.test(src)) v.push(`${name}: does not ask the placement helper`)
  if (!/viewColumn: placement\.viewColumn, preserveFocus: placement\.preserveFocus/.test(src))
    v.push(`${name}: createWebviewPanel does not receive the declared show options`)
  if (!/reveal\(undefined, true\)/.test(src)) v.push(`${name}: the reuse path does not reveal without stealing focus`)
  return v
}
const sources: Record<string, string> = {}
for (const [name, file] of Object.entries(PANELS)) {
  sources[name] = readFileSync(file, "utf8")
  const v = lintPanelSource(name, sources[name])
  check(`P3: ${name} panel satisfies every structural rule`, v.length === 0, v.join("; "))
}
const helper = readFileSync(path.join(ROOT, "ide/vscode/src/graph-panel.ts"), "utf8")
check(
  "P3: one place resolves the placement (the panels share it, no per-panel fork)",
  /resolvePlacementFromSettings/.test(helper) && /ViewColumn\.Active/.test(helper) && /ViewColumn\.Beside/.test(helper),
  "",
)
const manifest = parseSealedRecord(MANIFEST) as {
  contributes?: { configuration?: { properties?: Record<string, { enum?: string[]; default?: string }> } }
}
const prop = manifest.contributes?.configuration?.properties?.[PANEL_PLACEMENT_SETTING]
check("P3: the extension CONTRIBUTES the setting (a setting nobody can set is not a setting)", prop !== undefined, PANEL_PLACEMENT_SETTING)
check(
  "P3: the contributed enum matches the declared values and the default is the owner's decision",
  prop !== undefined &&
    JSON.stringify(prop.enum) === JSON.stringify(["activeGroup", "beside", "panel", "secondarySidebar"]) &&
    prop.default === "activeGroup",
  JSON.stringify(prop ?? null),
)

// --- P4: mutants ------------------------------------------------------------------
console.log("\nP4: mutants (each planted defect must fail the suite)")
const moduleSource = readFileSync(MODULE, "utf8")
async function withModule(name: string, from: string, to: string, probe: (m: any) => boolean): Promise<void> {
  if (!moduleSource.includes(from)) {
    check(`M: ${name} (SKIP — anchor not found)`, false, from.slice(0, 80))
    return
  }
  const dir = mkdtempSync(path.join(tmpdir(), "m55-p1-mut-"))
  const target = path.join(dir, "mutant.ts")
  writeFileSync(target, moduleSource.replace(from, to))
  try {
    const m = await import(pathToFileURL(target).href)
    mutant(name, probe(m))
  } catch (e) {
    mutant(name, true, `mutant failed to load: ${String(e).slice(0, 80)}`)
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {}
  }
}

// M1 (acceptance 5): a hardcoded column reintroduced into a panel — the lint
// must catch it. This is the defect the whole issue is about, planted back.
{
  const mutated = sources.hub!.replace(
    "const placement = resolvePlacementFromSettings()",
    "const placement = { viewColumn: ViewColumn.Beside, preserveFocus: false }",
  )
  const v = lintPanelSource("hub", mutated)
  mutant("M1: a reintroduced hardcoded ViewColumn.Beside is caught", v.length > 0, v.join("; ").slice(0, 120))
}
// M2: the setting is ignored — every value opens beside (the pre-M55 behaviour).
await withModule("M2: the setting ignored (always the old beside split)", "  return {\n    viewColumn: requested === \"beside\" ? columns.Beside : columns.Active,", "  return {\n    viewColumn: columns.Beside,", (m) => {
  // An EXPLICIT activeGroup, so the probe exercises the mutated branch (the
  // default path short-circuits before it and would hide the defect).
  const d = m.resolvePanelPlacement("activeGroup", COLUMNS)
  return d.viewColumn !== COLUMNS.Active
})
// M3: preserveFocus lost — the informational open steals the cursor again.
await withModule("M3: preserveFocus lost (the cursor moves out of the file)", "    preserveFocus: opts.takesKeyboardInput !== true,\n    mode: requested,", "    preserveFocus: false,\n    mode: requested,", (m) => {
  const d = m.resolvePanelPlacement("activeGroup", COLUMNS)
  return d.preserveFocus === false
})
// M4: the unimplemented values silently no-op (no warning).
await withModule("M4: an unsupported value falls back silently", "      warning: `bb.panelPlacement '${requested}' is not implemented for webview panels (editor-area columns only) — using ${DEFAULT_PANEL_PLACEMENT}`,", "      warning: undefined,", (m) => {
  const d = m.resolvePanelPlacement("secondarySidebar", COLUMNS)
  return typeof d.warning !== "string"
})

// --- Evidence -----------------------------------------------------------------------
const status = failures.length === 0 ? "verified" : "known-gap"
const result = {
  issue: "776",
  code: "P1",
  milestone: "M55",
  title: "Panel placement + focus (Truth Rule 6)",
  status,
  passed,
  failed: failures.length,
  checks,
  mutantsCaught,
  mutantsTotal,
  negatives: 0,
  currentHost: process.platform,
  focusLeg: "pending — column count + active editor are asserted in-editor by V1's rig (closure requirement)",
  currentCommit,
  workingTreeRelevantChanges: dirty.filter((f) => f.startsWith("ide/vscode/") || f.startsWith("script/m55/")),
  verifierCommand: "npx tsx script/m55/verify-panel-placement.ts",
  evidenceFile: "P1.json",
  generatedAt: new Date().toISOString(),
  failures,
}
mkdirSync(path.dirname(EVIDENCE), { recursive: true })
writeSealed(EVIDENCE, result)
console.log(`\nP1: ${status.toUpperCase()} (${passed}/${checks} passed, ${mutantsCaught}/${mutantsTotal} mutants)`)
console.log(`Evidence: ${EVIDENCE}`)
if (failures.length > 0) {
  console.log("Failures:")
  for (const f of failures) console.log(`  - ${f}`)
  process.exit(1)
}
process.exit(0)

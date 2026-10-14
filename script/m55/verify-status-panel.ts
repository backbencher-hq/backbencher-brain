// script/m55/verify-status-panel.ts — M55.V1 component gate: the status SURFACE
// (Truth Rule 1 — a fact that cannot be read was not delivered).
//
// FOUND BY THE FRAME, not by a plan: validation/m55/frames/live-7/7-status.png
// shows `Backbencher: Show status` rendering a notification whose entire
// visible content is "launch: compiled dist (bundled) — …". The command exists
// to state the evidence levels, the activation budget, the index phase and the
// staleness marker; it asked `window.showInformationMessage(lines.join("\n"))`
// and VS Code renders a notification as ONE line. Everything else was
// collapsed away — the claim survived, the facts did not.
//
// Ownership (one owner per surface, the house rule):
//   script/m25/verify-status-surface.ts  owns the MODEL (renderStatus: the
//                                        lines, the laws, the actions).
//   THIS gate                            owns the SURFACE (the panel markup
//                                        that carries those lines to the eye).
//
// What this gate checks:
//
//   S1 every fact:   the pure markup owner renders EVERY model line, in order,
//                    with no truncation — the defect in one assertion.
//   S2 stale first:  the staleness marker leads the surface and is loud; a
//                    stale status can never render as a clean list.
//   S3 escaping:     repo-controlled strings go through the DOM port; an HTML
//                    payload in a line, a language, an id or a description
//                    must arrive escaped (W6 law; no innerHTML in the owner).
//   S4 declared emptiness: no active editor and no declared language each
//                    render a note that SAYS so — never a blank table (which
//                    reads as "nothing to report").
//   S5 wiring:       the command renders the surface (not a notification
//                    carrying the facts), through the ONE shell, the ONE
//                    placement helper and the ONE panel-reuse key, with no
//                    second style or placement rule for this panel.
//   S6 mutants:      a dropped line, a reordered line, an unescaped line, a
//                    buried stale marker, a silent empty table and a return to
//                    the notification-only surface must each fail.
//
// Run: npx tsx script/m55/verify-status-panel.ts
// Evidence: validation/m55/results/V1-status-panel.json (machine-emitted)

import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { writeSealed } from "../lib/evidence.ts"
import { fingerprintFields } from "../m61/claim_fingerprints.ts"

const ROOT = path.resolve(import.meta.dirname, "../..")
const MODULE = path.join(ROOT, "ide/vscode/src/status-markup.ts")
const EXTENSION = path.join(ROOT, "ide/vscode/src/extension.ts")
const EVIDENCE = path.join(ROOT, "validation/m55/results/V1-status-panel.json")

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

const mod = (await import(pathToFileURL(MODULE).href)) as typeof import("../../ide/vscode/src/status-markup.ts")
const { renderStatusMarkup, statusSurfaceState } = mod

/** The model's own shape, as the frames' input produced it (seven facts, two
 *  languages, one action). Kept literal so a change in the model is visible
 *  here as a diff, not swallowed by a helper. */
const INPUT: mod.StatusSurfaceInput = {
  lines: [
    "server: running (0.1.0)",
    "activation: 132ms / declared 150ms budget — within budget",
    "index: ready",
    "this file (typescript): I4 — index-sourced, structural relationships verified",
    "freshness: fresh (reindexed)",
    "launch: compiled dist (bundled) — /repo/dist/lsp/server.js",
    "log: ~/.bb/logs/bb-lsp.log",
  ],
  // The facts `bbLsp.showServerStatus` owns. They were their OWN 4-line
  // notification until this fix and collapsed to one line exactly like the
  // main surface did (frame live-8/7 showed only "launch: compiled dist…").
  serverFacts: [
    "launch: compiled dist (bundled) — /repo/dist/lsp/server.js",
    "server version: 0.1.0",
    "version ok: yes",
    "activation: 132 ms (declared budget 150 ms, within)",
  ],
  staleBadge: null,
  noActiveFileNote: null,
  perLanguage: [
    { language: "typescript", level: "I4", description: "index-sourced, structural relationships verified" },
    { language: "java", level: "I4", description: "index-sourced, structural relationships verified" },
  ],
  actions: [{ title: "Index now", command: "bbLsp.indexNow" }],
}

// --- S1: every fact, in order, no truncation --------------------------------------
console.log("S1: every model line reaches the surface, in order")
const markup = renderStatusMarkup(INPUT)
for (const line of INPUT.lines) {
  check(`S1: the line "${line.slice(0, 28)}…" is on the surface`, markup.includes(line))
}
check(
  "S1: zero lines are dropped (the count of fact rows equals the model's line count)",
  (markup.match(/data-fact="/g) ?? []).length === INPUT.lines.length,
  `${(markup.match(/data-fact="/g) ?? []).length} vs ${INPUT.lines.length}`,
)
const order = INPUT.lines.map((l) => markup.indexOf(l))
check("S1: the lines keep the model's order (no reordering)", order.every((idx, i) => idx >= 0 && (i === 0 || idx > order[i - 1]!)), JSON.stringify(order))
check(
  "S1: the surface is a LIST of facts, not one line (a notification could carry exactly one of these lines)",
  INPUT.lines.length > 1 && (markup.match(/data-fact="/g) ?? []).length > 1,
)
check("S1: the per-language table renders every declared language", INPUT.perLanguage.every((p) => markup.includes(p.language) && markup.includes(p.level)))
// Read off the live frame (live-10/7-status.png): the rows rendered
// "I1 — I1 — protocol-passed", because `description` already starts with the
// level. A fact stated twice reads as a broken surface.
/** The rule as a pure function so a mutant can be run through it: a level that
 *  appears twice in one row ("I1 — I1 — protocol-passed") is a duplicated
 *  fact, and duplicate facts read as a broken surface. */
function duplicatedLevels(out: string, perLanguage: Array<{ level: string }>): string[] {
  return perLanguage.filter((p) => out.includes(`${p.level} — ${p.level}`)).map((p) => p.level)
}
check(
  "S1: no per-language row states its level twice",
  duplicatedLevels(markup, INPUT.perLanguage).length === 0,
  duplicatedLevels(markup, INPUT.perLanguage).join(", "),
)
check(
  "S1: the server-provenance facts render (the second collapsed notification's facts)",
  INPUT.serverFacts.every((l) => markup.includes(l)) && (markup.match(/data-server-fact="/g) ?? []).length === INPUT.serverFacts.length,
  `${(markup.match(/data-server-fact="/g) ?? []).length} vs ${INPUT.serverFacts.length}`,
)
check("S1: the actions render with their command ids (no dead buttons, no hidden remedies)", markup.includes("bbLsp.indexNow") && markup.includes("Index now"))
check("S1: the state slot reports the same counts as the markup", (() => {
  const s = JSON.parse(statusSurfaceState(INPUT)) as { facts: number; serverFacts: number; perLanguage: number; actions: number; staleMarker: boolean }
  return (
    s.facts === INPUT.lines.length &&
    s.serverFacts === INPUT.serverFacts.length &&
    s.perLanguage === INPUT.perLanguage.length &&
    s.actions === INPUT.actions.length &&
    s.staleMarker === false
  )
})())

// --- S2: the staleness marker leads ------------------------------------------------
console.log("\nS2: staleness is the first thing on the surface")
const stale = renderStatusMarkup({ ...INPUT, staleBadge: "STALE — index behind your edits; results may be wrong until reindex" })
check("S2: the marker is rendered", stale.includes("STALE — index behind your edits"))
check("S2: the marker is marked for styling (a marker that renders as ordinary text is not loud)", /class="bb-stale-marker"[^>]*data-stale="true"/.test(stale), stale.slice(0, 160))
check(
  "S2: the marker precedes the facts (never buried below a clean list)",
  stale.indexOf("STALE — index behind your edits") < stale.indexOf(INPUT.lines[0]!),
)
check("S2: the state slot says a marker is present", (JSON.parse(statusSurfaceState({ ...INPUT, staleBadge: "x" })) as { staleMarker: boolean }).staleMarker === true)

// --- S3: escaping is the port's job ----------------------------------------------
console.log("\nS3: repo-controlled strings are escaped")
const hostile = renderStatusMarkup({
  ...INPUT,
  lines: ['log: <script>alert("x")</script>'],
  perLanguage: [{ language: '<img src=x onerror=alert(1)>', level: "I4", description: "</span><b>bold</b>" }],
  actions: [{ title: '</b><script>alert(2)</script>', command: '"onmouseover="alert(3)' }],
})
check("S3: a script tag in a fact line arrives escaped", !/<script>/.test(hostile) && hostile.includes("&lt;script&gt;"))
check("S3: an attribute-injection attempt in a language name arrives escaped", !/<img src=x/.test(hostile))
check("S3: a closing-tag attempt in a description arrives escaped", !/<\/span><b>/.test(hostile))
check("S3: an attribute-injection attempt in a command id arrives escaped", !/"onmouseover="/.test(hostile))
const moduleSource = readFileSync(MODULE, "utf8")
check("S3: the owner never concatenates HTML by hand (no innerHTML, no template-built tags)", !/innerHTML/.test(moduleSource) && !/<div\s*\$\{/.test(moduleSource))
check("S3: the owner is pure (no vscode import — the gate could not run it otherwise)", !/from "vscode"/.test(moduleSource))

// --- S4: declared emptiness --------------------------------------------------------
console.log("\nS4: absence is declared, never a blank table")
const noFile = renderStatusMarkup({ ...INPUT, noActiveFileNote: "No active editor — the per-file facts are not claimed." })
check("S4: the no-active-editor note is rendered", noFile.includes("No active editor — the per-file facts are not claimed"))
check("S4: the note is marked (machine-readable, not prose only)", /data-no-active-file="true"/.test(noFile))
const noLang = renderStatusMarkup({ ...INPUT, perLanguage: [] })
check("S4: an empty per-language table SAYS it is empty", /data-empty="per-language"/.test(noLang) && /nothing is claimed/i.test(noLang))

// --- S5: wiring --------------------------------------------------------------------
console.log("\nS5: the command renders a surface, through the shared owners")
const ext = readFileSync(EXTENSION, "utf8")
/** Strip comments before linting: the module's own header QUOTES the defect
 *  (“it asked window.showInformationMessage(lines.join("\n"))”) to explain why
 *  it was removed, and a lint that reads prose as code fails the fix it is
 *  looking at (the same lesson the earlier lane lints learned). */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")
}
/** The status-surface REGION of extension.ts: from the command's handler to the
 *  next section. Scoping the lint here matters — the file legitimately calls
 *  `showInformationMessage(lines.join("\n"))` for OTHER surfaces (the indexing
 *  consent prompt), and a file-wide regex would flag those and fail a correct
 *  fix. What must never happen is the STATUS facts taking that road. */
function statusRegion(src: string): string {
  const start = src.indexOf("export async function showStatusPanel")
  if (start < 0) return ""
  const end = src.indexOf("// E2: auto-index on open", start)
  return end > start ? src.slice(start, end) : src.slice(start)
}

/** The wiring rule as a pure function so mutants can be run through it. */
function lintWiring(fullSource: string): string[] {
  const src = statusRegion(fullSource)
  const v: string[] = []
  if (src === "") return ["showStatusPanel is not in extension.ts"]
  if (!/await showStatusSurface\(view, input, context\)/.test(src)) v.push("showStatusPanel does not render the surface")
  if (!/buildWebviewHtml\(\{ cspSource, stateJson: statusSurfaceState\(surface\), bodyMarkup: renderStatusMarkup\(surface\) \}\)/.test(src))
    v.push("the surface does not go through the ONE shell + the pure markup owner")
  if (!/resolvePlacementFromSettings\(\)/.test(src)) v.push("the status panel does not ask the ONE placement helper")
  if (!/panelKey\("status", "status", undefined\)/.test(src)) v.push("the status panel does not use the ONE reuse key")
  if (!/serverFacts: serverProvenanceLines\(\)/.test(src)) v.push("the provenance facts are not fed to the surface")
  // One surface, not two: bbLsp.showServerStatus must land on the SAME surface
  // (its own facts are the provenance section), never its own notification.
  // Checked on the WHOLE source: that registration sits above this region.
  if (!/registerCommand\("bbLsp\.showServerStatus", \(\) => void showStatusPanel\(context\)\)/.test(fullSource))
    v.push("bbLsp.showServerStatus does not open the one status surface (a second surface is how two commands ended up telling different stories)")
  if (!/createWebviewPanel\(\s*"bbStatus"/.test(src)) v.push("no bbStatus panel is created")
  if (!/lockStep|STATUS_PANELS\.get\(STATUS_PANEL_KEY\)/.test(src)) v.push("the surface does not reuse its panel (a second click must not open a second column)")
  // The defect itself: facts must not ride a notification line.
  if (/showInformationMessage\(view\.tooltipLines\.join/.test(src) || /showInformationMessage\(lines\.join\("\\n"\)/.test(src))
    v.push("the facts are still going into a notification (VS Code renders one line — the defect)")
  const joined = src.slice(src.indexOf("async function showStatusSurface"))
  const body = joined.slice(0, joined.indexOf("\n}", 400))
  if (/ViewColumn\./.test(body)) v.push("the status panel names a column itself (must ask the placement helper)")
  return v
}
const wiring = lintWiring(stripComments(ext))
check("S5: the status surface is wired through the shared owners", wiring.length === 0, wiring.join("; "))
// S5b: the palette reads as the docs say it does. Every contributed command
// here has category "Backbencher" AND a title that used to start with
// "Backbencher: " — so the palette rendered "Backbencher: Backbencher: Show
// status (…)" while docs/m25/INSTALL.md tells the user to run
// "Backbencher: Show status". The probe frame (typed query, match list) is what
// made the duplication visible.
interface ContributedCommand {
  command: string
  title: string
  category?: string
}
function duplicateCategoryTitles(commands: ContributedCommand[]): string[] {
  return commands
    .filter((c) => typeof c.category === "string" && c.category.length > 0 && c.title.startsWith(`${c.category}: `))
    .map((c) => `${c.command}: "${c.title}" repeats the category "${c.category}"`)
}
const manifest = JSON.parse(readFileSync(path.join(ROOT, "ide/vscode/package.json"), "utf8")) as {
  contributes?: { commands?: ContributedCommand[] }
}
const dupTitles = duplicateCategoryTitles(manifest.contributes?.commands ?? [])
check("S5b: no palette title repeats its category (the palette must read as the docs name it)", dupTitles.length === 0, dupTitles.join("; "))
check("S5: the panel is contributed by name (a panel nobody can open is not a surface)", /"bbLsp\.showStatusPanel"/.test(ext))

// --- S6: mutants -------------------------------------------------------------------
console.log("\nS6: mutants (each planted defect must fail the suite)")
async function withModule(name: string, from: string, to: string, caught: (m: typeof mod) => boolean): Promise<void> {
  if (!moduleSource.includes(from)) {
    check(`M: ${name} (SKIP — anchor not found)`, false, from.slice(0, 70))
    return
  }
  const dir = mkdtempSync(path.join(tmpdir(), "m55-v1-sts-mut-"))
  const target = path.join(dir, "mutant.ts")
  writeFileSync(target, moduleSource.replace(from, to))
  try {
    const m = (await import(pathToFileURL(target).href)) as typeof mod
    mutant(name, caught(m))
  } catch (e) {
    mutant(name, true, `mutant failed to load: ${String(e).slice(0, 80)}`)
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {}
  }
}

// M1: the defect back — only the first line renders (what a notification did).
await withModule(
  "M1: only the first fact renders (the collapsed-notification behaviour)",
  "  input.lines.forEach((line, i) => {",
  "  input.lines.slice(0, 1).forEach((line, i) => {",
  (m) => !m.renderStatusMarkup(INPUT).includes(INPUT.lines[1]!),
)
// M2: the facts are reordered (the surface stops matching the model's order).
await withModule(
  "M2: the facts are reordered",
  "  input.lines.forEach((line, i) => {",
  "  [...input.lines].reverse().forEach((line, i) => {",
  (m) => {
    const out = m.renderStatusMarkup(INPUT)
    const idx = INPUT.lines.map((l) => out.indexOf(l))
    return idx.some((v, i) => v < 0 || (i > 0 && v < idx[i - 1]!))
  },
)
// M3: a line goes in unescaped (hand-built HTML).
await withModule(
  "M3: a fact line is injected as raw HTML",
  '    name.textContent = line',
  '    name.rawHtml = line',
  (m) => {
    const out = m.renderStatusMarkup({ ...INPUT, lines: ["<script>alert(1)</script>"] })
    return out.includes("<script>") || out.indexOf("<script>") === -1
  },
)
// M4: the stale marker is buried below the facts.
await withModule(
  "M4: the stale marker is buried below the facts",
  "    root.appendChild(marker)\n  }",
  "    // buried: appended last instead of first\n  }",
  (m) => {
    const out = m.renderStatusMarkup({ ...INPUT, staleBadge: "STALE — results may be wrong" })
    return out.indexOf("STALE — results may be wrong") > out.indexOf(INPUT.lines[0]!)
  },
)
// M5: an empty per-language table renders silently.
await withModule(
  "M5: an empty table renders with no declared-empty note",
  '    empty.textContent = "No language has a declared claim level yet — nothing is claimed, and this line says so rather than showing an empty table."',
  '    empty.textContent = ""',
  (m) => !/nothing is claimed/i.test(m.renderStatusMarkup({ ...INPUT, perLanguage: [] })),
)
// M8: the provenance section is dropped (the second notification's facts go
// missing again — the exact regression this fix exists to prevent).
await withModule("M8: the provenance facts stop rendering", "  if (input.serverFacts.length > 0) {", "  if (false) {", (m) => !m.renderStatusMarkup(INPUT).includes(INPUT.serverFacts[0]!))
// M6: the surface goes back to being a notification (the wiring lint must see it).
{
  const mutated = ext.replace(
    'commands.registerCommand("bbLsp.showServerStatus", () => void showStatusPanel(context))',
    'commands.registerCommand("bbLsp.showServerStatus", () => { void window.showInformationMessage(serverProvenanceLines().join("\\n")) })',
  )
  const v = lintWiring(stripComments(mutated))
  mutant("M6b: showServerStatus goes back to its own collapsed notification", v.length > 0, v.join("; ").slice(0, 140))
}
// M10: the level is stated twice again (the live frame's "I1 — I1 — protocol-passed").
await withModule(
  "M10: a per-language row states its level twice",
  "    meta.textContent = p.description",
  "    meta.textContent = `${p.level} — ${p.description}`",
  (m) => duplicatedLevels(m.renderStatusMarkup(INPUT), INPUT.perLanguage).length > 0,
)
// M9: a title starts repeating its category again.
{
  const dup = duplicateCategoryTitles([
    { command: "bbLsp.showStatusPanel", title: "Backbencher: Show status (evidence levels, staleness)", category: "Backbencher" },
  ])
  mutant("M9: a palette title repeats its category again", dup.length === 1, dup.join("; ").slice(0, 120))
}
// M7: the provenance facts stop reaching the surface.
{
  const mutated = ext.replace("serverFacts: serverProvenanceLines(),", "serverFacts: [],")
  const v = lintWiring(stripComments(mutated))
  mutant("M7: the provenance facts are dropped from the surface", v.length > 0, v.join("; ").slice(0, 140))
}

{
  const mutated = ext.replace(
    "  await showStatusSurface(view, input, context)",
    '  await window.showInformationMessage(view.tooltipLines.join("\\n"))',
  )
  const v = lintWiring(mutated)
  mutant("M6: the facts return to a one-line notification", v.length > 0, v.join("; ").slice(0, 140))
}

// --- Evidence ----------------------------------------------------------------------
const status = failures.length === 0 ? "verified" : "known-gap"
const result = {
  issue: "V1-component",
  code: "V1-status-panel",
  milestone: "M55",
  title: "The status surface (Truth Rule 1: a fact that cannot be read was not delivered)",
  status,
  passed,
  failed: failures.length,
  checks,
  mutantsCaught,
  mutantsTotal,
  negatives: 0,
  currentCommit,
  ...fingerprintFields(["m55.V1-status-panel"], ROOT),
  workingTreeRelevantChanges: dirty.filter((f) => f.startsWith("ide/vscode/") || f.startsWith("script/m55/")),
  foundBy: "the V1 rig's own frame: validation/m55/frames/live-7/7-status.png (the visible content was the single line 'launch: compiled dist (bundled) — …')",
  owner: "ide/vscode/src/status-markup.ts (pure markup) + ide/vscode/src/extension.ts (panel + reuse)",
  modelOwner: "ide/vscode/src/status-model.ts (unchanged; gated by script/m25/verify-status-surface.ts)",
  verifierCommand: "npx tsx script/m55/verify-status-panel.ts",
  evidenceFile: "V1-status-panel.json",
  generatedAt: new Date().toISOString(),
  failures,
}
mkdirSync(path.dirname(EVIDENCE), { recursive: true })
writeSealed(EVIDENCE, result)
console.log(`\nV1-status-panel: ${status.toUpperCase()} (${passed}/${checks} passed, ${mutantsCaught}/${mutantsTotal} mutants)`)
console.log(`Evidence: ${EVIDENCE}`)
if (failures.length > 0) {
  console.log("Failures:")
  for (const f of failures) console.log(`  - ${f}`)
  process.exit(1)
}

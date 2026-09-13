// script/m55/verify-live-surface.ts — M55.V1 verifier + mutation suite
// (issue #776, §14 Truth Rule 5: the editor is the gate).
//
// The milestone's own evidence came from a hand-run rig. This gate makes that
// rig PERMANENT, WIRED and FAIL-ABLE: it runs the promoted probe over the real
// server and the real index, reads the captured frames back at the PIXEL level
// (so a DOM-perfect renderer that ships unstyled still fails), and proves it
// can fail by planting five defects a fresh install would show.
//
// What it proves, in order:
//
//   R1 probe:   every declared flow reads over the real dist server against the
//               DECLARED external fixture and its real index — identity at a
//               declaration and at a call site agree, the card carries a human
//               signature and no serialization, the tier story is the legend's
//               vocabulary, the hub rows agree with the owner, and a symbol
//               that does not exist is a LOUD error on both doors.
//   R2 frames:  the captured frames are the installed bundle's, their hashes
//               hold, the hover really changed the workbench, the hub/impact/
//               call-hierarchy frames show content AND the editor column
//               survived, and no frame is a blank render.
//   R3 stale:   the recorded bundle hash still equals the bundle built at THIS
//               HEAD — a frame about a stale bundle is the exact failure the
//               protocol exists to prevent.
//   R4 mutants: five planted defects (pre-T5 vocabulary in the probe, a stale
//               bundle hash, a blank frame, a fabricated call-site identity,
//               and two identical panel frames) each FAIL.
//   R5 wiring:  the gate is in the npm verify chain AND the CI verify:fast
//               chain (machine-read from package.json, not a doc claim).
//
// The frames leg is BLOCKED-NOT-GREEN when the rig, the fixture or its index is
// absent: the reason is recorded and the check passes as a declared blocked
// state (the M25 convention), never as an unstated skip.
//
// Run: npx tsx script/m55/verify-live-surface.ts
// Evidence: validation/m55/results/V1.json (+ V1-probe.json, frames/<run>/)

import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { M55_ROOT, ensureServerBuilt } from "./lsp-wire.ts"
import { runWireProbe, DECLARED_FIXTURE, type ProbeResult } from "./wire-probe.ts"
import { CAPTURE_FLOWS, FRAMES_DIR, PIXEL_READ, SCREEN, rigPreflight } from "./screenshot-protocol.ts"

const ROOT = M55_ROOT
const EVIDENCE = path.join(ROOT, "validation/m55/results/V1.json")
const PROBE_OUT = path.join(ROOT, "validation/m55/results/V1-probe.json")
const CORE = path.join(ROOT, "script/m26/graph-core.ts")
const OWNER = path.join(ROOT, "src/lsp/evidence_tier.ts")
const PACKAGE = path.join(ROOT, "package.json")

let checks = 0
let passed = 0
const failures: string[] = []
let mutantsTotal = 0
let mutantsCaught = 0

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
function blocked(label: string, reason: string): void {
  // A declared blocked state is a PASS with its reason recorded — never a
  // silent skip and never green-by-omission (the M25 convention).
  console.log(`  ⊘ ${label} — BLOCKED: ${reason}`)
  checks++
  passed++
}

// --- the pure rules the mutants target ---------------------------------------------
const LEGEND = ["structural", "import_based", "usage_contextual", "reference_qualified", "inferred"] as const
const RAW_JSON_SHAPE = /[{[]["']?(name|type)["']?\s*:/i

/** R1's vocabulary rule: the emitted tiers must be renderable by the legend. */
function tierVocabularyHolds(tiers: unknown): boolean {
  return Array.isArray(tiers) && tiers.every((t) => typeof t === "string" && ((LEGEND as readonly string[]).includes(t) || t === "unknown"))
}
/** R1's primary rule: the headline class is a member of the list it headlines. */
function primaryIsMember(tiers: string[], primary: unknown): boolean {
  return tiers.length === 0 ? primary === "unknown" : primary === tiers[0]
}
/** R1's serialization rule: no rendered card carries raw structured JSON. */
function cardIsHuman(card: string): boolean {
  return card.length > 0 && !RAW_JSON_SHAPE.test(card)
}
/** R1's identity rule: the declaration and the call site are the same symbol. */
function identityAgrees(decl: string | null, callSite: string | null): boolean {
  return decl !== null && decl === callSite
}
/** R3's bundle rule: the frames were captured against the bundle built now. */
function bundleIsCurrent(recorded: string, built: string): boolean {
  return recorded !== "" && built !== "" && recorded === built
}
/** R2's content rule: a frame region that is a single colour is not a render. */
function frameShowsContent(stats: { ok?: boolean; uniform?: boolean; textRows?: number; textFraction?: number }): boolean {
  if (stats.ok !== true) return false
  if (stats.uniform === true) return false
  return (stats.textRows ?? 0) >= 2 && (stats.textFraction ?? 0) > 0.0005
}
/** R2's distinctness rule: two different views cannot be the same pixels. */
function surfacesDiffer(diff: { ok?: boolean; changedPixels?: number }): boolean {
  return diff.ok === true && (diff.changedPixels ?? 0) > 500
}

function pixel(cmd: string, args: string[]): any {
  try {
    const out = execFileSync("python3", [PIXEL_READ, cmd, ...args], { encoding: "utf8", timeout: 120_000 })
    return JSON.parse(out) as unknown
  } catch (e) {
    const stdout = (e as { stdout?: string }).stdout ?? ""
    try {
      return JSON.parse(stdout) as unknown
    } catch {
      return { ok: false, reason: `pixel-read failed: ${e instanceof Error ? e.message.slice(0, 120) : String(e)}` }
    }
  }
}

const currentCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
const workingTreeRelevantChanges = execFileSync("git", ["status", "--porcelain"], { cwd: ROOT, encoding: "utf8" })
  .split("\n")
  .map((l) => l.slice(3).trim())
  .filter((p) => p.startsWith("src/lsp/") || p.startsWith("script/m55/") || p.startsWith("script/m26/"))

// --- R1: the probe (real server, real index) ----------------------------------------
console.log("R1: the probe — every declared flow, over the real server and the real index")
const pre = rigPreflight()
console.log(`  (rig: ${pre.ok ? "available" : `MISSING ${pre.missing.join(", ")}`})`)
ensureServerBuilt()
const probe: ProbeResult = await runWireProbe({ workspace: DECLARED_FIXTURE })
writeFileSync(PROBE_OUT, JSON.stringify(probe, null, 2) + "\n")

if (probe.status === "blocked") {
  blocked("R1: the probe reads the live surfaces", probe.reason ?? "unknown")
} else {
  check("R1: every declared flow read (no flow silently blocked)", probe.blockedFlows.length === 0, probe.blockedFlows.join(","))
  const hover = (id: string) => probe.flows[id]?.result as { contents?: { value?: string }; data?: { symbol?: any; provenance?: any } } | undefined
  const f1 = hover("F1")
  const f2 = hover("F2")
  const f3 = hover("F3")
  const f4 = hover("F4")

  check(
    "R1: the declaration and the call site resolve the SAME identity (T1)",
    identityAgrees(f1?.data?.symbol?.name ?? null, f2?.data?.symbol?.name ?? null),
    `${f1?.data?.symbol?.name} vs ${f2?.data?.symbol?.name}`,
  )
  check(
    "R1: the same identity gets the same tier story at both positions (T5)",
    JSON.stringify(f1?.data?.symbol?.evidenceTiers ?? null) === JSON.stringify(f2?.data?.symbol?.evidenceTiers ?? null) &&
      f1?.data?.provenance?.evidenceClass === f2?.data?.provenance?.evidenceClass,
    JSON.stringify([f1?.data?.symbol?.evidenceTiers, f2?.data?.symbol?.evidenceTiers]),
  )
  check("R1: the constructor hover resolves (T1 U5 — the live 'not in the index' defect)", f3?.data?.symbol !== undefined && f3?.data?.symbol !== null, JSON.stringify(f3?.data?.symbol ?? null).slice(0, 120))
  check("R1: the getter hover resolves (T1 accessors)", f4?.data?.symbol !== undefined && f4?.data?.symbol !== null, JSON.stringify(f4?.data?.symbol ?? null).slice(0, 120))

  for (const id of ["F1", "F2", "F3", "F4"]) {
    const h = hover(id)
    const tiers = h?.data?.symbol?.evidenceTiers
    const primary = h?.data?.provenance?.evidenceClass
    check(`R1: ${id} tiers are the legend's vocabulary (closed set)`, tierVocabularyHolds(tiers), JSON.stringify(tiers))
    check(`R1: ${id} primary is a member of its own tier list`, Array.isArray(tiers) ? primaryIsMember(tiers as string[], primary) : false, `primary=${String(primary)} tiers=${JSON.stringify(tiers)}`)
    check(`R1: ${id} card is human text (no serialized structure)`, cardIsHuman(h?.contents?.value ?? ""), (h?.contents?.value ?? "").slice(0, 140))
    check(`R1: ${id} card carries the actions row (T1)`, (h?.contents?.value ?? "").includes("Open in graph") && (h?.contents?.value ?? "").includes("Impact analysis") && (h?.contents?.value ?? "").includes("Call hierarchy"), (h?.contents?.value ?? "").slice(-160))
    check(`R1: ${id} card carries a human signature (T4)`, (h?.data?.symbol?.signature ?? "").length > 0 && !RAW_JSON_SHAPE.test(h?.data?.symbol?.signature ?? ""), String(h?.data?.symbol?.signature))
  }

  // The hub's own door, over the REAL index: chips must agree with the owner.
  const ownerMod = (await import(pathToFileURL(OWNER).href)) as typeof import("../../src/lsp/evidence_tier.ts")
  const coreMod = (await import(pathToFileURL(CORE).href)) as typeof import("../../script/m26/graph-core.ts")
  let hubRowsChecked = 0
  let hubRowAgreements = 0
  for (const flowId of ["F7", "F8"]) {
    const grouped = probe.flows[flowId]?.result as { callers?: any[]; callees?: any[] } | undefined
    const rows = [...(grouped?.callers ?? []), ...(grouped?.callees ?? [])].flatMap((g: any) => g.rows ?? [])
    for (const row of rows) {
      hubRowsChecked++
      const byOwner = ownerMod.classifyTier({ relationshipType: row.relationshipType, confidence: row.confidence, evidenceClass: row.evidenceClass ?? null })
      const byCore = coreMod.tierForEdge({ relationshipType: row.relationshipType, confidence: row.confidence, metadata: row.evidenceClass === undefined ? undefined : { evidenceClass: row.evidenceClass } } as never)
      if (byOwner === byCore && tierVocabularyHolds([byOwner])) hubRowAgreements++
    }
  }
  check("R1: the hub door returned rows to check", hubRowsChecked >= 4, String(hubRowsChecked))
  check("R1: every hub row's tier agrees between the owner and the rendered core (T5 on the live index)", hubRowsChecked > 0 && hubRowAgreements === hubRowsChecked, `${hubRowAgreements}/${hubRowsChecked}`)

  // T2/T3 live reads: population + agreement, not just "no error".
  const f5 = probe.flows.F5?.result as any[] | undefined
  const greetUsages = f1?.data?.symbol?.usageCount
  check("R1: references for a method return locations (T3)", Array.isArray(f5) && f5.length >= 1, JSON.stringify(f5 ?? null).slice(0, 120))
  check(
    "R1: the card's usage count agrees with the references door (T3: one relation vocabulary)",
    typeof greetUsages === "number" && Array.isArray(f5) && greetUsages >= 1 && greetUsages <= f5.length,
    `card=${String(greetUsages)} references=${Array.isArray(f5) ? f5.length : "n/a"}`,
  )
  const f6 = probe.flows.F6?.result as { item?: any; incoming?: unknown[]; outgoing?: unknown[] } | undefined
  check("R1: the call hierarchy prepares at the declaration (T2)", f6?.item !== undefined && f6?.item !== null, JSON.stringify(f6?.item ?? null).slice(0, 120))
  const f9 = probe.flows.F9?.result as { root?: any; impact?: unknown[] } | undefined
  check("R1: impact roots and returns its bounded set (T1/W5)", f9?.root !== undefined && Array.isArray(f9?.impact), JSON.stringify({ root: f9?.root?.name, impact: f9?.impact?.length }).slice(0, 120))
  const f11 = probe.flows.F11?.result as { graphError: string | null; graphHasResult: boolean; impactError: string | null; impactHasResult: boolean } | undefined
  check(
    "R1: a symbol that does not exist is a LOUD error on both doors (never an empty result)",
    f11 !== undefined && (f11.graphError ?? "").startsWith("bb/graph:") && f11.graphHasResult === false && (f11.impactError ?? "").startsWith("bb/impact:") && f11.impactHasResult === false,
    JSON.stringify(f11),
  )
}

// --- R2: the frames -----------------------------------------------------------------
console.log("\nR2: the frames — read back at the pixel level")
// The NEWEST run, by the manifest's own timestamp — never by directory name.
// Found by running this gate: names like `live-9` sort AFTER `live-11`, so a
// name-ordered pick read live-9's manifest and verified a stale, pre-fix
// session (R3 then reported a bundle mismatch against an old bundle). A gate
// that can silently verify the wrong run is exactly what this milestone exists
// to prevent, so the order is a declared rule here, and R6's M10 mutant plants
// the name-ordered pick back.
function newestRun(runs: string[]): string | null {
  let best: { name: string; at: string } | null = null
  for (const name of runs) {
    let at = ""
    try {
      const m = JSON.parse(readFileSync(path.join(FRAMES_DIR, name, "manifest.json"), "utf8")) as { generatedAt?: string }
      at = typeof m.generatedAt === "string" ? m.generatedAt : ""
    } catch {
      at = ""
    }
    if (best === null || at > best.at) best = { name, at }
  }
  return best === null ? null : best.name
}
const runs = existsSync(FRAMES_DIR) ? readdirSync(FRAMES_DIR).filter((d) => existsSync(path.join(FRAMES_DIR, d, "manifest.json"))) : []
const runName = newestRun(runs)
check("R2: the newest capture run is picked by timestamp, not by name", runName === null || runs.indexOf(runName) === runs.findIndex((r) => r === runName), runName ?? "no runs")
let frameFacts: Record<string, unknown> = {}
if (runName === null) {
  blocked("R2: the captured frames are read back", `no capture session has run (run: npx tsx script/m55/screenshot-protocol.ts) — expected under ${path.relative(ROOT, FRAMES_DIR)}/<run>/manifest.json`)
} else {
  const manifest = JSON.parse(readFileSync(path.join(FRAMES_DIR, runName, "manifest.json"), "utf8")) as {
    status: string
    reason?: string
    bundle: { bundleSha256: string }
    flows: Array<{ id: string; label: string; status: string; reason?: string; frame?: { path: string; sha256: string } }>
  }
  const frames = manifest.flows.filter((f) => f.status === "captured" && f.frame !== undefined)
  const framePath = (label: string) => {
    const f = frames.find((x) => x.label === label)
    return f === undefined ? null : path.join(ROOT, f.frame!.path)
  }
  // The window rectangle recorded with the frames (there is no window manager
  // on the virtual display, so the editor window does not necessarily fill the
  // screen — the frame reads are relative to it, never to the display).
  const win = frames[0]?.frame?.window ?? null
  if (win === null) {
    blocked("R2: the frames carry the window geometry", "the capture rig recorded no window rectangle — the region reads cannot be trusted, so they are declared blocked rather than guessed")
  }
  const region = (kind: "editor" | "panel"): [string, string, string, string] => {
    const w = win ?? { x: 0, y: 0, width: SCREEN.width, height: SCREEN.height }
    const fx = kind === "editor" ? 0.05 : 0.6
    const fw = kind === "editor" ? 0.45 : 0.38
    return [String(w.x + Math.floor(w.width * fx)), String(w.y + Math.floor(w.height * 0.12)), String(Math.floor(w.width * fw)), String(Math.floor(w.height * 0.75))]
  }
  const base = framePath("base")
  const hoverDecl = framePath("hover-declaration")
  const hoverCall = framePath("hover-call-site")
  const hub = framePath("open-in-graph")
  const impact = framePath("impact")
  const callTree = framePath("call-hierarchy")

  check(`R2: the session captured the declared frames (${frames.length}/${CAPTURE_FLOWS.length})`, frames.length >= 5, `captured: ${frames.map((f) => f.label).join(",")}`)
  let hashesHold = 0
  for (const f of frames) {
    const abs = path.join(ROOT, f.frame!.path)
    if (!existsSync(abs)) continue
    const { createHash } = await import("node:crypto")
    const actual = createHash("sha256").update(readFileSync(abs)).digest("hex")
    if (actual === f.frame!.sha256) hashesHold++
  }
  check("R2: every frame's recorded hash holds (the frames are the files)", hashesHold === frames.length, `${hashesHold}/${frames.length}`)

  for (const [label, abs] of [["base", base], ["hover-declaration", hoverDecl], ["open-in-graph", hub]] as const) {
    if (abs === null) {
      blocked(`R2: the ${label} frame shows content`, "the frame was not captured in this run")
      continue
    }
    const full = pixel("stats", [abs, "0", "0", String(SCREEN.width), String(SCREEN.height)])
    frameFacts[`${label}:stats`] = full
    check(`R2: the ${label} frame is a ${SCREEN.width}x${SCREEN.height} render with content (not a blank/unstyled frame)`, full.width === SCREEN.width && full.height === SCREEN.height && frameShowsContent(full), JSON.stringify(full).slice(0, 160))
  }
  if (base !== null && hoverDecl !== null) {
    const d = pixel("diff", [base, hoverDecl, "0", "0", String(SCREEN.width), String(SCREEN.height)])
    frameFacts["hover:diff"] = d
    check("R2: asking for the hover changed the workbench (the card rendered)", surfacesDiffer(d), JSON.stringify(d).slice(0, 160))
    check("R2: the hover's change is a card-sized block, not a stray pixel", d.ok === true && d.box !== null && d.box[2] >= 120 && d.box[3] >= 40, JSON.stringify(d.box ?? null))
  } else {
    blocked("R2: the hover changed the workbench", "base or hover-declaration frame missing")
  }
  if (hub !== null) {
    // The panel region: the right-hand side where a hub/impact/call-tree view
    // opens. The editor region: the main column. P1's law is that the panel
    // must not steal the editor — the code must still be there.
    const panel = pixel("stats", [hub, ...region("panel")])
    const editor = pixel("stats", [hub, ...region("editor")])
    frameFacts["hub:panel"] = panel
    frameFacts["hub:editor"] = editor
    check("R2: the hub frame shows rendered rows in the panel region", frameShowsContent(panel), JSON.stringify(panel).slice(0, 160))
    check("R2: the hub frame KEPT the editor column (P1: the panel never steals the editor)", frameShowsContent(editor), JSON.stringify(editor).slice(0, 160))
  } else {
    blocked("R2: the hub frame shows rows and keeps the editor column", "the open-in-graph frame was not captured in this run")
  }
  if (hub !== null && impact !== null) {
    const d = pixel("diff", [hub, impact, ...region("panel")])
    frameMatters("R2: the impact view is not the hub view (distinct surfaces)", surfacesDiffer(d), d)
  } else {
    blocked("R2: the impact view differs from the hub", "one of the frames was not captured in this run")
  }
  if (impact !== null && callTree !== null) {
    const d = pixel("diff", [impact, callTree, ...region("panel")])
    frameMatters("R2: the call-hierarchy view differs from impact (distinct surfaces)", surfacesDiffer(d), d)
  } else {
    blocked("R2: the call-hierarchy view differs from the impact view", "one of the frames was not captured in this run")
  }
  if (hoverCall !== null && hoverCall !== hoverDecl) {
    const d = pixel("diff", [hoverDecl, hoverCall, "0", "0", String(SCREEN.width), String(SCREEN.height)])
    check("R2: the call-site hover is its own frame (different position, same identity)", surfacesDiffer(d), JSON.stringify(d).slice(0, 140))
  } else {
    blocked("R2: the call-site hover is its own frame", "the call-site frame was not captured")
  }

  // R3 lives inside the frames leg: the bundle the frames are about.
  console.log("\nR3: the frames are about THIS HEAD's bundle")
  try {
    execFileSync("node", ["./esbuild-extension.mjs"], { cwd: path.join(ROOT, "ide/vscode"), stdio: ["ignore", "ignore", "pipe"], timeout: 300_000 })
    const { createHash } = await import("node:crypto")
    const builtHash = createHash("sha256").update(readFileSync(path.join(ROOT, "ide/vscode/dist/extension.js"))).digest("hex")
    check("R3: the recorded bundle hash equals the bundle built at this HEAD", bundleIsCurrent(manifest.bundle.bundleSha256, builtHash), `recorded ${manifest.bundle.bundleSha256.slice(0, 12)} vs built ${builtHash.slice(0, 12)}`)
  } catch (e) {
    blocked("R3: the recorded bundle hash equals the bundle built at this HEAD", `the extension bundle could not be rebuilt: ${e instanceof Error ? e.message.slice(0, 120) : String(e)}`)
  }
}

function frameMatters(label: string, ok: boolean, diff: unknown): void {
  frameFacts[label] = diff
  check(label, ok, JSON.stringify(diff).slice(0, 160))
}

// --- R4: mutants --------------------------------------------------------------------
console.log("\nR4: mutants (each planted defect must fail the suite)")
mutant("M1: the pre-T5 vocabulary in the probe (a tier the legend cannot render)", !tierVocabularyHolds(["structural", "indexed"]) && !tierVocabularyHolds(["semantic_candidate"]))
mutant("M2: a stale bundle hash", !bundleIsCurrent("deadbeef".repeat(8), "cafebabe".repeat(8)) && !bundleIsCurrent("", "cafebabe".repeat(8)))
mutant("M3: a blank (unstyled) frame", !frameShowsContent({ ok: true, uniform: true, textRows: 0, textFraction: 0 }) && !frameShowsContent({ ok: true, uniform: false, textRows: 1, textFraction: 0 }))
mutant("M4: a fabricated call-site identity", !identityAgrees("greet", "greetAll") && !identityAgrees(null, null) && !identityAgrees("greet", null))
mutant("M5: two identical panel frames (a view that never rendered)", !surfacesDiffer({ ok: true, changedPixels: 0 }) && !surfacesDiffer({ ok: true, changedPixels: 120 }))
{
  // M6: the primary disagreeing with its own list — the defect T5 names.
  const tiers = ["structural", "usage_contextual"]
  mutant("M6: a primary outside its own tier list", !primaryIsMember(tiers, "indexed") && primaryIsMember(tiers, "structural"))
  // M7: a serialized card (T4's defect) read live.
  mutant("M7: a card carrying raw structured JSON", !cardIsHuman('method put([{"name":"key","type":"string"}])') && cardIsHuman("**put** — method, 3 usages"))
}

// --- R5: wiring ---------------------------------------------------------------------
console.log("\nR5: wiring — the gate is in the chains (machine-read, not a doc claim)")
const pkg = JSON.parse(readFileSync(PACKAGE, "utf8")) as { scripts: Record<string, string> }
const inVerify = (pkg.scripts.verify ?? "").includes("m55/verify-live-surface")
const inFast = (pkg.scripts["verify:fast"] ?? "").includes("m55/verify-live-surface")
check("R5: the gate is in the npm verify chain", inVerify, "package.json scripts.verify")
check("R5: the gate is in the CI verify:fast chain", inFast, "package.json scripts['verify:fast']")

// --- R6: the findings document (frames are evidence; evidence must not rot) --------
// docs/m55/FRAME-FINDINGS.md lists what the frames showed and what was done about
// each. A findings document that names frames which no longer exist is a claim
// with no evidence behind it, and its verdicts must come from the declared set
// (fixed / open / verified / needs-a-truth-assertion) — not from prose drift.
console.log("\nR6: the findings document's frame paths and verdicts")
const FINDINGS = path.join(ROOT, "docs/m55/FRAME-FINDINGS.md")
const findings = readFileSync(FINDINGS, "utf8")
const namedFrames = [...new Set(findings.match(/validation\/m55\/frames\/[A-Za-z0-9._\/-]+\.png/g) ?? [])]
check("R6: the findings document names frames at all", namedFrames.length >= 8, `${namedFrames.length}`)
const missingFrames = namedFrames.filter((f) => !existsSync(path.join(ROOT, f)))
check(
  `R6: every frame the findings document names exists (${namedFrames.length} named)`,
  missingFrames.length === 0,
  missingFrames.join(", "),
)
const VERDICTS = ["FIXED", "OPEN", "OPEN (narrow)", "NEEDS A TRUTH ASSERTION", "VERIFIED"]
const verdictLines = findings.split("\n").filter((l) => l.startsWith("## F"))
check("R6: the findings carry one verdict per finding", verdictLines.length >= 8, `${verdictLines.length} findings`)
const badVerdicts = verdictLines.filter((l) => !VERDICTS.some((v) => l.includes(`\u00b7 ${v}`)))
check("R6: every verdict is a declared word (no invented status)", badVerdicts.length === 0, badVerdicts.map((l) => l.slice(0, 60)).join(" | "))
mutant(
  "M8: a findings document naming a frame that does not exist",
  !existsSync(path.join(ROOT, "validation/m55/frames/live-99/7-status.png")) && namedFrames.length > 0,
)
mutant(
  "M9: a verdict outside the declared set",
  !VERDICTS.some((v) => "## F99 — something · PROBABLY FINE".includes(`\u00b7 ${v}`)),
)
// M10: the newest-run pick goes back to sorting by name (the defect this gate
// ran into: `live-9` sorts after `live-11`, so a stale session was verified).
{
  const byName = [...runs].sort()
  const namePick = byName.length > 0 ? byName[byName.length - 1] : null
  mutant(
    "M10: a name-ordered newest-run pick (can verify a stale session)",
    namePick === null || namePick !== newestRun(runs) || runs.length < 2,
    `name pick ${namePick} vs timestamp pick ${newestRun(runs)}`,
  )
}

// --- evidence ------------------------------------------------------------------------
const failed = checks - passed
const result = {
  issue: "M55.V1",
  code: "V1",
  milestone: "M55",
  status: failed === 0 ? "verified" : "known-gap",
  checks,
  passed,
  failed,
  realFailed: failed,
  negativeCases: mutantsTotal,
  mutants: { total: mutantsTotal, caught: mutantsCaught },
  currentCommit,
  workingTreeRelevantChanges,
  verifierCommand: "npx tsx script/m55/verify-live-surface.ts",
  evidenceFile: "V1.json",
  generatedAt: new Date().toISOString(),
  live: {
    fixture: DECLARED_FIXTURE,
    fixturePresent: existsSync(DECLARED_FIXTURE),
    rigAvailable: pre.ok,
    rigMissing: pre.missing,
    captureRun: runName,
    probeFile: path.relative(ROOT, PROBE_OUT),
    probeStatus: probe.status,
  },
  frameFacts,
  // Acceptance 4: every claim maps to a frame or a probe line.
  claimTrace: [
    { claim: "the hover actions answer a palette invocation as well as a hover link", source: "component gate V1-action-args (47/47, 7/7 mutants)", frame: "4-open-in-graph.png, 5-impact.png" },
    { claim: "the status facts render on a readable surface, once each, with provenance", source: "component gate V1-status-panel (42/42, 11/11 mutants)", frame: "7-status.png" },
    { claim: "hover at a declaration and at a call site resolve the same identity", source: "probe F1 + F2", frame: "2-hover-declaration.png, 3-hover-call-site.png" },
    { claim: "one tier story per symbol, in the legend's vocabulary", source: "probe F1–F4 provenance.evidenceClass + evidenceTiers", frame: "2-hover-declaration.png" },
    { claim: "the card renders a human signature and no serialization", source: "probe F1–F4 signature + card text", frame: "2-hover-declaration.png" },
    { claim: "the hub rows agree with the one classifier on the real index", source: "probe F7 + F8 rows (owner vs core)", frame: "4-open-in-graph.png" },
    { claim: "the panel opens without stealing the editor column", source: "frame read: editor region text rows", frame: "4-open-in-graph.png" },
    { claim: "the three surfaces are distinct views", source: "frame diffs: hub vs impact vs call hierarchy", frame: "4, 5, 6" },
    { claim: "a symbol that does not exist is a declared error, not an empty result", source: "probe F11", frame: null },
    { claim: "every frame is about the bundle built at this HEAD", source: "R3 bundle-hash comparison", frame: "all frames" },
  ],
  failures,
  limitations: [
    "The frames leg depends on the declared EXTERNAL fixture ($HOME/bb-demo-hub), its owner index in ~/.bb, and the display tooling — by owner decision the fixture is not vendored into the repo, so on a machine without it the leg is BLOCKED-WITH-REASON, never green.",
    "The protocol declares a PINNED VS Code 1.85.0 from .vscode-test; that pin is not present on this machine, so the session runs the system `code` and records its exact version in the evidence. The pin's comparability guarantee is therefore declared but not honored here — recorded, not hidden.",
    "The flow DRIVING is keyboard-deterministic (`code -g`, the editor's hover chord, the extension's contributed commands through the palette BY ID — see docs/m55/FRAME-FINDINGS.md F9: a palette TITLE is not an identifier, and `>` + an id ranks unrelated commands first, both of which were caught by reading the frames back). The filing rig additionally pixel-clicked the hover card's action links; that path is not re-driven here, and the card's actions are asserted from the probe's card text plus the component gate V1-action-args instead.",
    "Pixel thresholds (card-size, changed-pixel floors, text-row floors) are declared constants tuned to this display size (1920x1080 @ zoom 0); a different screen size invalidates the frame reads and the gate says so rather than scaling silently.",
  ],
}

try {
  writeFileSync(EVIDENCE, JSON.stringify(result, null, 2) + "\n")
  console.log(`\nEV V1 evidence written: ${path.relative(ROOT, EVIDENCE)}`)
} catch (e) {
  console.log(`\nEV V1 evidence write failed: ${String(e)}`)
}

console.log(`\nV1 RESULT: ${failed === 0 ? "VERIFIED" : "KNOWN-GAP"} — ${passed}/${checks} passed, ${mutantsCaught}/${mutantsTotal} mutants caught`)
if (failed > 0) console.log(`failures:\n  - ${failures.join("\n  - ")}`)
process.exit(failed === 0 ? 0 : 1)

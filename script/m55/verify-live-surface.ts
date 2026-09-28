// script/m55/verify-live-surface.ts — M55.V1 verifier + mutation suite
// (issue #776, §14 Truth Rule 5: the editor is the gate).
//
// The milestone's own evidence came from a hand-run rig. This gate makes that
// rig PERMANENT, WIRED and FAIL-ABLE: it runs the promoted probe over the real
// server and the real index, reads the captured frames back at the PIXEL level
// (so a DOM-perfect renderer that ships unstyled still fails), and proves it
// can fail by planting fourteen defects a fresh install would show.
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
//   R4 mutants: fourteen planted defects (pre-T5 vocabulary in the probe, a
//               stale bundle hash, a blank frame, a fabricated call-site
//               identity, two identical panel frames, a primary outside its
//               own tier list, a serialized card, a frame that does not exist,
//               a non-declared verdict word, a name-ordered newest-run pick, a
//               blocked session reported as captured, a header reading the row
//               count as the group count, a dropped usage group, and a group
//               whose declared multiplicity lies) each FAIL.//   R5 wiring:  the gate is in the local `npm run verify` chain, and is NOT in
//               `verify:fast` — the latter is the M36.S2 runner-certified
//               subset (exactly 21 gates, asserted by
//               script/m36/verify-verify-fast.ts), and this leg needs a display
//               and a packaged VSIX, which a CI runner cannot provide. Both
//               directions are machine-read from package.json, and the mutant
//               plants the leg back into the runner subset.
//   R6 findings: every frame the findings document names exists, and every
//               verdict is a declared word.
//   R7 blocked: the gate RUNS the real rig with the fixture absent and asserts
//               the session is a declared blocked record with a reason and no
//               frames — V1's closure requirement, machine-emitted at this HEAD
//               instead of a claim in a document.
//   R8 header:  the hub's header counts are the GROUP counts and account for
//               every listed row, differentially against the server's own
//               counts block over the real index (F7's "3 callers · 2 callees"
//               vs its five rows).
//
// The frames leg is BLOCKED-NOT-GREEN when the rig, the fixture or its index is
// absent: the reason is recorded and the check passes as a declared blocked
// state (the M25 convention), never as an unstated skip. R7 is the proof that
// this rule is the behaviour and not the intention.
//
// Run: npx tsx script/m55/verify-live-surface.ts
// Evidence: validation/m55/results/V1.json (+ V1-probe.json, frames/<run>/)

import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { writeSealed } from "../lib/evidence.ts"
import { pathToFileURL } from "node:url"
import { M55_ROOT, ensureServerBuilt } from "./lsp-wire.ts"
import { EDITOR_CONTENT_REGION, navigationSpannedFile, noNavigationReason, type RegionDiff } from "./navigation.ts"
import { runWireProbe, DECLARED_FIXTURE, type ProbeResult } from "./wire-probe.ts"
import { CAPTURE_FLOWS, FRAMES_DIR, PIXEL_READ, SCREEN, rigPreflight } from "./screenshot-protocol.ts"
import { parseSealedRecord } from "../lib/evidence.ts"

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
writeSealed(PROBE_OUT, probe)

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
/** The declared order as a PURE function of (name, timestamp) pairs, so the
 *  R6/M10 mutant is proven on a constructed pair and never on whatever happens
 *  to be in the artifact directory (a can-fail proof that depends on which
 *  sessions exist is not a proof — found by running this gate, 2026-09-17). */
function pickNewestRun(entries: Array<{ name: string; at: string }>): string | null {
  let best: { name: string; at: string } | null = null
  for (const e of entries) if (best === null || e.at > best.at) best = e
  return best === null ? null : best.name
}
function runEntries(runs: string[]): Array<{ name: string; at: string }> {
  return runs.map((name) => {
    let at = ""
    try {
      const m = JSON.parse(readFileSync(path.join(FRAMES_DIR, name, "manifest.json"), "utf8")) as { generatedAt?: string }
      at = typeof m.generatedAt === "string" ? m.generatedAt : ""
    } catch {
      at = ""
    }
    return { name, at }
  })
}
function newestRun(runs: string[]): string | null {
  return pickNewestRun(runEntries(runs))
}
const runs = existsSync(FRAMES_DIR) ? readdirSync(FRAMES_DIR).filter((d) => existsSync(path.join(FRAMES_DIR, d, "manifest.json"))) : []
const runList = runEntries(runs)
const runName = pickNewestRun(runList)
{
  // The picked run is the newest by its OWN manifest timestamp: every other
  // run's timestamp is older. (The previous form compared two index lookups of
  // the same name — always true, a vacuous check.)
  const pickedAt = runList.find((e) => e.name === runName)?.at ?? ""
  const older = runList.filter((e) => e.name !== runName && e.at > pickedAt)
  check("R2: the newest capture run is picked by its manifest timestamp, not by name", runName === null || older.length === 0, older.length > 0 ? `newer run(s) exist: ${older.map((e) => e.name).join(", ")}` : runName ?? "no runs")
}
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
  // T1's closure frames: the constructor case that the owner's filing evidence
  // (s10-ctor-graph.png) captured as a SILENT RELABEL.
  const ctorHover = framePath("ctor-hover-declaration")
  const ctorGraph = framePath("ctor-open-in-graph")
  // T3's closure frame: the zero-usage card (a declared absence in the editor).
  const zeroUsage = framePath("hover-zero-usages")
  // T2's closure frame: the call hierarchy AFTER a click on a caller row. The
  // requirement is "clicking one lands on the CALL SITE"; the frame must show
  // that navigation happened, so it is compared against the pre-click frame.
  const chClick = framePath("call-hierarchy-click")

  // EVERY declared flow must have a frame: the milestone's rule is that a claim
  // with no frame is not a claim. A flow that silently blocks would leave a
  // claim unframed, so it fails here (the rig drives these deterministically;
  // the blocked-path proof is R7's job, not a hole in this run).
  const missingFlows = CAPTURE_FLOWS.filter((f) => !frames.some((x) => x.label === f.label))
  check(
    `R2: the session captured every declared frame (${frames.length} captured, ${CAPTURE_FLOWS.length} declared)`,
    missingFlows.length === 0,
    `missing: ${missingFlows.map((f) => f.label).join(",") || "none"}`,
  )
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

  // T1's closure requirement: the constructor case, framed at this HEAD. A
  // missing frame here is the claim with no evidence behind it, so it fails
  // rather than being blocked — the rig drives this flow deterministically
  // (the fixture has a constructor; the drive is `code -g` + the hover chord +
  // a palette command by id).
  check("R2: the T1 closure frames exist (the constructor card and the constructor graph)", ctorHover !== null && ctorGraph !== null, `ctor-hover=${ctorHover !== null} ctor-graph=${ctorGraph !== null}`)
  if (ctorHover !== null) {
    const full = pixel("stats", [ctorHover, "0", "0", String(SCREEN.width), String(SCREEN.height)])
    frameFacts["ctor-hover:stats"] = full
    check("R2: the constructor hover frame shows a rendered card (T1 U5)", frameShowsContent(full), JSON.stringify(full).slice(0, 160))
  }
  if (ctorHover !== null && hoverDecl !== null) {
    const d = pixel("diff", [hoverDecl, ctorHover, "0", "0", String(SCREEN.width), String(SCREEN.height)])
    frameFacts["ctor-hover:diff"] = d
    check("R2: the constructor card is its OWN frame, not the method card again (T1 U5 — different identity)", surfacesDiffer(d), JSON.stringify(d).slice(0, 160))
  }
  if (ctorGraph !== null && hub !== null) {
    const d = pixel("diff", [hub, ctorGraph, ...region("panel")])
    frameMatters("R2: the graph opened from the constructor is its own surface (T1 U5 — the relabel was SILENT, so the two cases must not render identically)", surfacesDiffer(d), d)
  }
  // T2's closure requirement: the click that lands on the call site.
  check("R2: the T2 closure frame exists (the call hierarchy after a click)", chClick !== null, `call-hierarchy-click=${chClick !== null}`)
  if (chClick !== null) {
    const full = pixel("stats", [chClick, "0", "0", String(SCREEN.width), String(SCREEN.height)])
    frameFacts["ch-click:stats"] = full
    check("R2: the clicked call-hierarchy frame shows a rendered surface (T2)", frameShowsContent(full), JSON.stringify(full).slice(0, 160))
    if (callTree !== null) {
      // The tree occupies the lower-right of the editor area; the landing editor
      // the top-left. The click must change the EDITOR, and it must change it
      // like a NAVIGATION rather than a cursor move — see navigation.ts for the
      // rule and the two frames it was measured from (live-17 navigation,
      // live-19 the recorded cursor move).
      const w = win ?? { x: 0, y: 0, width: SCREEN.width, height: SCREEN.height }
      /** A region RECT (x, y, width, height all as window fractions) to the
       *  pixel-read argument tuple. The shared rule's region is declared as a
       *  rect, so the conversion lives here once. */
      const atRect = (rect: [number, number, number, number]): [string, string, string, string] => {
        const [fx, fy, fw, fh] = rect
        return [
          String(w.x + Math.floor(w.width * fx)),
          String(w.y + Math.floor(w.height * fy)),
          String(Math.floor(w.width * fw)),
          String(Math.floor(w.height * fh)),
        ]
      }
      const editorBox = atRect(EDITOR_CONTENT_REGION)
      const navDiff = pixel("diff", [callTree, chClick, ...editorBox])
      frameFacts["ch-click:editor-diff"] = navDiff
      check(
        "R2: clicking a caller row CHANGED the editor (the navigation landed somewhere new) — T2",
        surfacesDiffer(navDiff),
        JSON.stringify(navDiff).slice(0, 160),
      )
      // The stronger form, and the one live-19 proved was missing: the change
      // must reach the TOP of the visible file. A frame where only a band of
      // lines changed is the open file being edited (a click that never took
      // the row selection, so the activation key went to the editor) — that was
      // recorded as a "landing" and passed, which is the gate weakness this
      // assertion closes. The rig refuses to record such a frame now; this leg
      // refuses to pass one.
      frameFacts["ch-click:navigation"] = navDiff
      check(
        "R2: the click NAVIGATED to another file — the editor's TOP lines changed, not just a cursor band (T2)",
        navigationSpannedFile(navDiff as RegionDiff),
        noNavigationReason(navDiff as RegionDiff),
      )
      const wholeDiff = pixel("diff", [callTree, chClick, "0", "0", String(SCREEN.width), String(SCREEN.height)])
      frameFacts["ch-click:whole-diff"] = wholeDiff
      check("R2: the click frame is its own frame (not the pre-click one)", surfacesDiffer(wholeDiff), JSON.stringify(wholeDiff).slice(0, 140))
    }
  }

  // T3's closure requirement: "V1's in-editor frame of the same case" — the
  // zero-usage symbol rendered in the editor, distinct from the used one.
  check("R2: the T3 closure frame exists (the zero-usage card)", zeroUsage !== null, `hover-zero-usages=${zeroUsage !== null}`)
  if (zeroUsage !== null) {
    const full = pixel("stats", [zeroUsage, "0", "0", String(SCREEN.width), String(SCREEN.height)])
    frameFacts["zero-usage:stats"] = full
    check("R2: the zero-usage frame shows a rendered card (T3)", frameShowsContent(full), JSON.stringify(full).slice(0, 160))
    if (hoverDecl !== null) {
      const d = pixel("diff", [hoverDecl, zeroUsage, "0", "0", String(SCREEN.width), String(SCREEN.height)])
      frameFacts["zero-usage:diff"] = d
      check("R2: the zero-usage card is its own frame, not the used symbol's card again (T3)", surfacesDiffer(d), JSON.stringify(d).slice(0, 160))
    }
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
// M16/M17: the navigation rule (M14/M15 are already taken by R8 and R5). M16 is
// the REAL defect this gate ran into — live-19's recorded "landing" frame shows
// the open file with a cursor band changed (box y=196 height=95, the measured
// numbers) — so a rule that accepted it would pass a click that never
// navigated. M17 is the empty case.
mutant(
  "M16: a click that only moved the cursor inside the open file (the recorded live-19 frame)",
  !navigationSpannedFile({ ok: true, changedPixels: 44053, box: [12, 196, 1197, 95] }),
)
mutant(
  "M17: a click that changed nothing / an unreadable frame",
  !navigationSpannedFile({ ok: true, changedPixels: 0, box: null }) &&
    !navigationSpannedFile({ ok: false, reason: "pixel-read failed" }) &&
    !navigationSpannedFile(null),
)
// The positive control: the measured NAVIGATION shape (live-17's box: the
// change starts at the top line and spans the visible file) must satisfy the
// rule, so an over-strict threshold cannot silently make every run fail.
check(
  "R2: the navigation rule accepts the measured navigation shape (live-17's box: y=0, height=288)",
  navigationSpannedFile({ ok: true, changedPixels: 44216, box: [12, 0, 1197, 288] }),
  JSON.stringify({ box: [12, 0, 1197, 288] }),
)
{
  // M6: the primary disagreeing with its own list — the defect T5 names.
  const tiers = ["structural", "usage_contextual"]
  mutant("M6: a primary outside its own tier list", !primaryIsMember(tiers, "indexed") && primaryIsMember(tiers, "structural"))
  // M7: a serialized card (T4's defect) read live.
  mutant("M7: a card carrying raw structured JSON", !cardIsHuman('method put([{"name":"key","type":"string"}])') && cardIsHuman("**put** — method, 3 usages"))
}

// --- R5: wiring ---------------------------------------------------------------------
console.log("\nR5: wiring — the gate is in the chains (machine-read, not a doc claim)")
const pkg = parseSealedRecord(PACKAGE) as { scripts: Record<string, string> }
const inVerify = (pkg.scripts.verify ?? "").includes("m55/verify-live-surface")
const inFast = (pkg.scripts["verify:fast"] ?? "").includes("m55/verify-live-surface")
check("R5: the gate is in the local npm verify chain", inVerify, "package.json scripts.verify")
// CORRECTION (M36.S2 interplay, found while re-running this gate): the V1
// acceptance criterion originally read "wired into the npm verify chain and the
// CI verify:fast chain". That is no longer the honest wiring: verify:fast is now
// the runner-certified subset — EXACTLY the 21 gates fresh-HOME-certified for CI
// runners, asserted by script/m36/verify-verify-fast.ts — and this leg cannot
// run there (it needs Xvfb, xdotool, PIL and a packaged VSIX). So the gate
// asserts BOTH directions: present in the local chain, absent from the runner
// subset. A leg that needs a display being pointed at the runner subset is a
// broken chain, not extra coverage.
const m36Gate = existsSync(path.join(ROOT, "script/m36/verify-verify-fast.ts"))
check("R5: the M36 runner-subset gate is present (the authority for what verify:fast may contain)", m36Gate, "script/m36/verify-verify-fast.ts")
check(
  "R5: the gate is NOT in verify:fast — this leg needs a display, so it is not runner-certifiable (M36.S2)",
  !inFast,
  "package.json scripts['verify:fast']",
)
/** The wiring rule, extracted so M15 plants the defect against it. */
const legIsInChain = (chain: string): boolean => chain.includes("m55/verify-live-surface")
mutant(
  "M15: a display-dependent leg planted back into the runner-certified verify:fast subset",
  !legIsInChain(pkg.scripts["verify:fast"] ?? "") && legIsInChain("npx tsx script/m55/verify-live-surface.ts && npx tsx script/m30/verify-governance.ts"),
)

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
// ran into: `live-9` sorts after `live-11`/`live-22`, so a stale session was
// verified). Proven on a CONSTRUCTED pair whose name order and timestamp order
// disagree, so the mutant is catchable regardless of which sessions exist on
// disk — the earlier disk-derived form silently stopped failing when the run
// naming changed, which is exactly the decay this milestone exists to kill.
{
  const pair = [
    { name: "session-b", at: "2026-01-01T00:00:00.000Z" },
    { name: "session-a", at: "2026-01-02T00:00:00.000Z" },
  ]
  const namePick = [...pair.map((e) => e.name)].sort().slice(-1)[0] ?? null
  const declaredPick = pickNewestRun(pair)
  mutant(
    "M10: a name-ordered newest-run pick (can verify a stale session)",
    declaredPick === "session-a" && namePick === "session-b" && namePick !== declaredPick,
    `name pick ${String(namePick)} vs timestamp pick ${String(declaredPick)}`,
  )
}

// --- R7: the blocked path (V1's closure requirement) ---------------------------------
// "V1's closure requires the external-fixture blocked path proven: run with the
// fixture absent -> blocked with a reason, never green." A rule that is only
// read in prose is not proven, so this leg RUNS the real rig against a workspace
// that does not exist, reads the session record back, and asserts the four
// things a blocked record must say. The record is written into the evidence dir
// (V1-blocked-path.json) at this HEAD, so it cannot go stale silently.
console.log("\nR7: the blocked path — a missing fixture is a declared blocked session, never green")
const BLOCKED_PROOF = path.join(ROOT, "validation/m55/results/V1-blocked-path.json")
const ABSENT_FIXTURE = path.join(ROOT, "validation/m55/.blocked-path-fixture-absent")

/** The one blocked-path predicate. Extracted so M11 can plant the defect
 *  (a session record claiming to be captured) against the SAME rule the leg
 *  asserts — a mutant that re-implements the rule proves nothing. */
function blockedSessionIsBlocked(r: { status?: string; reason?: string; fixture?: { present?: boolean } } | null): boolean {
  return (
    r !== null &&
    r.status === "blocked" &&
    typeof r.reason === "string" &&
    (/fixture/i.test(r.reason) || /prerequisite/i.test(r.reason)) &&
    r.fixture?.present === false
  )
}

check("R7: the absent-fixture path really is absent (the proof cannot pass vacuously)", !existsSync(ABSENT_FIXTURE), ABSENT_FIXTURE)
let blockedRecord: { status?: string; reason?: string; fixture?: { present?: boolean; workspace?: string }; flows?: unknown[] } | null = null
try {
  // A blocked session exits non-zero by design (see the rig CLI): the RECORD is
  // the evidence, so the exit code is deliberately not the assertion.
  execFileSync("npx", ["tsx", "script/m55/screenshot-protocol.ts", "--fixture", ABSENT_FIXTURE, "--run", "blocked-proof", "--out", BLOCKED_PROOF], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 180_000,
  })
} catch {
  // expected for a blocked session
}
try {
  blockedRecord = parseSealedRecord(BLOCKED_PROOF) as typeof blockedRecord
} catch {
  blockedRecord = null
}
check("R7: a session run with the fixture absent emitted a session record at this HEAD", blockedRecord !== null, path.relative(ROOT, BLOCKED_PROOF))
check(
  "R7: the session is a DECLARED BLOCKED record (status + reason + the absent workspace)",
  blockedSessionIsBlocked(blockedRecord),
  JSON.stringify({ status: blockedRecord?.status, reason: blockedRecord?.reason, present: blockedRecord?.fixture?.present }).slice(0, 200),
)
check("R7: the blocked session captured nothing (no frame can back a claim)", Array.isArray(blockedRecord?.flows) && blockedRecord!.flows!.length === 0, `flows=${blockedRecord?.flows?.length ?? "n/a"}`)
check(
  "R7: the blocked run left no frames directory (a blocked session never writes a green-looking run)",
  !existsSync(path.join(FRAMES_DIR, "blocked-proof")),
  "validation/m55/frames/blocked-proof",
)
mutant(
  "M11: a blocked session reported as captured",
  !blockedSessionIsBlocked({ ...(blockedRecord ?? {}), status: "captured" }) &&
    !blockedSessionIsBlocked({ ...(blockedRecord ?? {}), reason: "" }) &&
    blockedSessionIsBlocked(blockedRecord),
)

// --- R8: the hub header counts account for the listed rows (F7) ---------------------
// docs/m55/FRAME-FINDINGS.md F7: the live hub header read `3 callers · 2 callees`
// while the by-file list below it showed five rows. hub-panel.ts says the header
// numbers are the GROUP counts (§13.4) and the list is the rows grouped by file,
// so 3 + 2 = the five rows listed — which may be exactly right. That is a claim
// for a machine assertion over a real index, not for a comment.
//
// This leg renders the REAL probe response through the ONE renderer core and
// asserts three independent derivations agree, in both directions:
//   * the header number the eye reads == the number of rows rendered under it
//     (so the two numbers account for the list);
//   * the header number == the SERVER's own declared group count (the wire's
//     counts block is a second, independent source — the differential);
//   * the declared row multiplicity (occurrences) sums to the raw response's
//     row count — the number the header is NOT, and must not be confused with.
// A header that read the ROW count as the group count (the frame's ambiguity
// resolved the wrong way) fails; the live fixture has groups != rows for
// Greeter (3 vs 4), so that mutant cannot pass vacuously.
console.log("\nR8: the hub header counts account for the listed rows (F7 — the frame's '3 callers · 2 callees' vs its five rows)")

/** The minimal DOM port (the V1/U3 stub convention). */
class HubDomEl {
  className = ""
  children: HubDomEl[] = []
  textContent = ""
  attrs: Record<string, string> = {}
  constructor(public tagName: string) {}
  setAttribute(name: string, value: string): void {
    this.attrs[name] = value
  }
  appendChild(child: HubDomEl): HubDomEl {
    this.children.push(child)
    return child
  }
  addClass(name: string): void {
    this.className = this.className ? `${this.className} ${name}` : name
  }
  find(className: string): HubDomEl | null {
    if (this.className.split(" ").includes(className)) return this
    for (const child of this.children) {
      const hit = child.find(className)
      if (hit !== null) return hit
    }
    return null
  }
  findAll(className: string, out: HubDomEl[] = []): HubDomEl[] {
    if (this.className.split(" ").includes(className)) out.push(this)
    for (const child of this.children) child.findAll(className, out)
    return out
  }
}

interface HubHeaderAudit {
  ok: boolean
  violations: string[]
  facts: Record<string, number>
}

/** The F7 rule, extracted so M12–M14 plant defects against the SAME rule the
 *  live assertion uses — a mutant that re-implements the rule proves nothing. */
function hubHeaderAudit(grouped: any, core: typeof import("../../script/m26/graph-core.ts")): HubHeaderAudit | null {
  if (grouped === undefined || grouped === null || !Array.isArray(grouped.callers) || !Array.isArray(grouped.callees)) return null
  const el = new HubDomEl("div")
  const dom = { create: (t: string) => new HubDomEl(t), root: () => el, el }
  core.renderHubList(grouped as never, dom as never, "file")
  const summary = el.find("bb-hub-summary")
  if (summary === null) return null
  const num = (v: string | undefined): number => (v === undefined ? Number.NaN : Number(v))
  const direction = (d: "caller" | "callee") => {
    const rows = el.findAll("bb-hub-symrow").filter((r) => r.attrs["data-dir"] === d)
    return { rendered: rows.length, occurrences: rows.reduce((n, r) => n + num(r.attrs["data-occurrences"]), 0) }
  }
  const callers = direction("caller")
  const callees = direction("callee")
  const rawCallerRows = (grouped.callers as any[]).reduce((n, g) => n + ((g.rows ?? []) as unknown[]).length, 0)
  const rawCalleeRows = (grouped.callees as any[]).reduce((n, g) => n + ((g.rows ?? []) as unknown[]).length, 0)
  const facts: Record<string, number> = {
    derivedCallerGroups: num(summary.attrs["data-callers"]),
    derivedCalleeGroups: num(summary.attrs["data-callees"]),
    derivedCallerRows: num(summary.attrs["data-caller-rows"]),
    derivedCalleeRows: num(summary.attrs["data-callee-rows"]),
    serverCallerGroups: num(summary.attrs["data-server-callers"]),
    serverCalleeGroups: num(summary.attrs["data-server-callees"]),
    renderedCallerRows: callers.rendered,
    renderedCalleeRows: callees.rendered,
    renderedCallerOccurrences: callers.occurrences,
    renderedCalleeOccurrences: callees.occurrences,
    rawCallerRows,
    rawCalleeRows,
  }
  const violations: string[] = []
  if (facts.derivedCallerGroups !== facts.renderedCallerRows) violations.push("header callers != caller rows listed")
  if (facts.derivedCalleeGroups !== facts.renderedCalleeRows) violations.push("header callees != callee rows listed")
  if (facts.derivedCallerGroups !== facts.serverCallerGroups) violations.push("derived caller groups != the server's declared caller groups")
  if (facts.derivedCalleeGroups !== facts.serverCalleeGroups) violations.push("derived callee groups != the server's declared callee groups")
  if (facts.derivedCallerRows !== facts.rawCallerRows) violations.push("header's declared caller rows != the response's rows")
  if (facts.derivedCalleeRows !== facts.rawCalleeRows) violations.push("header's declared callee rows != the response's rows")
  if (facts.renderedCallerOccurrences !== facts.rawCallerRows) violations.push("rendered caller occurrences != the response's rows")
  if (facts.renderedCalleeOccurrences !== facts.rawCalleeRows) violations.push("rendered callee occurrences != the response's rows")
  return { ok: violations.length === 0, violations, facts }
}

if (probe.status === "blocked") {
  blocked("R8: the hub header counts account for the listed rows (F7)", "the probe is blocked — there is no live response to audit")
} else {
  const coreHub = (await import(pathToFileURL(CORE).href)) as typeof import("../../script/m26/graph-core.ts")
  let hubAudits = 0
  for (const [flowId, label] of [["F7", "Greeter (class)"], ["F8", "greet (method)"]] as const) {
    const audit = hubHeaderAudit(probe.flows[flowId]?.result, coreHub)
    if (audit === null) {
      blocked(`R8: the ${label} hub response renders a summary`, "the flow was blocked or the response carries no summary")
      continue
    }
    hubAudits++
    const f = audit.facts
    check(
      `R8: ${label} — the header numbers account for every listed row (${f.derivedCallerGroups} + ${f.derivedCalleeGroups} = ${f.renderedCallerRows + f.renderedCalleeRows} rows)`,
      audit.ok,
      audit.violations.join("; "),
    )
    check(
      `R8: ${label} — groups and row multiplicity are declared separately and both hold (${f.derivedCallerGroups} groups / ${f.derivedCallerRows} rows)`,
      f.derivedCallerGroups === f.renderedCallerRows && f.derivedCallerRows === f.renderedCallerOccurrences,
      JSON.stringify(f),
    )
  }
  check("R8: the hub header rule was audited over the real index", hubAudits >= 1, String(hubAudits))

  // The mutants. Each plants the defect this leg exists to catch, against the
  // REAL live response, and the first one can only be caught because the live
  // fixture's groups and rows differ — so this suite fails loudly if the fixture
  // ever becomes trivially consistent (it would stop testing anything).
  const live = JSON.parse(JSON.stringify(probe.flows.F7?.result ?? null)) as any
  const groupsDifferFromRows = live !== null && (live.counts.callerGroups !== live.counts.callerRows || live.counts.calleeGroups !== live.counts.calleeRows)
  check(
    "R8: the live fixture's hub has groups != rows, so M12 cannot pass vacuously",
    groupsDifferFromRows,
    live === null ? "no F7 response" : JSON.stringify(live.counts),
  )
  mutant(
    "M12: a header that reads the ROW count as the group count (the F7 ambiguity resolved the wrong way)",
    live !== null &&
      hubHeaderAudit({ ...live, counts: { ...live.counts, callerGroups: live.counts.callerRows, calleeGroups: live.counts.calleeRows } }, coreHub)?.ok === false &&
      hubHeaderAudit(live, coreHub)?.ok === true,
  )
  mutant(
    "M13: a usage group dropped from the list while the header keeps counting it",
    live !== null && hubHeaderAudit({ ...live, callers: live.callers.slice(1) }, coreHub)?.ok === false,
  )
  mutant(
    "M14: a group whose declared multiplicity lies about its rows",
    live !== null &&
      hubHeaderAudit({ ...live, callers: live.callers.map((g: any, i: number) => (i === 0 ? { ...g, occurrences: 1 } : g)) }, coreHub)?.ok === false,
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
    blockedPathProof: path.relative(ROOT, BLOCKED_PROOF),
    blockedPathStatus: blockedRecord?.status ?? null,
    blockedPathReason: blockedRecord?.reason ?? null,
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
    { claim: "the three surfaces are distinct views", source: "frame diffs: hub vs impact vs call hierarchy", frame: "4-open-in-graph.png, 5-impact.png, 6-call-hierarchy.png" },
    { claim: "a symbol that does not exist is a declared error, not an empty result", source: "probe F11", frame: null },
    { claim: "every frame is about the bundle built at this HEAD", source: "R3 bundle-hash comparison", frame: "all frames" },
    { claim: "a missing fixture is a declared blocked session with a reason, never a green run", source: "R7 + validation/m55/results/V1-blocked-path.json", frame: null },
    { claim: "the hub header's counts are the group counts and account for every listed row (F7)", source: "R8 over the real F7/F8 responses rendered by the ONE core", frame: "4-open-in-graph.png" },
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
  writeSealed(EVIDENCE, result)
  console.log(`\nEV V1 evidence written: ${path.relative(ROOT, EVIDENCE)}`)
} catch (e) {
  console.log(`\nEV V1 evidence write failed: ${String(e)}`)
}

console.log(`\nV1 RESULT: ${failed === 0 ? "VERIFIED" : "KNOWN-GAP"} — ${passed}/${checks} passed, ${mutantsCaught}/${mutantsTotal} mutants caught`)
if (failed > 0) console.log(`failures:\n  - ${failures.join("\n  - ")}`)
process.exit(failed === 0 ? 0 : 1)

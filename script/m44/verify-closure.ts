// script/m44/verify-closure.ts — M44.X1 (issue #694): the closure gate +
// the launch bar's machine-checkable half.
//
// Pattern: M42.X1 (which follows M29.X1), applied to the M44 lane.
//   Pass 0:  editor legs RE-RUN AT HEAD before the ladder. Deliberate order
//            deviation from M42 (documented): this closure edits an
//            m25-relevant file (run-fork-e2e.mts — the fork terminal gate
//            26→88 so forks exercise the M44 hub), and m25 governance
//            freshness-judges fork/E5 evidence against m25-relevant diffs.
//            Re-stamping the editor evidence FIRST is what makes the ladder
//            run honestly at this HEAD instead of failing on our own edit.
//   Pass 1:  the full program ladder at HEAD — M24..M29 governance gates
//            (each re-runs its milestone's suite) then the M42 component
//            verifiers H1..H6 and the M44 component verifiers U1..U6. M44
//            governance is NOT run here (it validates X1's own evidence at
//            the closing HEAD — the m29 self-referential-trap rationale);
//            this file is not in any suite it runs.
//   Pass 2:  contract §6 mutant coverage re-asserted per M44 surface (plus
//            the standing pre-M44 surfaces) from the suites' own evidence.
//   Pass 3:  closure preconditions on the M44 ledger + the LAUNCH RECORD +
//            KNOWN-GAPS inventory: every launch-bar item carries EVIDENCE
//            (existing, verified file) or a recorded reason with an owner
//            marker — a forged record, a reasonless waiver, a stale editor
//            leg, a missing fork, or a regressed ledger item fires. The
//            §8.5 spot-check pack is present; the verdict itself stays with
//            the owner (this gate only proves the audit CAN FAIL).
//   Pass 3b: the closure audit's own can-fail proof — in-memory negatives
//            only; the on-disk ledger and launch record are never mutated.
//   Pass 4:  the compiled KNOWN-GAPS inventory is regenerated over the
//            m44 evidence limitations and audited (machine-derived, not
//            hand-forged; every entry non-empty and code-labeled).
//
// Evidence: validation/m44/results/X1.json (machine-emitted).

import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { writeSealed } from "../lib/evidence.ts"
import { parseSealedRecord } from "../lib/evidence.ts"

const ROOT = resolve(import.meta.dirname, "../..")
const EVIDENCE_PATH = join(ROOT, "validation/m44/results/X1.json")
const LEDGER_PATH = join(ROOT, "validation/m44/results/manifest.json")
const LAUNCH_RECORD = join(ROOT, "docs/m44/LAUNCH-RECORD.md")
const SPOT_PACK = join(ROOT, "validation/m44/results/SPOT-CHECK-PACK.md")
const KNOWN_GAPS = join(ROOT, "validation/m44/results/KNOWN-GAPS.json")

// The program ladder in our lane, dependency order. Co-agent lanes are
// deliberately absent (M14/M37/M40/M41 — their gates are theirs). The M44
// governance gate runs AFTER this gate (it validates X1's evidence).
const SUITE: Array<{ code: string; script: string }> = [
  { code: "M24", script: "script/m24/verify-governance.ts" },
  { code: "M25", script: "script/m25/verify-governance.ts" },
  { code: "M26", script: "script/m26/verify-governance.ts" },
  { code: "M27", script: "script/m27/verify-governance.ts" },
  { code: "M28", script: "script/m28/verify-governance.ts" },
  { code: "M29", script: "script/m29/verify-governance.ts" },
  { code: "M42-H1", script: "script/m42/verify-highlight.ts" },
  { code: "M42-H2", script: "script/m42/verify-rich-hover.ts" },
  { code: "M42-H3", script: "script/m42/verify-enrichment-surface.ts" },
  { code: "M42-H4", script: "script/m42/verify-hover-actions.ts" },
  { code: "M42-H5", script: "script/m42/verify-hub.ts" },
  { code: "M42-H6", script: "script/m42/verify-hub-navigation.ts" },
  { code: "M44-U1", script: "script/m44/verify-usages-groups.ts" },
  { code: "M44-U3", script: "script/m44/verify-hub-tree.ts" },
  { code: "M44-U4", script: "script/m44/verify-legend.ts" },
  { code: "M44-U5", script: "script/m44/verify-impact-resolution.ts" },
  { code: "M44-U6", script: "script/m44/verify-usages-fallback.ts" },
]

let checks = 0
let passed = 0
const failures: string[] = []
let negatives = 0
function check(label: string, ok: boolean, detail = ""): void {
  checks++
  if (ok) passed++
  else failures.push(detail ? `${label}: ${detail}` : label)
  console.log(`  ${ok ? "✓" : "✗"} ${label}${ok || !detail ? "" : ` — ${detail}`}`)
}
function negative(label: string, ok: boolean, detail = ""): void {
  negatives++
  check(label, ok, detail)
}

const currentCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()

// --- Pass 0: editor legs at HEAD (E5 real VS Code + E6 forks) -----------------------
console.log(`pass 0: editor legs re-run at HEAD ${currentCommit.slice(0, 8)} (E5 + forks — the hub is asserted in-editor)`)
function legRun(code: string, script: string): number {
  console.log(`  running ${code}…`)
  let exit = -1
  try {
    execFileSync("npx", ["tsx", script], { cwd: ROOT, encoding: "utf8", timeout: 580_000, stdio: ["ignore", "pipe", "ignore"] })
    exit = 0
  } catch (e) {
    exit = (e as { status?: number }).status ?? -1
  }
  check(`X1: ${code} leg green at HEAD`, exit === 0, `exit=${exit}`)
  return exit
}
const editorExits: Record<string, number> = {}
editorExits["E5"] = legRun("E5 (VS Code, full 88-check suite incl. the M44 hub)", "script/m25/run-vscode-e2e.mts")
editorExits["E6"] = legRun("E6 (forks — same suite through Cursor/Antigravity)", "script/m25/run-fork-e2e.mts")

interface LegEvidence {
  status?: string
  currentCommit?: string
  editor?: { name?: string; version?: string }
  checks?: Array<{ name?: string; ok?: boolean }>
  reason?: string
  fork?: string
}
function readLeg(rel: string): LegEvidence | null {
  try {
    return JSON.parse(readFileSync(join(ROOT, rel), "utf8")) as LegEvidence
  } catch {
    return null
  }
}
{
  const e5 = readLeg("validation/m25/results/E5.json")
  check("X1: E5 evidence verified at THIS HEAD", e5?.status === "verified" && e5.currentCommit === currentCommit, `status=${e5?.status} commit=${String(e5?.currentCommit).slice(0, 8)}`)
  check("X1: E5 editor recorded (name + version, pinned)", typeof e5?.editor?.name === "string" && typeof e5?.editor?.version === "string", JSON.stringify(e5?.editor ?? null).slice(0, 80))
  // The M44 hub must be exercised in-editor (X1's visual leg): the hub view
  // rows + affordance + tree + ONE legend checks by name, from the live run.
  const e5Names = (e5?.checks ?? []).map((c) => c.name ?? "")
  const hubNeedles = ["E5-H5: hub renders all three views", "E5-H5: navigable rows declare the click affordance", "E5-U4: the ONE legend renders in the hub panel"]
  for (const n of hubNeedles) check(`X1: E5 ran the hub leg "${n.slice(0, 44)}…"`, e5Names.some((x) => x.startsWith(n)), "")
  // Forks: both available forks verified at THIS HEAD; Windsurf blocked with
  // a reason (never omitted, never claimed — contract §2 I4).
  for (const [fork, file] of [["cursor", "F-CURSOR.json"], ["antigravity", "F-ANTIGRAVITY.json"]] as const) {
    const f = readLeg(`validation/m25/results/${file}`)
    const forkNames = (f?.checks ?? []).map((c) => c.name ?? "")
    check(`X1: E6 ${fork} verified at THIS HEAD`, f?.status === "verified" && f.currentCommit === currentCommit, `status=${f?.status} commit=${String(f?.currentCommit).slice(0, 8)}`)
    check(`X1: E6 ${fork} ran the hub legs (terminal gate raised 26→88)`, hubNeedles.every((n) => forkNames.some((x) => x.startsWith(n))), `hub legs missing from ${file}`)
  }
  const ws = readLeg("validation/m25/results/F-WINDSURF.json")
  check("X1: E6 windsurf recorded blocked WITH reason (never omitted)", ws?.status === "blocked" && typeof ws.reason === "string" && ws.reason.length > 0, `status=${ws?.status}`)
}

// --- Pass 1: the full program ladder at HEAD ---------------------------------------
console.log(`\npass 1: the full program ladder (M24–M44) at HEAD ${currentCommit.slice(0, 8)}`)
const exits: Record<string, number> = { ...editorExits }
function ladderRun(code: string, script: string): void {
  console.log(`  running ${code}…`)
  let exit = -1
  try {
    execFileSync("npx", ["tsx", script], { cwd: ROOT, encoding: "utf8", timeout: 580_000, stdio: ["ignore", "pipe", "ignore"] })
    exit = 0
  } catch (e) {
    exit = (e as { status?: number }).status ?? -1
  }
  exits[code] = exit
  check(`X1: ${code} ladder run green at HEAD`, exit === 0, `exit=${exit}`)
}
for (const { code, script } of SUITE) ladderRun(code, script)

// --- Pass 2: contract §6 mutant-set coverage per surface ---------------------------
console.log("\npass 2: §6 mutant coverage (from the suites' own evidence)")
const MUTANT_EVIDENCE: Array<{ surface: string; file: string }> = [
  { surface: "M24 hover/positions (standing)", file: "validation/m24/results/L2.json" },
  { surface: "M26 graph renderer (standing)", file: "validation/m26/results/W1.json" },
  { surface: "M28 union differential (standing)", file: "validation/m28/results/U1.json" },
  { surface: "M44-U1 usages grouping", file: "validation/m44/results/U1.json" },
  { surface: "M44-U3 hub tree", file: "validation/m44/results/U3.json" },
  { surface: "M44-U4 legend/counts", file: "validation/m44/results/U4.json" },
  { surface: "M44-U5 impact resolution", file: "validation/m44/results/U5.json" },
  { surface: "M44-U6 references fallback", file: "validation/m44/results/U6.json" },
]
for (const { surface, file } of MUTANT_EVIDENCE) {
  let ok = false
  let detail = "missing"
  try {
    const d = JSON.parse(readFileSync(join(ROOT, file), "utf8")) as {
      mutantsCaught?: number
      mutantsTotal?: number
      negativeCases?: number
      verdict?: { mutantsCaught?: number; mutantsTotal?: number; negativeCases?: number }
      negatives?: { planned?: number } | number
    }
    const caught = d.verdict?.mutantsCaught ?? d.mutantsCaught ?? (typeof d.negatives === "object" ? d.negatives?.planned ?? 0 : (d.negatives ?? 0)) ?? d.negativeCases ?? 0
    const total = d.verdict?.mutantsTotal ?? d.mutantsTotal ?? caught
    ok = caught > 0 && total > 0
    detail = ok ? "" : `no mutant record in ${file}`
  } catch {
    detail = `${file} not found`
  }
  check(`X1: §6 mutant coverage recorded for ${surface}`, ok, detail)
}

// --- Pass 2.5: the KNOWN-GAPS inventory, compiled before it is audited --------------
// (Deterministic, from the m44 evidence limitations + fixed closure-time
// items. Pass 3's launch-record audit validates the inventory's EVIDENCE row,
// so on a cold tree the file must exist before that audit runs. The re-audit
// after compilation lives in pass 4. Bootstrap order is part of the gate's
// contract, not a hidden repair.)
console.log("\npass 2.5: known-gaps inventory compiled (ahead of the audit that checks it)")
const inventory: Array<{ code: string; limitation: string }> = []
for (const f of ["G1", "U1", "U2", "U3", "U4", "U5", "U6"]) {
  try {
    const d = JSON.parse(readFileSync(join(ROOT, `validation/m44/results/${f}.json`), "utf8")) as { limitations?: string[] }
    for (const lim of d.limitations ?? []) inventory.push({ code: f, limitation: lim })
  } catch {
    inventory.push({ code: f, limitation: `(evidence ${f}.json unreadable at closure time — recorded, never silent)` })
  }
}
// Closure-time items: fixed here, owner-held, or CI-run (dispositions live in
// docs/m44/LAUNCH-RECORD.md — the same rule as the M42 inventory).
inventory.push(
  { code: "X1-fork-coverage", limitation: "Fork runs stopped at 26 checks (before the M44 hub legs); FIXED in this closure — terminal gate raised 26→88 in script/m25/run-fork-e2e.mts and the forks re-run through the full suite at the closure HEAD." },
  { code: "X1-windsurf", limitation: "Windsurf fork unavailable on this machine (CLI not installed) — blocked-with-reason at validation/m25/results/F-WINDSURF.json; owner decides: install + re-run run-fork-e2e, or accept the blocked record for v7." },
  { code: "X1-os-matrix", limitation: "darwin/windows in-repo machine records stay blocked-by-design on this linux box; the os-matrix workflow runs each native leg on push (M42 record stands; win32 budget variance owner-waived 2026-09-06)." },
  { code: "X1-openvsx", limitation: "OpenVSX publish + listing regeneration await the owner-held OVSX_PAT (unchanged from M42); recorded in docs/m44/LAUNCH-RECORD.md." },
  { code: "X1-verdict", limitation: "The §8.5 achieved/not-achieved verdict is the owner's, never the gate's — spot-check pack prepared at validation/m44/results/SPOT-CHECK-PACK.md." },
  { code: "X1-tool-union", limitation: "Tool-surface unification is the M44 co-agent track; the IDE lane consumes the unified surfaces as they land — IDE-side verification here covers the IDE lane's own surfaces only." },
)
{
  const compiled = {
    schemaVersion: 1,
    status: "verified",
    count: inventory.length,
    inventory,
    note: "Compiled by script/m44/verify-closure.ts from the m44 evidence limitations + closure-time items (deterministic; no wall clock). Every entry carries its disposition in docs/m44/LAUNCH-RECORD.md (fixed / documented-with-reason / owner / CI-pending). None silent.",
  }
  mkdirSync(join(ROOT, "validation/m44/results"), { recursive: true })
  writeSealed(KNOWN_GAPS, compiled)
}

// --- Pass 3: closure preconditions — ledger + launch record + spot-check pack ------
// The KNOWN-GAPS inventory is compiled FIRST (deterministically, from the
// m44 evidence limitations + fixed closure-time items): pass 3's launch-
// record audit validates the inventory's EVIDENCE row, so on a cold tree the
// file must exist before that audit runs. Bootstrap order is part of the
// gate's contract, not a hidden repair.
console.log("\npass 3: closure preconditions (launch record + spot-check pack + forks)")

interface LedgerItem {
  code: string
  status: string
  evidence?: { status?: string }
}

/** Pure audit over in-memory snapshots — negatives mutate copies only. */
function audit(
  snapshot: LedgerItem[],
  launchRecordText: string | null,
  packPresent: boolean,
  e5Status: string,
  forksVerified: number,
  ladderExits: Record<string, number>,
): string[] {
  const v: string[] = []
  for (const item of snapshot) {
    if (item.code === "X1") continue
    if ((item.evidence?.status ?? item.status) !== "verified") v.push(`pre1:${item.code} not evidence-verified`)
  }
  for (const [code, exit] of Object.entries(ladderExits)) {
    if (exit !== 0) v.push(`pre2:ladder leg ${code} failed (exit=${exit})`)
  }
  if (!packPresent) v.push("pre3:spot-check pack missing")
  if (e5Status !== "verified") v.push(`pre4:E5 editor leg not verified (${e5Status})`)
  if (forksVerified < 2) v.push(`pre5:only ${forksVerified} live forks verified (need both available forks: cursor + antigravity)`)
  // Launch record: every row is EVIDENCE (existing, verified file) or carries
  // a non-empty reason AND an owner marker. Rows are machine-marked:
  //   | <item> | <scope> | EVIDENCE | <relative path of a verified evidence file> |
  //   | <item> | <scope> | OWNER | <reason, must contain 'owner'> |
  //   | <item> | <scope> | CI-PENDING | <reason, must be non-empty> |
  if (launchRecordText === null) {
    v.push("pre6:launch record missing")
    return v
  }
  const rows = launchRecordText.split("\n").filter((l) => {
    if (!l.trim().startsWith("|")) return false
    const u = l.toUpperCase()
    return u.includes("| EVIDENCE |") || u.includes("| OWNER |") || u.includes("| CI-PENDING |")
  })
  if (rows.length < 12) v.push(`pre6:launch record has ${rows.length} status rows (expected >= 12)`)
  for (const row of rows) {
    const cells = row.split("|").map((c) => c.trim())
    // cells: ['', item, scope, STATUS, evidence-or-reason, '']
    if (cells.length < 5) {
      v.push(`pre6:malformed launch-record row: ${row.slice(0, 100)}`)
      continue
    }
    const status = (cells[3] ?? "").toUpperCase()
    const payload = cells[4] ?? ""
    if (status === "EVIDENCE") {
      const p = join(ROOT, payload)
      if (!existsSync(p)) v.push(`pre6:EVIDENCE row ${cells[1]} references missing file ${payload}`)
      else {
        try {
          const d = parseSealedRecord(p) as { status?: string }
          if (d.status !== "verified") v.push(`pre6:EVIDENCE row ${cells[1]} file ${payload} is ${d.status ?? "unverified"}`)
        } catch {
          // Non-JSON evidence artifacts (e.g. the markdown spot-check pack
          // row) are validated by existence; JSON ones by their verdict.
        }
      }
    } else if (status === "OWNER") {
      if (payload.length === 0) v.push(`pre6:OWNER row ${cells[1]} has no reason`)
      else if (!/owner|ishaq2321/i.test(payload)) v.push(`pre6:OWNER row ${cells[1]} reason does not name the owner`)
    } else if (status === "CI-PENDING") {
      if (payload.length === 0) v.push(`pre6:CI-PENDING row ${cells[1]} has no reason`)
    } else {
      v.push(`pre6:launch-record row ${cells[1]} has unknown status ${cells[3] ?? ""}`)
    }
  }
  return v
}

let ledgerSnapshot: LedgerItem[] = []
try {
  const ledger = parseSealedRecord(LEDGER_PATH) as { issues: LedgerItem[] }
  ledgerSnapshot = ledger.issues.map((i) => ({ ...i }))
} catch {
  ledgerSnapshot = []
}
const launchText = existsSync(LAUNCH_RECORD) ? readFileSync(LAUNCH_RECORD, "utf8") : null
const packOk = existsSync(SPOT_PACK) && existsSync(join(ROOT, "docs/IDE-HONESTY-CONTRACT.md"))
const e5Now = readLeg("validation/m25/results/E5.json")
const forkCount = (["validation/m25/results/F-CURSOR.json", "validation/m25/results/F-ANTIGRAVITY.json"] as const).filter((f) => readLeg(f)?.status === "verified").length

const violations = audit(ledgerSnapshot, launchText, packOk, e5Now?.status ?? "missing", forkCount, exits)
check("X1: closure preconditions audited — zero violations", violations.length === 0, violations.join("; ").slice(0, 400))

// Pass 3b: the closure audit's own can-fail proof (in-memory negatives only).
console.log("\npass 3b: closure-audit can-fail proof (in-memory negatives)")
{
  // forged ledger — an item's evidence regresses to planned
  const forgedLedger = ledgerSnapshot.map((i) => ({ ...i, evidence: { status: i.code === "U6" ? "planned" : (i.evidence?.status ?? i.status) } }))
  negative("X1: negative — a ledger item whose evidence regresses is caught", audit(forgedLedger, launchText, packOk, "verified", 2, exits).some((x) => x.startsWith("pre1:U6")))
  // stale ladder leg — one leg's exit regressed
  const staleExits = { ...exits, "M44-U6": 1 }
  negative("X1: negative — a failed ladder leg is caught", audit(ledgerSnapshot, launchText, packOk, "verified", 2, staleExits).some((x) => x.startsWith("pre2:")))
  // missing spot-check pack
  negative("X1: negative — a missing spot-check pack is caught", audit(ledgerSnapshot, launchText, false, "verified", 2, exits).some((x) => x.startsWith("pre3:")))
  // unverified E5 leg
  negative("X1: negative — an unverified E5 editor leg is caught", audit(ledgerSnapshot, launchText, packOk, "blocked", 2, exits).some((x) => x.startsWith("pre4:")))
  // forks dropped below the bar
  negative("X1: negative — fewer than two verified forks is caught", audit(ledgerSnapshot, launchText, packOk, "verified", 1, exits).some((x) => x.startsWith("pre5:")))
  // forged launch record — a reasonless OWNER waiver
  const forgedRecord = (launchText ?? "").replace(/\| OWNER \| [^|]*\|/, "| OWNER |  |")
  negative("X1: negative — reasonless waiver in the launch record is caught", audit(ledgerSnapshot, forgedRecord, packOk, "verified", 2, exits).some((x) => x.startsWith("pre6:")))
  // EVIDENCE row pointing at a missing file
  const fakeRow = "\n| bogus | linux | EVIDENCE | validation/nope/none.json |"
  negative("X1: negative — an EVIDENCE row referencing a missing file is caught", audit(ledgerSnapshot, (launchText ?? "") + fakeRow, packOk, "verified", 2, exits).some((x) => x.startsWith("pre6:") && x.includes("none.json")))
}

// --- Pass 4: KNOWN-GAPS inventory re-audit ------------------------------------------
// (The compilation happened in pass 2.5, ahead of the audit that validates
// the inventory's launch-record row. Here the compiled artifact is audited.)
console.log("\npass 4: known-gaps inventory audit (compiled in pass 2.5)")
{
  const compiled = {
    schemaVersion: 1,
    status: "verified",
    count: inventory.length,
    inventory,
    note: "Compiled by script/m44/verify-closure.ts from the m44 evidence limitations + closure-time items (deterministic; no wall clock). Every entry carries its disposition in docs/m44/LAUNCH-RECORD.md (fixed / documented-with-reason / owner / CI-pending). None silent.",
  }
  mkdirSync(join(ROOT, "validation/m44/results"), { recursive: true })
  writeSealed(KNOWN_GAPS, compiled)
  const recompiled = parseSealedRecord(KNOWN_GAPS) as { count?: number; inventory?: Array<{ code: string; limitation: string }> }
  check("X1: known-gaps inventory compiled over the m44 evidence", recompiled.count === inventory.length && (recompiled.inventory ?? []).every((g) => g.code.length > 0 && g.limitation.length > 0), `count=${recompiled.count}`)
  check("X1: the launch record's known-gaps section is non-empty", (launchText ?? "").includes("## Known-gaps inventory"), "")
  check("X1: the §8.5 spot-check pack names the hub surfaces", packOk && readFileSync(SPOT_PACK, "utf8").includes("Open in graph"), "")
}

// --- Evidence ------------------------------------------------------------------------
const failed = checks - passed
const result = {
  issue: "694",
  code: "X1",
  milestone: "M44",
  status: failed === 0 ? "verified" : "known-gap",
  checks,
  passed,
  failed,
  failures,
  negativeCases: negatives,
  suiteExits: exits,
  editorLegs: {
    e5: "validation/m25/results/E5.json (re-run at this HEAD — full suite incl. the M44 hub legs)",
    e6: "validation/m25/results/F-CURSOR.json + F-ANTIGRAVITY.json (re-run at this HEAD, terminal gate 26→88); F-WINDSURF blocked-with-reason",
  },
  currentCommit,
  verifierCommand: "npx tsx script/m44/verify-closure.ts",
  evidenceFile: "X1.json",
  launchBar: {
    record: "docs/m44/LAUNCH-RECORD.md (12 machine-audited rows: EVIDENCE / OWNER / CI-PENDING)",
    osMatrix: "linux machine-verified (E7-linux.json); darwin/windows run native on GitHub-hosted runners via .github/workflows/os-matrix.yml; in-repo records blocked-by-design until persisted by owner/CI",
    openVsxPublish: "owner-required: OVSX_PAT is owner-held (validation/m25/results/E4-openvsx.json); recorded in LAUNCH-RECORD.md with reason",
    knownGapsInventory: "validation/m44/results/KNOWN-GAPS.json — machine-compiled from evidence limitations + closure-time items; every gap fixed or recorded with reason; the §8.5 verdict stays with the owner",
  },
  ownerSpotCheck: {
    pack: "validation/m44/results/SPOT-CHECK-PACK.md",
    verdictOwner: "owner (ishaq2321)",
    contract: "IDE Honesty Contract §8.5 — the achieved/not-achieved verdict is the owner's, never the gate's",
  },
  generatedAt: new Date().toISOString(),
  limitations: [
    "Pass 0 deliberately deviates from the M42 pass order: this closure edits an m25-relevant file (run-fork-e2e.mts), so the editor legs re-run and re-stamp BEFORE the ladder freshness-judges them.",
    "Pass 1 runs each milestone's governance gate (which re-runs that milestone's suite); it proves the ladder green at HEAD, not that every individual evidence file was re-stamped inside this single run — evidence re-pinned to the closure commit follow the standing U5/U6 sweep procedure.",
    "The launch bar's owner-held items (OpenVSX publish token, Windsurf install decision, the §8.5 verdict, darwin/win CI persistence) are recorded with reasons — this gate machine-checks the record's honesty, it cannot execute owner-held credentials.",
    "Co-agent lanes (M14/M37/M40/M41…) are outside this program's closure; their gates live in their own milestones.",
  ],
}
writeSealed(EVIDENCE_PATH, result)

console.log(`\nX1: ${failed === 0 ? "VERIFIED" : "KNOWN-GAP"} (${passed}/${checks} passed, ${negatives} negatives)`)
console.log(`Evidence: ${EVIDENCE_PATH}`)
process.exit(failed === 0 ? 0 : 1)

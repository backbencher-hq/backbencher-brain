// script/m42/verify-closure.ts — M42.X1 (issue #655): the closure gate +
// the launch bar's machine-checkable half.
//
// Pattern: M29.X1 (the m29 closure gate), applied to the M42 lane.
//   Pass 1:  the full program ladder at HEAD — M24..M29 governance gates
//            (each re-runs its milestone's suite) then the M42 component
//            verifiers H1..H6. M42 governance is NOT run here (it validates
//            X1's own evidence at the closing HEAD, the m29
//            self-referential-trap rationale) and this file is not in any
//            suite it runs.
//   Pass 2:  contract §6 mutant coverage re-asserted per M42 surface from
//            the suites' own evidence files.
//   Pass 3:  closure preconditions on the M42 ledger + the LAUNCH RECORD:
//            every launch-bar item carries EVIDENCE (existing, verified file)
//            or a recorded reason with an owner marker — a forged record, a
//            reasonless waiver, or a stale/regressed leg fires. The §8.5
//            spot-check pack is present; the verdict itself stays with the
//            owner (this gate only proves the audit CAN FAIL).
//   Pass 4:  launch-bar machine leg — the E7 linux leg (packaged VSIX +
//            shared assertion core against the SHIPPED server) is re-run at
//            HEAD; darwin/windows are machine-emitted blocked records with
//            their specific reasons (G3, never omitted, never claimed), and
//            the .github/workflows/os-matrix.yml leg that can execute them on
//            GitHub-hosted runners is audited present.
//
// Evidence: validation/m42/results/X1.json (machine-emitted).

import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { writeSealed } from "../lib/evidence.ts"
import { parseSealedRecord } from "../lib/evidence.ts"

const ROOT = resolve(import.meta.dirname, "../..")
const EVIDENCE_PATH = join(ROOT, "validation/m42/results/X1.json")
const LEDGER_PATH = join(ROOT, "validation/m42/results/manifest.json")
const LAUNCH_RECORD = join(ROOT, "docs/m42/LAUNCH-RECORD.md")
const SPOT_PACK = join(ROOT, "validation/m42/results/SPOT-CHECK-PACK.md")
const OS_MATRIX_WORKFLOW = join(ROOT, ".github/workflows/os-matrix.yml")

// The program ladder in our lane, dependency order. Co-agent lanes are
// deliberately absent (M14/M37/M40/M41 — their gates are theirs). The M42
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

// --- Pass 1: the full program ladder at HEAD ---------------------------------------
console.log(`pass 1: the full program ladder (M24–M42) at HEAD ${currentCommit.slice(0, 8)}`)
const exits: Record<string, number> = {}
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
  { surface: "M42-H1 document highlight", file: "validation/m42/results/H1.json" },
  { surface: "M42-H2 rich hover", file: "validation/m42/results/H2.json" },
  { surface: "M42-H3 enrichment surface", file: "validation/m42/results/H3.json" },
  { surface: "M42-H4 hover actions", file: "validation/m42/results/H4.json" },
  { surface: "M42-H5 hub renderer", file: "validation/m42/results/H5.json" },
  { surface: "M42-H6 hub navigation", file: "validation/m42/results/H6.json" },
]
for (const { surface, file } of MUTANT_EVIDENCE) {
  let ok = false
  let detail = "missing"
  try {
    const d = JSON.parse(readFileSync(join(ROOT, file), "utf8")) as {
      mutantsCaught?: number
      mutantsTotal?: number
      negativeCases?: number
      verdict?: { mutantsCaught?: number; mutantsTotal?: number }
      negatives?: { planned?: number } | number
    }
    const caught = d.verdict?.mutantsCaught ?? d.mutantsCaught ?? (typeof d.negatives === "object" ? d.negatives?.planned ?? 0 : (d.negatives ?? 0))
    const total = d.verdict?.mutantsTotal ?? d.mutantsTotal ?? caught
    ok = caught > 0 && total > 0
    detail = ok ? "" : `no mutant record in ${file}`
  } catch {
    detail = `${file} not found`
  }
  check(`X1: §6 mutant coverage recorded for ${surface}`, ok, detail)
}

// --- Pass 3: closure preconditions — ledger + launch record + spot-check pack ------
console.log("\npass 3: closure preconditions (launch record + spot-check pack)")

/** Pure audit over an in-memory snapshot — negatives mutate copies only. */
function audit(
  snapshot: Array<{ code: string; status: string; evidence?: { status?: string } }>,
  launchRecordText: string | null,
  packPresent: boolean,
  workflowPresent: boolean,
  e7LinuxStatus: string,
  ladderExits: Record<string, number>,
): string[] {
  const v: string[] = []
  for (const item of snapshot) {
    if (item.code === "X1") continue
    if ((item.evidence?.status ?? item.status) !== "verified") v.push(`pre1:${item.code} not evidence-verified`)
  }
  // Ladder: every leg ran green (the run's own exits).
  for (const [code, exit] of Object.entries(ladderExits)) {
    if (exit !== 0) v.push(`pre2:ladder leg ${code} failed (exit=${exit})`)
  }
  if (!packPresent) v.push("pre3:spot-check pack missing")
  if (!workflowPresent) v.push("pre4:os-matrix CI workflow missing (darwin/win legs have no executable home)")
  if (e7LinuxStatus !== "verified") v.push(`pre5:E7 linux leg not verified at HEAD (${e7LinuxStatus})`)
  // Launch record: every row is EVIDENCE (existing, verified file) or carries
  // a non-empty reason AND an owner marker. Rows are machine-marked:
  //   | <item> | <scope> | EVIDENCE | <relative path of a verified evidence file> |
  //   | <item> | <scope> | OWNER | <reason, must contain 'owner'> |
  //   | <item> | <scope> | CI-PENDING | <reason, must be non-empty> |
  if (launchRecordText === null) {
    v.push("pre6:launch record missing")
    return v
  }
  const rows = launchRecordText.split("\n").filter((l) => l.trim().startsWith("|") && l.includes("EVIDENCE") || l.trim().startsWith("|") && l.includes("OWNER") || l.trim().startsWith("|") && l.includes("CI-PENDING"))
  if (rows.length < 6) v.push(`pre6:launch record has ${rows.length} status rows (expected >= 6)`)
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
          v.push(`pre6:EVIDENCE row ${cells[1]} file ${payload} is not readable evidence JSON`)
        }
      }
    } else if (status === "OWNER") {
      if (payload.length === 0) v.push(`pre6:OWNER row ${cells[1]} has no reason`)
      else if (!/owner/i.test(payload)) v.push(`pre6:OWNER row ${cells[1]} reason does not name the owner`)
    } else if (status === "CI-PENDING") {
      if (payload.length === 0) v.push(`pre6:CI-PENDING row ${cells[1]} has no reason`)
    } else {
      v.push(`pre6:launch-record row ${cells[1]} has unknown status ${cells[3] ?? ""}`)
    }
  }
  return v
}

let ledgerSnapshot: Array<{ code: string; status: string; evidence?: { status?: string } }> = []
try {
  const ledger = parseSealedRecord(LEDGER_PATH) as { issues: Array<{ code: string; status: string; evidence?: { status?: string } }> }
  ledgerSnapshot = ledger.issues.map((i) => ({ ...i }))
} catch {
  ledgerSnapshot = []
}
const launchText = existsSync(LAUNCH_RECORD) ? readFileSync(LAUNCH_RECORD, "utf8") : null
const packOk = existsSync(SPOT_PACK) && existsSync(join(ROOT, "docs/IDE-HONESTY-CONTRACT.md"))
let e7Linux = "missing"
try {
  const e7 = JSON.parse(readFileSync(join(ROOT, "validation/m25/results/E7-linux.json"), "utf8")) as { status?: string }
  e7Linux = e7.status ?? "unreadable"
} catch {}

const violations = audit(ledgerSnapshot, launchText, packOk, existsSync(OS_MATRIX_WORKFLOW), e7Linux, exits)
check("X1: closure preconditions audited — zero violations", violations.length === 0, violations.join("; ").slice(0, 400))

// Pass 3b: the closure audit's own can-fail proof (in-memory negatives only).
console.log("\npass 3b: closure-audit can-fail proof (in-memory negatives)")
{
  // forged launch record — a reasonless OWNER waiver
  const forgedRecord = (launchText ?? "").replace(/\| [^|]+ \| OWNER \| [^|]+ \|/g, "| x | OWNER |  |")
  negative("X1: negative — reasonless waiver in the launch record is caught", audit(ledgerSnapshot, forgedRecord, packOk, true, e7Linux, exits).some((x) => x.startsWith("pre6:")))
  // stale ladder leg — one leg's exit regressed
  const staleExits = { ...exits, "M42-H6": 1 }
  negative("X1: negative — a failed ladder leg is caught", audit(ledgerSnapshot, launchText, packOk, true, e7Linux, staleExits).some((x) => x.startsWith("pre2:")))
  // forged evidence — an item's evidence regresses to planned
  const forgedLedger = ledgerSnapshot.map((i) => ({ ...i, evidence: { status: i.code === "H6" ? "planned" : (i.evidence?.status ?? i.status) } }))
  negative("X1: negative — a ledger item whose evidence regresses is caught", audit(forgedLedger, launchText, packOk, true, e7Linux, exits).some((x) => x.startsWith("pre1:H6")))
  // missing spot-check pack
  negative("X1: negative — a missing spot-check pack is caught", audit(ledgerSnapshot, launchText, false, true, e7Linux, exits).some((x) => x.startsWith("pre3:")))
  // missing OS-matrix workflow
  negative("X1: negative — a missing os-matrix workflow is caught", audit(ledgerSnapshot, launchText, packOk, false, e7Linux, exits).some((x) => x.startsWith("pre4:")))
  // unverified E7 linux leg
  negative("X1: negative — an unverified E7 linux leg is caught", audit(ledgerSnapshot, launchText, packOk, true, "blocked", exits).some((x) => x.startsWith("pre5:")))
  // EVIDENCE row pointing at a missing file
  const fakeRow = "\n| bogus | linux | EVIDENCE | validation/nope/none.json |"
  negative("X1: negative — an EVIDENCE row referencing a missing file is caught", audit(ledgerSnapshot, (launchText ?? "") + fakeRow, packOk, true, e7Linux, exits).some((x) => x.startsWith("pre6:") && x.includes("none.json")))
}

// --- Pass 4: launch-bar machine leg (E7 linux at HEAD) ------------------------------
console.log("\npass 4: launch-bar OS leg — E7 re-run at HEAD (linux real, darwin/win blocked-with-reason)")
{
  let exit = -1
  try {
    execFileSync("npx", ["tsx", "script/m25/verify-cross-platform.ts"], { cwd: ROOT, encoding: "utf8", timeout: 580_000, stdio: ["ignore", "pipe", "ignore"] })
    exit = 0
  } catch (e) {
    exit = (e as { status?: number }).status ?? -1
  }
  check("X1: E7 cross-platform verifier runs clean at HEAD (this host's leg + blocked records)", exit === 0, `exit=${exit}`)
  // THE OS MATRIX IS HOST-SCOPED, NOT HARD-CODED. This block asserted that the
  // darwin and win32 legs are `blocked` and that the LINUX leg is `verified` —
  // which was true of the machine the lane was developed on and false of any
  // other. On this host (darwin, x86_64 macOS 14.8.4) the correct shape is the
  // mirror image: darwin measured, linux and win32 blocked-with-reason. A gate
  // that hard-codes which platform is absent cannot be run on a second machine,
  // and its "verdict" on a macOS host would have been a claim about Linux.
  //
  // What is asserted now is the CONTRACT RULE (IDE Honesty Contract §10: budgets
  // and claim levels are OS-scoped; every platform is either measured here or
  // declared-absent with a reason, never assumed):
  //   1. all three platform legs exist and are named (never omitted),
  //   2. exactly the platform this host runs on is the one that may be verified,
  //   3. every other platform is `blocked` WITH a non-empty reason,
  //   4. the host's own leg carries this host's OS.
  const PLATFORM_LEGS = [
    { os: "darwin", file: "E7-darwin.json" },
    { os: "linux", file: "E7-linux.json" },
    { os: "win32", file: "E7-windows.json" },
  ] as const
  const THIS_HOST = process.platform
  const legRows = PLATFORM_LEGS.map(({ os, file }) => {
    try {
      const d = JSON.parse(readFileSync(join(ROOT, "validation/m25/results", file), "utf8")) as { os?: string; status?: string; blockedReason?: string; currentCommit?: string }
      return { os, file, present: true, declaredOs: d.os, status: String(d.status ?? "(none)"), reason: String(d.blockedReason ?? "").trim(), commit: d.currentCommit }
    } catch {
      return { os, file, present: false, declaredOs: "", status: "(absent)", reason: "", commit: undefined }
    }
  })
  console.log(`      this host is ${THIS_HOST}; the OS matrix under audit: ${legRows.map((l) => `${l.os}=${l.status}`).join(", ")}`)
  check(
    "X1: every platform leg exists and is named (no OS is silently omitted)",
    legRows.every((l) => l.present),
    legRows.filter((l) => !l.present).map((l) => l.file).join(", "),
  )
  check(
    "X1: every platform leg declares its own OS (a record may not claim another platform's leg)",
    legRows.every((l) => l.declaredOs === l.os),
    legRows.filter((l) => l.declaredOs !== l.os).map((l) => `${l.file} declares ${l.declaredOs}`).join(", "),
  )
  // The host's own leg must be the one MEASURED — measured, not passed. A
  // `known-gap` host leg is an honest measurement of this platform that found a
  // real failure (on this host: H2's usage link), and it must be REPORTED as
  // such, not silently accepted. So the assertion is that the host leg is
  // stamped at this HEAD and is one of the two states a measurement can honestly
  // end in; the green requirement stays, and its failure names the leg's own
  // recorded reason rather than a bare status.
  const hostLeg = legRows.find((l) => l.os === THIS_HOST)
  check(
    `X1: the leg for THIS host (${THIS_HOST}) is the measured one, stamped at this HEAD`,
    hostLeg !== undefined && (hostLeg.status === "verified" || hostLeg.status === "known-gap") && hostLeg.commit === currentCommit,
    `host leg: ${hostLeg?.status} commit=${String(hostLeg?.commit).slice(0, 8)} (HEAD=${currentCommit.slice(0, 8)})`,
  )
  check(
    `X1: the ${THIS_HOST} leg is green at this HEAD (a known-gap host leg is a real platform finding, and names why)`,
    hostLeg?.status === "verified",
    hostLeg?.status === "verified" ? "" : `${THIS_HOST} leg is ${String(hostLeg?.status)}${hostLeg?.reason ? ` — ${hostLeg.reason.slice(0, 220)}` : " with no recorded reason (contract §8.3)"}`,
  )
  // Every OTHER platform is declared-absent WITH a reason — never assumed.
  const others = legRows.filter((l) => l.os !== THIS_HOST)
  for (const other of others) {
    check(
      `X1: the ${other.os} leg is declared-absent with a reason (never omitted, never assumed)`,
      other.status === "blocked" && other.reason.length > 0,
      `status=${other.status} reason=${other.reason.length === 0 ? "(NONE)" : other.reason.slice(0, 90)}`,
    )
  }
}

// --- Evidence ------------------------------------------------------------------------
const failed = checks - passed
const result = {
  issue: "655",
  code: "X1",
  milestone: "M42",
  status: failed === 0 ? "verified" : "known-gap",
  checks,
  passed,
  failed,
  failures,
  negativeCases: negatives,
  suiteExits: exits,
  currentCommit,
  verifierCommand: "npx tsx script/m42/verify-closure.ts",
  evidenceFile: "X1.json",
  launchBar: {
    osMatrixLinux: "machine-verified (E7-linux.json at HEAD)",
    osMatrixDarwinWindows: "machine-blocked records with reasons; executable leg authored in .github/workflows/os-matrix.yml (runs on GitHub-hosted runners on push)",
    openVsxPublish: "owner-required: OVSX_PAT is owner-held (validation/m25/results/E4-openvsx.json); recorded in LAUNCH-RECORD.md with reason",
    placeholderMilestones: "milestones #27/#28 closed with pointer comments to #38/#39 (see LAUNCH-RECORD.md)",
    knownGapsInventory: "docs/m42/LAUNCH-RECORD.md inventory — every gap fixed or recorded with reason; the §8.5 achieved/not-achieved verdict stays with the owner",
  },
  ownerSpotCheck: {
    pack: "validation/m42/results/SPOT-CHECK-PACK.md",
    verdictOwner: "owner (ishaq2321)",
    contract: "IDE Honesty Contract §8.5 — the achieved/not-achieved verdict is the owner's, never the gate's",
  },
  generatedAt: new Date().toISOString(),
  limitations: [
    "Pass 1 runs each milestone's governance gate (which re-runs that milestone's suite); it proves the ladder green at HEAD, not that every individual evidence file was re-stamped inside this single run.",
    "The launch bar's owner-held items (OpenVSX publish token, the §8.5 verdict, darwin/win CI execution on GitHub-hosted runners) are recorded with reasons — this gate machine-checks the record's honesty, it cannot execute owner-held credentials.",
    "Co-agent lanes (M14/M37/M40/M41…) are outside this program's closure; their gates live in their own milestones.",
  ],
}
mkdirSync(join(ROOT, "validation/m42/results"), { recursive: true })
writeSealed(EVIDENCE_PATH, result)

console.log(`\nX1: ${failed === 0 ? "VERIFIED" : "KNOWN-GAP"} (${passed}/${checks} passed, ${negatives} negatives)`)
console.log(`Evidence: ${EVIDENCE_PATH}`)
process.exit(failed === 0 ? 0 : 1)

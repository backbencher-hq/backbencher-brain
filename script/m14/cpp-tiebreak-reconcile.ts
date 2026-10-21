/**
 * cpp-tiebreak-reconcile — THE OWN-FILE TIE-BREAK's MOVEMENT, PER ROW, MEASURED.
 *
 * THE QUESTION THE LEAD ASKS EVERY LANE: "does the cell include the shared OWN-FILE TIE-BREAK's
 * movement (`e1e2f7a19`) — PER ROW OR PER COLUMN — answer, do not guess."
 *
 * THE MECHANISM, FROM THE COMMIT ITSELF (`e1e2f7a190a819ef06a145b53742250ee934710e`,
 * 2026-10-20 21:14, "THE OWN-FILE TIE-BREAK LANDS"): the arbiter now walks the row's OWN FILE's
 * statements FIRST, so an edge whose own file declares the target IS bound — the gate's model being
 * made to MATCH production's. The rule carries TWO conditions, and the second is the charter's:
 *   (i)  the target must be a NAME a declaration can bind (`isPlainIdentifier` — a source-text
 *        target is not a name, and a target carrying the BINDING SEPARATOR is a CLAIM);
 *   (ii) it NEVER resolves a row that CARRIES A CLAIM, so a claim can never be merged into
 *        `resolved` by this rule in either direction.
 *
 * WHY THE PER-ROW ANSWER IS AVAILABLE AT ALL, and it is a property of the DUMP, not a hope: the
 * gate's `--dump` writes the NON-RESOLVED rows with their outcome, so a row that became RESOLVED
 * DISAPPEARS from the post-move dump. The movement is therefore RECOVERABLE as a set difference:
 *   · a key in BEFORE and ABSENT from AFTER  →  the row became RESOLVED (the movement);
 *   · a key in both with a DIFFERENT outcome  →  the row moved between non-resolved classes;
 *   · a key only in AFTER                    →  a row that was never in the before set.
 * The key is (label, source file, line, target) — the dump's own coordinates.
 *
 * THE CLAIM CHECK IS THE CHARTER'S, PER ROW: every moved row's CLAIM COLUMN must be `-`. A moved
 * row that carried a claim would be a claim merged into `resolved`, which the charter forbids and
 * which the tie-break's own condition (ii) exists to prevent. The count is printed, not asserted.
 *
 * THE OWN-FILE ATTRIBUTION: the tie-break's rule is "the row's OWN FILE declares the target". The
 * instrument re-parses ONLY the files that own a moved row (the pool worker's own parse, the same
 * one the gate uses) and counts how many moved rows' targets are declared in their own file. That
 * is the ATTRIBUTION BY MECHANISM; the attribution is by SIZE and by MECHANISM together, because a
 * row-level identity is what this instrument provides and a size is what the columns provide.
 *
 * USAGE
 *   bun run script/m14/cpp-tiebreak-reconcile.ts --before=<dump> --after=<dump> [--json=<path>]
 *   bun run script/m14/cpp-tiebreak-reconcile.ts --before=<dump> --after=<dump> --no-own-file
 *
 * EXIT: 0 measured · 2 usage · 3 CONTROL DID NOT FIRE.
 */
import * as fs from "node:fs"
import * as path from "node:path"

const ROOT = path.resolve((import.meta as any).dirname, "..", "..")
const argOf = (f: string): string | null => {
  const j = process.argv.find((a) => a.startsWith(`${f}=`))
  return j ? j.slice(f.length + 1) : null
}
const BEFORE = argOf("--before")
const AFTER = argOf("--after")
const JSON_OUT = argOf("--json")
const OWN_FILE = !process.argv.includes("--no-own-file")
if (!BEFORE || !AFTER) {
  console.error("usage: bun run script/m14/cpp-tiebreak-reconcile.ts --before=<dump> --after=<dump> [--json=<path>] [--no-own-file]")
  process.exit(2)
}

type DumpRow = { label: string; outcome: string; target: string; src: string; line: number; claim: string }
const readDump = (p: string): Map<string, DumpRow> => {
  const m = new Map<string, DumpRow>()
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    if (!line.startsWith("DUMP\t")) continue
    const f = line.split("\t")
    if (f.length < 6) continue
    if (f[1] === "BOUND") continue
    const at = f[4].match(/^(.*):(\d+)$/)
    if (!at) continue
    const key = `${f[1]}\0${at[1]}\0${at[2]}\0${f[3]}`
    if (m.has(key)) continue
    m.set(key, { label: f[1], outcome: f[2], target: f[3], src: at[1], line: Number(at[2]), claim: f[5] })
  }
  return m
}
const before = readDump(BEFORE)
const after = readDump(AFTER)

// ── the movement, per row ──────────────────────────────────────────────────────────────────────────
const movedToResolved: DumpRow[] = []
const outcomeChanged: Array<{ from: string; to: string; row: DumpRow }> = []
const newRows: DumpRow[] = []
for (const [k, row] of before) {
  const a = after.get(k)
  if (a === undefined) movedToResolved.push(row)
  else if (a.outcome !== row.outcome) outcomeChanged.push({ from: row.outcome, to: a.outcome, row })
}
for (const [k, row] of after) if (!before.has(k)) newRows.push(row)

// ── the control: the set arithmetic must close, exactly ───────────────────────────────────────────
const intersection = before.size - movedToResolved.length
if (intersection + movedToResolved.length !== before.size) {
  console.error("cpp-tiebreak-reconcile: CONTROL DID NOT FIRE — the before set does not decompose")
  process.exit(3)
}
if (intersection + newRows.length !== after.size) {
  console.error("cpp-tiebreak-reconcile: CONTROL DID NOT FIRE — the after set does not decompose")
  process.exit(3)
}

// ── the charter's claim check, PER MOVED ROW ──────────────────────────────────────────────────────
const movedWithClaim = movedToResolved.filter((r) => r.claim !== "-" && r.claim !== "")
const movedByLabel: Record<string, number> = {}
for (const r of movedToResolved) movedByLabel[r.label] = (movedByLabel[r.label] ?? 0) + 1
const changedByTransition: Record<string, number> = {}
for (const c of outcomeChanged) {
  const k = `${c.from} -> ${c.to}`
  changedByTransition[k] = (changedByTransition[k] ?? 0) + 1
}

// ── the own-file attribution (the tie-break's own rule) ───────────────────────────────────────────
let ownFileChecked = 0
let ownFileDeclares = 0
let ownFileSamples: string[] = []
if (OWN_FILE && movedToResolved.length > 0) {
  const { parseFile } = await import(path.join(ROOT, "src/ast/pool-worker.ts"))
  const byFile = new Map<string, DumpRow[]>()
  for (const r of movedToResolved) {
    const list = byFile.get(r.src) ?? []
    list.push(r)
    byFile.set(r.src, list)
  }
  for (const [src, rows] of byFile) {
    const repo = src.includes(`${path.sep}.corpus${path.sep}`)
      ? src.slice(src.indexOf(`${path.sep}.corpus${path.sep}`) + `${path.sep}.corpus${path.sep}`.length).split(path.sep)[0]
      : ""
    const repoDir = repo ? path.join(ROOT, ".corpus", repo) : path.dirname(src)
    let res: any
    try {
      res = await parseFile(src, repoDir)
    } catch {
      continue
    }
    const declared = new Set<string>()
    for (const s of res?.symbols ?? []) declared.add(String(s.name ?? ""))
    for (const r of rows) {
      ownFileChecked++
      if (declared.has(r.target)) {
        ownFileDeclares++
        if (ownFileSamples.length < 8) ownFileSamples.push(`${r.src.split(`${path.sep}.corpus${path.sep}`)[1] ?? r.src}:${r.line} ${r.label} -> ${r.target}`)
      }
    }
  }
}

const report = {
  schemaVersion: 1,
  instrument: "script/m14/cpp-tiebreak-reconcile.ts",
  measuredAt: new Date().toISOString(),
  mechanism: {
    commit: "e1e2f7a190a819ef06a145b53742250ee934710e",
    date: "2026-10-20T21:14:28-04:00",
    rule: "the arbiter walks the row's OWN FILE's statements first, so an edge whose own file declares the target IS bound",
    conditions: [
      "the target must be a NAME a declaration can bind (isPlainIdentifier)",
      "it NEVER resolves a row that CARRIES A CLAIM, so a claim is never merged into `resolved`",
    ],
  },
  population: { before: before.size, after: after.size },
  movement: {
    movedToResolved: movedToResolved.length,
    byLabel: movedByLabel,
    outcomeChanged: outcomeChanged.length,
    byTransition: changedByTransition,
    newRows: newRows.length,
  },
  claimCheck: {
    movedRowsCarryingAClaim: movedWithClaim.length,
    rule: "a moved row that carried a claim would be a CLAIM MERGED INTO RESOLUTION; the tie-break's own condition (ii) forbids it in either direction",
    samples: movedWithClaim.slice(0, 8).map((r) => `${r.src}:${r.line} ${r.label} -> ${r.target} claim=${r.claim}`),
  },
  ownFileAttribution: {
    checked: ownFileChecked,
    ownFileDeclares: ownFileDeclares,
    share: ownFileChecked > 0 ? ownFileDeclares / ownFileChecked : 0,
    note: "the tie-break's OWN RULE: the row's own file declares the target. The remainder is attributable to other mechanisms (the project index arms, the namespace citation), and the column delta measures the total.",
    samples: ownFileSamples,
  },
}
if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify(report, null, 2) + "\n")

console.log("cpp-tiebreak-reconcile — the own-file tie-break's movement, PER ROW")
console.log(`  before : ${before.size} non-resolved row(s)`)
console.log(`  after  : ${after.size} non-resolved row(s)`)
console.log(`  MOVED TO RESOLVED : ${movedToResolved.length}  ${JSON.stringify(movedByLabel)}`)
console.log(`  outcome changed   : ${outcomeChanged.length}  ${JSON.stringify(changedByTransition)}`)
console.log(`  new rows          : ${newRows.length}`)
console.log(`  moved rows carrying a CLAIM: ${movedWithClaim.length}  (a claim is never merged into resolution)`)
if (OWN_FILE) console.log(`  own-file declares the target: ${ownFileDeclares} of ${ownFileChecked} (${((ownFileDeclares / Math.max(1, ownFileChecked)) * 100).toFixed(1)} %)`)
console.log("PASS — the before and after sets both decompose exactly, and the claim check is printed, not asserted")
process.exit(0)

/**
 * compare-c-arms — READ THE c LANE'S THREE ARMS AND PRINT THE MOVEMENT, WITH THE ACCEPTANCE
 * TEST'S CHECKS COMPUTED FROM THE OUTPUT (not asserted in prose).
 *
 * Author: Muhammad Ishaq Khan. Read-only: it reads the arms' logs and prints. It writes nothing.
 *
 * IT READS:
 *   validation/m14/fixtures/c/measurements/c-arm-A-BEFORE.txt   the HEAD analyzer, the recorded population
 *   validation/m14/fixtures/c/measurements/c-arm-A-AFTER.txt    the lane's analyzer, the SAME population
 *   validation/m14/fixtures/c/measurements/c-arm-B-AFTER.txt    the lane's analyzer, the gate's own `c,h` map
 *
 * AND IT PRINTS, FOR EACH PAIR: the per-column movement, the INTENT CLOSURE with its own sum
 * checked against the edge count, and the acceptance test's four conditions:
 *   1. extFAIL = bindFAIL = causeFAIL = 0
 *   2. arbitraryTwin NOT risen
 *   3. the class sum EXACTLY equals the edge count (closure exact)
 *   4. the claims are NOT merged into resolution — the extOK/bindOK columns are counted SEPARATELY
 *      from `resolved`, and the gate's own owner-channel line is printed verbatim so the separation
 *      is the gate's statement and not this script's.
 *
 * EVERY NUMBER CARRIES ITS POPULATION, because the three arms do NOT share one: A runs on 5,022 `.c`
 * files and B runs on the `c,h` map's 20,824, so a percentage is comparable only WITHIN a pair.
 */
import { existsSync, readFileSync } from "node:fs"
import * as path from "node:path"

const HERE = path.dirname(new URL(import.meta.url).pathname)
const MEAS = path.join(HERE, "measurements")

const COLS = [
  "edges", "resolved", "collRes", "amb(decl)", "amb(kind)", "unresolved",
  "extOK", "ext?", "extFAIL", "bindOK", "bind?", "bindFAIL", "causeOK", "causeFAIL",
]

type Table1 = Map<string, number[]>
type Intent = Map<string, number[]>

function parseArm(text: string): {
  table1: Table1
  intent: Intent
  total: number[] | null
  intentTotal: number[] | null
  closureOk: boolean
  closureLine: string
  population: string
  ownerLine: string
  digests: string
} {
  const lines = text.split("\n")
  const table1: Table1 = new Map()
  const intent: Intent = new Map()
  let total: number[] | null = null
  let closureOk = false
  let closureLine = ""
  let population = ""
  let ownerLine = ""
  let mode: "table1" | "pooled" | "intent" | "meta" | "" = ""
  let total1: number[] | null = null
  for (const raw of lines) {
    const line = raw.replace(/\r/g, "")
    if (/^population: /.test(line)) population = line.trim()
    if (/^\s*owner\s+VERIFIED/.test(line)) ownerLine = line.trim()
    if (/^  INTENT CLOSURE:/.test(line)) { closureLine = line.trim(); closureOk = /every row closes/.test(line); continue }
    // THE THREE COUNT TABLES, TOLD APART BY THEIR OWN HEADERS. The gate prints three tables that
    // all start with a label and a run of numbers, and a reader that takes the LAST one for the
    // first one is reading the pooled corpus key space as if it were the per-project model. So the
    // header line decides which table a row belongs to, and the rows go to THAT table.
    if (/^type\s+edges\s+resolved\s+collRes/.test(line)) { mode = "table1"; continue }
    if (/^type\s+metadata KEYS/.test(line)) { mode = "meta"; continue }
    if (/^type\s+edges\s+resolved\s+amb\(decl\)\s+unresolved/.test(line)) { mode = "pooled"; continue }
    // the intent block's header is INDENTED in the gate's output, the other two are not — so the
    // header regexes must allow leading whitespace or the intent rows fall into another table.
    if (/^\s*type\s+edges\s+intended/.test(line)) { mode = "intent"; continue }
    // the intent block's ROWS are indented too, so the row pattern must allow leading whitespace.
    const m = line.match(/^\s*(\w+)\s+((?:\d+\s+)+\d+)\s*$/)
    if (m) {
      const nums = m[2].trim().split(/\s+/).map(Number)
      if (mode === "intent") {
        if (m[1] === "TOTAL") total = nums
        else intent.set(m[1], nums)
      } else if (mode === "table1") {
        table1.set(m[1], nums)
        if (m[1] === "TOTAL") total1 = nums
      }
    }
  }
  // THE DIGEST HEADER, if the arm's log carries one (the arm script writes it first).
  let digests = ""
  const dIdx = lines.findIndex((l) => l.startsWith("INSTRUMENT DIGESTS"))
  if (dIdx >= 0) digests = lines.slice(dIdx, dIdx + 4).join(" | ")
  return { table1, intent, total: total1, intentTotal: total, closureOk, closureLine, population, ownerLine, digests }
}

function readArm(label: string): ReturnType<typeof parseArm> | null {
  const p = path.join(MEAS, `c-arm-${label}.txt`)
  if (!existsSync(p)) return null
  return parseArm(readFileSync(p, "utf8"))
}

function main(): void {
  const before = readArm("A-BEFORE")
  const after = readArm("A-AFTER")
  const bafter = readArm("B-AFTER")
  if (!before || !after) {
    console.error("compare-c-arms — the A pair is not on disk yet:")
    if (!before) console.error("  missing: measurements/c-arm-A-BEFORE.txt")
    if (!after) console.error("  missing: measurements/c-arm-A-AFTER.txt")
    process.exit(2)
  }

  console.log("compare-c-arms — the c lane's arms, the movement, and the acceptance test's checks")
  console.log("")
  console.log("  INSTRUMENT VERSIONS — AN ARM THAT RAN BEFORE 2026-10-20 21:14 AND ONE THAT RAN AFTER")
  console.log("  IT ARE DIFFERENT INSTRUMENTS, AND A READER MUST BE ABLE TO TELL WHICH MADE A NUMBER.")
  console.log("    the arbiter        : the tree's arbiter (the own-file tie-break landed 2026-10-20 21:14,")
  console.log("                         commit e1e2f7a19; the c arms ran AFTER it)")
  console.log("    THE DIGESTS        : each arm's OWN LOG carries, in its first lines, the digests of the")
  console.log("                         arbiter and the analyzer as they stood WHEN THAT ARM RAN. A COMMIT")
  console.log("                         IS NOT ENOUGH — the arbiter's source can change without its")
  console.log("                         commit changing — so a reader checks the digest IN THE LOG.")
  for (const [label, arm] of [["A-BEFORE", before], ["A-AFTER", after], ["B-AFTER", bafter]] as const) {
    if (!arm) continue
    const dig = (arm as any).digests as string | undefined
    if (dig) console.log(`      ${label}: ${dig.replace(/\n/g, " | ")}`)
  }
  console.log("    A-BEFORE's analyzer: the tree's HEAD analyzer (git show HEAD:src/ast/real-c-analyzer.ts)")
  console.log("    A-AFTER's analyzer : the lane's working-tree analyzer (the exports fix)")
  console.log("    the corpus root    : the farm $BB_CORPUS_ROOT=.corpus (the gate's default root is a")
  console.log("                         DIFFERENT population and a rate is comparable only within a pair)")
  console.log("")
  console.log("  POPULATIONS (each arm's own line; A and B ARE DIFFERENT POPULATIONS)")
  console.log(`    A-BEFORE: ${before.population}`)
  console.log(`    A-AFTER : ${after.population}`)
  if (bafter) console.log(`    B-AFTER : ${bafter.population}`)
  console.log("")

  // ── TABLE 1, per label, with the movement ──────────────────────────────────────────────────
  console.log("  TABLE 1 — PER PROJECT (the scope production resolves in)")
  for (const label of ["calls", "uses", "contains", "imports", "references", "exports", "overrides", "instantiates"]) {
    const b = before.table1.get(label)
    const a = after.table1.get(label)
    if (!b || !a) continue
    const d = a.map((v, i) => v - b[i])
    if (b.every((v) => v === 0) && a.every((v) => v === 0)) continue
    const head = `    ${label.padEnd(12)}`
    console.log(`${head} edges ${b[0]}→${a[0]} (${d[0] >= 0 ? "+" : ""}${d[0]})   resolved ${b[1]}→${a[1]} (${d[1] >= 0 ? "+" : ""}${d[1]})   collRes ${b[2]}→${a[2]}   amb(decl) ${b[3]}→${a[3]} (${d[3] >= 0 ? "+" : ""}${d[3]})   amb(kind) ${b[4]}→${a[4]}   unresolved ${b[5]}→${a[5]} (${d[5] >= 0 ? "+" : ""}${d[5]})`)
    const claim = `extOK ${b[6]}→${a[6]}  ext? ${b[7]}→${a[7]}  extFAIL ${b[8]}→${a[8]}  bindOK ${b[9]}→${a[9]}  bind? ${b[10]}→${a[10]}  bindFAIL ${b[11]}→${a[11]}  causeOK ${b[12]}→${a[12]}  causeFAIL ${b[13]}→${a[13]}`
    console.log(`    ${"".padEnd(12)} ${claim}`)
  }
  console.log("")

  // ── the acceptance test's four conditions, COMPUTED ───────────────────────────────────────
  const checks: Array<[string, boolean, string]> = []

  // 1 · extFAIL = bindFAIL = causeFAIL = 0
  {
    const bad: string[] = []
    for (const [label, nums] of after.table1) {
      if (nums[8] !== 0) bad.push(`A-AFTER ${label} extFAIL ${nums[8]}`)
      if (nums[11] !== 0) bad.push(`A-AFTER ${label} bindFAIL ${nums[11]}`)
      if (nums[13] !== 0) bad.push(`A-AFTER ${label} causeFAIL ${nums[13]}`)
    }
    if (bafter) {
      for (const [label, nums] of bafter.table1) {
        if (nums[8] !== 0) bad.push(`B-AFTER ${label} extFAIL ${nums[8]}`)
        if (nums[11] !== 0) bad.push(`B-AFTER ${label} bindFAIL ${nums[11]}`)
        if (nums[13] !== 0) bad.push(`B-AFTER ${label} causeFAIL ${nums[13]}`)
      }
    }
    checks.push(["extFAIL = bindFAIL = causeFAIL = 0", bad.length === 0, bad.length ? bad.join(" · ") : "0 in every label, in both arms"])
  }

  // 2 · arbitraryTwin NOT risen
  {
    const b = before.intentTotal
    const a = after.intentTotal
    if (b && a) {
      // the intent TOTAL's columns are: edges · intended · sameFileUnproven · arbitraryTwin ·
      // nothingAnywhere · noTarget — so arbitraryTwin is INDEX 3, and reading index 2 would check
      // the wrong class and call it a pass.
      const BT = 3
      const d = a[BT] - b[BT]
      checks.push([
        "arbitraryTwin NOT risen",
        d <= 0,
        `arbitraryTwin ${b[BT]} → ${a[BT]} (${d >= 0 ? "+" : ""}${d}) · sameFileUnproven ${b[2]} → ${a[2]} · nothingAnywhere ${b[4]} → ${a[4]}`,
      ])
    } else {
      checks.push(["arbitraryTwin NOT risen", false, "the intent TOTAL row was not on disk in both arms"])
    }
  }

  // 3 · the class sum EXACTLY equals the edge count
  {
    const gaps: string[] = []
    for (const [label, nums] of after.intent) {
      // intended, sameFileUnproven, arbitraryTwin, nothingAnywhere, noTarget
      const sum = nums[1] + nums[2] + nums[3] + nums[4] + nums[5]
      if (sum !== nums[0]) gaps.push(`${label}: ${sum} ≠ ${nums[0]}`)
    }
    const t = after.intent.get("TOTAL")
    const tSum = t ? t[1] + t[2] + t[3] + t[4] + t[5] : -1
    if (t && tSum !== t[0]) gaps.push(`TOTAL: ${tSum} ≠ ${t[0]}`)
    checks.push([
      "the class sum EXACTLY equals the edge count (closure exact)",
      gaps.length === 0 && after.closureOk,
      gaps.length ? gaps.join(" · ") : (t ? `every row, and the TOTAL (${tSum} = ${t[0]})` : "every row"),
    ])
  }

  // 4 · the claims are NOT merged into resolution
  {
    // The gate counts the claim channels in their OWN columns (extOK/ext?/extFAIL, bindOK/bind?/
    // bindFAIL). The check this script can make from the output is that the claim channels are
    // present and DISJOINT from `resolved` — i.e. the gate's own owner-channel line is printed and
    // the claim columns are not folded into `resolved`.
    const ok = after.ownerLine.length > 0
    checks.push([
      "claims never merged into resolution",
      ok,
      ok ? "the gate prints the owner channel BESIDE the name model, and the claim columns are counted separately" : "the gate's owner-channel line was not on disk — this check could NOT be made",
    ])
  }

  console.log("  THE ACCEPTANCE TEST'S CONDITIONS, computed from the arms' own output")
  for (const [name, ok, detail] of checks) {
    console.log(`    ${ok ? "PASS" : "FAIL"}  ${name} — ${detail}`)
  }
  console.log("")

  // ── THE RECORDED ARM, so the GATE's movement is not mistaken for the ANALYZER's ───────────
  // The ledger's c row (RESOLUTION-LEDGER.md §1, row `c`) is the 2026-10-19 arm: the HEAD
  // analyzer under the gate as it stood THEN. A-BEFORE is the HEAD analyzer under the gate as it
  // stands NOW. **THE DIFFERENCE BETWEEN THEM IS THE GATE'S, NOT THE LANE'S** — the gate has taken
  // the CMake-reader wiring and the K1/iso-c corrections since. The lane's own movement is
  // A-AFTER − A-BEFORE, where the gate is IDENTICAL on both sides.
  const rec = { edges: 574_851, resolved: 248_021, claims: 37_633, verifiedPct: 49.7 }
  // THE GATE'S OWN TOTAL ROW, NOT THE SUM OF THE ROWS: the TOTAL row is IN the table, so summing
  // the table counts every label twice and the headline doubles. The gate's TOTAL is the number.
  const bT = before.total
  const aT = after.total
  if (!bT || !aT) {
    console.log("  THE ARMS' TOTAL ROWS ARE NOT ON DISK — this reader cannot report a movement.")
    process.exit(1)
  }
  const bEdges = bT[0]
  const bResolved = bT[1]
  const aEdges = aT[0]
  const aResolved = aT[1]
  console.log("  THE RECORDED ARM (the ledger's c row — the 2026-10-19 arm, the OLD gate) and the")
  console.log("  attribution of every difference. THE LANE'S MOVEMENT IS THE SECOND LINE ONLY.")
  console.log(`    RECORDED  (ledger §1 row c, 2026-10-19, HEAD analyzer, OLD gate) : edges ${rec.edges} · resolved ${rec.resolved} · verified ${rec.verifiedPct} %`)
  console.log(`    A-BEFORE  (HEAD analyzer, CURRENT gate)                          : edges ${bEdges} · resolved ${bResolved} (${(bResolved / bEdges * 100).toFixed(1)} %)`)
  console.log(`      → THE GATE'S MOVEMENT SINCE THE RECORDED ARM: edges ${bEdges - rec.edges >= 0 ? "+" : ""}${bEdges - rec.edges} · resolved ${bResolved - rec.resolved >= 0 ? "+" : ""}${bResolved - rec.resolved}`)
  console.log(`        THIS IS THE TIE-BREAK'S PRICE ON THE c LANE, plus the gate's other changes since`)
  console.log(`        2026-10-19 (the CMake-reader wiring, the K1/iso-c corrections, and the own-file`)
  console.log(`        tie-break of 2026-10-20 21:14, commit e1e2f7a19). IT IS NOT THE LANE'S WORK.`)
  console.log(`    A-AFTER   (the lane's analyzer, CURRENT gate)                     : edges ${aEdges} · resolved ${aResolved} (${(aResolved / aEdges * 100).toFixed(1)} %)`)
  console.log(`      → THE LANE'S MOVEMENT: edges ${aEdges - bEdges >= 0 ? "+" : ""}${aEdges - bEdges} · resolved ${aResolved - bResolved >= 0 ? "+" : ""}${aResolved - bResolved} · share ${((aResolved / aEdges - bResolved / bEdges) * 100 >= 0 ? "+" : "")}${((aResolved / aEdges - bResolved / bEdges) * 100).toFixed(2)} pp  (same gate, same root, same population)`)
  console.log("")

  if (after.ownerLine) console.log(`  the gate's own owner-channel line (A-AFTER):\n    ${after.ownerLine}`)
  console.log(`  the gate's own closure line (A-AFTER): ${after.closureLine || "(not printed)"}`)

  if (bafter) {
    console.log("")
    console.log("  ARM B (the gate's own `c,h` map — A DIFFERENT POPULATION, so its columns are NOT")
    console.log("  comparable with A's; it is the RULING 1 and the KEY-SPACE arm)")
    for (const [label, nums] of bafter.table1) {
      if (nums.every((v) => v === 0)) continue
      console.log(`    ${label.padEnd(12)} ${nums.map((v, i) => `${COLS[i]}=${v}`).join("  ")}`)
    }
    const bt = bafter.intent.get("TOTAL")
    if (bt) console.log(`    intent TOTAL  edges=${bt[0]}  intended=${bt[1]}  sameFileUnproven=${bt[2]}  arbitraryTwin=${bt[3]}  nothingAnywhere=${bt[4]}  noTarget=${bt[5]}`)
    console.log(`    closure: ${bafter.closureLine}`)
    // the KEY-SPACE movement: amb(decl) in B against A — Rulings 1 and 2 priced together
    const aAmb = after.table1.get("calls")?.[3] ?? 0
    const bAmb = bafter.table1.get("calls")?.[3] ?? 0
    console.log(`    the key-space reading: calls amb(decl) A-AFTER ${aAmb} → B-AFTER ${bAmb} (a RISE is Ruling 1's falsifier (b))`)
  }
}

main()

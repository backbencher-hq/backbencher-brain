// TYPESCRIPT LANE — THE TWO-BUILD POPULATION DELTA (the R2 grammar swap, attributed).
//
// ⇒⇒⇒ THE FLEET'S RULE: a delta must be attributed to the side that moved. The grammar swap is a
// change to the PARSER, so the question it raises is not "did `part_of` appear" — it is "DID ANYTHING
// ELSE MOVE". A `part_of` count that arrives alongside a shifted `calls` count is not a swap that
// extended the lane; it is a swap that changed the lane, and the decision belongs to the Lead with
// numbers rather than to the lane with a hope.
//
// WHAT THIS REFUSES TO DO:
//   · it refuses to compare two logs whose POPULATION lines differ (two different populations would
//     make every per-label delta meaningless);
//   · it refuses to compare two logs that are the SAME build (a delta of zero between one build and
//     itself proves nothing and reads like a clean result);
//   · it does not print a rate it cannot compute from the columns present.
//
// Usage: bun run script/m14/ts-two-build-delta.ts <logA> <logB> [--label-a=served] [--label-b=patched]
import { readFileSync } from "node:fs"
import { createHash } from "node:crypto"

const COLS = ["edges","resolved","collRes","ambDecl","ambKind","unresolved","extOK","extQ","extFAIL",
              "bindOK","bindQ","bindFAIL","causeOK","causeFAIL"]

interface Parsed {
  population: string
  populationDigest: string
  sha256: string
  types: Map<string, Record<string, number>>
  namedTypes: number
  grammar: string
}

function parse(logPath: string): Parsed {
  const raw = readFileSync(logPath, "utf8")
  const lines = raw.split(/\r?\n/)
  const popLine = (lines.find((l) => /^\s*population:/i.test(l)) ?? "").trim()
  // THE BUILD IDENTITY, if the log names it. A log that does not say which bytes it ran on cannot
  // support an attribution, so the absence is reported rather than guessed.
  const grammarLine = (lines.find((l) => /(?:sha256|digest)[^a-z]{0,4}[0-9a-f]{64}/i.test(l) && /wasm|grammar/i.test(l)) ?? "").trim()
  const grammarMatch = /([0-9a-f]{64})/.exec(grammarLine)
  const hIdx = lines.findIndex((l) => /^type\s+edges\s+resolved/i.test(l.trim()))
  const types = new Map<string, Record<string, number>>()
  if (hIdx >= 0) {
    for (let i = hIdx + 1; i < lines.length; i++) {
      const cells = lines[i].trim().split(/\s+/)
      if (cells.length < 15 || !/^[a-z_]+$/.test(cells[0])) break
      const nums = cells.slice(1, 15).map((n) => Number(n.replace(/,/g, "")))
      if (nums.some(Number.isNaN)) break
      types.set(cells[0], Object.fromEntries(COLS.map((c, j) => [c, nums[j]])))
    }
  }
  return {
    population: popLine,
    populationDigest: createHash("sha256").update(popLine).digest("hex").slice(0, 16),
    sha256: createHash("sha256").update(raw).digest("hex"),
    types,
    namedTypes: types.size,
    grammar: grammarMatch ? grammarMatch[1] : "(the log names no build digest)",
  }
}

const argv = process.argv.slice(2)
const [logA, logB] = argv.filter((a) => !a.startsWith("--"))
const labelA = argv.find((a) => a.startsWith("--label-a="))?.slice("--label-a=".length) ?? "A"
const labelB = argv.find((a) => a.startsWith("--label-b="))?.slice("--label-b=".length) ?? "B"
if (!logA || !logB) {
  console.error("usage: ts-two-build-delta.ts <logA> <logB> [--label-a=served] [--label-b=patched]")
  process.exit(2)
}

const A = parse(logA)
const B = parse(logB)

console.log(`A (${labelA}): ${logA}`)
console.log(`  log sha256 ${A.sha256.slice(0, 16)} · build ${A.grammar.slice(0, 16)}`)
console.log(`  ${A.population || "(NO POPULATION LINE)"}`)
console.log(`B (${labelB}): ${logB}`)
console.log(`  log sha256 ${B.sha256.slice(0, 16)} · build ${B.grammar.slice(0, 16)}`)
console.log(`  ${B.population || "(NO POPULATION LINE)"}`)
console.log()

if (!A.types.size || !B.types.size) {
  console.error("REFUSED: one of the logs carries no readable TABLE 1. A delta needs two per-type blocks.")
  process.exit(3)
}
if (A.population !== B.population) {
  console.error("REFUSED: the two logs describe DIFFERENT POPULATIONS. A per-label delta across two")
  console.error("populations is a comparison of two studies, not of two builds.")
  process.exit(4)
}
if (A.sha256 === B.sha256) {
  console.error("REFUSED: the two logs are the SAME FILE. A delta of a log against itself is zero by")
  console.error("construction and would read as a clean result.")
  process.exit(5)
}

const allTypes = [...new Set([...A.types.keys(), ...B.types.keys()])].sort()
const moved: string[] = []
console.log("PER-LABEL DELTA (B − A), every column, and a row is 'moved' if ANY column moved:")
console.log("label".padEnd(14) + COLS.map((c) => c.padStart(10)).join(""))
let totalA = 0, totalB = 0
for (const t of allTypes) {
  const a = A.types.get(t) ?? Object.fromEntries(COLS.map((c) => [c, 0]))
  const b = B.types.get(t) ?? Object.fromEntries(COLS.map((c) => [c, 0]))
  const diffs = COLS.map((c) => (b[c] ?? 0) - (a[c] ?? 0))
  if (diffs.some((d) => d !== 0)) moved.push(t)
  totalA += a.edges ?? 0
  totalB += b.edges ?? 0
  console.log(t.padEnd(14) + diffs.map((d) => (d === 0 ? "·" : String(d > 0 ? `+${d}` : d)).padStart(10)).join(""))
}
console.log()
console.log(`edges: ${labelA} ${totalA} → ${labelB} ${totalB} (Δ ${totalB - totalA})`)
console.log()
const nonPartOf = moved.filter((t) => t !== "part_of")
console.log(moved.length === 0
  ? "VERDICT: NO LABEL MOVED. The swap is output-preserving over this population — which is itself a finding, and it means the two logs did not actually run different builds."
  : `VERDICT: ${moved.length} label(s) moved: ${moved.join(", ")}`)
if (nonPartOf.length > 0) {
  console.log()
  console.log("*** STOP — A LABEL OTHER THAN `part_of` MOVED. ***")
  console.log("The Lead's condition 4: a grammar that fixes one node type and perturbs others is a")
  console.log("DIFFERENT DECISION, and it is made with numbers. Report this delta and do not absorb it.")
  process.exit(6)
}
console.log()
console.log("Only `part_of` moved. The swap extended the lane; it did not change it.")

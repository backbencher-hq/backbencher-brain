// kotlin-wall-classify — stream the gate's own kotlin arm dump into the D7 wall classes (light; no re-parse).
//
// USAGE: bun run script/m14/kotlin-wall-classify.ts <dump.log> [more dump.log ...] --json=<out.json>
//
// MULTIPLE DUMPS ARE SUMMED, AND THAT IS THE ARM'S SHAPE. The kotlin arm is the UNION OF THREE DISJOINT
// SLICE RUNS (validation/m14/results/kotlin-whole-population-closure.json — 3 slices over [0,2346)),
// and each slice resolves against its OWN per-project declaration table. So the wall census that must
// reconcile with the closure is the SUM of the slices' wall classes, not a whole-population re-run's:
// MEASURED, a single whole-population run of the same gate over the same files reads 146,477 wall
// rows where the slice sum is 148,357 (edges identical at 257,582) — the difference is the
// declaration table's completeness, a property of the RUN'S SCOPE. This instrument therefore accepts
// several dumps and sums them, and its `dumps` array says which ones.
import { createReadStream, writeFileSync } from "node:fs"
import { createInterface } from "node:readline"
const FILES = process.argv.slice(2).filter((a) => !a.startsWith("--"))
const OUT = process.argv.find((a) => a.startsWith("--json="))?.slice("--json=".length) ?? ""
if (FILES.length === 0) {
  console.error("usage: kotlin-wall-classify.ts <dump.log> [more dump.log ...] --json=<out.json>")
  process.exit(2)
}
const WALL = new Set(["unresolved", "ambDeclOnly", "ambBoth"])
const STD = ["kotlin.", "java.", "javax.", "sun.", "jdk.", "android."]
const byLabel: Record<string, any> = {}
const classes: Record<string, { rows: number; samples: string[] }> = {}
const topTargets = new Map<string, number>()
const shape = (t: string): string => {
  if (t.length === 0) return "empty"
  if (t.startsWith("`")) return "backticked"
  if (/^[^A-Za-z0-9_`]/.test(t)) return "operator-or-punctuation"
  if (t.includes("(") || t.includes(")")) return "call-or-annotation-shaped"
  if (STD.some((p) => t.startsWith(p))) return "external-jvm-stdlib"
  if (t.includes(".")) return "external-dotted"
  if (/^[A-Z][A-Za-z0-9_]*$/.test(t)) return "simple-type-shaped"
  if (/^[a-z_][A-Za-z0-9_]*$/.test(t)) return "simple-name-shaped"
  return "other"
}
const classify = (label: string, t: string): string => {
  const sh = shape(t)
  // overrides FIRST: its targets can be dotted/backticked too, and the disposition (guess tiers are
  // heuristic by construction) is about the LABEL, not the spelling.
  if (label === "overrides") return "C4-override-guess-or-name"
  if (sh === "external-jvm-stdlib") return "C1-external-jvm-stdlib"
  if (label === "imports" && (sh === "external-dotted" || sh === "simple-name-shaped")) return "C3-external-import-path"
  if (sh === "external-dotted") return "C2-external-library"
  if (sh === "empty" || sh === "operator-or-punctuation" || sh === "call-or-annotation-shaped") return "C5-placeholder-or-fragment"
  if (sh === "backticked") return "C8-backticked"
  if (sh === "simple-type-shaped") return "C6-type-shaped-simple"
  return "C7-name-shaped-simple"
}
let rows = 0
const perDump: Array<{ dump: string; wallRows: number }> = []
for (const FILE of FILES) {
  let fileRows = 0
  const rl = createInterface({ input: createReadStream(FILE, "utf8"), crlfDelay: Infinity })
  for await (const line of rl) {
    if (!line.startsWith("DUMP\t")) continue
    const p = line.split("\t")
    const label = p[1], outcome = p[2], target = String(p[3] ?? "").trim(), where = p[4] ?? ""
    if (!WALL.has(outcome)) continue
    rows++
    fileRows++
    const L = byLabel[label] ?? { amb: 0, unresolved: 0, shapes: {} as Record<string, number> }
    if (outcome === "unresolved") L.unresolved++
    else L.amb++
    const cls = classify(label, target)
    const sh = shape(target)
    L.shapes[sh] = (L.shapes[sh] ?? 0) + 1
    byLabel[label] = L
    const C = classes[cls] ?? { rows: 0, samples: [] }
    C.rows++
    if (C.samples.length < 6) C.samples.push(`${outcome}\t${label}\t${target}\t${where}`)
    classes[cls] = C
    topTargets.set(target, (topTargets.get(target) ?? 0) + 1)
  }
  perDump.push({ dump: FILE, wallRows: fileRows })
}
const report = {
  instrument: "script/m14/kotlin-wall-classify.ts",
  dumps: FILES,
  perDump,
  wallRows: rows,
  byLabel: Object.fromEntries(Object.entries(byLabel).sort((a: any, b: any) => (b[1].amb + b[1].unresolved) - (a[1].amb + a[1].unresolved))),
  classes,
  topTargets: [...topTargets.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([target, rows]) => ({ target, rows })),
  claimed: 0,
  note: "wall = unresolved + ambDeclOnly + ambBoth from the gate's own dump, SUMMED over the arm's disjoint slice runs; CLAIMED=0 (no lane claim kind; extOK is the fleet external channel, not a claim column). A whole-population single run of the same gate reads DIFFERENT wall rows because each run resolves against its own per-project declaration table (a property of the run's scope).",
}
if (OUT) writeFileSync(OUT, JSON.stringify(report, null, 1) + "\n")
console.log(JSON.stringify({ wallRows: rows, perDump, classes: Object.fromEntries(Object.entries(classes).map(([k, v]) => [k, v.rows])), top: report.topTargets.slice(0, 12) }, null, 1))

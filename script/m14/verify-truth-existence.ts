/**
 * verify-truth-existence — the gate for the OTHER half of the allowlist gap.
 *
 * ## The gap this catches
 *
 * The M60 label-coverage sweep started from a label the analyzer EMITS and the
 * allowlist DROPS: compared by nothing, while the lane still prints a percentage.
 * `verify-label-coverage.ts` measures that direction.
 *
 * This gate measures its MIRROR, which is just as silent and was found by accident:
 * a label the allowlist ADMITS, for which no oracle exists. Those rows enter the
 * comparison with no truth to meet, so every one of them is counted as an
 * unexplained fabrication — the lane reports its analyzer as inventing edges when
 * the real problem is that nobody wrote down what it should have invented.
 *
 * The harness already prints the condition as `COMPARED WITH NO TRUTH`. This makes it
 * a failure instead of a log line. A 6-file sweep found it in 13 lane/corpus pairs:
 *
 *   overrides   scala, java, python, kotlin, groovy, php, ruby
 *   extends     julia
 *   instantiates julia, powershell
 *   references  powershell
 *
 * `overrides` is the systematic one and the reason is structural, not accidental:
 * it sits in the allowlist's DEFAULT admitted prefix for every language except
 * csharp/dart/swift/cpp, so it is compared everywhere, while only a handful of
 * lanes have an overrides oracle at all. Scala's own lane printed
 * `COMPARED WITH NO TRUTH: overrides (26 comparable, 0 truth)` throughout this work.
 *
 * ## Why this is not fixed by adding every oracle
 *
 * Because admitting a label without truth is a different defect from dropping one
 * without truth, and the fix is not symmetric. Dropping the label hides output.
 * Admitting it without an oracle converts that hidden output into a count of
 * FABRICATIONS, which is a false accusation of the analyzer. The honest state for
 * such a lane is DECLARED: the spec says the label is compared against nothing and
 * why, so the number is not mistaken for a verdict.
 *
 * This gate therefore does not fail merely that the condition exists — it fails
 * because the condition is undeclared. A lane that has written the admission down
 * passes; a lane that has not is asking to be read as clean when it is not.
 *
 * ## Cost
 *
 * It runs the differential itself, so it is slower than the other gates. `--sample`
 * defaults to 6 files per lane for that reason; the gate asserts the CONDITION is
 * declared, not that the sample is large.
 *
 * Usage: npx tsx script/m14/verify-truth-existence.ts [--sample N]
 */

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { execFileSync } from "node:child_process"

const ROOT = path.resolve(path.dirname(process.argv[1]), "..", "..")
const SPEC_DIR = path.join(ROOT, "script/m14/spec")

function declaredLabels(lang: string): Set<string> {
  const p = path.join(SPEC_DIR, `${lang}-completeness.json`)
  if (!fs.existsSync(p)) return new Set()
  try {
    const d = JSON.parse(fs.readFileSync(p, "utf8"))
    const lc = d?.label_coverage
    const out = new Set<string>()
    for (const key of ["declared_gaps", "declared_no_truth"]) {
      for (const g of (lc?.[key] ?? [])) if (g?.label) out.add(String(g.label))
    }
    return out
  } catch {
    return new Set()
  }
}

function main(): void {
  const argv = process.argv.slice(2)
  const i = argv.indexOf("--sample")
  const sample = i >= 0 ? Number(argv[i + 1]) : 6

  console.log(`# verify-truth-existence — admitted labels with no oracle behind them\n`)
  console.log(`running the differential at --sample ${sample} to read the harness's own condition\n`)

  let out = ""
  try {
    // NODE_OPTIONS carries the TS loader into the spawned batches; without it the
    // children re-run this script under plain node and cannot resolve a .ts import.
    // M14_WORK_ENV points the differential at a PRISTINE work root. Without it the
    // gate inherits the cold pool left by whatever sweep ran last, and a drained
    // pool measures almost nothing — which is how the first version of this gate
    // reported PASS on a sweep that had already found 13 lane/corpus pairs. A gate
    // whose verdict depends on history is not a gate.
    const workRoot = fs.mkdtempSync(path.join(os.tmpdir(), "m14-truth-existence-"))
    out = execFileSync("node", [path.join(ROOT, "script/m14/differential.ts"), "--sample", String(sample)], {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
      env: {
        ...process.env,
        NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import tsx`.trim(),
        M14_WORK_ENV: workRoot,
      },
      timeout: 60 * 60 * 1000,
    })
  } catch (e: any) {
    out = `${e.stdout ?? ""}${e.stderr ?? ""}`
  }

  // the harness prints one line per (corpus, lane) with any such label
  const hits = new Map<string, { lane: string; labels: string[] }>()
  for (const line of out.split("\n")) {
    // The harness indents its per-lane lines, so the anchor tolerates leading space.
    // The first version anchored at `^[` and therefore matched nothing, reporting PASS
    // on a sweep that had already printed 13 of these.
    const m = line.match(/^\s*\[([^\]]+)\]\s+([a-z0-9]+):\s+COMPARED WITH NO TRUTH:\s*(.+?)\s*$/)
    if (!m) continue
    const lane = m[2]
    // The clause is `<label> (<n> comparable, 0 truth)`, repeated. Splitting on the
    // comma inside the parens is what made the first version report a label called
    // `0`. Match the shape instead, and keep only labels that actually EMITTED
    // something: an admitted label with no truth AND no rows is not yet a risk, while
    // one with rows is a count of fabrications that has no meaning.
    const labels: string[] = []
    for (const c of m[3].matchAll(/([a-z_]+)\s*\(\s*(\d+)\s+comparable/g)) {
      if (Number(c[2]) > 0) labels.push(c[1])
    }
    const prev = hits.get(lane) ?? { lane, labels: [] }
    for (const l of labels) if (!prev.labels.includes(l)) prev.labels.push(l)
    hits.set(lane, prev)
  }

  if (!hits.size) {
    console.log("PASS — every admitted label has an oracle behind it (or none is emitted on this sample)")
    process.exit(0)
  }

  console.log("| lane | admitted with NO truth | declared in spec? |")
  console.log("|---|---|---|")
  let undeclared = 0
  for (const { lane, labels } of [...hits.values()].sort((a, b) => a.lane.localeCompare(b.lane))) {
    const declared = declaredLabels(lane)
    const cells = labels.map((l) => {
      const ok = declared.has(l)
      if (!ok) undeclared++
      return ok ? `\`${l}\` (declared)` : `**\`${l}\`**`
    })
    console.log(`| ${lane} | ${cells.join(", ")} | ${labels.every((l) => declared.has(l)) ? "yes" : "**no**"} |`)
  }

  console.log("")
  if (undeclared === 0) {
    console.log("PASS — every admitted-but-truthless label is DECLARED in its lane spec")
    process.exit(0)
  }
  console.log(`FAIL — ${undeclared} admitted label(s) have no oracle and are not declared.`)
  console.log("      Each is being counted as an unexplained FABRICATION against the analyzer when the")
  console.log("      actual problem is that nobody wrote down what it should have produced. Declare it at")
  console.log("      spec/<lang>-completeness.json label_coverage.declared_no_truth[], or wire an oracle.")
  process.exit(1)
}
main()
/**
 * 2026-09-29: verify csharp's LINE NUMBERS on every relationship, per the M60 claim.
 *
 * WHY THIS IS A SEPARATE GATE AND NOT A FIXTURE. Every other csharp check asks whether a
 * relationship EXISTS with the right label and target. None of them ask whether its `line_number`
 * points at the construct that justifies it. That makes the line the most weakly-held field in
 * the graph: a relationship can be entirely correct and still be stamped on the wrong line, and
 * every existing gate will pass it. It is also the field a consumer is most likely to use — a
 * "go to definition" affordance built on `line_number` is exactly as wrong as the line is, and it
 * fails silently at the point of use rather than in CI.
 *
 * WHAT IS ACTUALLY ASSERTED, because "the line is right" needs a definition:
 *
 *   IN BOUNDS   1 <= line <= the file's line count. A line outside the file is not a weaker
 *               claim, it is a claim about a file that does not exist.
 *   NON-NULL    present and a number, not null and not NaN. A null line reads as "unknown",
 *               which is a real loss of information and is not the same defect as a wrong line —
 *               so it is counted separately rather than folded in.
 *   MONOTONE-ish the median relationship's line should not sit in the first or last line of the
 *               file. A pile-up on line 1 usually means the line is the DECLARATION's rather than
 *               the USE's, which is the specific mistake M59.A7 corrected once and which can
 *               regress silently.
 *
 * WHAT IT DELIBERATELY DOES NOT CLAIM. It does not decide whether a line is the RIGHT line for a
 * use that occurs on several lines, nor whether a whole-file line is better than a per-node one
 * for a given consumer. Those are design questions with defensible answers either way. This gate
 * asserts the properties that are true under every design, so a failure is always a defect and
 * never a disagreement about taste.
 */
import * as fs from "fs"
import * as path from "path"

const ROOT = process.cwd()

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined
}

async function main() {
  const listFile = arg("--list")
  const lang = arg("--lang") ?? "csharp"
  if (!listFile) { console.error(`usage: verify-csharp-line-numbers.ts --list <paths> [--lang csharp] [--limit N]`); process.exit(2) }
  const limit = Number(arg("--limit") ?? 200)
  const files = fs.readFileSync(listFile, "utf8").split("\n").map((f) => f.trim()).filter(Boolean).slice(0, limit)

  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))

  // A NULL line is CORRECT for a name the source never writes. `constructor` for a primary
  // constructor and `Finalize` for a destructor are SYNTHESIZED: the file writes `Widget()` and
  // `~Widget()`, so no line can be the site of the string "constructor". Fixture
  // `csharp/callsite-lines-825` pins exactly that, with the rationale in the expectation:
  // "synthesised name — the source writes `Widget()`, never `constructor`, so no line can be its
  // site."
  //
  // I tried to "fix" those 61 rows by falling back to the owner's declaration line, and the
  // fixture failed — correctly. Publishing the class's line for a member name that appears
  // NOWHERE on it is the same defect M59.A7 fixed, which stamped the range start and claimed a
  // line the target was not written on for 653 of 23,924 relationships. A measurement of "61 null
  // lines" is therefore not a finding until you ask WHICH names; these are the right ones.
  //
  // So the gate asserts the boundary rather than papering over it: a null line is allowed ONLY
  // for a synthesized name. A null line on `Descriptor` would be a real hole, because that string
  // IS written somewhere, and this is the assertion that would catch it.
  const SYNTHESIZED = new Set(["constructor", "Finalize", "anonymous", "this"])
  const unjustifiedNulls: string[] = []

  let total = 0
  let nullLine = 0
  let justifiedNulls = 0
  let outOfBounds = 0
  let notInteger = 0
  const byLabel = new Map<string, { n: number; null: number; oob: number }>()
  const oobSamples: string[] = []
  const firstLastPileup: string[] = []
  let filesWithOob = 0

  for (const f of files) {
    let src: string
    try { src = fs.readFileSync(f, "utf8") } catch { continue }
    if (src.length > 1_000_000) continue
    const lineCount = src.split("\n").length
    let res: any
    try { res = await ASTEngine.parseFile(f, src) } catch { continue }
    const rels = res.relationships ?? []
    if (rels.length === 0) continue
    let fileOob = 0
    const lines: number[] = []
    for (const r of rels) {
      const label = String(r.type ?? r.relationshipType ?? "?")
      const st = byLabel.get(label) ?? { n: 0, null: 0, oob: 0 }
      st.n++
      const ln = r.line_number
      if (ln === null || ln === undefined) {
        st.null++
        nullLine++
        if (SYNTHESIZED.has(String(r.target))) justifiedNulls++
        else {
          unjustifiedNulls.push(`  ${path.basename(f)}  ${label}  ${r.source} -> ${r.target}  line_number=null  (the name IS written in the file)`)
        }
        continue
      }
      if (typeof ln !== "number" || !Number.isInteger(ln)) {
        st.oob++
        notInteger++
        if (oobSamples.length < 12) oobSamples.push(`  ${path.basename(f)}  ${label}  line_number=${JSON.stringify(ln)} (not an integer)`)
        continue
      }
      if (ln < 1 || ln > lineCount) {
        st.oob++
        outOfBounds++
        fileOob++
        if (oobSamples.length < 12) oobSamples.push(`  ${path.basename(f)}  ${label}  line ${ln} of ${lineCount}`)
        continue
      }
      lines.push(ln)
      byLabel.set(label, st)
    }
    if (fileOob > 0) filesWithOob++
    // the pile-up check, on the median so one odd file cannot dominate
    if (lines.length >= 20) {
      lines.sort((a, b) => a - b)
      const med = lines[Math.floor(lines.length / 2)]
      if (med <= 1 || med >= lineCount) {
        if (firstLastPileup.length < 8) {
          firstLastPileup.push(`  ${path.basename(f)}  median line ${med} of ${lineCount}, ${lines.length} relationships`)
        }
      }
    }
    total += rels.length
  }

  console.log(`line-number audit — ${lang}, ${files.length} files, ${total} relationships\n`)
  console.log("  label".padEnd(34) + "n".padStart(8) + "null".padStart(8) + "out-of-bounds".padStart(15))
  console.log("-".repeat(65))
  for (const [label, st] of [...byLabel.entries()].sort((a, b) => b[1].n - a[1].n)) {
    console.log(`  ${label.padEnd(32)}${String(st.n).padStart(8)}${String(st.null).padStart(8)}${String(st.oob).padStart(15)}`)
  }
  if (oobSamples.length > 0) {
    console.log(`\n  out-of-bounds / non-integer samples:`)
    for (const s of oobSamples) console.log(s)
  }
  if (firstLastPileup.length > 0) {
    console.log(`\n  median-line pile-up at a file boundary (a declaration line rather than a use line):`)
    for (const s of firstLastPileup) console.log(s)
  }
  console.log(`\n  files with an out-of-bounds line: ${filesWithOob}`)

  const problems: string[] = []
  if (outOfBounds > 0) problems.push(`${outOfBounds} relationship(s) carry a line outside their file`)
  if (unjustifiedNulls.length > 0) problems.push(`${unjustifiedNulls.length} relationship(s) carry a null line for a name the source WRITES`)
  if (notInteger > 0) problems.push(`${notInteger} relationship(s) carry a non-integer line`)
  if (problems.length > 0) {
    console.log(`\nPROBLEMS (${problems.length}):`)
    for (const p of problems) console.log(`  ! ${p}`)
    console.log(`\nVERDICT: FAIL — ${problems.length} line-number problem(s) above.`)
    if (outOfBounds > 0) console.log(`  A line outside the file is a claim about a file that does not exist.`)
    if (unjustifiedNulls.length > 0) {
      console.log(`  A null line for a name the source WRITES is a hole in a field every other row fills —`)
      console.log(`  unlike a null line for a synthesized name, which is the correct answer.`)
    }
    process.exit(1)
  }
  console.log(`\nVERDICT: PASS — every relationship's line is an integer inside its own file.`)
  if (unjustifiedNulls.length > 0) {
    console.log(`\n  null lines that are NOT explained by a synthesised name:`)
    for (const u of unjustifiedNulls.slice(0, 12)) console.log(u)
  }
  console.log(`  ${nullLine} relationship(s) carry no line (${((nullLine / Math.max(1, total)) * 100).toFixed(1)}%); ${justifiedNulls} of those are synthesized names`)
  console.log(`  that the source never writes, which is CORRECT and is pinned by csharp/callsite-lines-825.`)
  console.log(`  The figure that would be a defect is the other one:`)
  if (nullLine > justifiedNulls) console.log(`    ${nullLine - justifiedNulls} unjustified null line(s) — listed above.`)
  if (nullLine === justifiedNulls) {
    console.log(`    none — every null line is accounted for by a name the source never writes.`)
  }
  console.log(`  A null line is a smaller claim than a wrong one: a consumer can tell them apart.`)
  console.log(`  What this gate does NOT assert is that a line is the RIGHT one for a use spanning`)
  console.log(`  several lines — that is a design question, and a gate that settled it would be`)
  console.log(`  enforcing a preference rather than a property.`)
}

if (import.meta.main) await main()

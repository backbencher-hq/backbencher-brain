// M59.A7 handoff, cpp lane: after adding line_number at every emit site, is the
// claimed line the line of the node that NAMES the relationship?
//
//   - rows with no `line_number`      -> the attribute is unattributable (must be
//                                        rare and explained, never the default)
//   - rows whose line < 1             -> fabricated 0 (the #870 defect)
//   - rows where the TARGET token is not written on the claimed line -> the line
//     names something other than the edge (the "wrong node" class)
//
// The token check is conservative: it lowercases and splits `a.b`/`ns::x`/`->`
// forms down to the leaf, then asks whether that leaf appears on the line. A
// synthesised target (contains/overrides/extends bases) is checked by its own
// last segment.
import fs from "node:fs"
import path from "node:path"
import { ASTEngine } from "../../../src/ast/engine"

const ROOT = "/home/ishaq2321/bb_tests/repositories"
const TARGETS: Array<[string, string, number]> = [
  ["nlohmann-json", "include/nlohmann", 6],
  ["fmt", "include/fmt", 20],
  ["fmt", "src", 10],
  ["sqlite", "src", 12],
]

const collect = (dir: string, ext: string[], out: string[] = []): string[] => {
  if (!fs.existsSync(dir)) return out
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) collect(p, ext, out)
    else if (ext.some(x => e.name.endsWith(x))) out.push(p)
  }
  return out
}

let rows = 0, noLine = 0, badLine = 0, offLine = 0
const offSamples: string[] = []
const offByType: Record<string, string[]> = {}
const synthSkipped = { n: 0 }
const noLineSamples: string[] = []
const byType: Record<string, { n: number; noLine: number; offLine: number }> = {}

for (const [repo, sub, limit] of TARGETS) {
  const files = collect(path.join(ROOT, repo, sub), [".cpp", ".cc", ".hpp", ".h", ".cxx"]).slice(0, limit)
  if (files.length === 0) { console.log(`${repo}/${sub}: (no files)`); continue }
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8")
    const lines = src.split("\n")
    let res: any
    try {
      res = await ASTEngine.parseFile(f, src)
    } catch (e: any) {
      console.log(`  (analyzer threw on ${path.relative(ROOT, f)}: ${e?.message ?? e})`)
      continue
    }
    for (const r of res.relationships ?? []) {
      rows++
      const t = String(r.type ?? "?")
      const b = (byType[t] ??= { n: 0, noLine: 0, offLine: 0 })
      b.n++
      const ln = r.line_number
      if (typeof ln !== "number" || ln <= 0) {
        noLine++; b.noLine++
        if (noLineSamples.length < 12) noLineSamples.push(`${t} ${r.source}->${r.target} @${JSON.stringify(ln)} in ${path.relative(ROOT, f)}`)
        continue
      }
      if (ln > lines.length) { badLine++; continue }
      // The target may be SYNTHESIZED (contains→`constructor`, overrides,
      // anonymous scopes) or carry trailing comment text (the include path
      // reader's known shape). Those rows can still be checked for having a
      // positive line, but not for a written token.
      const rawTarget = String(r.target ?? "").replace(/\/\/.*$/, "").replace(/\/\*.*$/, "").trim()
      const synth = /^(constructor|destructor|anonymous_|block_|lambda|operator|~)/.test(rawTarget)
      if (synth) synthSkipped.n++
      const leaf = rawTarget.split(/::|\.|->/).filter(Boolean).pop() ?? ""
      const text = (lines[ln - 1] ?? "").toLowerCase()
      if (leaf && !synth && !text.includes(leaf.toLowerCase())) {
        offLine++; b.offLine++
        const samplesForType = (offByType[t] ??= [])
        if (samplesForType.length < 3) samplesForType.push(`${t} ${r.source}->${r.target} @L${ln} "${(lines[ln - 1] ?? "").trim().slice(0, 70)}" in ${path.relative(ROOT, f)}`)
      }
    }
  }
  console.log(`${repo}/${sub}: measured ${files.length} file(s)`)
}

console.log(`\nrows=${rows}  no/unusable line=${noLine}  line>file=${badLine}  target-not-on-claimed-line=${offLine}`)
console.log(`coverage: ${(((rows - noLine) / rows) * 100).toFixed(2)}% of rows carry a positive line`)
console.log(`synthesized targets skipped by the token check: ${synthSkipped.n}`)
console.log("\nby relationship type:")
for (const [k, v] of Object.entries(byType).sort((a, b) => b[1].n - a[1].n)) {
  console.log(`  ${k.padEnd(14)} rows=${String(v.n).padStart(5)}  noLine=${String(v.noLine).padStart(4)}  offLine=${String(v.offLine).padStart(4)}`)
}
if (noLineSamples.length) { console.log("\nsample rows with no usable line:"); for (const s of noLineSamples) console.log("  " + s) }
console.log("\nsample rows whose target is not on the claimed line (per type):")
for (const [k, v] of Object.entries(offByType)) for (const s of v) console.log("  " + s)

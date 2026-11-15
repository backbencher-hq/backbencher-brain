// M60 line census for the Go lane.
//
// M60's root-cause question is not "is this line right" but "does this row
// HAVE a line at all". cpp #870 was one `line_number: 0` row in a whole
// 21-language sweep, and the reason it was caught at all was that the analyzer
// emitted no line on any row and the sweep's `unexplained` counter is the only
// place a missing line shows up as a defect rather than as silence. M59.O3
// asserts the store's zero-line count is 0, so a 0 here is not cosmetic.
//
// This is the census: EVERY relationship the go analyzer publishes, at full
// extent over five corpora, counted per (label, marker) with and without a line,
// and with a count of zeros. It reads no convention and judges no site — the
// round-6 site oracle did that, and its limit is the reason this file exists
// separately: "the target is written on that line" cannot choose between two
// plausible sites, so the conventions are pinned by adversarial fixtures in
// go-round7-line-conventions.ts and only their presence is counted here.
//
// A line of 0, a negative line, and a line past EOF are each counted
// separately, because they are three different bugs and a single "missing"
// counter would merge them.
import * as fs from "node:fs"
import * as path from "node:path"

const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const arg = (k: string, d: string): string => {
  const i = process.argv.indexOf(k)
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : d
}

type Cell = { edges: number; withLine: number; noLine: number; zero: number; negative: number; pastEof: number; min: number; max: number }

async function main() {
  const repos = process.argv.slice(2).filter((a) => !a.startsWith("--"))
  const want = Number(arg("--files", "0"))
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const g = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-go.wasm")))
  const mod: any = await import(path.join(ROOT, "src/ast/real-go-analyzer.ts"))

  const cells: Record<string, Cell> = {}
  const bad: string[] = []
  const mirrorOnly: string[] = []
  let totalEdges = 0

  for (const repo of repos) {
    const dir = path.join("/home/ishaq2321/bb_tests/repositories", repo)
    if (!fs.existsSync(dir)) { console.log(`[SKIP] ${repo}`); continue }
    const files: string[] = []
    const walk = (d: string): void => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (e.name === "vendor" || e.name === ".git") continue
        const p = path.join(d, e.name)
        if (e.isDirectory()) walk(p); else if (e.name.endsWith(".go")) files.push(p)
      }
    }
    walk(dir)
    files.sort()
    const take = want > 0 ? files.slice(0, want) : files
    const parser = new P()
    parser.setLanguage(g)

    for (const abs of take) {
      const content = fs.readFileSync(abs, "utf8")
      const rel = path.relative(dir, abs)
      const lineCount = content.split("\n").length
      const tree = parser.parse(content)
      let res: any
      try { res = await new mod.RealGoAnalyzer().analyze(tree.rootNode, content, rel) } catch { continue }
      for (const r of res.relationships ?? []) {
        const label = String(r.type)
        const marker = String((r.metadata ?? {}).relationshipType ?? "-")
        const key = `${label}/${marker}`
        cells[key] ??= { edges: 0, withLine: 0, noLine: 0, zero: 0, negative: 0, pastEof: 0, min: Infinity, max: 0 }
        const c = cells[key]
        c.edges++
        totalEdges++
        const ln = r.line_number
        if (typeof ln === "number") {
          c.withLine++
          if (ln === 0) { c.zero++; if (bad.length < 20) bad.push(`${repo}/${rel} | ${key} | line 0 | ${r.source}->${r.target}`) }
          else if (ln < 0) { c.negative++; if (bad.length < 20) bad.push(`${repo}/${rel} | ${key} | line ${ln} | ${r.source}->${r.target}`) }
          else if (ln > lineCount) { c.pastEof++; if (bad.length < 20) bad.push(`${repo}/${rel} | ${key} | line ${ln} > ${lineCount} | ${r.source}->${r.target}`) }
          else { c.min = Math.min(c.min, ln); c.max = Math.max(c.max, ln) }
        } else {
          c.noLine++
          // A metadata.line mirror is NOT line_number. cpp #870's rows carried
          // only a `metadata.line` mirror and that was the defect, so a label
          // relying on the mirror is recorded by name.
          const mirror = (r.metadata ?? {}).line
          if (typeof mirror === "number") {
            if (mirrorOnly.length < 20) mirrorOnly.push(`${repo}/${rel} | ${key} | metadata.line=${mirror}, no line_number | ${r.source}->${r.target}`)
          } else if (bad.length < 20) {
            bad.push(`${repo}/${rel} | ${key} | NO LINE AT ALL | ${r.source}->${r.target}`)
          }
        }
      }
    }
  }

  const rows = Object.entries(cells).sort((a, b) => a[0].localeCompare(b[0]))
  console.log("label/marker".padEnd(42) + "edges".padStart(9) + "withLine".padStart(10) + "noLine".padStart(8) + "zero".padStart(6) + "min".padStart(7) + "max".padStart(8))
  console.log("-".repeat(90))
  for (const [k, c] of rows) {
    const min = c.min === Infinity ? "-" : String(c.min)
    console.log(k.padEnd(42) + String(c.edges).padStart(9) + String(c.withLine).padStart(10) + String(c.noLine).padStart(8) + String(c.zero).padStart(6) + min.padStart(7) + String(c.max).padStart(8))
  }
  const noLine = rows.reduce((a, [, c]) => a + c.noLine, 0)
  const zero = rows.reduce((a, [, c]) => a + c.zero, 0)
  const neg = rows.reduce((a, [, c]) => a + c.negative, 0)
  const eof = rows.reduce((a, [, c]) => a + c.pastEof, 0)
  console.log("-".repeat(90))
  console.log(`TOTAL edges=${totalEdges}  withLine=${totalEdges - noLine}  NO LINE=${noLine}  zero=${zero}  negative=${neg}  pastEOF=${eof}`)
  console.log(`M59.O3 zero-line count = ${zero}  ${zero === 0 ? "(assertion holds)" : "(ASSERTION VIOLATED)"}`)
  if (mirrorOnly.length) {
    console.log(`\nrows relying on a metadata.line MIRROR instead of line_number (${mirrorOnly.length} sampled):`)
    for (const m of mirrorOnly) console.log("  " + m)
  }
  if (bad.length) {
    console.log(`\nfindings (${bad.length} sampled):`)
    for (const b of bad) console.log("  " + b)
  }
}
main()

// Go lane — round 7 perf A/B for GOD11 + GOD12.
//
// The round-5 script (`go-round5-perf.ts`) cannot be reused as-is: it
// materialises its "before" side from `git show HEAD:...`, and HEAD is now this
// lane's own commit, so the comparison would be against itself. This one pins
// the before-side to the exact commit that predates the change — 03bfc864, which
// carries GOD10 and not GOD11/GOD12 — and only rewrites its import specifier, so
// the measured code is committed code and not a paraphrase.
//
// WHY IT MATTERS SPECIFICALLY. GOD12 introduced `resolveGoWorkSource`, which
// walks the ancestor chain on EVERY call, selector-use and bare-identifier node
// until it hits a function, a package-scope var_spec/const_spec, or the root. The
// old code called `findContainingGoFunction`, which walks the same chain looking
// for two node types. So the walk is not new — but the new one also inspects
// every var_spec/const_spec it passes and, for a package-scope one, scans the
// spec's named children for an identifier. On a file that is one large
// initializer that is a bounded extra cost; on a file with many package-scope
// vars it is a per-var child scan. This measures whether that is visible at all.
//
// Requirements carried from §9 and the round-5 script, because a perf number
// without them is not evidence:
//   (a) the ANALYZER measured alone, normalised per 1k nodes, inside a FIXED
//       size band — absolute ms over mixed file sizes is not comparable;
//   (b) INTERLEAVED, file by file, in one process, so both sides see the same
//       machine load and the RATIO survives a busy box even when neither
//       absolute number is scorable;
//   (c) a measured LOAD CONTEXT printed with the rows, not a note (#871).
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { execSync } from "node:child_process"

const ROOT = "<corpus-root>/mcp/backbencher-brain"
const BEFORE_COMMIT = "03bfc864" // GOD10 present, GOD11/GOD12 absent
const arg = (k: string, d: string): string => {
  const i = process.argv.indexOf(k)
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : d
}

const loadAvg = (): string => fs.readFileSync("/proc/loadavg", "utf8").trim().split(/\s+/).slice(0, 3).join(" ")

async function main() {
  const repos = arg("--repos", "go-tools,terraform").split(",")
  const want = Number(arg("--files", "400"))
  const minKb = Number(arg("--min-kb", "2"))
  const maxKb = Number(arg("--max-kb", "20"))

  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const g = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-go.wasm")))

  // The BEFORE analyzer, from the pinned commit, import specifier rewritten only.
  const beforeSrc = execSync(`git show ${BEFORE_COMMIT}:src/ast/real-go-analyzer.ts`, {
    cwd: ROOT, maxBuffer: 1 << 28,
  }).toString().replace(/from "\.\/engine"/g, 'from "<corpus-root>/mcp/backbencher-brain/src/ast/engine"')
  const beforeDir = "/tmp/opencode/go-before"
  fs.mkdirSync(beforeDir, { recursive: true })
  const beforePath = path.join(beforeDir, `real-go-analyzer-${BEFORE_COMMIT}.ts`)
  fs.writeFileSync(beforePath, beforeSrc)
  const After: any = await import(path.join(ROOT, "src/ast/real-go-analyzer.ts"))
  const Before: any = await import(beforePath)

  const parser = new P()
  parser.setLanguage(g)

  const rows: any[] = []
  let nodes = 0
  for (const repo of repos) {
    const dir = path.join("<corpus-root>/bb_tests/repositories", repo)
    if (!fs.existsSync(dir)) continue
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
    let taken = 0
    for (const abs of files) {
      if (taken >= want) break
      const kb = fs.statSync(abs).size / 1024
      if (kb < minKb || kb > maxKb) continue
      const content = fs.readFileSync(abs, "utf8")
      const rel = path.relative(dir, abs)
      const tree = parser.parse(content)
      nodes++
      taken++
      // INTERLEAVED: same file, both analyzers, one after the other, in one
      // process. Three passes each and the MEDIAN, so one scheduling hiccup
      // cannot decide the row.
      const t = (fn: () => any): number[] => {
        const out: number[] = []
        for (let i = 0; i < 3; i++) { const s = performance.now(); fn(); out.push(performance.now() - s) }
        out.sort((a, b) => a - b)
        return [out[1]]
      }
      const b = t(() => new Before.RealGoAnalyzer().analyze(tree.rootNode, content, rel))
      const a = t(() => new After.RealGoAnalyzer().analyze(tree.rootNode, content, rel))
      let n = 0
      const count = (x: any): void => { n++; for (const c of x.namedChildren ?? []) count(c) }
      count(tree.rootNode)
      rows.push({ repo, rel, nodes: n, before: b[0], after: a[0] })
    }
  }

  const med = (xs: number[]): number => { const s = [...xs].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] }
  const nSum = rows.reduce((a, r) => a + r.nodes, 0)
  const bMed = med(rows.map((r) => r.before))
  const aMed = med(rows.map((r) => r.after))
  const bPer1k = (rows.reduce((a, r) => a + r.before, 0) / nSum) * 1000
  const aPer1k = (rows.reduce((a, r) => a + r.after, 0) / nSum) * 1000
  const ratio = bMed > 0 ? aMed / bMed : 0

  console.log(`GOD11+GOD12 perf A/B — before=${BEFORE_COMMIT} after=HEAD`)
  console.log(`band ${minKb}-${maxKb} KB · repos ${repos.join(",")} · ${rows.length} files · ${nSum} nodes · 3 passes interleaved, median`)
  console.log(`LOAD CONTEXT at completion: ${loadAvg()}  (rows under a busy box: the RATIO is scorable, the absolutes are not)`)
  console.log("")
  console.log("side      median-ms   ms-per-1k-nodes")
  console.log(`before    ${bMed.toFixed(2).padStart(9)}   ${bPer1k.toFixed(3).padStart(12)}`)
  console.log(`after     ${aMed.toFixed(2).padStart(9)}   ${aPer1k.toFixed(3).padStart(12)}`)
  console.log(`ratio     ${ratio.toFixed(4).padStart(9)}   (after/before; 1.000 = no measurable cost)`)
  const slower = rows.filter((r) => r.after > r.before * 1.5).length
  const faster = rows.filter((r) => r.after < r.before * 0.67).length
  console.log(`per-file: ${slower} of ${rows.length} files >1.5x slower, ${faster} >1.5x faster`)
  const worst = [...rows].sort((x, y) => (y.after - y.before) - (x.after - x.before)).slice(0, 5)
  console.log("largest absolute regressions:")
  for (const r of worst) console.log(`  ${(r.after - r.before).toFixed(2).padStart(7)} ms  ${r.before.toFixed(2)}->${r.after.toFixed(2)}  ${r.nodes} nodes  ${r.repo}/${r.rel}`)
}
main()

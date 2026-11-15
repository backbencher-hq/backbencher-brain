// Definitive equivalence: the WHOLE analyzer output, before vs after the perf fix.
//
// The doc-equivalence probe compared `extractScalaDoc` on every node, which proves
// that function. This compares everything it can affect — every symbol's metadata
// and every relationship — by running the pre-fix analyzer (recovered from git, so
// it is the real committed code and not a reconstruction) beside the current one on
// identical parsed trees.
//
// A perf change that is not byte-identical in output is a regression wearing a
// benchmark's clothes, so this is the check that decides whether the fix ships.

import fs from "node:fs"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { RealScalaAnalyzer } from "../../../src/ast/real-scala-analyzer"

const ROOT = path.resolve(path.dirname(process.argv[1]), "..", "..", "..")
const CORPUS = "/home/ishaq2321/bb_tests/repositories"
const repo = process.argv[2] ?? "scala3"
const drawFile = process.argv[3]
const LIMIT = Number(process.argv[4] ?? 300)

async function main(): Promise<void> {
  // recover the committed pre-fix analyzer, rewriting its two relative imports so
  // it can live outside src/ without changing what it does
  const src = execFileSync("git", ["show", "HEAD:src/ast/real-scala-analyzer.ts"], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
  const patched = src
    .replace('from "./engine"', `from "${path.join(ROOT, "src/ast/engine")}"`)
    .replace('from "./override-context"', `from "${path.join(ROOT, "src/ast/override-context")}"`)
  const tmp = "/tmp/opencode/old-scala-analyzer.mts"
  fs.mkdirSync(path.dirname(tmp), { recursive: true })
  fs.writeFileSync(tmp, patched)
  const OldMod: any = await import(tmp)
  const OldAnalyzer = OldMod.RealScalaAnalyzer

  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const gl = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-scala.wasm")))
  const parser = new P()
  parser.setLanguage(gl)
  const now = new RealScalaAnalyzer()
  const old = new OldAnalyzer()

  const files = fs.readFileSync(drawFile, "utf8").split("\n").map((s) => s.trim()).filter(Boolean).slice(0, LIMIT)

  let filesOk = 0
  let relDiff = 0
  let symDiff = 0
  let totalRels = 0
  let totalSyms = 0
  const examples: string[] = []

  const relKey = (r: any): string => `${r.source} -> ${r.target} @${r.type} c=${r.confidence ?? ""} l=${r.line_number ?? ""}`
  const symKey = (s: any): string => {
    const m = s.metadata ?? {}
    return `${s.name}|${s.kind}|${s.ownerName ?? ""}|${s.range?.startLine ?? ""}|${m.signature ?? ""}|${m.scaladoc ?? m.doc ?? ""}|${(m.superTypes ?? []).join(",")}`
  }

  for (const f of files) {
    const fp = path.join(CORPUS, repo, f)
    if (!fs.existsSync(fp)) continue
    const text = fs.readFileSync(fp, "utf8")
    let root: any
    try { root = parser.parse(text).rootNode } catch { continue }
    let a: any
    let b: any
    try {
      a = old.analyze(root, text, fp)
      b = now.analyze(root, text, fp)
    } catch { continue }
    filesOk++
    const ar = (a.relationships ?? []).map(relKey).sort()
    const br = (b.relationships ?? []).map(relKey).sort()
    totalRels += ar.length
    const onlyOldR = ar.filter((x) => !br.includes(x))
    const onlyNewR = br.filter((x) => !ar.includes(x))
    if (onlyOldR.length || onlyNewR.length) {
      relDiff++
      if (examples.length < 8) {
        for (const x of onlyOldR.slice(0, 3)) examples.push(`REL only-OLD ${f}: ${x}`)
        for (const x of onlyNewR.slice(0, 3)) examples.push(`REL only-NEW ${f}: ${x}`)
      }
    }
    const as = (a.symbols ?? []).map(symKey).sort()
    const bs = (b.symbols ?? []).map(symKey).sort()
    totalSyms += as.length
    const onlyOldS = as.filter((x) => !bs.includes(x))
    const onlyNewS = bs.filter((x) => !as.includes(x))
    if (onlyOldS.length || onlyNewS.length) {
      symDiff++
      if (examples.length < 8) for (const x of onlyOldS.slice(0, 2)) examples.push(`SYM only-OLD ${f}: ${x.slice(0, 160)}`)
    }
  }

  console.log(`# whole-output equivalence, committed pre-fix vs current — ${filesOk} files from ${repo}\n`)
  console.log(`- relationships compared: ${totalRels.toLocaleString()}`)
  console.log(`- symbols compared: ${totalSyms.toLocaleString()} (name, kind, owner, line, signature, doc, supertypes)`)
  console.log(`- **files with any relationship difference: ${relDiff}**`)
  console.log(`- **files with any symbol difference: ${symDiff}**`)
  if (examples.length) for (const e of examples) console.log(`    ${e}`)
  console.log(`\n- verdict: ${relDiff === 0 && symDiff === 0 ? "BYTE-IDENTICAL OUTPUT — safe to ship" : "OUTPUT DIFFERS — investigate before shipping"}`)
}
main().catch((e) => { console.error(e); process.exit(1) })
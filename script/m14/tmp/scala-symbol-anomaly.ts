// Find symbols whose NAME or KIND is not a name.
//
// The unknown-names census printed a `symbols by kind` row reading
// `function Object() { [native code] }111...1   constructor` — a kind value
// carrying V8's own toString text and a run of digits. Either the analyzer
// published a corrupted symbol or the census misprinted; both are worth knowing
// and only one is a defect, so this asks the analyzer directly and reports the
// FILE, so the source can be read.
//
// A symbol name is a name when it is short, identifier-shaped, or an operator
// the language spells with punctuation. It is NOT a name when it contains
// whitespace, a bracket pair the language would not write, or text that belongs
// to some other program entirely.

import fs from "node:fs"
import path from "node:path"
import { RealScalaAnalyzer } from "../../../src/ast/real-scala-analyzer"

const ROOT = path.resolve((import.meta as any).dirname ?? path.dirname(process.argv[1]), "..", "..", "..")
const CORPUS = "/home/ishaq2321/bb_tests/repositories"
const repo = process.argv[2] ?? "scala3"
const drawFile = process.argv[3]

async function main(): Promise<void> {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const lang = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-scala.wasm")))
  const parser = new P()
  parser.setLanguage(lang)
  const analyzer = new RealScalaAnalyzer()
  const files = drawFile
    ? fs.readFileSync(drawFile, "utf8").split("\n").map((s) => s.trim()).filter(Boolean)
    : []

  let scanned = 0
  const badName = new Map<string, { n: number; file: string; kind: string; line: number }>()
  const badKind = new Map<string, { n: number; file: string; example: string }>()
  const clean = /^[A-Za-z0-9_$]{1,64}$/
  // operators a scala member may legitimately be named
  const operatorish = /^[^\w\s]{1,12}$/

  for (const f of files) {
    const fp = path.join(CORPUS, repo, f)
    if (!fs.existsSync(fp)) continue
    const src = fs.readFileSync(fp, "utf8")
    let root: any
    try { root = parser.parse(src).rootNode } catch { continue }
    let res: any
    try { res = analyzer.analyze(root, src, fp) } catch { continue }
    scanned++
    for (const s of res.symbols ?? []) {
      const nm = String(s.name ?? "")
      const kd = String((s as any).kind ?? "")
      if (!clean.test(nm) && !operatorish.test(nm)) {
        const key = nm.length > 70 ? `${nm.slice(0, 70)}…(+${nm.length - 70})` : nm
        if (!badName.has(key)) badName.set(key, { n: 0, file: f, kind: kd, line: (s as any).startLine ?? -1 })
        badName.get(key)!.n++
      }
      if (kd.length > 40 || /\s/.test(kd)) {
        const key = kd.length > 70 ? `${kd.slice(0, 70)}…(+${kd.length - 70})` : kd
        if (!badKind.has(key)) badKind.set(key, { n: 0, file: f, example: nm.slice(0, 40) })
        badKind.get(key)!.n++
      }
    }
  }

  console.log(`# anomalous symbol NAMES — ${scanned} files from ${repo}`)
  if (!badName.size) console.log("  none")
  for (const [k, v] of [...badName].sort((a, b) => b[1].n - a[1].n).slice(0, 25)) {
    console.log(`  **${v.n}**  kind=${v.kind}  ${v.file}:${v.line}  name=${JSON.stringify(k)}`)
  }
  console.log(`\n# anomalous symbol KINDS — ${scanned} files from ${repo}`)
  if (!badKind.size) console.log("  none")
  for (const [k, v] of [...badKind].sort((a, b) => b[1].n - a[1].n).slice(0, 25)) {
    console.log(`  **${v.n}**  ${v.file}  kind=${JSON.stringify(k)}  e.g. symbol ${JSON.stringify(v.example)}`)
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
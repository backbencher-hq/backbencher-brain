// YAML lane: three specific defect probes the census flagged.
//   A. docker 198 files -> 236,042 symbols (1,192/file vs grails 45/file) — why?
//   B. duplicate mapping keys -> two symbols sharing one id?
//   C. anchors are per-document in YAML; is the resolver document-scoped?
//   D. merge key with a SEQUENCE of aliases — still classified as `extends`?
//   E. framework detection fires on any key name anywhere in the file?
import * as fs from "node:fs"
import * as path from "node:path"

const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const CORPUS_ROOT = "/home/ishaq2321/bb_tests/repositories"

function walk(dir: string, out: string[], depth = 0): void {
  if (depth > 14) return
  let entries: fs.Dirent[] = []
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const e of entries) {
    if (e.name === ".git" || e.name === "node_modules") continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out, depth + 1)
    else if (/\.(ya?ml)$/i.test(e.name)) out.push(p)
  }
}

const CASES: Record<string, string> = {
  dupKey: `root:
  child: 1
  child: 2
  other: 3
`,
  mergeSeq: `base: &base
  a: 1
derived:
  <<: [*base]
  b: 2
`,
  anchorDocScope: `--- &a
  x: 1
--- &b
  <<: *a
  y: 2
`,
  tagInclude: `tasks:
  - name: build
    !include other.yml
value: !custom 5
tagged: !!str 7
`,
  directives: `%YAML 1.1
---
a: 1
`,
  fwFalsePositive: `version: 2
services: {}
nested:
  version: 3
jobs: {}
on: push
stages: []
`,
  onFalsePositive: `name: my-ci
on:
  push:
    branches: [main]
jobs:
  build:
    steps: []
`,
  bigFlow: `{a: {b: {c: {d: {e: 1}}}}}\n`,
  longFlowSeq: `key: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]\n`,
  timestamp: `at: 2001-12-14t21:59:43.10-05:00
exp: 2026-01-01
`,
  k8sRef: `apiVersion: v1
kind: ConfigMap
metadata:
  name: cm
data:
  key: value
---
apiVersion: v1
kind: Pod
spec:
  containers:
    - name: app
      envFrom:
        - configMapRef:
            name: cm
`,
}

async function main() {
  const wts: any = await import("web-tree-sitter")
  const ParserClass = wts.Parser ?? wts.default ?? wts
  const Language = wts.Language ?? wts.default?.Language
  await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const grammar = await Language.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-yaml.wasm")))
  const parser = new ParserClass()
  parser.setLanguage(grammar)
  const mod: any = await import(path.join(ROOT, "src/ast/real-yaml-analyzer.ts"))

  // ---- A. docker anomaly -------------------------------------------------
  const files: string[] = []
  walk(path.join(CORPUS_ROOT, "docker"), files)
  files.sort()
  const rows: Array<{ file: string; bytes: number; symbols: number; rels: number; lines: number }> = []
  for (const f of files.slice(0, 198)) {
    const content = fs.readFileSync(f, "utf8")
    const tree = parser.parse(content)
    if (!tree?.rootNode) continue
    const analyzer = new mod.RealYamlAnalyzer()
    const res: any = await analyzer.analyze(tree.rootNode, content, f)
    rows.push({ file: path.relative(CORPUS_ROOT, f), bytes: content.length, symbols: (res.symbols ?? []).length, rels: (res.relationships ?? []).length, lines: content.split("\n").length })
  }
  rows.sort((a, b) => b.symbols - a.symbols)
  console.log("=== A. docker top-12 by symbol count ===")
  for (const r of rows.slice(0, 12)) console.log(`${String(r.symbols).padStart(8)} sym ${String(r.rels).padStart(8)} rel ${String(r.bytes).padStart(9)} B ${String(r.lines).padStart(6)} ln  ${r.file}`)
  const totalSym = rows.reduce((a, r) => a + r.symbols, 0)
  const top12 = rows.slice(0, 12).reduce((a, r) => a + r.symbols, 0)
  console.log(`files=${rows.length} totalSym=${totalSym} top12Share=${((top12 / totalSym) * 100).toFixed(1)}%  median=${rows[Math.floor(rows.length / 2)].symbols}`)

  // deep-dive the single worst file
  const worst = rows[0]
  if (worst) {
    const abs = path.join(CORPUS_ROOT, worst.file)
    const content = fs.readFileSync(abs, "utf8")
    const tree = parser.parse(content)
    const analyzer = new mod.RealYamlAnalyzer()
    const res: any = await analyzer.analyze(tree.rootNode, content, abs)
    console.log(`\n--- worst file head: ${worst.file} (${worst.symbols} symbols, ${worst.lines} lines) ---`)
    console.log(content.split("\n").slice(0, 12).join("\n"))
    const qns = (res.symbols ?? []).map((s: any) => s.qualifiedName)
    const depth = qns.filter((q: string) => (String(q).match(/\./g) ?? []).length)
    const ids = new Set((res.symbols ?? []).map((s: any) => s.id))
    console.log(`unique ids=${ids.size} of ${(res.symbols ?? []).length} symbols  (COLLISIONS=${(res.symbols ?? []).length - ids.size})`)
    console.log(`avg dot-depth=${(depth.reduce((a: number, b: number) => a + b, 0) / Math.max(1, depth.length)).toFixed(2)}`)
    console.log("deepest 5 qnames:", qns.sort((a: string, b: string) => b.length - a.length).slice(0, 5))
  }

  // ---- B..E per-case ----------------------------------------------------
  for (const [name, src] of Object.entries(CASES)) {
    const tree = parser.parse(src)
    const analyzer = new mod.RealYamlAnalyzer()
    const res: any = await analyzer.analyze(tree.rootNode, src, `${name}.yaml`)
    console.log(`\n=== ${name} ===`)
    console.log(src.split("\n").map((l, i) => `   ${i + 1} | ${l}`).join("\n"))
    const ids = (res.symbols ?? []).map((s: any) => s.id)
    const dupIds = ids.filter((v, i) => ids.indexOf(v) !== i)
    console.log(`  SYMBOLS (${ids.length}, unique ${new Set(ids).size}${dupIds.length ? `, DUP IDS: ${JSON.stringify([...new Set(dupIds)])}` : ""}):`)
    for (const s of res.symbols ?? []) {
      console.log(`    L${String(s.range?.startLine).padStart(3)} ${String(s.kind).padEnd(9)} id=${String(s.id).padEnd(34)} name=${String(s.name).padEnd(14)} valueType=${String((s.metadata ?? {}).valueType)}`)
    }
    console.log(`  RELATIONSHIPS (${(res.relationships ?? []).length}):`)
    for (const r of res.relationships ?? []) {
      console.log(`    ${String(r.type).padEnd(12)} ${String(r.source).padEnd(30)} -> ${String(r.target).padEnd(24)} conf=${r.confidence} meta=${JSON.stringify(r.metadata)}`)
    }
    console.log(`  imports=${(res.imports ?? []).length} exports=${(res.exports ?? []).length}`)
    console.log(`  metadata: frameworks=${JSON.stringify((res.metadata ?? {}).detectedFrameworks)} patterns=${JSON.stringify((res.metadata ?? {}).patterns)} docCount=${(res.metadata ?? {}).documentCount}`)
  }
}
main()

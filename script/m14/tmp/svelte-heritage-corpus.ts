// M49 W12 svelte heritage corpus measurement (reads only — writes nothing).
//
// Measures the REAL corpus, not a probe: every .svelte file in the svelte
// checkout whose source carries an `extends`/`implements` token (a heritage
// edge cannot exist without one) is analyzed with the production SFC path
// (ASTEngine.parseFile) AND with the F5 oracle's embedded-script walk
// (svelte grammar -> script raw_text -> javascript grammar -> deriveTreeEdges),
// and the two heritage sets are compared edge by edge.
//
// Usage: bun run script/m14/tmp/svelte-heritage-corpus.ts [repoDir]
import * as fs from "fs"
import * as path from "path"
import * as WTS from "web-tree-sitter"
import { deriveTreeEdges } from "../differential"

import { fileURLToPath } from "node:url"
const __dirname = fileURLToPath(new URL(".", import.meta.url)).replace(/[\\/]+$/, "")

const ROOT = process.env.BB_M14_ROOT ? path.resolve(process.env.BB_M14_ROOT) : path.resolve(__dirname, "..", "..", "..")
const REPO = process.argv[2] ?? "/home/ishaq2321/bb_tests/repositories/svelte"

async function main() {
  const P: any = (WTS as any).Parser ?? (WTS as any).default ?? WTS
  const Lang: any = (WTS as any).Language ?? (WTS as any).default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const jsLang = await Lang.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-javascript.wasm")))
  const tsLang = await Lang.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-typescript.wasm")))
  const svLang = await Lang.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-svelte.wasm")))
  const js = new P(); js.setLanguage(jsLang)
  const ts = new P(); ts.setLanguage(tsLang)
  const sv = new P(); sv.setLanguage(svLang)

  const files: string[] = []
  const scan = (d: string) => {
    let entries
    try { entries = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) { if (!/^(\.|node_modules|build|target|dist)/.test(e.name)) scan(p) }
      else if (e.name.endsWith(".svelte")) files.push(p)
    }
  }
  scan(REPO)

  const eng: any = await import("../../../src/ast/engine")

  let scanned = 0, heritageFiles = 0
  let analyzerHeritage = 0, oracleHeritage = 0
  let oracleMissing = 0, analyzerUnexplained = 0
  const mismatches: any[] = []

  for (const f of files.sort()) {
    const src = fs.readFileSync(f, "utf8")
    if (!src.includes("extends") && !src.includes("implements")) continue
    scanned++
    // Oracle view: svelte grammar -> each script raw_text -> its grammar walker
    const stree = sv.parse(src)
    const scripts: { text: string; isTs: boolean }[] = []
    const walk = (n: any) => {
      if (n.type === "script_element") {
        const raw = n.namedChildren.find((c: any) => c.type === "raw_text")
        const startTag = n.namedChildren.find((c: any) => c.type === "start_tag")
        const isTs = !!startTag && /lang=["']ts["']/.test(startTag.text)
        if (raw && raw.text.trim().length > 0) scripts.push({ text: raw.text, isTs })
      }
      for (let i = 0; i < n.namedChildCount; i++) walk(n.namedChild(i))
    }
    walk(stree.rootNode)
    const oracle = new Set<string>()
    for (const s of scripts) {
      const t = (s.isTs ? ts : js).parse(s.text)
      for (const e of deriveTreeEdges(t.rootNode, s.isTs ? "typescript" : "javascript")) {
        if (e.label === "extends" || e.label === "implements") oracle.add(`${e.label}:${e.target}`)
      }
    }
    // Analyzer view: production SFC path
    let res: any
    try { res = await eng.ASTEngine.parseFile(f, src) } catch { continue }
    const analyzer = new Set<string>()
    for (const r of res.relationships ?? []) {
      const t = String(r.type ?? r.relationshipType ?? "")
      if (t === "extends" || t === "implements") analyzer.add(`${t}:${r.target}`)
    }
    if (oracle.size === 0 && analyzer.size === 0) continue
    heritageFiles++
    analyzerHeritage += analyzer.size
    oracleHeritage += oracle.size
    for (const e of oracle) if (!analyzer.has(e)) { oracleMissing++; mismatches.push({ file: path.relative(REPO, f), dir: "MISSING_IN_ANALYZER", edge: e }) }
    for (const e of analyzer) if (!oracle.has(e)) { analyzerUnexplained++; mismatches.push({ file: path.relative(REPO, f), dir: "UNEXPLAINED_BY_ORACLE", edge: e }) }
  }

  console.log(`repo: ${REPO}`)
  console.log(`svelte files scanned (carry an extends/implements token): ${scanned}`)
  console.log(`files with script heritage: ${heritageFiles}`)
  console.log(`heritage edges — analyzer: ${analyzerHeritage}  oracle: ${oracleHeritage}`)
  console.log(`MISSING (truth not emitted by analyzer): ${oracleMissing}`)
  console.log(`UNEXPLAINED (analyzer edge oracle cannot derive): ${analyzerUnexplained}`)
  for (const m of mismatches.slice(0, 40)) console.log(`  ${m.dir}  ${m.file}  ${m.edge}`)
}

main().catch((e) => { console.error("corpus measurement failed:", e); process.exit(1) })

// The 3 unexplained contract rows: the analyzer emits a row the oracle does not
// derive. Reads the oracle function out of source (importing differential.ts
// launches a 40-language sweep) and transpiles it rather than regex-stripping
// the types — hand-stripping leaves non-null assertions and the probe becomes a
// parser-error hunt.
import * as fs from "fs"
import * as path from "path"
import { vue, rels } from "./harness"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../../../..")
const CORPUS = "/home/ishaq2321/bb_tests/repositories"

function under(root: string, limit: number) {
  const out: string[] = []
  const walk = (d: string) => {
    if (out.length >= limit) return
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (out.length >= limit) return
      if (e.name === ".git" || e.name === "node_modules" || e.name === "dist") continue
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.name.endsWith(".vue")) out.push(p)
    }
  }
  walk(root)
  return out.sort()
}

const TMP = "/tmp/opencode/vue-oracle-ab.mjs"
function loadOracle(): any {
  const dsrc = fs.readFileSync(path.join(ROOT, "script/m14/differential.ts"), "utf8")
  const i = dsrc.indexOf("function deriveVueContractEdges")
  const j = dsrc.indexOf("/**\n * F1: Options-API heritage truth", i)
  const body = dsrc.slice(i, j)
  const js = new Bun.Transpiler({ loader: "ts", target: "bun" }).transformSync(body)
  fs.writeFileSync(TMP, js + "\nexport { deriveVueContractEdges }\n")
  return import(TMP)
}

async function main() {
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
  const { deriveVueContractEdges } = await loadOracle()
  const wts: any = await import("web-tree-sitter")
  const Parser = wts.Parser ?? wts.default
  const L = wts.Language ?? wts.default?.Language
  await Parser.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
  const vueLang = await L.load(fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-vue.wasm")))
  const jsLang = await L.load(fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-javascript.wasm")))
  const tsLang = await L.load(fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-typescript.wasm")))

  let onlyAnalyzer = 0, onlyOracle = 0, agreed = 0
  const ex: string[] = []
  for (const f of under(`${CORPUS}/element-plus`, 250)) {
    const src = fs.readFileSync(f, "utf8")
    if (!/\b(defineProps|defineEmits|provide|inject)\s*[(<]/.test(src)) continue
    const mod = path.basename(f, ".vue")
    const r = await vue(src, f)
    const ana = new Set(
      rels(r, "references")
        .filter((x: any) => x.metadata?.isPropContract || x.metadata?.isEmitContract || x.metadata?.isProvideContract || x.metadata?.isInjectContract)
        .map((x: any) => `${x.source}|${x.target}`),
    )
    const vp = new Parser(); vp.setLanguage(vueLang)
    const root = vp.parse(src)
    const subTrees: any[] = []
    for (const b of (ASTEngine as any).extractSfcScriptBlocks(root, src)) {
      const sp = new Parser()
      sp.setLanguage(b.lang === "ts" || b.lang === "tsx" ? tsLang : jsLang)
      subTrees.push(sp.parse(b.body).rootNode)
    }
    const nm = /\bname\s*:\s*['"]([\w-]+)['"]/.exec(src)?.[1] ?? mod
    const orc = new Set(deriveVueContractEdges(subTrees, nm).map((e: any) => `${e.from}|${e.target}`))
    for (const t of ana) if (orc.has(t)) agreed++
    for (const t of ana) if (!orc.has(t)) { onlyAnalyzer++; if (ex.length < 10) ex.push(`${mod}  ANALYZER-ONLY ${t}`) }
    for (const t of orc) if (!ana.has(t)) { onlyOracle++; if (ex.length < 20) ex.push(`${mod}  ORACLE-ONLY   ${t}`) }
  }
  console.log(`=== contract rows, analyzer vs oracle (250 element-plus files) ===`)
  console.log(`  agreed: ${agreed}`)
  console.log(`  ANALYZER-only (would be unexplained): ${onlyAnalyzer}`)
  console.log(`  ORACLE-only   (would be MISSING):      ${onlyOracle}`)
  for (const e of ex) console.log(`    ${e}`)
}
main()
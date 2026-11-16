// F1 closure: the analyzer's heritage rows vs the oracle's, on the real corpus
// files, so a mismatch is a shape difference and not a guess.
import * as fs from "fs"
import * as path from "path"
import { vue, rels } from "./harness"

const CORPUS = "<corpus-root>/bb_tests/repositories"

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

async function main() {
  const files = under(`${CORPUS}/vue-element-admin`, 200)
  // differential.ts runs main() on import, so read the function out of source
  // instead of importing it: an A/B probe must not launch a 40-language sweep.
  const dsrc = fs.readFileSync(path.resolve(import.meta.dirname ?? ".", "../../../..", "script/m14/differential.ts"), "utf8")
  const i = dsrc.indexOf("function deriveVueHeritageTruth")
  const j = dsrc.indexOf("\nasync function deriveEmbeddedScriptTrees")
  const body = dsrc.slice(i, j).replace(/:\s*Array<\{ label: string; from: string; target: string \}>/g, "").replace(/:\s*any\b/g, "").replace(/:\s*string\b/g, "").replace(/:\s*number\b/g, "")
  const D: any = { deriveVueHeritageTruth: new Function("return (" + body.replace(/^function deriveVueHeritageTruth/, "function") + ")")() }
  void (await import(path.resolve(import.meta.dirname ?? ".", "../../../..", "script/m14/differential.ts")))
  let n = 0
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8")
    if (!/^\s*mixins\s*:/m.test(src) && !/^\s*extends\s*:/m.test(src)) continue
    const r = await vue(src, f)
    const ana = rels(r, "extends").map((x: any) => `${x.source}->${x.target}`)
    if (!ana.length) continue
    n++
    // what the oracle would derive
    const { ASTEngine } = await import(path.resolve(import.meta.dirname ?? ".", "../../../..", "src/ast/engine.ts"))
    void ASTEngine
    const eng: any = await import(path.resolve(import.meta.dirname ?? ".", "../../../..", "src/ast/engine.ts"))
    const wts: any = await import("web-tree-sitter")
    const Parser = wts.Parser ?? wts.default
    const L = wts.Language ?? wts.default?.Language
    await Parser.init({ locateFile: () => path.join(process.cwd(), "node_modules/web-tree-sitter/tree-sitter.wasm") })
    const vueLang = await L.load(fs.readFileSync(path.join(process.cwd(), "wasm/tree-sitter-vue.wasm")))
    const jsLang = await L.load(fs.readFileSync(path.join(process.cwd(), "wasm/tree-sitter-javascript.wasm")))
    const p = new Parser(); p.setLanguage(vueLang)
    const tree = p.parse(src)
    const blocks = (eng as any).ASTEngine.extractSfcScriptBlocks(tree.rootNode, src)
    const subTrees: any[] = []
    for (const b of blocks) {
      const sp = new Parser(); sp.setLanguage(jsLang)
      subTrees.push(sp.parse(b.body).rootNode)
    }
    const oracle = D.deriveVueHeritageTruth?.(subTrees, path.basename(f, ".vue")) ?? []
    console.log(`\n${path.relative(CORPUS, f)}`)
    console.log(`  analyzer: ${JSON.stringify(ana)}`)
    console.log(`  oracle:   ${JSON.stringify(oracle.map((e: any) => `${e.from}->${e.target}`))}`)
    const at = new Set(ana.map((x: string) => x.split("->")[1]))
    const ot = new Set(oracle.map((e: any) => e.target))
    const missing = [...at].filter((t) => !ot.has(t))
    console.log(`  in analyzer but NOT oracle: ${JSON.stringify(missing)}`)
    if (n >= 5) break
  }
  console.log(`\nderiveVueHeritageTruth exported? ${typeof D.deriveVueHeritageTruth}`)
}
main()
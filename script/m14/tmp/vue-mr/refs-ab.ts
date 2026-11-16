// A/B the oracle's contract derivation against the analyzer's contract rows, per
// file, so the 79 MISSING rows are identified rather than guessed at.
import * as fs from "fs"
import * as path from "path"
import { vue, rels } from "./harness"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../../../..")
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
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
  const wts: any = await import("web-tree-sitter")
  const Parser = wts.Parser ?? wts.default
  const L = wts.Language ?? wts.default?.Language
  await Parser.init({ locateFile: () => path.join(process.cwd(), "node_modules/web-tree-sitter/tree-sitter.wasm") })
  const vueLang = await L.load(fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-vue.wasm")))
  const jsLang = await L.load(fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-javascript.wasm")))
  const tsLang = await L.load(fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-typescript.wasm")))

  // read the oracle function out of source (importing differential.ts runs a sweep)
  const dsrc = fs.readFileSync(path.join(ROOT, "script/m14/differential.ts"), "utf8")
  const i = dsrc.indexOf("function deriveVueContractEdges")
  const j = dsrc.indexOf("/**\n * F1: Options-API heritage truth", i)
  const body = dsrc.slice(i, j)
  // Strip the TYPES with a real transpiler rather than a regex: hand-stripping
  // TS leaves non-null assertions behind, and `inner.pop()!` does not parse as
  // JS. The A/B probe must not become a parser-error hunt.
  const js = (Bun as any).Transpiler
    ? new Bun.Transpiler({ loader: "ts", target: "bun" }).transformSync(body)
    : body
  const derive: any = new Function(js.replace(/^export\s+/gm, "") + "\nreturn deriveVueContractEdges;")()

  const files = under(`${CORPUS}/element-plus`, 200)
  let missing = 0, extra = 0, agree = 0
  const reasons = new Map<string, number>()
  const ex: string[] = []
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8")
    if (!/\b(defineProps|defineEmits|provide|inject)\s*[(<]/.test(src)) continue
    const mod = path.basename(f, ".vue")
    const r = await vue(src, f)
    const ana = rels(r, "references")
      .filter((x: any) => x.metadata?.isPropContract || x.metadata?.isEmitContract || x.metadata?.isProvideContract || x.metadata?.isInjectContract)
      .map((x: any) => `${x.source}|${x.target}`)
    const vp = new Parser(); vp.setLanguage(vueLang)
    const root = vp.parse(src)
    const blocks = (ASTEngine as any).extractSfcScriptBlocks(root, src)
    const subTrees: any[] = []
    for (const b of blocks) {
      const sp = new Parser()
      sp.setLanguage(b.lang === "ts" || b.lang === "tsx" ? tsLang : jsLang)
      subTrees.push(sp.parse(b.body).rootNode)
    }
    // the component's declared name, which both sides read
    const nm = /\bname\s*:\s*['"]([\w-]+)['"]/.exec(src)?.[1] ?? mod
    const orc = derive(subTrees, nm).map((e: any) => `${e.from}|${e.target}`)
    const aSet = new Set(ana), oSet = new Set(orc)
    for (const t of oSet) if (!aSet.has(t)) { missing++; const k = classify(t, src); reasons.set(k, (reasons.get(k) ?? 0) + 1); if (ex.length < 8) ex.push(`${mod}  oracle-only ${t}  (${k})`) }
    for (const t of aSet) if (!oSet.has(t)) { extra++; const k = classify(t, src); reasons.set("ANALYZER-ONLY " + k, (reasons.get("ANALYZER-ONLY " + k) ?? 0) + 1) }
    agree += [...oSet].filter((t) => aSet.has(t)).length
  }
  console.log(`=== contract-edge A/B over ${files.length} element-plus files ===`)
  console.log(`  agreed: ${agree} | oracle-only (MISSING): ${missing} | analyzer-only (unexplained): ${extra}`)
  console.log("  by shape:")
  for (const [k, v] of [...reasons.entries()].sort((a, b) => b[1] - a[1])) console.log(`    ${String(v).padStart(4)}  ${k}`)
  console.log("  examples:")
  for (const e of ex) console.log(`    ${e}`)
}

function classify(t: string, src: string): string {
  const [, name] = t.split("|")
  const isLocal = new RegExp(`(interface|type|const|let|var)\\s+${name}\\b`).test(src)
  if (/withDefaults/.test(src) && new RegExp(`defineProps<${name}>`).test(src)) return "named type inside withDefaults"
  if (new RegExp(`defineProps\\(\\s*${name}\\s*[,)]`).test(src) || new RegExp(`defineEmits\\(\\s*${name}\\s*[,)]`).test(src)) return "binding argument"
  if (new RegExp(`defineProps<${name}>`).test(src)) return isLocal ? "named type, LOCAL declaration" : "named type, imported"
  if (new RegExp(`provide\\(\\s*${name}\\b`).test(src)) return "provide(key)"
  if (new RegExp(`inject\\(\\s*${name}\\b`).test(src)) return "inject(key)"
  return "other"
}
main()
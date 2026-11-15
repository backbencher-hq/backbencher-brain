import * as fs from "fs"
import { execSync } from "child_process"
import * as WTS from "web-tree-sitter"
import { deriveTypeScriptReferencesTruth } from "../oracles/typescript-references"
const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
async function main() {
  const wts: any = WTS
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init()
  const lang = await L.load(`${ROOT}/wasm/tree-sitter-typescript.wasm`)
  const files = execSync("git ls-files '*.ts' | rg -v '^node_modules/|^dist/|^wasm/|^script/m14/tmp/' | head -"+(process.argv[2]??300), { encoding: "utf8", cwd: ROOT }).trim().split("\n").filter(Boolean)
  let agree = 0, missing = 0, extra = 0, filesOk = 0
  const miss = new Map<string, number>(), ext = new Map<string, number>()
  const ms: string[] = [], es: string[] = []
  for (const f of files) {
    if (!fs.existsSync(`${ROOT}/${f}`)) continue
    const src = fs.readFileSync(`${ROOT}/${f}`, "utf8")
    const p = new P(); p.setLanguage(lang)
    let r: any
    try { r = await new (await import(`${ROOT}/src/ast/real-typescript-analyzer`)).RealTypeScriptAnalyzer().analyze(p.parse(src).rootNode, src, `${ROOT}/${f}`) } catch { continue }
    filesOk++
    const truth = new Set(deriveTypeScriptReferencesTruth(p.parse(src).rootNode).map((e) => `${e.from}|${e.target}`))
    const an = new Set((r.relationships ?? []).filter((x: any) => x.type === "references").map((x: any) => `${x.source}|${x.target}`))
    const declared = new Set((r.symbols ?? []).map((s: any) => s.name))
    for (const k of truth) if (an.has(k)) agree++; else { missing++; const t = k.split("|")[1]; const cls = declared.has(t) ? "declared-in-file" : "builtin/ambient"; miss.set(cls, (miss.get(cls)??0)+1); if (ms.length<6) ms.push(`${f}  ${k.replace("|"," -> ")}  [${cls}]`) }
    for (const k of an) if (!truth.has(k)) { extra++; const t = k.split("|")[1]; const cls = declared.has(t) ? "declared-in-file" : "builtin/ambient"; ext.set(cls, (ext.get(cls)??0)+1); if (es.length<6) es.push(`${f}  ${k.replace("|"," -> ")}  [${cls}]`) }
  }
  const tot = agree + missing + extra
  console.log(`files=${filesOk}  agree=${agree}  MISSING=${missing}  EXTRA=${extra}   agreement=${((agree/tot)*100).toFixed(1)}%`)
  console.log(`  MISSING by class: ${[...miss].map(([k,v])=>`${k}=${v}`).join("  ")}`)
  console.log(`  EXTRA   by class: ${[...ext].map(([k,v])=>`${k}=${v}`).join("  ")}`)
  console.log("\nMISSING:"); for (const s of ms) console.log("  "+s)
  console.log("\nEXTRA:"); for (const s of es) console.log("  "+s)
}
main()

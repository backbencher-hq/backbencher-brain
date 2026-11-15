import * as fs from "fs"
import * as path from "path"
import { Parser, Language } from "web-tree-sitter"
const ROOT = path.resolve((import.meta as any).dirname ?? path.dirname(process.argv[1] ?? "."), "..", "..", "..")
// The four types graph-engine.ts serves when a caller does not ask for others.
const DEFAULT_REL_TYPES = new Set(["calls", "instantiates", "extends", "implements"])
function list(root: string): string[] {
  const out: string[] = []
  const skip = new Set([".git","node_modules","vendor","tmp","log"])
  const walk = (d: string) => { let e: fs.Dirent[]; try { e = fs.readdirSync(d,{withFileTypes:true}) } catch { return }
    for (const x of e) { if (x.name.startsWith(".")) continue; const p = path.join(d,x.name)
      if (x.isDirectory()) { if (!skip.has(x.name)) walk(p) } else if (x.name.endsWith(".rb")) out.push(p) } }
  walk(root); return out.sort()
}
async function main() {
  const { RealRubyAnalyzer } = await import(path.join(ROOT, "src", "ast", "real-ruby-analyzer.ts"))
  await Parser.init()
  const lang = await Language.load(path.join(ROOT, "wasm", "tree-sitter-ruby.wasm"))
  const parser = new Parser(); parser.setLanguage(lang as any)
  const limitAt = process.argv.indexOf("--limit")
  const LIMIT = limitAt >= 0 ? parseInt(process.argv[limitAt+1]) : Infinity
  const roots = process.argv.slice(2).filter((a,i) => !a.startsWith("--") && !(i>0 && process.argv[i-1]==="--limit"))
  let files: string[] = []
  for (const r of roots) files = files.concat(list(path.resolve(r)))
  if (Number.isFinite(LIMIT) && files.length > LIMIT) { const st = files.length/LIMIT; files = Array.from({length:LIMIT},(_,i)=>files[Math.floor(i*st)]) }
  const by = new Map<string, number>()
  let total = 0
  for (const f of files) {
    let c: string; try { c = fs.readFileSync(f,"utf8") } catch { continue }
    let t: any; try { t = parser.parse(c) } catch { continue }
    let r: any; try { r = new RealRubyAnalyzer().analyze(t.rootNode, c, f) } catch { continue }
    for (const x of r.relationships ?? []) { const ty = String(x.type ?? ""); by.set(ty,(by.get(ty)??0)+1); total++ }
  }
  let inDefault = 0
  for (const [ty,n] of by) if (DEFAULT_REL_TYPES.has(ty)) inDefault += n
  console.log(`files=${files.length}  relationships=${total}`)
  console.log(`served by the DEFAULT graph filter (${[...DEFAULT_REL_TYPES].join(", ")}): ${inDefault}  = ${((inDefault/total)*100).toFixed(1)}%`)
  console.log(`SILENTLY EXCLUDED by that default: ${total-inDefault}  = ${(((total-inDefault)/total)*100).toFixed(1)}%\n`)
  for (const [ty,n] of [...by.entries()].sort((a,b)=>b[1]-a[1]))
    console.log(`  ${ty.padEnd(13)} ${String(n).padStart(7)}  ${((n/total)*100).toFixed(1).padStart(5)}%  ${DEFAULT_REL_TYPES.has(ty)?"served":"EXCLUDED"}`)
  fs.writeFileSync(path.join(ROOT,"validation","m60","results","ruby-rel-type-share.json"),
    JSON.stringify({generatedAt:new Date().toISOString(),files:files.length,total,defaultRelTypes:[...DEFAULT_REL_TYPES],
      servedByDefault:inDefault, excludedByDefault:total-inDefault, byType:Object.fromEntries(by)},null,2))
}
main()

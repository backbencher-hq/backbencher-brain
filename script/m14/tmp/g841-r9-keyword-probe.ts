import { readFileSync, writeFileSync } from "node:fs"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
await P.init({ locateFile: () => `${ROOT}/node_modules/web-tree-sitter/tree-sitter.wasm` })
const lang = await L.load(readFileSync(`${ROOT}/wasm/tree-sitter-groovy.wasm`))
const p = new P(); p.setLanguage(lang)
const KWS = ["boolean","int","long","short","byte","char","float","double","void","def","class","static","new","in","as","default","assert","for","if","while","switch","case","break","continue","return","true","false","null","this","super","throws","try","catch","finally","import","package","interface","trait","enum","extends","implements","instanceof","synchronized","abstract","final","public","private","protected","volatile","transient","native","strictfp","goto","const","else","do","var","record","sealed","open","module","with","yield","lambda"]
const rejected: string[] = []
const lines: string[] = []
for (const k of KWS) {
  const src = `class W {\n    def m(g, v) {\n        g.f(${k}: v)\n    }\n}\n`
  const r = p.parse(src)?.rootNode
  if (r?.hasError) { rejected.push(k); lines.push(`class W {\n    def m(g, v) {\n        g.f(${k}: v)\n    }\n}\n`) }
}
for (let i = 0; i < lines.length; i++) writeFileSync(`/tmp/kw/${String(i).padStart(2,"0")}.groovy`, lines[i])
writeFileSync("/tmp/kw/list.txt", lines.map((_,i)=>`/tmp/kw/${String(i).padStart(2,"0")}.groovy`).join("\n")+"\n")
writeFileSync("/tmp/kw/names.txt", rejected.join("\n")+"\n")
console.log(`we REJECT ${rejected.length} of ${KWS.length} keyword keys:`)
console.log(rejected.join(" "))

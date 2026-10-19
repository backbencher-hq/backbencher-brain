// Whole-population count of `importedName` claims (analyzer pass; no gate arm) + resolved-before
// join against the pre-importedName arm dump, so the Lead's "resolved must not fall" is MEASURED
// rather than assumed.
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { ASTEngine } from "../../src/ast/engine"
import { RealPythonAnalyzer } from "../../src/ast/real-python-analyzer"
const A=(f:string)=>{const i=process.argv.indexOf(f);return i>=0?process.argv[i+1]:undefined}
const BEFORE=A("--before")!, OUT=A("--out")
const before=new Set<string>()
for (const line of readFileSync(BEFORE,"utf8").split("\n")) {
  if(!line.startsWith("DUMP\t"))continue
  const p=line.split("\t"); if(p.length<6)continue
  const spec=p[4]??""; const c=spec.lastIndexOf(":")
  before.add(`${c>0?spec.slice(0,c):spec}\u0000${p[1]}\u0000${c>0?spec.slice(c+1):"0"}\u0000${p[3]}`)
}
const CORPUS=process.env.BB_CORPUS_ROOT??path.join(process.cwd(),".corpus")
const files:string[]=[]
const walk=(d:string,depth=0):void=>{if(depth>12)return;let es:string[];try{es=readdirSync(d)}catch{return}
  for(const e of es){if(e===".git"||e==="node_modules"||e===".corpus")continue;const p=path.join(d,e);let st:any;try{st=statSync(p)}catch{continue}
    if(st.isDirectory())walk(p,depth+1);else if(st.isFile()&&/\.(py|pyi|pyw)$/.test(e))files.push(p)}}
walk(CORPUS)
const parser:any=await ASTEngine.getParser("python"); const analyzer=new RealPythonAnalyzer()
let claimed=0,resolvedBefore=0,nonResolvedBefore=0
const byLabel=new Map<string,number>(); const byRoot=new Map<string,number>()
const resolvedSamples:string[]=[]
for(const f of files){
  let r:any;try{const content=readFileSync(f,"utf8");const tree=parser.parse(content);if(!tree)continue;r=analyzer.analyze(tree.rootNode,content,f)}catch{continue}
  if(!r)continue
  for(const rel of r.relationships){
    const md=rel.metadata; const imp=md?.importedName
    if(!imp||typeof imp!=="object"||typeof imp.specifier!=="string"||typeof imp.name!=="string")continue
    claimed++
    byLabel.set(String(rel.type),(byLabel.get(String(rel.type))??0)+1)
    const root=imp.specifier.split(".")[0]??""; byRoot.set(root,(byRoot.get(root)??0)+1)
    const key=`${f}\u0000${String(rel.type)}\u0000${Number(rel.line_number??0)}\u0000${String(rel.target)}`
    if(before.has(key)){nonResolvedBefore++;continue}
    resolvedBefore++
    if(resolvedSamples.length<5)resolvedSamples.push(`${path.relative(CORPUS,f)}:${rel.line_number} ${String(rel.type)} ${String(rel.target)} (${imp.specifier})`)
  }
}
console.log(`importedName claims=${claimed} · non-resolved-before=${nonResolvedBefore} · RESOLVED-BEFORE=${resolvedBefore}`)
console.log(`by label: ${JSON.stringify([...byLabel.entries()].sort((a,b)=>b[1]-a[1]))}`)
console.log(`by specifier root: ${JSON.stringify([...byRoot.entries()].sort((a,b)=>b[1]-a[1]).slice(0,15))}`)
console.log(`resolved-before samples: ${JSON.stringify(resolvedSamples)}`)
if(OUT){writeFileSync(OUT,JSON.stringify({claimed,nonResolvedBefore,resolvedBefore,byLabel:Object.fromEntries(byLabel),byRoot:Object.fromEntries(byRoot),resolvedSamples},null,2));console.log(`wrote ${OUT}`)}

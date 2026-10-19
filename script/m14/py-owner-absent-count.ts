// Whole-population count of `ownerMemberAbsent` claims (INDEXED arm simulation, analyzer pass) +
// a GATE-SIDE closure simulation so a would-be-refuted claim is caught BEFORE the arm.
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { ASTEngine } from "../../src/ast/engine"
import { PYTHON_DECLARATION_SPEC } from "../../src/ast/project-index"
import { buildProjectIndex } from "../../src/ast/project-index"
import { RealPythonAnalyzer } from "../../src/ast/real-python-analyzer"
process.env.BB_PY_OWNER_MEMBER_ABSENT = "1"
const A=(f:string)=>{const i=process.argv.indexOf(f);return i>=0?process.argv[i+1]:undefined}
const OUT=A("--out")
const CORPUS=process.env.BB_CORPUS_ROOT??path.join(process.cwd(),".corpus")
let SYNTH_DECL_COUNTS: Map<string, number> | null = null
let SYNTH_ALL_COUNTS: Map<string, number> | null = null
const ONLY=A("--repo")
const repos=readdirSync(CORPUS).map((e)=>path.join(CORPUS,e)).filter((p)=>{try{return statSync(p).isDirectory()}catch{return false}}).filter((p)=>!ONLY||path.basename(p)===ONLY).sort()
const parser:any=await ASTEngine.getParser("python")
const leaf=(n:string):string=>{const t=n.replace(/[<[].*$/,"").trim();const segs=t.split(/[.:]/).filter((x)=>x.length>0);return segs.length>0?segs[segs.length-1]!:t}
let claims=0, gateVerified=0, gateRefuted=0, gateUnverifiable=0
const byOwner=new Map<string,number>(); const refutedSamples:string[]=[]
for(const repo of repos){
  const files:string[]=[]
  const walk=(d:string,depth=0):void=>{if(depth>12)return;let es:string[];try{es=readdirSync(d)}catch{return}
    for(const e of es){if(e===".git"||e==="node_modules")continue;const p=path.join(d,e);let st:any;try{st=statSync(p)}catch{continue}
      if(st.isDirectory())walk(p,depth+1);else if(st.isFile()&&/\.(py|pyi|pyw)$/.test(e))files.push(p)}}
  walk(repo)
  if(files.length===0)continue
  const trees:any[]=[]; const contents:string[]=[]
  for(const f of files){let text:string|null=null;try{text=readFileSync(f,"utf8")}catch{text=null};if(text===null)continue;const t=parser.parse(text);if(!t)continue;trees.push({path:f,tree:t});contents.push(text)}
  if(trees.length===0)continue
  const SYNTHETIC = process.argv.includes("--synthetic")
  const REAL = process.argv.includes("--real")
  let index: any
  if (REAL) {
    // REAL index (same builder/ spec production uses): the indexed arm's decls test is
    // index.symbolCounts, so this is the only faithful split diagnosis.
    index = buildProjectIndex(trees, PYTHON_DECLARATION_SPEC); index.complete = true
  } else if (SYNTHETIC) {
    // LIGHT COUNT MODE: the reworked emission reads ONLY index.complete, typeKinds and
    // symbolCounts, so a synthetic index built from this repo's own analyzer symbols is enough to
    // count claims without materialising per-repo parse trees (memory-light under box pressure).
    const counts = new Map<string, number>()
    const countsDecl = new Map<string, number>()
    const kinds = new Map<string, string>()
    {
      const analyzerA = new RealPythonAnalyzer()
      for (let i = 0; i < files.length; i++) {
        let rr: any
        try { rr = analyzerA.analyze(trees[i]!.tree.rootNode, contents[i]!, files[i]!) } catch { continue }
        if (!rr) continue
        for (const sym of rr.symbols ?? []) {
          if (!sym?.name) continue
          counts.set(sym.name, (counts.get(sym.name) ?? 0) + 1)
          if (sym.kind === "class" || sym.kind === "enum" || sym.kind === "function" || sym.kind === "method") {
            countsDecl.set(sym.name, (countsDecl.get(sym.name) ?? 0) + 1)
          }
          if ((sym.kind === "class" || sym.kind === "enum") && !kinds.has(sym.name)) kinds.set(sym.name, "class")
        }
      }
    }
    index = { complete: true, typeKinds: kinds, typeMembers: new Map(), typeBases: new Map(), symbolCounts: counts }
    SYNTH_DECL_COUNTS = countsDecl
    SYNTH_ALL_COUNTS = counts
  } else {
    index = buildProjectIndex(trees,PYTHON_DECLARATION_SPEC); index.complete = true
  }
  const analyzer=new RealPythonAnalyzer()
  const allSymbols:any[]=[]; const repoClaims:any[]=[]
  for(let i=0;i<trees.length;i++){
    let r:any;try{r=analyzer.analyze(trees[i]!.tree.rootNode,contents[i]!,files[i]!,{projectIndex:index} as any)}catch{continue}
    if(!r)continue
    for(const s of r.symbols??[])allSymbols.push(s)
    for(const rel of r.relationships??[]){const md=rel.metadata;if(md?.ownerMemberAbsent)repoClaims.push({rel,md,file:files[i]!})}
  }
  // GATE-SIDE closure simulation (mirrors incoming-gate.ts ownerMembers construction)
  const supers=new Map<string,string[]>(); const membersByName=new Map<string,Set<string>>()
  for(const r of allSymbols){
    if(r.ownerName){for(const k of new Set([r.ownerName,leaf(r.ownerName)])){let set=membersByName.get(k);if(!set)membersByName.set(k,(set=new Set()));set.add(r.name)};continue}
    for(const k of new Set([r.name,leaf(r.name)])){const sup=(r.superTypes??[]).map(leaf).filter((x:string)=>x.length>0);if(sup.length>0){const cur=supers.get(k);supers.set(k,cur?[...cur,...sup]:sup)}}
  }
  const closed=new Map<string,Set<string>>()
  for(const start of membersByName.keys()){const out=new Set<string>();const seen=new Set<string>([start]);const stack=[start]
    while(stack.length>0){const cur=stack.pop() as string;const own=membersByName.get(cur);if(own)for(const m of own)out.add(m)
      for(const up of supers.get(cur)??[]){if(seen.has(up))continue;seen.add(up);stack.push(up)}}
    closed.set(start,out)}
  if(ONLY){
    // THE GATE'S DECLS MAP IS EVERY ANALYZER SYMBOL NAME (plus qualifiedName aliases), NOT the
    // declaration proxy: incoming-gate counts each symbol's name (properties/attrs included) as a
    // declaration key. So the faithful diagnosis uses the ALL-symbol count map.
    const dc=(REAL && index?.symbolCounts) ? index.symbolCounts : (SYNTH_ALL_COUNTS ?? new Map<string,number>())
    const verifiedRows=repoClaims.filter(({rel,md})=>{const set=closed.get(md.owner);return set!==undefined&&!set.has(String(rel.target))})
    const declsZero=verifiedRows.filter(({rel})=>(dc.get(String(rel.target))??0)===0)
    const declsPos=verifiedRows.filter(({rel})=>(dc.get(String(rel.target))??0)>0)
    const samples=declsPos.slice(0,5).map(({rel,md,file})=>`${path.relative(CORPUS,file)}:${rel.line_number} ${String(rel.type)} ${String(rel.target)} owner=${md.owner}`)
    console.log("REPOJSON "+JSON.stringify({repo:path.basename(repo),files:trees.length,claims:repoClaims.length,gateVerified:verifiedRows.length,gateRefuted:repoClaims.length-verifiedRows.length,verifiedDeclsZero:declsZero.length,verifiedDeclsPositive:declsPos.length,declsPositiveSamples:samples}))
    continue
  }
  for(const {rel,md,file} of repoClaims){
    claims++; byOwner.set(md.owner,(byOwner.get(md.owner)??0)+1)
    const set=closed.get(md.owner)
    if(set===undefined)gateUnverifiable++
    else if(set.has(String(rel.target))){gateRefuted++; if(refutedSamples.length<5)refutedSamples.push(`${path.relative(CORPUS,file)}:${rel.line_number} ${String(rel.type)} ${String(rel.target)} owner=${md.owner}`)}
    else gateVerified++
  }
  console.error(`  ${path.basename(repo).padEnd(26)} files=${String(trees.length).padEnd(6)} claims=${String(repoClaims.length).padEnd(6)} gateVerified=${String([...repoClaims].filter(({rel,md})=>{const s=closed.get(md.owner);return s!==undefined&&!s.has(String(rel.target))}).length).padEnd(6)} gateRefuted=${[...repoClaims].filter(({rel,md})=>{const s=closed.get(md.owner);return s!==undefined&&s.has(String(rel.target))}).length}`)
}
console.log(`\nownerMemberAbsent claims=${claims} · gate-sim VERIFIED=${gateVerified} · gate-sim REFUTED=${gateRefuted} · UNVERIFIABLE=${gateUnverifiable}`)
console.log(`top owners: ${JSON.stringify([...byOwner.entries()].sort((a,b)=>b[1]-a[1]).slice(0,12))}`)
console.log(`refuted samples: ${JSON.stringify(refutedSamples)}`)
if(OUT){writeFileSync(OUT,JSON.stringify({claims,gateVerified,gateRefuted,gateUnverifiable,byOwner:Object.fromEntries(byOwner),refutedSamples},null,2));console.log(`wrote ${OUT}`)}

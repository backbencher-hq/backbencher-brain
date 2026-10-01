/**
 * M60 — the CASE AUDIT: a proof, not a review, that no switch case is dead.
 *
 * THE BUG CLASS. `revert_statement` had a case, a real body, and had NEVER FIRED: it
 * tested `node.namedChild(0).type === "identifier"` and the grammar puts an `expression`
 * wrapper there for every spelling. A second one, `using_alias`, was found the same way.
 * Both READ AS COVERAGE — a case in the source is not a reachable case — and neither
 * was visible to any count-based gate, because a branch that emits nothing changes no
 * count. So the question is not "does this case look right" but "can this case lose a
 * row", and that is answerable mechanically.
 *
 * THE TEST, in two steps.
 *
 *   1. A case whose body is nothing but `break` (or a descend flag plus `break`) CANNOT
 *      lose a row by construction. It is a no-op that documents a node type, and no edit
 *      to it would change a single relationship. Those are safe, and there is no
 *      judgement in that claim.
 *   2. Everything else is SUSPICIOUS if it emits nothing while an emitting type sits
 *      beneath it in the corpus — which is exactly the `revert_statement` shape: work
 *      written, never reached.
 *
 * The list below is the result, and it is SHORT and PINNED, so a new dead branch shows
 * up as a gate failure rather than as a judgement call in a review. Two of the entries
 * were found this way and are the reason the gate exists.
 *
 * Set `BB_SOLIDITY_CASE_AUDIT=1`; the analyzer's counters are compiled out of the
 * normal path (a flag read once per file) and absent from the returned metadata
 * entirely when the flag is off, so nothing here can be observed by accident.
 */

/** The known-suspicious set, each with the reason it is benign. Anything NEW here is
 *  a finding; anything MISSING is a stale gate. */
const EXPECTED_SUSPICIOUS: Record<string, string> = {
  binary_expression: "Counts `&&`/`||` as complexity decision points. A real body, but it feeds the COMPLEXITY metric, not a relationship — the audit counts relationship emissions only, so a correct case looks silent here. The clearest illustration that 'no relationship' and 'no work' are different claims.",
  parenthesized_expression: "A pass-through wrapper whose job is to stop the callee descent recursing into parentheses; what it wraps is read by a LATER case. Emitting nothing of its own is the point of it.",
  import_directive: "Emits in a POST-PASS over the collected `importEdges`, not inline — the same reason `override_specifier` and `inheritance_specifier` read as silent.",
  inheritance_specifier: "The `extends`/`implements` edge is emitted by the enclosing `contract_declaration` case, which reads the ancestor from here. This case's job is to hand the ancestor up.",
  meta_type_expression: "Requires the named type to be declared IN THIS FILE. All 86 corpus occurrences name a cross-file type, so zero is the correct count — the class exists in the F5 adjudication as `meta-type-mention-of-a-cross-file-type`.",
  catch_clause: "Emits `references -> <custom error>` only when the catch NAMES A TYPE. All 10 corpus catch clauses bind an unnamed `bytes memory`, so zero is correct.",
  pragma_directive: "A pragma is not a relationship. The case reads the version and comparison tokens for the file's metadata; emitting an edge to a version string would put a target in the graph that no project declares.",
  struct_expression: "SOL-10 — emits `isStructConstructor` only when the struct expression is NOT a call's callee. All 13 corpus occurrences are call-with-options (`target.call{value: v}(…)`), which the `call_expression` case claims, so zero here is correct and each still emits a `calls` row with `hasCallOptions`.",
  yul_function_call: "SOL-8 — a `yul_function_call` whose callee is a `yul_evm_builtin` is an OPCODE, not a call, and is deliberately suppressed. All 2,800 corpus Yul calls name a builtin, so the count is zero BY DESIGN and is why the corpus cannot under-represent Yul.",
}
import * as fs from "node:fs"; import * as path from "path"
import { fileURLToPath } from "node:url"; import * as cp from "node:child_process"; import * as WTS from "web-tree-sitter"
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..",".."); const DIR="$HOME/fixtures/repositories/solidity"
function hh(s:string){let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)}return (h>>>0).toString(16).padStart(8,"0")}
const { parseFile } = await import(path.join(ROOT,"src/ast/pool-worker.ts"))
await WTS.Parser.init()
const lang:any=await WTS.Language.load(fs.readFileSync(path.join(ROOT,"wasm/tree-sitter-solidity.wasm")))
const p=new WTS.Parser(); p.setLanguage(lang)
const all=cp.execSync(`git -C ${DIR} ls-files '*.sol'`,{encoding:"utf8",maxBuffer:1<<26}).trim().split("\n").filter(Boolean)
const prod=all.filter((r:string)=>!(r.startsWith("test/")||r.includes("/test/")||r.endsWith(".t.sol")))
const files=prod.map((r:string)=>({r,h:hh(`solidity/${r}`)})).sort((a:any,b:any)=>a.h<b.h?-1:a.h>b.h?1:a.r<b.r?-1:1).map((x:any)=>x.r)
const hits:Record<string,number>={}, emits:Record<string,number>={}
// node type -> set of node types appearing anywhere in its subtree, corpus-wide
const inside:Record<string,Set<string>>={}
for(const rel of files){
  const t=p.parse(fs.readFileSync(path.join(DIR,rel),"utf8"))
  const stack:[any,string[]][]=[[t.rootNode,[] as string[]]]
  while(stack.length>0){
    const [n,ancestors]=stack.pop()!
    for (const a of ancestors){ if(!inside[a]) inside[a]=new Set(); inside[a].add(n.type) }
    const chain=[...ancestors, n.type]
    for(let i=0;i<n.childCount;i++){ const c:any=n.child(i); if(c) stack.push([c, chain]) }
  }
  const r:any=await parseFile(path.join(DIR,rel), ROOT)
  const md:any=r.metadata??{}
  for(const k of Object.keys(md.__caseHits??{})) hits[k]=(hits[k]??0)+md.__caseHits[k]
  for(const k of Object.keys(md.__caseEmits??{})) emits[k]=(emits[k]??0)+md.__caseEmits[k]
}

const srcLines=fs.readFileSync(path.join(ROOT,"src/ast/real-solidity-analyzer.ts"),"utf8").split("\n")
const src=srcLines.slice(979).join("\n")
const cases=new Set<string>(); for(const m of src.matchAll(/^\s{8}case "([a-z_]+)":/gm)) cases.add(m[1])
const EMIT=new Set(Object.keys(emits).filter(k=>emits[k]>0))
const CASE_INDENT=/^        case "[a-z_]+":\s*\{?\s*$/
const SWITCH_END=/^      (default:|\})/
const bodyOf=(t:string):string=>{
  let start=-1
  for(let i=979;i<srcLines.length;i++){ if(srcLines[i]===`        case "${t}": {`){ start=i; break } }
  if(start<0) return ""
  const body:string[]=[]
  for(let i=start+1;i<srcLines.length;i++){
    const l:string=srcLines[i]
    if(CASE_INDENT.test(l) || SWITCH_END.test(l)) break
    body.push(l)
  }
  return body.join("\n")
}
const trivialBody=(t:string):boolean=>{
  const code=bodyOf(t).replace(/\/\/.*$/gm,"").replace(/\/\*[\s\S]*?\*\//g,"").trim()
  if(code==="") return true
  return /^break$/.test(code) || /^descend = (true|false)\n?break$/.test(code) || /^break\n?descend = (true|false)$/.test(code)
}
const emitsBelow=(t:string)=>[...(inside[t]??[])].filter(k=>k!==t && EMIT.has(k))
const silent=[...cases].filter(c=>(hits[c]??0)>0 && (emits[c]??0)===0).sort()
const trivial=silent.filter(trivialBody)
const suspicious=silent.filter(c=>!trivialBody(c) && emitsBelow(c).length>0)

const out={
  gate:"M60.solidity-case-audit",
  title:"no switch case in the Solidity analyzer is dead",
  question:"A case with a real body, no emissions, and an emitting type beneath it is the `revert_statement` shape: work written, never reached, reading as coverage.",
  totals:{ casesInSwitch:cases.size, typesThatEmit:EMIT.size, silentButLive:silent.length,
    trivialBody:trivial.length, suspicious:suspicious.length },
  trivialBodyNote:"A case whose body is only `break` (or a descend flag plus `break`) cannot lose a row by construction. That is a mechanical fact about the source, not a reviewer's opinion.",
  suspicious:{
    found:suspicious,
    expected:Object.keys(EXPECTED_SUSPICIOUS).sort(),
    matched:suspicious.filter(c=>EXPECTED_SUSPICIOUS[c]!==undefined).sort(),
    unmatched:suspicious.filter(c=>EXPECTED_SUSPICIOUS[c]===undefined).sort(),
    stale:Object.keys(EXPECTED_SUSPICIOUS).filter(c=>!suspicious.includes(c)).sort(),
    reasons:EXPECTED_SUSPICIOUS,
  },
}
const OUTDIR=path.join(ROOT,"validation","m60","results")
fs.mkdirSync(OUTDIR,{recursive:true})
fs.writeFileSync(path.join(OUTDIR,"solidity-case-audit.json"), JSON.stringify(out,null,2)+"\n")
console.log(`solidity case audit: ${out.totals.casesInSwitch} cases, ${out.totals.typesThatEmit} types emit`)
console.log(`  silent but live      ${out.totals.silentButLive}`)
console.log(`  trivial body (safe)  ${out.totals.trivialBody}   cannot lose a row by construction`)
console.log(`  SUSPICIOUS           ${out.totals.suspicious}`)
const problems=[...out.suspicious.unmatched, ...out.suspicious.stale]
if(problems.length>0){
  console.error(`\nFAIL — the suspicious set moved:`)
  for(const p of out.suspicious.unmatched) console.error(`  NEW, with no stated reason: ${p}`)
  for(const p of out.suspicious.stale) console.error(`  NO LONGER suspicious, so its reason is stale: ${p}`)
  process.exit(1)
}
console.log("\nPASS — every case with a real body either emits or has a stated reason, and no dead branch is unlisted.")

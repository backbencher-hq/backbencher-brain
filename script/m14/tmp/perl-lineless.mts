/** Which relationship labels carry no line_number, and is that the declared set? */
import * as fs from "fs"; import * as path from "path"
// REPO derived from this file's own location so the instrument travels with the
// repo; the corpora are large upstream checkouts and are not in it, so they come
// from BB_PERL_CORPUS (reviews/LANE-AUDIT-FORMULA.md, evidence rule 4).
const ROOT=path.resolve(import.meta.dir,"..","..","..")
const CR=process.env.BB_PERL_CORPUS ?? "<corpus-root>/bb_tests/repositories"
const wts:any=await import(path.join(ROOT,"node_modules/web-tree-sitter/tree-sitter.js"))
const P=wts.Parser??wts.default??wts; const L=wts.Language??wts.default?.Language
await P.init({locateFile:()=>path.join(ROOT,"node_modules/web-tree-sitter/tree-sitter.wasm")})
const p=new P(); p.setLanguage(await L.load(fs.readFileSync(path.join(ROOT,"wasm/tree-sitter-perl.wasm"))))
const { RealPerlAnalyzer } = await import(path.join(ROOT,"src/ast/real-perl-analyzer.ts"))
const C:any={mojo:`${CR}/mojo`,plack:`${CR}/plack`,Moose:`${CR}/cpan/Moose-2.4000`,Moo:`${CR}/cpan/Moo-2.005005`,Catalyst:`${CR}/cpan/Catalyst-Runtime-5.90132`,DBI:`${CR}/cpan/DBI-1.654`,perl5:`${CR}/perl5`}
// Aligned to production's router (src/ast/language-detection.ts:42 maps only
// pl|pm|t|perl) and to census.mts's ext set. This regex read `|PL`, which
// added one Makefile.PL per mojo/plack and made this instrument disagree with
// the census by 32 edges.
function walk(d:string,o:string[]=[],dep=0):string[]{ if(dep>12)return o; let es:fs.Dirent[]; try{es=fs.readdirSync(d,{withFileTypes:true})}catch{return o}
  for(const e of es){ if(e.name===".git"||e.name==="build")continue; const q=path.join(d,e.name); if(e.isDirectory())walk(q,o,dep+1); else if(/\.(pm|pl|t)$/.test(e.name))o.push(q)} return o}
const withLine=new Map<string,number>(), without=new Map<string,number>()
let tw=0,tn=0
for(const [nm,dir] of Object.entries(C)){ if(!fs.existsSync(dir as string))continue
  for(const f of walk(dir as string).sort()){ let src:string; try{src=fs.readFileSync(f,"utf8")}catch{continue}
    let r:any; try{ r=new RealPerlAnalyzer().analyze(p.parse(src).rootNode,src,f) }catch{continue}
    for(const rel of r.relationships??[]){ const lab=String(rel.type)
      if(typeof (rel as any).line_number==="number" && (rel as any).line_number>0){ withLine.set(lab,(withLine.get(lab)??0)+1); tw++ }
      else { without.set(lab,(without.get(lab)??0)+1); tn++ } } } }
console.log(`relationships WITH a line:    ${tw}`)
console.log(`relationships WITHOUT a line: ${tn}  (${(100*tn/(tw+tn)).toFixed(1)}%)`)
console.log("\nlabel                         with-line   without-line")
const labels=[...new Set([...withLine.keys(),...without.keys()])].sort()
for(const l of labels) console.log(`  ${l.padEnd(26)} ${String(withLine.get(l)??0).padStart(9)} ${String(without.get(l)??0).padStart(13)}`)

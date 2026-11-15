/**
 * DECLARED-TYPE ROUND TRIP — the fabrication check for the R9 relabel, in both
 * directions at once.
 *
 * ## Why this exists
 *
 * The largest single change this lane made to its edge set was not an addition: it
 * was a RELABEL. Ledger rule R9 says a declaration's written type is a `references`
 * edge marked `metadata.relationshipType === "declared_type"`, and java, kotlin,
 * scala, csharp, go, typescript and rust all publish a field/parameter/return type
 * that way and NONE of them publishes a `uses` edge for the same fact — typescript
 * suppresses the duplicate explicitly. This lane did publish both, so 7,892 edges
 * moved from `uses` to `references`.
 *
 * Moving 7,892 edges is exactly the operation the workstream's fabrication rule
 * warns about, and the existing differential cannot see it: its ground truth was
 * authored against the pre-move labelling, so a relabel that kept every fact and
 * changed every label would agree with itself.
 *
 * So this probe does the one thing a differential structurally cannot. It builds
 * TWO SETS over the whole admitted corpus and subtracts them:
 *
 *   SET A — every (file, source, target, line) the PARSE TREE says a declaration
 *           writes, derived by an independent walker.
 *   SET B — every (file, source, target, line) production `parseFile` emits with
 *           `type === "references"`.
 *
 *   B \ A  a FABRICATED edge: a relationship the source does not state. This is the
 *           most expensive defect the project can ship — the differential counts it
 *           `unexplained`, and it poisons bb_graph, bb_impact and bb_migrate, where
 *           a fake reference becomes wrong refactoring advice.
 *   A \ B  a LOST edge.
 *
 * Deduplicated the way the STORE deduplicates: the store keys a relationship on
 * (source, target, type, line), so the same triple twice is one row by design.
 *
 * ## What it cost to get to a clean 0/0
 *
 * Four wrong answers on this probe's side, each of which accused the analyzer of
 * fabricating edges that were all real. They are recorded because a checker that
 * cannot see anything WILL accuse the code, and a reader has to be able to tell
 * which side of the subtraction was broken:
 *
 *   1. The wrapper chain was walked UPWARD from the `Type` node. `NamedType` is its
 *      CHILD. Result: 0 derived, all 7,890 emitted edges "fabricated".
 *   2. The descent set was `{NamedType, NonNullType, ListType}` — omitting `Type`
 *      itself, which REAPPEARS inside a `ListType`. Every list-typed declaration
 *      silently read as "no resolvable name" (250 `InputValueDefinition`s).
 *   3. The line was taken from the member's own `Name`. The lane's rule is the
 *      `NamedType` that names the fact: in github-schema.graphql `avatarUrl` is on
 *      line 43, its `size: Int` argument on 47, and its `): URI!` return on 48.
 *      2,446 edges looked lost and 3,117 looked fabricated over a convention.
 *   4. The hop guard was 16, shorter than hasura `0038_wrapped_named_types.graphql`'s
 *      `d: [[[[[Int!]!]!]!]!]!`, which needs ~17. The 2 edges it could not reach
 *      were the last 2 it called fabricated.
 *
 * And three genuine SPELLING conventions the analyzer had never written down, each
 * of which was a real difference between the two sets rather than a bug on either
 * side. They are encoded here and they belong in the analyzer doc too:
 *
 *   - a FIELD ARGUMENT's type is attributed to the FIELD symbol (`Actor.avatarUrl ->
 *     Int`), because arguments are published as the field's `parameters` metadata and
 *     no argument symbol exists to own it.
 *   - a DIRECTIVE ARGUMENT's type is attributed to the DIRECTIVE symbol (`@example ->
 *     Boolean`), for the same reason and under a different spelling; the argument name
 *     survives in `metadata.argument`. This one class accounted for all 40 residual
 *     rows before it was written down.
 *   - a member declared in an `extend type X { … }` block is published exactly as a
 *     member of a definition (REVIEW.md finding C1), so the extension node types count
 *     as owners.
 */
import * as path from "node:path"
const { ROOT } = await import("../paths.mts")
import * as fs from "node:fs"
import { OUT } from "../paths.mts"
import { execFileSync } from "node:child_process"
const { parseFile } = (await import(path.join(ROOT, "src/ast/pool-worker"))) as any
const wts: any = await import(path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.js"))
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const lang: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-graphql.wasm")))
const parser = new P(); parser.setLanguage(lang)
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const files: Array<{abs:string,dir:string,rel:string,repo:string}> = []
for (const e of fs.readdirSync(CR)) {
  const dir = path.join(CR, e)
  try { execFileSync("git",["-C",dir,"rev-parse","--git-dir"],{stdio:"ignore"}) } catch { continue }
  let tracked: string[]
  try { tracked = execFileSync("git",["-C",dir,"ls-files","-z"],{encoding:"utf8",maxBuffer:512*1024*1024}).split("\0").filter(Boolean) } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    try { if (fs.statSync(abs).size > 512*1024) continue } catch { continue }
    if (!/\.(graphql|gql)$/.test(abs)) continue
    files.push({abs,dir,rel,repo:e})
  }
}
// A named type is `Type > NamedType > Name`, and a `[ID!]` wrapper puts the NamedType
// on a DESCENDANT `Type`, so the search goes DOWN the wrapper chain. It used to walk
// up, which found nothing and reported all 7,890 production edges as fabricated — a
// reminder that a checker which cannot see anything will accuse the code.
const WRAP=new Set(["Type","NamedType","NonNullType","ListType"])
// The wrapper chain is `Type > NonNullType > ListType > Type > NonNullType > NamedType > Name`,
// so the descent walks WRAPPER nodes, not `Type` nodes. An earlier version walked up
// and then walked `Type` children only; both found nothing and reported all 7,890
// production edges as fabricated, which is what a checker that cannot see anything does.
const nameOf=(n:any):string|undefined=>{
  let c:any=n, guard=0
  // The guard was 16 hops, which is shorter than `d: [[[[[Int!]!]!]!]!]!` in
  // hasura 0038_wrapped_named_types.graphql — a five-deep list needs ~17. The two edges
  // that tripped it were then reported as FABRICATED, which is the accusation a bounded
  // checker makes when it runs out of road.
  while(c && guard++<64){
    if(c.type==="NamedType"){ const nm=c.namedChildren?.find((x:any)=>x.type==="Name"); return nm&&!nm.isMissing&&nm.text?nm.text:undefined }
    const next=c.namedChildren?.find((x:any)=>WRAP.has(x.type))
    if(!next) return undefined
    c=next
  }
  return undefined
}
const A=new Set<string>(), reasons=new Map<string,number>()
const B=new Set<string>()
/** Declarations whose owner sits above a parse ERROR: counted, not asserted. */
let underParseError=0
const ownerUnderError=(n:any):boolean=>{ let d:any=n?.parent; while(d){ if(d.type==="ERROR"||d.isMissing) return true; d=d.parent } return false }

/**
 * Set A is STAGED per file and merged only for files production actually finished.
 *
 * This gate's own sidecar comment below already draws the distinction that matters —
 * "a lost edge caused by an analyzer defect from one caused by a file production never
 * finished" — and then the code did not draw it: `parseFile` throwing skipped the file
 * from BOTH sets, but a file whose production parse was cut short WITHOUT throwing left
 * its tree-derived rows in set A and nothing in set B, and every one of them was reported
 * as a LOST EDGE, which is a claim about the analyzer.
 *
 * Measured, and it is not hypothetical. A run of this gate on the 1,905-file corpus
 * reported `NON-ZERO — 0 fabricated, 39 lost`, and all 39 sat in **two** files — the same
 * run logged `[BB-HANG] parser stuck 120s` on one of them. Re-parsed each in isolation
 * through the same production entry point:
 *
 *   PageConnection…Builds_Schema.graphql  1,594 ms  0 errors  32 symbols  25 references
 *   gql-graphql-core schema_kitchen_sink   1,790 ms  6 errors  57 symbols  41 references
 *
 * and every one of the 12 example triples the gate printed as lost was present with the
 * exact source, target and line it said was missing. The analyzer emitted all 39. They
 * were lost by the WALK, under a machine running ten lanes, not by the extraction.
 *
 * So the excluded files are counted and NAMED rather than folded into `lost`, and the
 * subtraction only ever compares files both sides saw.
 */
const staged=new Map<string,string[]>()
const outcome=new Map<string,{ok:boolean;prod:number;err?:string}>()
let idx=0
async function worker(){
  while(true){
    const i=idx++; if(i>=files.length) return
    const f=files[i]; const lab=`${f.repo}/${f.rel}`
    // --- SET B: production
    let r:any; try{ r=await parseFile(f.abs,f.dir) }catch(e:any){ outcome.set(lab,{ok:false,prod:0,err:`threw: ${e?.message??e}`}); continue }
    if(!r||!Array.isArray(r.relationships)){ outcome.set(lab,{ok:false,prod:0,err:"no relationships array"}); continue }
    for(const x of r.relationships??[]){
      if(String(x.type)!=="references") continue
      B.add(`${lab}|${x.source}|${x.target}|${Number(x.line_number??0)}`)
    }
    outcome.set(lab,{ok:true,prod:(r.relationships??[]).filter((x:any)=>String(x.type)==="references").length})
    staged.set(lab,[])
    // --- SET A: from the tree
    const t=parser.parse(fs.readFileSync(f.abs,"utf8")); if(!t) continue
    const ownerOf=(declNode:any):string|undefined=>{
      let d=declNode.parent
      // The chain is FieldDefinition > FieldsDefinition > ObjectTypeDefinition, so the
      // owner is one of the DEFINITION nodes themselves — `TypeDefinition` is the
      // wrapper above them and never the direct parent.
      // The `*Extension` nodes are in this set for a measured reason: an `extend type X { a: Int }`
      // block declares members exactly as a definition does, and the analyzer publishes
      // them (REVIEW.md finding C1 — "every `extend` member was dropped" — was fixed and
      // pinned at 12/12). Leaving them out made the last 8 emitted edges look fabricated,
      // and all 8 were in extension blocks.
      const DEFS=new Set(["ObjectTypeDefinition","InterfaceTypeDefinition","InputObjectTypeDefinition","EnumTypeDefinition","UnionTypeDefinition","ScalarTypeDefinition","DirectiveDefinition","SchemaDefinition","ObjectTypeExtension","InterfaceTypeExtension","InputObjectTypeExtension","EnumTypeExtension","UnionTypeExtension","ScalarTypeExtension","SchemaExtension"])
      // STOP at a parse ERROR rather than attributing what is under it to the healthy
      // definition above. This is the fifth correction on this probe's side, and the
      // first four each accused the analyzer of fabricating edges that were real, so
      // the prior is worth stating: the probe's tree walker, not the analyzer, was
      // wrong again — and the reason it was wrong is a real GRAMMAR GAP.
      //
      // A directive application on a directive DEFINITION's argument is not supported:
      //   directive @foo(arg: String! @tag(name: "x")) @tag(name: "y") on QUERY
      // parses with an ERROR node swallowing `@foo(arg: String! @tag(name: "x"))`, and
      // the parser then reads the APPLIED `@tag(name: "y") on QUERY` as the definition's
      // own name, arguments and locations. The tree therefore genuinely says the
      // DirectiveDefinition is named `tag` — and this walker, climbing from the `arg`
      // inside the ERROR, attributed `arg: String!` to it and derived `@tag -> String @40`,
      // a row the analyzer correctly refused to publish. It refused because the tree's
      // OWN `ArgumentsDefinition` has a `Type` node with MISSING text, which is exactly
      // the guard REVIEW.md finding B2 added for that case.
      //
      // The analyzer publishing a symbol named `@tag` here is not a fabricated identity
      // either: `firstChildOfType(node, "Name")` returns `tag` because `tag` IS the
      // first direct `Name` child of the node the grammar produced. The parse is damaged;
      // the reader is faithful. Measured: 5 rows, all of them a directive definition's
      // argument type in a document that applies a directive to that argument.
      while(d){
        if(d.type==="ERROR"||d.isMissing) return undefined
        if(DEFS.has(d.type)){ const nm=d.namedChildren?.find((x:any)=>x.type==="Name"); return nm&&!nm.isMissing&&nm.text?nm.text:undefined }
        d=d.parent
      }
      return undefined
    }
    const v=(n:any)=>{
      if(n.type==="FieldDefinition"||n.type==="InputValueDefinition"||n.type==="VariableDefinition"||n.type==="Argument"){
        // the declared type is this node's own Type child (not an argument's default)
        const ty=n.namedChildren?.find((c:any)=>c.type==="Type")
        if(ty){
          const target=nameOf(ty)
          // 1-based, on the `NamedType` that NAMES the fact. That is the lane's stated
          // rule for a type reference (REVIEW.md §D: "the NamedType of a type
          // reference"), and it is not the member's own Name: in github-schema.graphql
          // `avatarUrl` is on line 43, its `size: Int` argument on 47, and its `): URI!`
          // return type on 48, so the field-return-type edge is 48. Using the member's
          // Name here made 2,446 edges look lost and 3,117 look fabricated, which is
          // what two checkers that disagree about a convention look like.
          let nt:any=ty, g=0
          while(nt && g++<64){ if(nt.type==="NamedType") break; nt=nt.namedChildren?.find((x:any)=>WRAP.has(x.type)) }
          const line=(nt??ty).startPosition.row+1
          if(!target){ const k=`no-resolvable-name:${n.type}`; reasons.set(k,(reasons.get(k)??0)+1) }
          else {
            let source:string|undefined
            // A FIELD ARGUMENT's type is attributed to the FIELD symbol, not to an
            // argument symbol: arguments are published as the field's `parameters`
            // metadata and no argument symbol exists to own it. `ownerOf` walks out to
            // the type, so for an argument the anchor is the enclosing FieldDefinition
            // and the emitted source is `Type.field`. Verified against
            // github-schema.graphql, where the emitted edge is `Actor.avatarUrl -> Int`
            // at line 47 — the argument's own NamedType line — not `Actor.size -> Int`.
            if(n.type==="FieldDefinition") source=ownerOf(n)?`${ownerOf(n)}.${n.namedChildren?.find((c:any)=>c.type==="Name")?.text}`:undefined
            else if(n.type==="InputValueDefinition"){
              let owner=ownerOf(n)
              // walk out to the enclosing FieldDefinition when there is one
              // A DIRECTIVE DEFINITION's argument is also an `InputValueDefinition`, and
              // the analyzer attributes its type to the directive symbol `@name` — not to
              // `name.arg`. That spelling difference accounted for ALL 40 residual rows
              // before it was encoded here. Both spellings name the same fact and both
              // keep the argument in `metadata.argument`; only one was written down here.
              let a:any=n.parent, enclosing:any=undefined, inDirective=false
              while(a){ if(a.type==="FieldDefinition"){ enclosing=a; break } if(a.type==="DirectiveDefinition"){ inDirective=true; break } if(a.type==="InputObjectTypeDefinition") break; a=a.parent }
              if(inDirective){ source=owner?`@${owner}`:undefined; }
              else if(enclosing){
                const fname=enclosing.namedChildren?.find((c:any)=>c.type==="Name")?.text
                source=owner&&fname?`${owner}.${fname}`:undefined
              } else source=owner?`${owner}.${n.namedChildren?.find((c:any)=>c.type==="Name")?.text}`:undefined
            }
            else if(n.type==="VariableDefinition") source=`$${n.namedChildren?.find((c:any)=>c.type==="Variable")?.text?.replace(/^\$/,"")}`
            // A DIRECTIVE DEFINITION's argument type is attributed to the DIRECTIVE
            // symbol `@name`, not to `name.arg`, and `metadata.argument` carries which
            // argument. Same reason as a field argument — no argument symbol exists —
            // but a different spelling, and it accounted for ALL 40 residual rows
            // (23 emitted-not-derived + 17 derived-not-emitted) before it was encoded
            // here. Both spellings were correct; only one of them was written down.
            else source=`@${ownerOf(n)}`
            if(!source){ const k=`no-source:${n.type}`; reasons.set(k,(reasons.get(k)??0)+1); if(ownerUnderError(n)) underParseError++ }            else staged.get(lab)!.push(`${lab}|${source}|${target}|${line}`)
          }
        }
      }
      for(let i2=0;i2<n.childCount;i2++) v(n.child(i2))
    }
    v(t.rootNode); t.delete?.()
  }
}
await Promise.all(Array.from({length:8},()=>worker()))
// Merge set A only for files production FINISHED with references of its own. An
// unfinished file contributes to neither side, and is reported by name rather than
// silently narrowing the count.
//
// `production returned a result but NO references` is the same failure wearing a
// success: the pool loses the file, the caller gets an empty relationship list, and
// nothing throws. `parseFile` never threw on any of the 1,905 files, so a `catch`-
// based guard catches none of this. Measured on the corpus:
//
//   filesWalked                            1,905
//   excluded, production did not finish         0
//   returned a result with NO references        2
//   lost edges attributed to those two      634 of 639
//
// and the two are `introspection.graphql` (632 lost) and
// `kitchen-sink-nullability.graphql` (2 lost). The 632 is EXACT: re-parsed alone
// through the same production entry point, `introspection.graphql` yields 632
// `references` in 637 symbols — every edge the gate called lost. It is the file the
// same run logged `[BB-HANG] parser stuck 120s` on. The lost count is also not stable
// between runs on the same corpus and the same analyzer: **39 in one run, 639 in the
// next**, because which files hang is a function of machine load, and ten lanes share
// this machine. A count that moves by 16x with no code change is a count about the
// walk, and reporting it as lost edges is a claim about the analyzer.
const excludedFiles: Array<{file:string;reason:string}>=[]
const noRefs: string[]=[]
for(const [lab,o] of outcome) if(!o.ok) excludedFiles.push({file:lab,reason:o.err??"unknown"})
for(const [lab,o] of outcome) if(o.ok&&o.prod===0&&(staged.get(lab)?.length??0)>0) noRefs.push(lab)
for(const [lab,rows] of staged) if(!noRefs.includes(lab)) for(const x of rows) A.add(x)
const emptyFromProduction=noRefs
const fabricated=[...B].filter(x=>!A.has(x))
const lost=[...A].filter(x=>!B.has(x))
/**
 * The FULL lost set, and a per-file histogram of it, in a SIDECAR.
 *
 * The artifact keeps `lostExamples` capped at 12, which is right for the artifact
 * and useless for diagnosis: the broadened corpus reads 639 lost edges, and 12
 * examples cannot tell a lost edge caused by an analyzer defect from one caused by
 * a file production never finished. So the whole set goes to its own file and the
 * histogram goes in the artifact, because "639 lost, spread over N files" and "639
 * lost, in one file that timed out" are different findings and only one of them is
 * about the analyzer.
 */
const fileOf = (triple: string): string => triple.slice(0, triple.indexOf("|"))
const hist = <T,>(xs: T[], key: (x: T) => string): Record<string, number> => {
  const m: Record<string, number> = {}
  for (const x of xs) { const k = key(x); m[k] = (m[k] ?? 0) + 1 }
  return Object.fromEntries(Object.entries(m).sort((a, b) => b[1] - a[1]))
}
fs.mkdirSync(OUT, { recursive: true })
fs.writeFileSync(path.join(OUT, "declared-type-roundtrip-lost.txt"), lost.concat(fabricated.map((x) => `FABRICATED ${x}`)).join("\n") + "\n")
const artifact = {
  kind: "graphql-declared-type-roundtrip",
  lane: "graphql",
  generatedAt: new Date().toISOString(),
  producedBy: "script/m14/tmp/graphql/probe/declared-type-roundtrip.mts",
  corpusRoot: CR,
  entryPoint: "src/ast/pool-worker.ts::parseFile",
  what: "SET A = every (file, source, target, line) the parse tree says a declaration writes; SET B = every such triple production parseFile emits as `references`. B\\A is a fabricated edge; A\\B is a lost edge. Deduped as the store dedups, on (source, target, type, line).",
  setAFromTree: A.size,
  setBFromProduction: B.size,
  fabricatedEdges: fabricated.length,
  fabricatedExamples: fabricated.slice(0, 12),
  lostEdges: lost.length,
  lostExamples: lost.slice(0, 12),
  treeNodesWithNoResolvableName: Object.fromEntries(reasons),
  // The population this verdict is about. `lost` counts only files BOTH sides saw, so
  // these two fields are what say how much of the corpus that is — a reader must not
  // take `lost: 0` as a claim about files the walk never finished.
  filesWalked: outcome.size,
  filesExcludedProductionUnfinished: excludedFiles.length,
  excludedExamples: excludedFiles.slice(0, 12),
  filesWithNoReferencesFromProduction: emptyFromProduction.length,
  declarationsUnderParseError: underParseError,
  emptyFromProductionExamples: emptyFromProduction.slice(0, 12),
  verdict: fabricated.length === 0 && lost.length === 0 ? "0/0 — no fabricated and no lost declared-type edge" : `NON-ZERO — ${fabricated.length} fabricated, ${lost.length} lost`,
  spellingConventions: [
    "a FIELD ARGUMENT's declared type is attributed to the FIELD symbol (Actor.avatarUrl -> Int); arguments are published as the field's `parameters` metadata and no argument symbol exists to own it",
    "a DIRECTIVE ARGUMENT's declared type is attributed to the DIRECTIVE symbol (@example -> Boolean); the argument name survives in metadata.argument",
    "a member declared in an `extend type X { … }` block is published exactly as a member of a definition",
  ],
}
fs.mkdirSync(OUT, { recursive: true })
fs.writeFileSync(path.join(OUT, "declared-type-roundtrip.json"), JSON.stringify(artifact, null, 2) + "\n")
console.log(JSON.stringify(artifact, null, 1))
console.log(fabricated.length === 0 && lost.length === 0 ? "\nPASS — the R9 relabel moved labels, not facts" : "\nFAIL — see fabricatedExamples / lostExamples")
console.log(`population: ${outcome.size} files walked, ${excludedFiles.length} excluded because production did not finish them, ${emptyFromProduction.length} returned a result with no references, ${underParseError} declarations sit under a parse ERROR`)
for(const e of excludedFiles.slice(0,6)) console.log(`  excluded ${e.file} — ${e.reason}`)
process.exitCode = fabricated.length === 0 && lost.length === 0 ? 0 : 1

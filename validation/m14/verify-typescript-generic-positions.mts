import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import ts from "typescript"

const mutation = process.argv.find(arg => arg.startsWith('--mutate='))?.split('=')[1]
if (mutation) Bun.plugin({name:'ts-generic-control',setup(build) {
  build.onLoad({filter:/real-typescript-analyzer\.ts$/},({path})=>{
    let source = readFileSync(path,'utf8')
    const method = mutation === 'constructor' ? 'typeArgsOfNew' : 'typeArgsOfAnnotation'
    const start = source.indexOf(`  private ${method}(`)
    const end = source.indexOf('\n  }', start)
    const before = 'out.push(leaf && !this.hasEnclosingTypeParameter(c, leaf) ? leaf : null)'
    const after = mutation === 'parameter' ? 'out.push(leaf)' : 'if (leaf) out.push(leaf)'
    const body = source.slice(start, end)
    assert.ok(body.includes(before))
    source = source.slice(0,start) + body.replace(before,after) + source.slice(end)
    console.log(`APPLIED generic mutation: ${mutation}`)
    return {contents:source,loader:'ts'}
  })
}})
const {ASTEngine}=await import('../../src/ast/engine')
const {storeResults,indexProjectParallel,reindexFilesParallel}=await import('../../src/ast/parallel-indexer')
const {BrainDatabase}=await import('../../src/brain/database')
const {handler:graph}=await import('../../src/mcp/tools/bb_graph/handler')
const root=mkdtempSync('/tmp/bb-ts-generic-')
process.env.BB_DATA_DIR=mkdtempSync('/tmp/bb-ts-generic-data-')
const filePath=join(root,'generics.ts')
const source=`class Alpha { run() {} }
class Beta { run() {} }
class T { run() {} }
class Pair<T, U> { first!: T; second!: U; }
function primitiveParameter(pair: Pair<number, Beta>) { pair.second.run(); }
function primitiveLocal() { const pair: Pair<string, Beta> = new Pair(); pair.second.run(); }
function primitiveNew() { const pair = new Pair<boolean, Beta>(); pair.second.run(); }
function unknownFirst(pair: Pair<any, Beta>) { pair.first.run(); }
function unknownNew() { const pair = new Pair<any, Beta>(); pair.first.run(); }
function unionSecond(pair: Pair<Alpha | Beta, Beta>) { pair.second.run(); }
function unionFirst(pair: Pair<Alpha | Beta, Beta>) { pair.first.run(); }
function arrayFirst(pair: Pair<Alpha[], Beta>) { pair.second.run(); }
function genericFirst<T extends Alpha>(pair: Pair<T, Beta>) { pair.first.run(); }
function genericSecond<T>(pair: Pair<T, Beta>) { pair.second.run(); }
function knownFirst(pair: Pair<Alpha, Beta>) { pair.first.run(); }
function knownSecond(pair: Pair<Alpha, Beta>) { pair.second.run(); }
`
writeFileSync(filePath,source)
const program=ts.createProgram([filePath],{target:ts.ScriptTarget.ES2022,strict:true,noEmit:true,types:[]})
assert.deepEqual(ts.getPreEmitDiagnostics(program).map(d=>ts.flattenDiagnosticMessageText(d.messageText,' ')),[])
const checker=program.getTypeChecker()
const expected:Array<{line:number;source:string;owner:string|null}>=[]
const unsupported=new Set(['unionFirst','genericFirst'])
const visit=(node:ts.Node):void=>{
  if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&node.expression.name.text==='run') {
    let current:ts.Node|undefined=node.parent
    while(current&&!ts.isFunctionDeclaration(current))current=current.parent
    assert.ok(current&&ts.isFunctionDeclaration(current)&&current.name)
    const declaration=checker.getSymbolAtLocation(node.expression.name)?.valueDeclaration?.parent
    expected.push({line:node.getSourceFile().getLineAndCharacterOfPosition(node.expression.name.getStart()).line+1,
      source:current.name.text,owner:unsupported.has(current.name.text)?null:declaration&&ts.isClassDeclaration(declaration)?declaration.name?.text??null:null})
  }
  ts.forEachChild(node,visit)
}
visit(program.getSourceFile(filePath)!)
const parsed=await ASTEngine.parseFile(filePath,source)
assert.deepEqual(parsed.errors,[])
assert.deepEqual(parsed.relationships.filter(r=>r.type==='calls'&&r.target==='run')
  .map(r=>({line:r.line_number,source:r.source,owner:r.metadata?.owner??null})).sort((a,b)=>a.line!-b.line!),expected)
const project='ts-generic-bindings'
const logger={log(){},write(){}}
const worker=process.argv.includes('--require-worker')
if(worker) {
  const result=await indexProjectParallel(project,root,{logger})
  assert.equal(result.summary?.parseMode,'worker-pool')
  assert.equal(result.successFiles,1)
} else {
  const stat=statSync(filePath)
  assert.equal((await storeResults(project,root,[{...parsed,filePath,success:true,fileHash:createHash('sha256').update(source).digest('hex').slice(0,16),sizeBytes:stat.size,lastModified:stat.mtimeMs}])).rolledBackFiles,0)
}
const db=await BrainDatabase.getRawInstance(project)
const rows=()=>db.prepare(`SELECT r.line_number AS line, s.name AS source, owner.name AS owner FROM brain_relationship r
 JOIN brain_symbol s ON s.id=r.source_symbol_id LEFT JOIN brain_symbol t ON t.id=r.target_symbol_id
 LEFT JOIN brain_symbol owner ON owner.id=t.owner_symbol_id
 WHERE r.project_id=? AND r.relationship_type='calls' AND r.target_external='run' ORDER BY line`).all(project)
assert.deepEqual(rows(),expected)
const response=await graph({symbol:'Beta',file:'generics.ts',direction:'callers',maxDepth:1,relationshipTypes:['calls'],refresh:false},
  {projectId:project,projectPath:root} as Parameters<typeof graph>[1])
assert.ok(!response.isError,JSON.stringify(response.content))
assert.equal(JSON.parse((response.content[0] as {text:string}).text).callers.length,expected.filter(row=>row.owner==='Beta').length)
if(worker) {
  writeFileSync(filePath,source.replaceAll(', Beta>', ', Alpha>'))
  assert.equal((await reindexFilesParallel(project,root,[{path:filePath,type:'modified'}],{logger})).errors,0)
  assert.deepEqual(rows(),expected.map(row=>row.owner==='Beta'?{...row,owner:'Alpha'}:row))
  writeFileSync(filePath,source)
  assert.equal((await reindexFilesParallel(project,root,[{path:filePath,type:'modified'}],{logger})).errors,0)
  assert.deepEqual(rows(),expected)
}
console.log(JSON.stringify({passed:true,compiler:ts.version,sites:expected.length,unsupported:[...unsupported],worker}))
process.exit(0)

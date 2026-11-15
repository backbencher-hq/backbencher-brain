import assert from "node:assert/strict"
import {createHash} from "node:crypto"
import {mkdtempSync,readFileSync,statSync,writeFileSync} from "node:fs"
import {join} from "node:path"
import ts from "typescript"

if (process.env.BB_TS_BASELINE_SOURCE) Bun.plugin({name:'ts-baseline',setup(build) {
  build.onLoad({filter:/real-typescript-analyzer\.ts$/},()=>({contents:readFileSync(process.env.BB_TS_BASELINE_SOURCE!,'utf8'),loader:'ts'}))
}})

if (process.argv.includes('--mutate')) Bun.plugin({name:'ts-receiver-scope-control',setup(build) {
  build.onLoad({filter:/real-typescript-analyzer\.ts$/},({path})=>{
    const source=readFileSync(path,'utf8')
    const before='if (facts.localsByScope.get(s)?.has(name)) return values.get(s)?.get(name)'
    assert.ok(source.includes(before))
    console.log('APPLIED receiver scope mutation')
    return {contents:source.replace(before,'for (const scopeValues of values.values()) if (scopeValues.has(name)) return scopeValues.get(name)'),loader:'ts'}
  })
}})
if (process.argv.includes('--mutate-storage')) Bun.plugin({name:'ts-receiver-storage-control',setup(build) {
  build.onLoad({filter:/member-owner-resolution\.ts$/},({path})=>{
    const source=readFileSync(path,'utf8')
    const before='metadata.typescriptUnresolvedReceiver !== true'
    assert.ok(source.includes(before))
    console.log('APPLIED receiver storage mutation')
    return {contents:source.replace(before,'true'),loader:'ts'}
  })
}})
const {ASTEngine}=await import('../../src/ast/engine')
const {storeResults,indexProjectParallel,reindexFilesParallel}=await import('../../src/ast/parallel-indexer')
const {BrainDatabase}=await import('../../src/brain/database')
const {handler:graph}=await import('../../src/mcp/tools/bb_graph/handler')
const root=mkdtempSync('/tmp/bb-ts-receiver-scopes-')
process.env.BB_DATA_DIR=mkdtempSync('/tmp/bb-ts-receiver-scopes-data-')
const filePath=join(root,'receivers.ts')
const source=`class Alpha { run() {} }
class Beta { run() {} }
class Box<T> { worker: T; constructor(worker: T) { this.worker = worker; } }
const items: Alpha[] = [];
const item = new Alpha();
function arrayAlpha(items: Alpha[]) { items[0].run(); }
function arrayBeta(items: Beta[]) { items[0].run(); }
function arrayUnknown(items: any) { items[0].run(); }
function outerArray() { items[0].run(); }
function nestedArray(items: Alpha[]) {
  { const items: Beta[] = []; items[0].run(); }
  items[0].run();
}
function genericAlpha(box: Box<Alpha>) { box.worker.run(); }
function genericBeta(box: Box<Beta>) { box.worker.run(); }
function genericUnknown(box: any) { box.worker.run(); }
function genericNested(box: Box<Alpha>) {
  { const box = new Box(new Beta()); box.worker.run(); }
  box.worker.run();
}
function loopAlpha(items: Alpha[]) { for (const item of items) { item.run(); } }
function loopBeta(items: Beta[]) { for (const item of items) { item.run(); } }
function loopUnknown(items: any) { for (const item of items) { item.run(); } }
function localAlpha() { const items: Alpha[] = []; items[0].run(); }
function localBeta() { const items: Beta[] = []; items[0].run(); }
function destructured({items}: {items:any}) { items[0].run(); }
function destructuredAlias({source: items}: {source:any}) { items[0].run(); }
function destructuredLocal() { const {items} = {items: [] as any}; items[0].run(); }
function genericExplicit() { const box = new Box<Beta>(new Beta()); box.worker.run(); }
`
writeFileSync(filePath,source)
const program=ts.createProgram([filePath],{target:ts.ScriptTarget.ES2022,strict:true,noEmit:true,types:[]})
assert.deepEqual(ts.getPreEmitDiagnostics(program).map(d=>ts.flattenDiagnosticMessageText(d.messageText,' ')),[])
const checker=program.getTypeChecker()
const compiler: Array<{line:number;source:string;owner:string|null}> = []
const visit=(node:ts.Node):void=>{
  if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&node.expression.name.text==='run') {
    const declaration=checker.getSymbolAtLocation(node.expression.name)?.valueDeclaration
    const owner=declaration?.parent
    let enclosing:ts.Node|undefined=node.parent
    while(enclosing&&!ts.isFunctionDeclaration(enclosing)) enclosing=enclosing.parent
    assert.ok(enclosing&&ts.isFunctionDeclaration(enclosing)&&enclosing.name)
    compiler.push({line:ts.getLineAndCharacterOfPosition(node.getSourceFile(),node.expression.name.getStart()).line+1,source:enclosing.name.text,
      owner:owner&&ts.isClassDeclaration(owner)?owner.name?.text??null:null})
  }
  ts.forEachChild(node,visit)
}
visit(program.getSourceFile(filePath)!)
const parsed=await ASTEngine.parseFile(filePath,source)
assert.deepEqual(parsed.errors,[])
const analyzer=parsed.relationships.filter(r=>r.type==='calls'&&r.target==='run')
const actual=analyzer.map(r=>({line:r.line_number,source:r.source,owner:r.metadata?.owner??null})).sort((a,b)=>a.line!-b.line!)
// Inferred generic constructor arguments are outside this syntax-only evidence.
const expected=compiler.map(row=>source.split('\n')[row.line-1].includes('new Box(new Beta())')?{...row,owner:null}:row)
assert.deepEqual(actual,expected,'receiver evidence must follow the binding selected by the compiler')
const project='ts-receiver-scopes'
if(process.argv.includes('--require-worker')) {
  const result=await indexProjectParallel(project,root,{logger:{log(){},write(){}}})
  assert.equal(result.summary?.parseMode,'worker-pool')
  assert.equal(result.successFiles,1)
} else {
  const stat=statSync(filePath)
  assert.equal((await storeResults(project,root,[{...parsed,filePath,success:true,fileHash:createHash('sha256').update(source).digest('hex').slice(0,16),sizeBytes:stat.size,lastModified:stat.mtimeMs}])).rolledBackFiles,0)
}
const db=await BrainDatabase.getRawInstance(project)
const rows=()=>db.prepare(`SELECT r.line_number AS line, source.name AS source, owner.name AS owner FROM brain_relationship r
 JOIN brain_symbol source ON source.id=r.source_symbol_id
 LEFT JOIN brain_symbol target ON target.id=r.target_symbol_id LEFT JOIN brain_symbol owner ON owner.id=target.owner_symbol_id
 WHERE r.project_id=? AND r.relationship_type='calls' AND r.target_external='run' ORDER BY line`).all(project)
assert.deepEqual(rows(),expected,'stored destinations must preserve scoped receiver evidence')
const answer=await graph({symbol:'Alpha',file:'receivers.ts',direction:'callers',maxDepth:1,relationshipTypes:['calls'],refresh:false},
  {projectId:project,projectPath:root} as Parameters<typeof graph>[1])
assert.ok(!answer.isError,JSON.stringify(answer.content))
const payload=JSON.parse((answer.content[0] as {text:string}).text)
assert.equal(payload.callers.length,expected.filter(row=>row.owner==='Alpha').length,'bb_graph must expose only the established Alpha receiver sites')
if(process.argv.includes('--require-worker')) {
  const changed=source.replace('arrayBeta(items: Beta[])','arrayBeta(items: Alpha[])')
  const line=source.split('\n').findIndex(line=>line.includes('function arrayBeta('))+1
  writeFileSync(filePath,changed)
  assert.equal((await reindexFilesParallel(project,root,[{path:filePath,type:'modified'}],{logger:{log(){},write(){}}})).errors,0)
  assert.deepEqual(rows(),expected.map(row=>row.line===line?{...row,owner:'Alpha'}:row))
  writeFileSync(filePath,source)
  assert.equal((await reindexFilesParallel(project,root,[{path:filePath,type:'modified'}],{logger:{log(){},write(){}}})).errors,0)
  assert.deepEqual(rows(),expected)
}
console.log(JSON.stringify({passed:true,compiler:ts.version,sites:expected.length,worker:process.argv.includes('--require-worker')}))
process.exit(0)

import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import ts from "typescript"

const baseline = process.env.BB_TS_BASELINE_SOURCE
const mutation = process.argv.find(arg => arg.startsWith('--mutate='))?.split('=')[1]
if (baseline || mutation) Bun.plugin({name:'ts-destructured-control',setup(build) {
  build.onLoad({filter:/real-typescript-analyzer\.ts$/},({path}) => {
    if (baseline) return {contents:readFileSync(baseline,'utf8'),loader:'ts'}
    const changes:Record<string,[string,string]> = {
      pattern: ['visitPattern(declaration?.childForFieldName("name") ?? null, declaration?.childForFieldName("value") ?? null, value.text, [], path)', 'void declaration'],
      key: ['if (key === path[0]) visitOrigin', 'if (true) visitOrigin'],
      array: ['if (index === Number(path[0])) visitOrigin', 'if (true) visitOrigin'],
      projection: ['const owner = hint ? topLevelClasses.get(hint.type) : null\n        if (owner && path.length === 0)', 'const owner = hint ? topLevelClasses.get(hint.type) : null\n        if (owner)'],
      defaults: ['visitPattern(left, pattern.childForFieldName("right"), target, [], tail)', 'void left'],
      assignments: ['visitPattern(write.childForFieldName("left"), write.childForFieldName("right"), value.text, [], path)', 'void write'],
    }
    assert.ok(mutation && mutation in changes)
    const [before,after] = changes[mutation]
    const source = readFileSync(path,'utf8')
    assert.equal(source.split(before).length,2,`unique mutation anchor: ${mutation}`)
    console.log(`APPLIED destructured mutation: ${mutation}`)
    return {contents:source.replace(before,after),loader:'ts'}
  })
}})
const {ASTEngine}=await import('../../src/ast/engine')
const {storeResults,indexProjectParallel,reindexFilesParallel}=await import('../../src/ast/parallel-indexer')
const {BrainDatabase}=await import('../../src/brain/database')
const {handler:graph}=await import('../../src/mcp/tools/bb_graph/handler')
const root=mkdtempSync('/tmp/bb-ts-destructured-aliases-')
process.env.BB_DATA_DIR=mkdtempSync('/tmp/bb-ts-destructured-aliases-data-')
const filePath=join(root,'destructured-aliases.ts')
const source=`class Alpha { run() {} }
class Beta { run() {} }
class ObjectAlias { item=new Alpha(); readObject() { this.item.run(); } }
function objectWrite(holder:ObjectAlias,input:any) { const {held:alias}={held:holder}; alias.item=input; holder.item.run(); }
class Short { item=new Alpha(); readShort() { this.item.run(); } }
function shortWrite(holder:Short,input:any) { const {holder:alias}={holder}; alias.item=input; holder.item.run(); }
class ArrayAlias { item=new Alpha(); readArray() { this.item.run(); } }
function arrayWrite(holder:ArrayAlias,input:any) { const [alias]=[holder]; alias.item=input; holder.item.run(); }
class PositionSafe { item=new Alpha(); readPositionSafe() { this.item.run(); } }
class PositionTarget { item=new Beta(); readPositionTarget() { this.item.run(); } }
function positionWrite(safe:PositionSafe,holder:PositionTarget,input:any) { const [,alias]=[safe,holder]; alias.item=input; safe.item.run(); holder.item.run(); }
class Nested { item=new Alpha(); readNested() { this.item.run(); } }
function nestedWrite(holder:Nested,input:any) { const {box:{held:alias}}={box:{held:holder}}; alias.item=input; holder.item.run(); }
class Container { item=new Alpha(); readContainer() { this.item.run(); } }
function containerWrite(holder:Container,input:any) { const box={held:holder}; const {held:alias}=box; alias.item=input; holder.item.run(); }
class Assigned { item=new Alpha(); readAssigned() { this.item.run(); } }
function assignedWrite(holder:Assigned,input:any) { let alias:any; ({held:alias}={held:holder}); alias.item=input; holder.item.run(); }
class AssignedArray { item=new Alpha(); readAssignedArray() { this.item.run(); } }
function assignedArrayWrite(holder:AssignedArray,input:any) { let alias:any; [alias]=[holder]; alias.item=input; holder.item.run(); }
class DefaultAlias { item=new Alpha(); readDefault() { this.item.run(); } }
function defaultWrite(holder:DefaultAlias,input:any) { const {held:alias=holder}: {held?:DefaultAlias}={}; alias.item=input; holder.item.run(); }
class RestSafe { item=new Alpha(); readRestSafe() { this.item.run(); } }
function restSafe(holder:RestSafe,input:any) { const {...alias}=holder; alias.item=input; holder.item.run(); }
class KeySafe { item=new Alpha(); readKeySafe() { this.item.run(); } }
class KeyTarget { item=new Beta(); readKeyTarget() { this.item.run(); } }
function keyWrite(safe:KeySafe,holder:KeyTarget,input:any) { const {held:alias,other:ignored}={other:safe,held:holder}; alias.item=input; safe.item.run(); holder.item.run(); }
class Property { item=new Alpha(); readProperty() { this.item.run(); } }
function propertyWrite(holder:Property,input:any) { const box={held:holder}; const alias=box.held; alias.item=input; holder.item.run(); }
class Quoted { item=new Alpha(); readQuoted() { this.item.run(); } }
function quotedWrite(holder:Quoted,input:any) { const {'held':alias}={'held':holder}; alias.item=input; holder.item.run(); }
class Hole { item=new Alpha(); readHole() { this.item.run(); } }
function holeWrite(holder:Hole,input:any) { const [,alias]=[,holder]; alias!.item=input; holder.item.run(); }
class ShadowSafe { item=new Alpha(); readShadowSafe() { this.item.run(); } }
function shadowSafe(holder:ShadowSafe,input:any) { const box={held:holder}; { const box={held:{item:input}}; const {held:alias}=box; alias.item=input; } holder.item.run(); }
class Typed { item:Alpha=new Alpha(); readTyped() { this.item.run(); } }
function typedWrite(holder:Typed,input:any) { const {held:alias}={held:holder}; alias.item=input; holder.item.run(); }
class Indexed { item=new Alpha(); readIndexed() { this.item.run(); } }
function indexedWrite(holder:Indexed,input:any) { const box=[holder]; const alias=box[0]; alias.item=input; holder.item.run(); }
class Computed { item=new Alpha(); readComputed() { this.item.run(); } }
function computedWrite(holder:Computed,input:any) { const {['held']:alias}={['held']:holder}; alias.item=input; holder.item.run(); }
class ShortDefault { item=new Alpha(); readShortDefault() { this.item.run(); } }
function shortDefaultWrite(holder:ShortDefault,input:any) { const {alias=holder}:{alias?:ShortDefault}={}; alias.item=input; holder.item.run(); }
class ArrayDefault { item=new Alpha(); readArrayDefault() { this.item.run(); } }
function arrayDefaultWrite(holder:ArrayDefault,input:any) { const [alias=holder]:Array<ArrayDefault|undefined>=[]; alias.item=input; holder.item.run(); }
class Spread { item=new Alpha(); readSpread() { this.item.run(); } }
function spreadWrite(holder:Spread,input:any) { const {held:alias}={...{held:holder}}; alias.item=input; holder.item.run(); }
class Recursive { item=new Alpha(); readRecursive() { this.item.run(); } }
function recursiveWrite(holder:Recursive,input:any) { let box:any={held:holder}; const original=box; box=box.next; const {held:alias}=original; alias.item=input; holder.item.run(); }
class ProjectionSafe { item=new Alpha(); readProjectionSafe() { this.item.run(); } }
function projectionSafe(holder:ProjectionSafe,input:any) { const {item:alias}=holder; (alias as any).item=input; holder.item.run(); }
`
writeFileSync(filePath,source)
const program=ts.createProgram([filePath],{target:ts.ScriptTarget.ES2022,strict:true,noEmit:true,types:[]})
assert.deepEqual(ts.getPreEmitDiagnostics(program).map(d=>ts.flattenDiagnosticMessageText(d.messageText,' ')),[])
const checker=program.getTypeChecker()
const expected:Array<{line:number;site:number;source:string;owner:string|null}>=[]
const supported=new Set(['readPositionSafe','readRestSafe','restSafe','readKeySafe','readShadowSafe','shadowSafe','readTyped','typedWrite','readProjectionSafe','projectionSafe'])
const unsupported=new Set(['readObject','objectWrite','readShort','shortWrite','readArray','arrayWrite','readPositionTarget','readNested','nestedWrite','readContainer','containerWrite','readAssigned','assignedWrite','readAssignedArray','assignedArrayWrite','readDefault','defaultWrite','readKeyTarget','readProperty','propertyWrite','readQuoted','quotedWrite','readHole','holeWrite','readIndexed','indexedWrite','readComputed','computedWrite','readShortDefault','shortDefaultWrite','readArrayDefault','arrayDefaultWrite','readSpread','spreadWrite','readRecursive','recursiveWrite'])
const visit=(node:ts.Node):void=>{
  if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&node.expression.name.text==='run') {
    let current:ts.Node|undefined=node.parent
    while(current&&!ts.isFunctionDeclaration(current)&&!ts.isMethodDeclaration(current))current=current.parent
    assert.ok(current&&(ts.isFunctionDeclaration(current)||ts.isMethodDeclaration(current))&&current.name&&ts.isIdentifier(current.name))
    assert.ok(supported.has(current.name.text) || unsupported.has(current.name.text) || ['positionWrite','keyWrite'].includes(current.name.text))
    const declaration=checker.getSymbolAtLocation(node.expression.name)?.valueDeclaration?.parent
    expected.push({site:node.getStart(),line:node.getSourceFile().getLineAndCharacterOfPosition(node.expression.name.getStart()).line+1,
      source:current.name.text,owner:(unsupported.has(current.name.text)||(['positionWrite','keyWrite'].includes(current.name.text)&&node.expression.expression.getText()!=='safe.item'))?null:declaration&&ts.isClassDeclaration(declaration)?declaration.name?.text??null:null})
  }
  ts.forEachChild(node,visit)
}
visit(program.getSourceFile(filePath)!)
// Execute separate copies to distinguish static reference evidence from runtime dispatch.
const runtimePath=join(mkdtempSync('/tmp/bb-ts-destructured-runtime-'),'runtime.mjs')
const executable='export const trace: string[] = [];\n'+source
  .replace('class Alpha { run() {} }', 'class Alpha { run() { trace.push("Alpha"); } }')
  .replace('class Beta { run() {} }', 'class Beta { run() { trace.push("Beta"); } }')
  .replace(/^class /gm,'export class ').replace(/^function /gm,'export function ')
writeFileSync(runtimePath,ts.transpileModule(executable,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText)
const runtime=await import(runtimePath)
const scenarios:Array<[string,()=>void,string[]]>=[
  ['object',()=>runtime.objectWrite(new runtime.ObjectAlias(),new runtime.Beta()),['Beta']],
  ['shorthand',()=>runtime.shortWrite(new runtime.Short(),new runtime.Beta()),['Beta']],
  ['array',()=>runtime.arrayWrite(new runtime.ArrayAlias(),new runtime.Beta()),['Beta']],
  ['array position',()=>runtime.positionWrite(new runtime.PositionSafe(),new runtime.PositionTarget(),new runtime.Alpha()),['Alpha','Alpha']],
  ['nested',()=>runtime.nestedWrite(new runtime.Nested(),new runtime.Beta()),['Beta']],
  ['container',()=>runtime.containerWrite(new runtime.Container(),new runtime.Beta()),['Beta']],
  ['assignment',()=>runtime.assignedWrite(new runtime.Assigned(),new runtime.Beta()),['Beta']],
  ['array assignment',()=>runtime.assignedArrayWrite(new runtime.AssignedArray(),new runtime.Beta()),['Beta']],
  ['default',()=>runtime.defaultWrite(new runtime.DefaultAlias(),new runtime.Beta()),['Beta']],
  ['rest copy control',()=>runtime.restSafe(new runtime.RestSafe(),new runtime.Beta()),['Alpha']],
  ['key control',()=>runtime.keyWrite(new runtime.KeySafe(),new runtime.KeyTarget(),new runtime.Alpha()),['Alpha','Alpha']],
  ['property',()=>runtime.propertyWrite(new runtime.Property(),new runtime.Beta()),['Beta']],
  ['quoted key',()=>runtime.quotedWrite(new runtime.Quoted(),new runtime.Beta()),['Beta']],
  ['array hole',()=>runtime.holeWrite(new runtime.Hole(),new runtime.Beta()),['Beta']],
  ['lexical shadow',()=>runtime.shadowSafe(new runtime.ShadowSafe(),new runtime.Beta()),['Alpha']],
  ['indexed',()=>runtime.indexedWrite(new runtime.Indexed(),new runtime.Beta()),['Beta']],
  ['computed key',()=>runtime.computedWrite(new runtime.Computed(),new runtime.Beta()),['Beta']],
  ['shorthand default',()=>runtime.shortDefaultWrite(new runtime.ShortDefault(),new runtime.Beta()),['Beta']],
  ['array default',()=>runtime.arrayDefaultWrite(new runtime.ArrayDefault(),new runtime.Beta()),['Beta']],
  ['object spread',()=>runtime.spreadWrite(new runtime.Spread(),new runtime.Beta()),['Beta']],
  ['recursive origin',()=>runtime.recursiveWrite(new runtime.Recursive(),new runtime.Beta()),['Beta']],
  ['projection control',()=>runtime.projectionSafe(new runtime.ProjectionSafe(),new runtime.Beta()),['Alpha']],
  ['annotation',()=>runtime.typedWrite(new runtime.Typed(),new runtime.Beta()),['Beta']],
]
for(const [name,run,trace] of scenarios) {
  runtime.trace.length=0;run();assert.deepEqual(runtime.trace,trace,name)
}
const parsed=await ASTEngine.parseFile(filePath,source)
assert.deepEqual(parsed.errors,[])
assert.deepEqual(parsed.relationships.filter(r=>r.type==='calls'&&r.target==='run')
  .map(r=>({site:r.metadata?.callSiteStartIndex,line:r.line_number,source:r.source,owner:r.metadata?.owner??null})).sort((a,b)=>Number(a.site)-Number(b.site)),expected)
const project='ts-destructured-aliases'
const logger={log(){},write(){}}
const worker=process.argv.includes('--require-worker')
if(worker) {
  const result=await indexProjectParallel(project,root,{logger})
  assert.equal(result.summary?.parseMode,'worker-pool')
  assert.equal(result.successFiles,1)
} else {
  // Repeated delivery of one AST edge must remain idempotent, unlike distinct sites.
  parsed.relationships.push({...parsed.relationships.find(row=>row.type==='calls'&&row.target==='run')!})
  const stat=statSync(filePath)
  assert.equal((await storeResults(project,root,[{...parsed,filePath,success:true,fileHash:createHash('sha256').update(source).digest('hex').slice(0,16),sizeBytes:stat.size,lastModified:stat.mtimeMs}])).rolledBackFiles,0)
}
const db=await BrainDatabase.getRawInstance(project)
const rows=()=>db.prepare(`SELECT json_extract(r.metadata,'$.callSiteStartIndex') AS site, r.line_number AS line, s.name AS source, owner.name AS owner FROM brain_relationship r
 JOIN brain_symbol s ON s.id=r.source_symbol_id LEFT JOIN brain_symbol t ON t.id=r.target_symbol_id
 LEFT JOIN brain_symbol owner ON owner.id=t.owner_symbol_id
 WHERE r.project_id=? AND r.relationship_type='calls' AND r.target_external='run' ORDER BY site`).all(project)
assert.deepEqual(rows(),expected)
for (const owner of ['Alpha','Beta']) {
  const response=await graph({symbol:owner,file:'destructured-aliases.ts',direction:'callers',maxDepth:1,relationshipTypes:['calls'],refresh:false},
    {projectId:project,projectPath:root} as Parameters<typeof graph>[1])
  assert.ok(!response.isError,JSON.stringify(response.content))
  const payload=JSON.parse((response.content[0] as {text:string}).text)
  assert.deepEqual(payload.callers.map((edge:any)=>edge.callSiteStartIndex).sort((a:number,b:number)=>a-b),expected.filter(row=>row.owner===owner).map(row=>row.site))
}
if(worker) {
  // Removing the alias write restores the initializer evidence, then the write is restored.
  const edited=source.replace('alias.item=input; holder.item.run();', '/* removed */     holder.item.run();')
  assert.equal(edited.length,source.length)
  writeFileSync(filePath,edited)
  assert.equal((await reindexFilesParallel(project,root,[{path:filePath,type:'modified'}],{logger})).errors,0)
  assert.deepEqual(rows(),expected.map(row=>['readObject','objectWrite'].includes(row.source)?{...row,owner:'Alpha'}:row))
  writeFileSync(filePath,source)
  assert.equal((await reindexFilesParallel(project,root,[{path:filePath,type:'modified'}],{logger})).errors,0)
  assert.deepEqual(rows(),expected)
  // A leading comment shifts every site without changing its semantic endpoints.
  const prefix = '// edit\n'
  writeFileSync(filePath,prefix+source)
  assert.equal((await reindexFilesParallel(project,root,[{path:filePath,type:'modified'}],{logger})).errors,0)
  assert.deepEqual(rows(),expected.map(row=>({...row,site:row.site+prefix.length,line:row.line+1})))
  writeFileSync(filePath,source)
  assert.equal((await reindexFilesParallel(project,root,[{path:filePath,type:'modified'}],{logger})).errors,0)
  assert.deepEqual(rows(),expected)
}
console.log(JSON.stringify({passed:true,compiler:ts.version,sites:expected.length,runtimeScenarios:scenarios.length,unsupported:[...unsupported],worker}))
process.exit(0)

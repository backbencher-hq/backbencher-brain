import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import ts from "typescript"

const baseline = process.env.BB_TS_BASELINE_SOURCE
const mutation = process.argv.find(arg => arg.startsWith('--mutate='))?.split('=')[1]
if (baseline || mutation) Bun.plugin({name:'ts-inheritance-control',setup(build) {
  build.onLoad({filter:/real-typescript-analyzer\.ts$/},({path}) => {
    if (baseline) return {contents:readFileSync(baseline,'utf8'),loader:'ts'}
    const changes:Record<string,[string,string]> = {
      parent: ['if (parent) classParents.set(node.startIndex, parent.startIndex)', 'if (false && parent) classParents.set(node.startIndex, parent.startIndex)'],
      shadow: ['names?.has(name) || names?.has("*")', '(candidate === owner ? classFields.has(`${candidate}:${name}`) : names?.has(name))'],
      depth: ['current = classParents.get(current)', 'current = current === Number(offset) ? classParents.get(current) : undefined'],
      thisWrite: ['declaringField(thisOwner, field.name) ?? thisOwner', 'thisOwner'],
      externalWrite: ['declaringField(`${instanceClass.startIndex}:instance`, field.name)', '`${instanceClass.startIndex}:instance`'],
      staticWrite: ['declaringField(`${staticClass.startIndex}:static`, field.name)', '`${staticClass.startIndex}:static`'],
      parameters: ['if (name.text === "constructor") {', 'if (false) {'],
    }
    assert.ok(mutation && mutation in changes)
    const [before,after] = changes[mutation]
    const source = readFileSync(path,'utf8')
    assert.equal(source.split(before).length,2,`unique mutation anchor: ${mutation}`)
    console.log(`APPLIED inheritance mutation: ${mutation}`)
    return {contents:source.replace(before,after),loader:'ts'}
  })
}})
const {ASTEngine}=await import('../../src/ast/engine')
const {storeResults,indexProjectParallel,reindexFilesParallel}=await import('../../src/ast/parallel-indexer')
const {BrainDatabase}=await import('../../src/brain/database')
const {handler:graph}=await import('../../src/mcp/tools/bb_graph/handler')
const root=mkdtempSync('/tmp/bb-ts-inherited-fields-')
process.env.BB_DATA_DIR=mkdtempSync('/tmp/bb-ts-inherited-fields-data-')
const filePath=join(root,'inherited-fields.ts')
const source=`class Alpha { run() {} }
class Beta { run() {} }
class Base { item: Alpha = new Alpha(); static shared: Beta = new Beta(); protected guarded: Alpha = new Alpha(); }
class Child extends Base { inherited() { this.item.run(); } protectedRead() { this.guarded.run(); } static staticRead() { this.shared.run(); } }
class Grandchild extends Child { grandchild() { this.item.run(); } }
class Shadow extends Base { declare item: any; shadow() { this.item.run(); } }
class Override extends Base { override item = new Beta(); overridden() { this.item.run(); } }
class Inferred { item = new Alpha(); baseRead() { this.item.run(); } }
class Writer extends Inferred { write(input:any) { this.item=input; } inheritedWritten() { this.item.run(); } }
class OwnWriter extends Base { override item = new Beta(); ownWrite(input:any) { this.item=input; } ownWritten() { this.item.run(); } }
function externalRead(child: Child, grand: Grandchild, base: Base) { child.item.run(); grand.item.run(); base.item.run(); }
function destructured(child: Child) { const {item} = child; item.run(); }
class Generic<T> { item!: T; stable: Alpha = new Alpha(); }
class Specialized extends Generic<Beta> { genericUnknown() { this.item.run(); } genericStable() { this.stable.run(); } }
function dynamicBase() { return Base; }
class Dynamic extends dynamicBase() { dynamicUnknown() { this.item.run(); } }
namespace Names { export class Base { item: Beta = new Beta(); } }
class Qualified extends Names.Base { qualifiedUnknown() { this.item.run(); } }
class Later { item: Beta = new Beta(); }
class Forward extends Later { forward() { this.item.run(); } }
class OutsideBase { item = new Alpha(); outsideBase() { this.item.run(); } }
class OutsideChild extends OutsideBase { outsideChild() { this.item.run(); } }
function inheritedExternalWrite(holder: OutsideChild, input:any) { holder.item=input; holder.item.run(); }
class StaticBase { static item = new Alpha(); static staticBase() { this.item.run(); } item: Beta = new Beta(); }
class StaticChild extends StaticBase { static staticChild() { this.item.run(); } static write(input:any) { StaticChild.item=input; } instanceSide() { this.item.run(); } }
class ParamShadow extends Base { constructor(public item:any) { super(); } parameterUnknown() { this.item.run(); } }
class AccessBase { get item(): Alpha { return new Alpha(); } }
class AccessChild extends AccessBase { get item(): any { return new Beta(); } accessorUnknown() { this.item.run(); } }
class PrivateBase { #item = new Alpha(); privateRead() { this.#item.run(); } }
class PrivateChild extends PrivateBase { #item = new Beta(); privateChildRead() { this.#item.run(); } }
class ComputedShadow extends Base { ['item']: any = new Beta(); computedUnknown() { this.item.run(); } }
class NestedBase { item: Alpha = new Alpha(); }
function nestedFactory() { class NestedBase { item: Beta = new Beta(); } class NestedChild extends NestedBase { nestedUnknown() { this.item.run(); } } return new NestedChild(); }
class InferredStable { item = new Alpha(); }
class StableChild extends InferredStable { stableInherited() { this.item.run(); } }
class ShadowWriter extends InferredStable { override item = new Beta(); change(input:any) { this.item=input; } shadowWritten() { this.item.run(); } }
class DeclaredBase { item: Alpha = new Alpha(); }
class Reparented extends DeclaredBase { reparented() { this.item.run(); } }
`
writeFileSync(filePath,source)
const program=ts.createProgram([filePath],{target:ts.ScriptTarget.ES2022,strict:true,noEmit:true,types:[]})
assert.deepEqual(ts.getPreEmitDiagnostics(program).map(d=>ts.flattenDiagnosticMessageText(d.messageText,' ')),[])
const checker=program.getTypeChecker()
const expected:Array<{line:number;site:number;source:string;owner:string|null}>=[]
const unsupported=new Set(['shadow','baseRead','inheritedWritten','ownWritten','genericUnknown','dynamicUnknown','qualifiedUnknown','outsideBase','outsideChild','inheritedExternalWrite','staticBase','staticChild','parameterUnknown','accessorUnknown','computedUnknown','nestedUnknown','shadowWritten'])
const visit=(node:ts.Node):void=>{
  if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&node.expression.name.text==='run') {
    let current:ts.Node|undefined=node.parent
    while(current&&!ts.isFunctionDeclaration(current)&&!ts.isMethodDeclaration(current))current=current.parent
    assert.ok(current&&(ts.isFunctionDeclaration(current)||ts.isMethodDeclaration(current))&&current.name&&ts.isIdentifier(current.name))
    const declaration=checker.getSymbolAtLocation(node.expression.name)?.valueDeclaration?.parent
    expected.push({site:node.getStart(),line:node.getSourceFile().getLineAndCharacterOfPosition(node.expression.name.getStart()).line+1,
      source:current.name.text,owner:unsupported.has(current.name.text)?null:declaration&&ts.isClassDeclaration(declaration)?declaration.name?.text??null:null})
  }
  ts.forEachChild(node,visit)
}
visit(program.getSourceFile(filePath)!)
// Execute separate copies to distinguish static reference evidence from runtime dispatch.
const runtimePath=join(mkdtempSync('/tmp/bb-ts-inheritance-runtime-'),'runtime.mjs')
const executable='export const trace: string[] = [];\n'+source
  .replace('class Alpha { run() {} }', 'class Alpha { run() { trace.push("Alpha"); } }')
  .replace('class Beta { run() {} }', 'class Beta { run() { trace.push("Beta"); } }')
  .replace(/^class /gm,'export class ').replace(/^function /gm,'export function ')
writeFileSync(runtimePath,ts.transpileModule(executable,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText)
const runtime=await import(runtimePath)
const scenarios:Array<[string,()=>void,string[]]>=[
  ['child',()=>new runtime.Child().inherited(),['Alpha']],
  ['grandchild',()=>new runtime.Grandchild().grandchild(),['Alpha']],
  ['protected',()=>new runtime.Child().protectedRead(),['Alpha']],
  ['static',()=>runtime.Child.staticRead(),['Beta']],
  ['override',()=>new runtime.Override().overridden(),['Beta']],
  ['destructuring',()=>runtime.destructured(new runtime.Child()),['Alpha']],
  ['inherited write',()=>{const o=new runtime.Writer();o.write(new runtime.Beta());o.baseRead();o.inheritedWritten();},['Beta','Beta']],
  ['external write',()=>runtime.inheritedExternalWrite(new runtime.OutsideChild(),new runtime.Beta()),['Beta']],
  ['static write',()=>{runtime.StaticChild.write(new runtime.Beta());runtime.StaticChild.staticChild();new runtime.StaticChild().instanceSide();},['Beta','Beta']],
  ['parameter shadow',()=>new runtime.ParamShadow(new runtime.Beta()).parameterUnknown(),['Beta']],
  ['accessor shadow',()=>new runtime.AccessChild().accessorUnknown(),['Beta']],
  ['private identities',()=>{const o=new runtime.PrivateChild();o.privateRead();o.privateChildRead();},['Alpha','Beta']],
  ['computed shadow',()=>new runtime.ComputedShadow().computedUnknown(),['Beta']],
  ['nested binding',()=>runtime.nestedFactory().nestedUnknown(),['Beta']],
  ['distinct child field',()=>{const o=new runtime.ShadowWriter();o.change(new runtime.Alpha());o.shadowWritten();new runtime.StableChild().stableInherited();},['Alpha','Alpha']],
]
for(const [name,run,trace] of scenarios) {
  runtime.trace.length=0;run();assert.deepEqual(runtime.trace,trace,name)
}
const parsed=await ASTEngine.parseFile(filePath,source)
assert.deepEqual(parsed.errors,[])
assert.deepEqual(parsed.relationships.filter(r=>r.type==='calls'&&r.target==='run')
  .map(r=>({site:r.metadata?.callSiteStartIndex,line:r.line_number,source:r.source,owner:r.metadata?.owner??null})).sort((a,b)=>Number(a.site)-Number(b.site)),expected)
const project='ts-inherited-fields'
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
  const response=await graph({symbol:owner,file:'inherited-fields.ts',direction:'callers',maxDepth:1,relationshipTypes:['calls'],refresh:false},
    {projectId:project,projectPath:root} as Parameters<typeof graph>[1])
  assert.ok(!response.isError,JSON.stringify(response.content))
  const payload=JSON.parse((response.content[0] as {text:string}).text)
  assert.deepEqual(payload.callers.map((edge:any)=>edge.callSiteStartIndex).sort((a:number,b:number)=>a-b),expected.filter(row=>row.owner===owner).map(row=>row.site))
}
if(worker) {
  // Changing the actual parent must replace the inherited owner, then restore it.
  const edited=source.replace('extends DeclaredBase', 'extends Later')
  writeFileSync(filePath,edited)
  assert.equal((await reindexFilesParallel(project,root,[{path:filePath,type:'modified'}],{logger})).errors,0)
  assert.deepEqual(rows(),expected.map(row=>row.source==='reparented'?{...row,site:row.site+5-12,owner:'Beta'}:row))
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

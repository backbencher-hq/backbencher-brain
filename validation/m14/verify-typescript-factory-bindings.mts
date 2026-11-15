import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import ts from "typescript"

const mutation = process.argv.find(arg => arg.startsWith('--mutate='))?.split('=')[1]
if (mutation) Bun.plugin({name:'ts-factory-control',setup(build) {
  build.onLoad({filter:mutation === 'source' ? /parallel-indexer\.ts$/ : /real-typescript-analyzer\.ts$/},({path})=>{
    const changes:Record<string,[string,string]> = {
      scope: ['return lookupReceiverFact(facts, returnTypes, this.scopeIdOf(call), callee.text) ?? null', 'for (const values of returnTypes.values()) if (values.has(callee.text)) return values.get(callee.text) ?? null; return null'],
      assignment: ['for (const assignment of pendingAssignments) {', 'for (const assignment of []) {'],
      source: ['["php", "typescript"].includes(fileLang) && typeof rel.metadata?.sourceStartIndex === "number"', 'fileLang === "php" && typeof rel.metadata?.sourceStartIndex === "number"'],
    }
    const source=readFileSync(path,'utf8')
    if (mutation.startsWith('signature-')) {
      const kind=mutation.slice('signature-'.length)
      const start=source.indexOf('const RECEIVER_FUNCTION_SCOPES = new Set([')
      const end=source.indexOf('\n])',start)
      const before=source.slice(start,end)
      assert.ok(before.includes(`"${kind}"`))
      changes[mutation]=[before,before.replace(`"${kind}"`,`"disabled_${kind}"`)]
    }
    assert.ok(mutation in changes)
    const [before,after]=changes[mutation]
    assert.ok(source.includes(before))
    console.log(`APPLIED factory mutation: ${mutation}`)
    return {contents:source.replace(before,after),loader:'ts'}
  })
}})
const {ASTEngine}=await import('../../src/ast/engine')
const {storeResults,indexProjectParallel,reindexFilesParallel}=await import('../../src/ast/parallel-indexer')
const {BrainDatabase}=await import('../../src/brain/database')
const {handler:graph}=await import('../../src/mcp/tools/bb_graph/handler')
const root=mkdtempSync('/tmp/bb-ts-factories-')
process.env.BB_DATA_DIR=mkdtempSync('/tmp/bb-ts-factory-data-')
const filePath=join(root,'factories.ts')
const source=`class Alpha { run() {} }
class Beta { run() {} }
function make(): Alpha { return new Alpha(); }
function moduleFactory() { const value = make(); value.run(); }
function nestedFactory() { function make(): Beta { return new Beta(); } const value = make(); value.run(); }
function siblingFactory() { const value = make(); value.run(); }
function unknownParameter(make: any) { const value = make(); value.run(); }
function typedParameter(make: () => Beta) { const value = make(); value.run(); }
function unknownLocal(input: any) { const make = input; const value = make(); value.run(); }
function arrowFactory() { const make = (): Beta => new Beta(); const value = make(); value.run(); }
function namedExpression() { const make = function inner(): Beta { return new Beta(); }; const value = make(); value.run(); }
function beforeDeclaration() { const value = later(); value.run(); }
function later(): Beta { return new Beta(); }
interface Contract { method(make: any): void; }
type Callback = (make: any) => void;
declare function declaration(make: any): void;
type Callable = { (make: any): void; new(make: any): Alpha; };
type Constructor = new(make: any) => Alpha;
abstract class AbstractContract { abstract method(make: any): void; }
class Decoy { make(): Beta { return new Beta(); } }
function methodNamesake() { const value = make(); value.run(); }
function overload(x: string): Alpha;
function overload(x: number): Beta;
function overload(x: string | number): Alpha | Beta { return typeof x === 'string' ? new Alpha() : new Beta(); }
function unresolvedOverload() { const value = overload('x'); value.run(); }
function overwritten(input: any) { let make = (): Alpha => new Alpha(); make = input; const value = make(); value.run(); }
function blockFactory() {
  { function make(): Beta { return new Beta(); } const value = make(); value.run(); }
  const value = make(); value.run();
}
function functionType() { const make: () => Beta = () => new Beta(); const value = make(); value.run(); }
function shadowedTypeParam<T>(make: () => T) { const value: any = make(); value.run(); }
`
writeFileSync(filePath,source)
const program=ts.createProgram([filePath],{target:ts.ScriptTarget.ES2022,strict:true,noEmit:true,types:[]})
assert.deepEqual(ts.getPreEmitDiagnostics(program).map(d=>ts.flattenDiagnosticMessageText(d.messageText,' ')),[])
const checker=program.getTypeChecker()
const expected:Array<{line:number;source:string;owner:string|null}>=[]
const unsupported=new Set(['unresolvedOverload','overwritten','shadowedTypeParam'])
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
const project='ts-factory-bindings'
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
const response=await graph({symbol:'Beta',file:'factories.ts',direction:'callers',maxDepth:1,relationshipTypes:['calls'],refresh:false},
  {projectId:project,projectPath:root} as Parameters<typeof graph>[1])
assert.ok(!response.isError,JSON.stringify(response.content))
assert.equal(JSON.parse((response.content[0] as {text:string}).text).callers.length,expected.filter(row=>row.owner==='Beta').length)
if(worker) {
  writeFileSync(filePath,source.replace('function make(): Alpha { return new Alpha(); }','function make(): Beta { return new Beta(); }'))
  assert.equal((await reindexFilesParallel(project,root,[{path:filePath,type:'modified'}],{logger})).errors,0)
  assert.deepEqual(rows(),expected.map(row=>row.owner==='Alpha'?{...row,owner:'Beta'}:row))
  writeFileSync(filePath,source)
  assert.equal((await reindexFilesParallel(project,root,[{path:filePath,type:'modified'}],{logger})).errors,0)
  assert.deepEqual(rows(),expected)
}
console.log(JSON.stringify({passed:true,compiler:ts.version,sites:expected.length,unsupported:[...unsupported],worker}))
process.exit(0)

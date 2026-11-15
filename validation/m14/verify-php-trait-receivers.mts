import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"
if (process.argv.includes('--mutate')) Bun.plugin({name:'php-trait-receiver-control',setup(build) {
  build.onLoad({filter:/real-php-analyzer\.ts$/},({path}) => {
    const source=readFileSync(path,'utf8')
    const before='return current.type === "trait_declaration"'
    assert.ok(source.includes(before))
    console.log('APPLIED trait receiver mutation')
    return {contents:source.replace(before,'return false'),loader:'ts'}
  })
}})
const { ASTEngine } = await import('../../src/ast/engine')
const { storeResults, indexProjectParallel } = await import('../../src/ast/parallel-indexer')
const { BrainDatabase } = await import('../../src/brain/database')
const root=mkdtempSync('/tmp/bb-php-trait-receivers-')
process.env.BB_DATA_DIR=mkdtempSync('/tmp/bb-php-trait-receiver-data-')
const source=String.raw`<?php namespace TraitReceivers;
class Base { function run() { return __METHOD__; } }
class Known { function run() { return __METHOD__; } }
trait Shared {
  function run() { return __METHOD__; }
  function probeSelf(self $value) { return $value->run(); }
  function probeThis() { return $this->run(); }
  function probeScope() { return self::run(); }
  function probeStatic() { return static::run(); }
  function probeParent() { return parent::run(); }
  function probeConcrete(Known $value) { return $value->run(); }
  function probeClosure() { return fn(self $value) => $value->run(); }
  function makeSelf() { return new self(); }
  function makeParent() { return new parent(); }
  function makeStatic() { return new static(); }
}
class First extends Base { use Shared; function run() { return __METHOD__; } }
class Second extends Base { use Shared; function run() { return __METHOD__; } }
`
const filePath=join(root,'receivers.php')
writeFileSync(filePath,source)
const parsed=await ASTEngine.parseFile(filePath,source)
assert.deepEqual(parsed.errors,[])
const calls=parsed.relationships.filter(edge=>edge.type==='calls' && String(edge.source).startsWith('probe'))
assert.equal(calls.length,7)
for (const edge of calls) {
  assert.equal(edge.metadata?.ownerIdentity, edge.source==='probeConcrete' ? 'traitreceivers\\known' : undefined, String(edge.source))
}
if(process.argv.includes('--native')) {
  const output=execFileSync(process.env.PHP_BIN ?? 'php',['-n','-r',source.slice(5)+String.raw`
$out=[];
foreach ([new First, new Second] as $value) {
  $out[] = [$value->probeSelf($value),$value->probeThis(),$value->probeScope(),$value->probeStatic(),$value->probeParent(),$value->probeConcrete(new Known),($value->probeClosure())($value),get_class($value->makeSelf()),get_class($value->makeParent()),get_class($value->makeStatic())];
}
echo json_encode($out, JSON_THROW_ON_ERROR);
`],{encoding:'utf8',timeout:10_000})
  assert.deepEqual(JSON.parse(output), ['First','Second'].map(name=>[...Array(4).fill(`TraitReceivers\\${name}::run`),'TraitReceivers\\Base::run','TraitReceivers\\Known::run',`TraitReceivers\\${name}::run`,`TraitReceivers\\${name}`,'TraitReceivers\\Base',`TraitReceivers\\${name}`]))
}
const project='php-trait-receivers'
const worker=process.argv.includes('--require-worker')
if(worker) {
  const indexed=await indexProjectParallel(project,root,{logger:{log(){},write(){}}})
  assert.equal(indexed.summary?.parseMode,'worker-pool')
  assert.equal(indexed.successFiles,1)
} else {
  const stat=statSync(filePath)
  assert.equal((await storeResults(project,root,[{...parsed,filePath,success:true,fileHash:createHash('sha256').update(source).digest('hex').slice(0,16),sizeBytes:stat.size,lastModified:stat.mtimeMs}])).rolledBackFiles,0)
}
const db=await BrainDatabase.getRawInstance(project)
const rows=db.prepare(`SELECT s.name AS source, owner.name AS target FROM brain_relationship r
 JOIN brain_symbol s ON s.id=r.source_symbol_id LEFT JOIN brain_symbol t ON t.id=r.target_symbol_id
 LEFT JOIN brain_symbol owner ON owner.id=t.owner_symbol_id WHERE r.project_id=? AND r.relationship_type='calls'
 AND s.name LIKE 'probe%' ORDER BY source`).all(project)
assert.deepEqual(rows,['probeClosure','probeConcrete','probeParent','probeScope','probeSelf','probeStatic','probeThis'].map(name=>({source:name,target:name==='probeConcrete' ? 'Known' : null})))
const consumerTypes=db.prepare(`SELECT r.target_symbol_id AS target FROM brain_relationship r
 JOIN brain_symbol s ON s.id=r.source_symbol_id WHERE r.project_id=? AND s.name IN ('probeSelf','probeClosure')
 AND r.relationship_type='references' AND json_extract(r.metadata,'$.consumerBoundType')=1`).all(project)
assert.equal(consumerTypes.length,2)
assert.ok(consumerTypes.every((row:any)=>row.target===null), 'trait self parameter references require a consumer')
const creations=db.prepare(`SELECT s.name AS source, r.target_symbol_id AS target FROM brain_relationship r
 JOIN brain_symbol s ON s.id=r.source_symbol_id WHERE r.project_id=? AND s.name LIKE 'make%'
 AND r.relationship_type='instantiates' ORDER BY source`).all(project)
assert.deepEqual(creations,['makeParent','makeSelf','makeStatic'].map(source=>({source,target:null})))
console.log(JSON.stringify({passed:true,sites:7,native:process.argv.includes('--native'),worker}))
process.exit(0)

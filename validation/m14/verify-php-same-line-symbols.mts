import assert from "node:assert/strict"
import {createHash} from "node:crypto"
import {mkdtempSync,writeFileSync,statSync} from "node:fs"
import {join} from "node:path"
import {ASTEngine} from "../../src/ast/engine"
import {storeResults,indexProjectParallel} from "../../src/ast/parallel-indexer"
import {BrainDatabase} from "../../src/brain/database"
const root=mkdtempSync('/tmp/bb-php-line-symbols-')
process.env.BB_DATA_DIR=mkdtempSync('/tmp/bb-php-line-data-')
const source=String.raw`<?php namespace One { class Same { function call() { self::work(); } static function work() {} } } namespace Two { class Same { function call() { self::work(); } static function work() {} } }`
const filePath=join(root,'compact.php')
writeFileSync(filePath,source)
const project='php-line-symbols'
const parsed=await ASTEngine.parseFile(filePath,source)
const stat=statSync(filePath)
if(process.argv.includes('--require-worker')) {
  const result=await indexProjectParallel(project,root,{logger:{log(){},write(){}}})
  assert.equal(result.summary?.parseMode,'worker-pool')
  assert.equal(result.successFiles,1)
} else assert.equal((await storeResults(project,root,[{...parsed,filePath,success:true,fileHash:createHash('sha256').update(source).digest('hex').slice(0,16),sizeBytes:stat.size,lastModified:stat.mtimeMs}])).rolledBackFiles,0)
const db=await BrainDatabase.getRawInstance(project)
assert.equal(db.prepare("SELECT count(*) AS n FROM brain_symbol WHERE project_id=? AND symbol_type='method'").get(project).n,4)
const rows=db.prepare(`SELECT json_extract(so.annotations,'$.fqn') AS source_owner, s.name AS source,
 json_extract(tow.annotations,'$.fqn') AS target_owner,t.name AS target
 FROM brain_relationship r JOIN brain_symbol s ON s.id=r.source_symbol_id
 JOIN brain_symbol so ON so.id=s.owner_symbol_id JOIN brain_symbol t ON t.id=r.target_symbol_id
 JOIN brain_symbol tow ON tow.id=t.owner_symbol_id WHERE r.project_id=? AND r.relationship_type='calls' ORDER BY source_owner`).all(project)
assert.deepEqual(rows,[{source_owner:'One\\Same',source:'call',target_owner:'One\\Same',target:'work'},
 {source_owner:'Two\\Same',source:'call',target_owner:'Two\\Same',target:'work'}])
console.log(JSON.stringify({passed:true,methods:4,calls:rows.length,worker:process.argv.includes('--require-worker')}))
process.exit(0)

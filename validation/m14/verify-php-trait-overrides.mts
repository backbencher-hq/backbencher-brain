import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"
const mutations: Record<string, [string,string,string]> = {
  visibility: ['php-member-dispatch','adapted.status === "found" && alias.visibility','false && alias.visibility'],
  self: ['php-project-overrides','if (traitComposition) target.shape = composeSignature(target.shape, composedOwner)','/* trait types remain uninstantiated */'],
  final: ['php-project-overrides','target.final || ',''],
  contracts: ['php-project-overrides','if (!contracts.length && ancestor.hasTraits) {','if (false) {'],
}
const mutation = process.argv.find(arg => arg.startsWith('--mutate='))?.split('=')[1]
if (mutation) {
  assert.ok(mutation in mutations)
  const [module,before,after] = mutations[mutation]
  Bun.plugin({name:'php-trait-contract-control',setup(build) {
    build.onLoad({filter:new RegExp(`${module}\\.ts$`)},({path}) => {
      const source=readFileSync(path,'utf8')
      assert.ok(source.includes(before))
      console.log(`APPLIED contract mutation: ${mutation}`)
      return {contents:source.replace(before,after),loader:'ts'}
    })
  }})
}
const { ASTEngine } = await import("../../src/ast/engine")
const { storeResults, indexProjectParallel } = await import("../../src/ast/parallel-indexer")
const { BrainDatabase } = await import("../../src/brain/database")

// [trait declaration, adaptations, child declaration, native-valid, override, compatibility]
const cases: Array<[string,string,string,boolean,boolean,string?,string?]> = [
  ['function f() {}', '', 'function f() {}', true, true],
  ['final function f() {}', '', 'function f() {}', false, false],
  ['static function f() {}', '', 'function f() {}', false, false],
  ['static function f() {}', '', 'static function f() {}', true, true],
  ['function f() {}', 'f as protected;', 'protected function f() {}', true, true],
  ['protected function f() {}', 'f as public;', 'protected function f() {}', false, false],
  ['function f() {}', 'f as private;', 'function f() {}', true, false],
  ['function f(int $v) {}', 'f as alias;', 'function alias(string $v) {}', false, false],
  ['function f(int $v) {}', 'f as alias;', 'function alias(int|string $v) {}', true, true],
  ['function f($v) {}', 'f as protected alias;', 'protected function alias($v) {}', true, true],
  ['function f($v) {}', 'f as alias;', 'function alias($v, $extra) {}', false, false],
  ['function &f() {}', 'f as alias;', 'function alias() {}', false, false],
  ['function f(): self {}', 'f as alias;', 'function alias(): self {}', true, true],
  ['function f(self $v) {}', 'f as alias;', 'function alias(self $v) {}', false, false],
  ['function f(self $v) {}', 'f as alias;', 'function alias(P $v) {}', true, true],
  ['function f(): self {}', '', 'function f(): Foreign {}', false, false],
  ['function f(parent $v): parent {}', '', 'function f(Root $v): Root {}', true, true],
  ['function f(parent $v): parent {}', '', 'function f(P $v): Root {}', false, false],
  ['abstract function f(int $v): int;', '', 'function f(int $v): int {}', true, true],
  ['abstract function f(int $v): int;', '', 'function f(string $v): int {}', false, false],
  ['function __construct(int $v) {}', '', 'function __construct(string $v, $extra) {}', true, true],
  ['abstract function __construct(int $v);', '', 'function __construct(int $v) {}', true, true],
  ['abstract function __construct(int $v);', '', 'function __construct(string $v) {}', false, false],
  ['abstract function __construct(int $v);', '', 'function __construct(string $v) {}', false, false, undefined, 'function __construct(int $v) {}'],
  ['abstract function __construct(int $v);', '', 'function __construct(int $v) {}', true, true, undefined, 'function __construct(int $v) {}'],
]
const root = mkdtempSync('/tmp/bb-php-trait-overrides-')
process.env.BB_DATA_DIR = mkdtempSync('/tmp/bb-php-trait-overrides-data-')
const results = []
for (const [index, [method, adaptations, child, valid, edge, , middle]] of cases.entries()) {
  const source = `<?php namespace Case${index}; class Root {} class Foreign {} trait T { ${method} } abstract class P extends Root { use T ${adaptations ? `{ ${adaptations} }` : ';'} } ${middle ? `class M extends P { ${middle} }` : ''} class C extends ${middle ? 'M' : 'P'} { ${child} }`
  if (process.argv.includes('--native')) {
    const name = child.includes('__construct(') ? '__construct' : child.includes('alias(') ? 'alias' : 'f'
    const reflection = ` $m = new \\ReflectionMethod(C::class, '${name}'); echo json_encode($m->hasPrototype() ? [$m->getPrototype()->getDeclaringClass()->getName(), $m->getPrototype()->getName()] : null);`
    const native = spawnSync(process.env.PHP_BIN ?? 'php', ['-n','-r',source.slice(5) + reflection], {encoding:'utf8',timeout:10_000})
    assert.equal(native.error, undefined)
    assert.equal(native.signal, null)
    assert.equal(native.status === 0, valid, `${index}: ${native.stdout}${native.stderr}`)
    if (valid) assert.deepEqual(JSON.parse(native.stdout), edge && (name !== '__construct' || method.startsWith('abstract')) ? [`Case${index}\\P`, name] : null)
  }
  const filePath = join(root,`${index}.php`)
  writeFileSync(filePath, source)
  const parsed = await ASTEngine.parseFile(filePath,source)
  assert.deepEqual(parsed.errors, [])
  const stat = statSync(filePath)
  results.push({...parsed,filePath,success:true,fileHash:createHash('sha256').update(source).digest('hex').slice(0,16),sizeBytes:stat.size,lastModified:stat.mtimeMs})
}
const project = 'php-trait-overrides'
const worker = process.argv.includes('--require-worker')
if (worker) {
  const indexed = await indexProjectParallel(project,root,{logger:{log(){},write(){}}})
  assert.equal(indexed.summary?.parseMode,'worker-pool')
  assert.equal(indexed.successFiles,cases.length)
} else assert.equal((await storeResults(project,root,results)).rolledBackFiles,0)
const db = await BrainDatabase.getRawInstance(project)
const rows = db.prepare(`SELECT f.relative_path AS file, o.name AS owner, t.name AS target,
 json_extract(r.metadata,'$.signatureCompatibility') AS compatibility,
 json_extract(r.metadata,'$.declaringTypeIdentity') AS declaring,
 json_extract(r.metadata,'$.traitComposition') AS composed
 FROM brain_relationship r JOIN brain_symbol s ON s.id=r.source_symbol_id
 JOIN brain_file f ON f.id=s.file_id JOIN brain_symbol t ON t.id=r.target_symbol_id
 JOIN brain_symbol o ON o.id=t.owner_symbol_id
 WHERE r.project_id=? AND r.relationship_type='overrides'
 AND s.owner_symbol_id IN (SELECT id FROM brain_symbol WHERE name='C') ORDER BY file`).all(project)
const expected = cases.flatMap(([method, , , , edge, compatibility, middle], index) => edge ? [{file:`${index}.php`,owner:middle ? 'M' : 'T',target:method.includes('__construct(') ? '__construct' : 'f',compatibility:compatibility ?? 'checked',declaring:`case${index}\\${middle ? 'm' : 'p'}`,composed:middle ? null : 1}] : []).sort((a,b)=>a.file.localeCompare(b.file))
assert.deepEqual(rows, expected)
console.log(JSON.stringify({passed:true,cases:cases.length,overrides:rows.length,worker,native:process.argv.includes('--native')}))
process.exit(0)

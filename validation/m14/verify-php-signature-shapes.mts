import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdtempSync, statSync, writeFileSync, readFileSync } from "node:fs"
import { join } from "node:path"
const mutate = process.argv.includes("--mutate")
const localMutation = process.argv.find(arg => arg.startsWith("--mutate-local="))?.split("=")[1]
if (localMutation) Bun.plugin({name: "php-local-modifier-control", setup(build) {
  const changes: Record<string, [string, string]> = {
    final: ['candidate.metadata?.isFinal || ', ''],
    static: ['!!candidate.isStatic !== !!method.isStatic || ', ''],
    visibility: ['visibilityRank(method.visibility) < visibilityRank(candidate.visibility)', 'false'],
  }
  assert.ok(localMutation in changes)
  build.onLoad({filter: /real-php-analyzer\.ts$/}, ({path}) => {
    const source = readFileSync(path, "utf8")
    const [before, after] = changes[localMutation]
    assert.ok(source.includes(before))
    console.log(`APPLIED local mutation: ${localMutation}`)
    return {contents: source.replace(before, after), loader: "ts"}
  })
}})
if (process.argv.includes("--mutate-variance")) Bun.plugin({name: "php-variance-control", setup(build) {
  build.onLoad({filter: /php-signature-variance\.ts$/}, ({path}) => {
    const text = readFileSync(path, "utf8")
    const before = 'if (!child || !parent) return undefined'
    assert.ok(text.includes(before))
    console.log("APPLIED variance mutation")
    return {contents: text.replace(before, 'if (true) return true'), loader: "ts"}
  })
}})
if (process.argv.includes("--mutate-contracts")) Bun.plugin({name: "php-constructor-contract-control", setup(build) {
  build.onLoad({filter: /(real-php-analyzer|php-project-overrides)\.ts$/}, ({path}) => {
    const text = readFileSync(path, "utf8")
    const before = 'if (incompatibleContract) continue'
    assert.ok(text.includes(before))
    console.log("APPLIED constructor contract mutation")
    return {contents: text.replace(before, '/* ancestor contract discarded */'), loader: "ts"}
  })
}})
if (mutate) Bun.plugin({name: "php-signature-control", setup(build) {
  build.onLoad({filter: /php-signature-shape\.ts$/}, ({path}) => {
    const text = readFileSync(path, "utf8")
    const before = 'if (!child || !parent) return true'
    assert.ok(text.includes(before))
    console.log("APPLIED signature mutation")
    return {contents: text.replace(before, 'if (true) return true'), loader: "ts"}
  })
}})
const {ASTEngine} = await import("../../src/ast/engine")
const {storeResults, indexProjectParallel, reindexFilesParallel} = await import("../../src/ast/parallel-indexer")
const {BrainDatabase} = await import("../../src/brain/database")
const {reconcilePhpProjectOverrides} = await import("../../src/ast/php-project-overrides")
const cases: Array<[string, string, boolean, string?]> = [
  ['function f($a) {}', 'function f($a) {}', true],
  ['function f($a) {}', 'function f($a, $b) {}', false],
  ['function f($a = null) {}', 'function f($a) {}', false],
  ['function f($a) {}', 'function f($a = null) {}', true],
  ['function f($a) {}', 'function f($a, $b = null) {}', true],
  ['function f($a, $b = null) {}', 'function f($a) {}', false],
  ['function f(...$a) {}', 'function f($a = null) {}', false],
  ['function f($a, $b) {}', 'function f(...$a) {}', true],
  ['function f(...$a) {}', 'function f($a = null, ...$b) {}', true],
  ['function f(...$a) {}', 'function f($a, ...$b) {}', false],
  ['function f(&$a) {}', 'function f($a) {}', false],
  ['function f($a) {}', 'function f(&$a) {}', false],
  ['function f(&...$a) {}', 'function f(&...$a) {}', true],
  ['function f(&...$a) {}', 'function f($a = null, &...$b) {}', false],
  ['function &f() {}', 'function f() {}', false],
  ['function f() {}', 'function &f() {}', true],
  ['function __construct($a) {}', 'function __construct($a, $b) {}', true],
  ['abstract function __construct($a);', 'function __construct($a, $b) {}', false],
  ['abstract function __construct(int $a);', 'function __construct(public int $a) {}', true],
  ['function f($a = null, $b) {}', 'function f($a, $b) {}', true],
  ['abstract function __construct($a);', 'function __construct() {}', false, 'function __construct($a) {}'],
  ['abstract function __construct($a);', 'function __construct($a = null) {}', true, 'function __construct($a) {}'],
  ['abstract function __construct(&$a);', 'function __construct($a) {}', false, 'function __construct(&$a) {}'],
  ['abstract function __construct(...$args);', 'function __construct() {}', false, 'function __construct(...$args) {}'],
  ['function f(int $a) {}', 'function f(string $a) {}', false],
  ['function f(int $a) {}', 'function f(int|string $a) {}', true],
  ['function f(int|string $a) {}', 'function f(int $a) {}', false],
  ['function f(?int $a) {}', 'function f(int $a) {}', false],
  ['function f(int $a = null) {}', 'function f(?int $a = null) {}', true],
  ['function f($a) {}', 'function f(mixed $a) {}', true],
  ['function f(mixed $a) {}', 'function f($a) {}', true],
  ['function f(int $a) {}', 'function f(float $a) {}', false],
  ['function f(): int {}', 'function f(): int|string {}', false],
  ['function f(): int|string {}', 'function f(): int {}', true],
  ['function f(): int {}', 'function f() {}', false],
  ['function f() {}', 'function f(): void {}', true],
  ['function f(): mixed {}', 'function f(): void {}', false],
  ['function f(): void {}', 'function f(): never {}', true],
  ['function f(): bool {}', 'function f(): false {}', true],
  ['function f(): false {}', 'function f(): bool {}', false],
  ['function f(Dog $a): Animal {}', 'function f(Animal $a): Dog {}', true],
  ['function f(Animal $a): Animal {}', 'function f(Dog $a): Animal {}', false],
  ['function f(): Dog {}', 'function f(): Animal {}', false],
  ['function f(Left&Right $a) {}', 'function f(Left $a) {}', true],
  ['function f(Left $a) {}', 'function f(Left&Right $a) {}', false],
  ['function f(): Left {}', 'function f(): Left&Right {}', true],
  ['function f((Left&Right)|null $a) {}', 'function f(Left|null $a) {}', true],
  ['function f(): iterable {}', 'function f(): array {}', true],
  ['function f(): array {}', 'function f(): iterable {}', false],
  ['function f(AliasDog $a): Animal {}', 'function f(Animal $a): Dog {}', true],
  ['function f(self $a): self {}', 'function f(Base $a): self {}', true],
  ['function f(): Animal {}', 'function f(): ForeignAnimal {}', false],
  ['abstract function __construct(int $a);', 'function __construct(string $a) {}', false, 'function __construct(int $a) {}'],
  ['final function f() {}', 'function f() {}', false],
  ['static function f() {}', 'function f() {}', false],
  ['function f() {}', 'static function f() {}', false],
  ['static function f() {}', 'static function f() {}', true],
  ['public function f() {}', 'protected function f() {}', false],
  ['protected function f() {}', 'private function f() {}', false],
  ['protected function f() {}', 'public function f() {}', true],
  ['protected function f() {}', 'protected function f() {}', true],
  ['function f(): static {}', 'function f(): static {}', true],
  ['function f(): object {}', 'function f(): static {}', true],
]
const root = mkdtempSync("/tmp/bb-php-signatures-")
process.env.BB_DATA_DIR = mkdtempSync("/tmp/bb-php-signatures-data-")
const project = "php-signature-shapes"
const parsed = []
const split = process.argv.includes("--split")
for (const [index, [base, child, compatible, middle]] of cases.entries()) {
  const formatted = `<?php namespace Case${index};
use Case${index}\\Dog as AliasDog;
class Animal {} class Dog extends Animal {} class ForeignAnimal {}
interface Left {} interface Right {}
abstract class Base { ${base} }
${middle ? `class Middle extends Base { ${middle} }\n` : ""}class Child extends ${middle ? "Middle" : "Base"} { ${child} }`
  const source = process.argv.includes("--same-line") ? formatted.replaceAll("\n", " ") : formatted
  if (process.argv.includes("--native")) {
    const result = spawnSync(process.env.PHP_BIN ?? "php", ["-n", "-r", source.slice(5)], {encoding:"utf8", timeout:10_000})
    assert.equal(result.error, undefined)
    assert.equal(result.signal, null)
    assert.equal(result.status === 0, compatible, `${index}: ${result.stdout}${result.stderr}`)
  }
  const units = split ? [
    [`${index}.php`, source.slice(0, source.lastIndexOf("class Child"))],
    [`${index}-child.php`, `<?php namespace Case${index}; use Case${index}\\Dog as AliasDog;\n${source.slice(source.lastIndexOf("class Child"))}`],
  ] : [[`${index}.php`, source]]
  for (const [fileName, unit] of units) {
  const filePath = join(root, fileName)
  writeFileSync(filePath, unit)
  const result = await ASTEngine.parseFile(filePath, unit)
  assert.deepEqual(result.errors, [])
  if (!split) {
    const overrides = result.relationships.filter(edge => edge.type === "overrides" && String(edge.source).startsWith("Child."))
    assert.equal(overrides.length, compatible ? 1 : 0, `analyzer case ${index}`)
    for (const edge of overrides) {
      assert.equal(edge.confidence, 0.85, `local confidence ${index}`)
      assert.equal(edge.metadata?.evidenceClass, "inferred", `local evidence ${index}`)
      assert.equal(edge.metadata?.signatureCompatibility, child.includes(": static") ? "unchecked" : "checked", `local compatibility ${index}`)
    }
  }
  if (index === 18 && (!split || fileName.endsWith('-child.php'))) {
    const constructor = result.symbols.find(s => s.name === "__construct" && s.ownerName === "Child")!
    assert.equal(constructor.parameters?.[0]?.isOptional, false, "promoted parameter without default is required")
    assert.equal(constructor.parameters?.[0]?.defaultValue, undefined)
  }
  const stat = statSync(filePath)
  parsed.push({...result, filePath, success:true, fileHash:createHash("sha256").update(unit).digest("hex").slice(0,16), sizeBytes:stat.size,lastModified:stat.mtimeMs})
  }
}
const logger = {log() {},write() {}}
if (process.argv.includes("--require-worker")) {
  const result = await indexProjectParallel(project, root, {logger})
  assert.equal(result.successFiles, parsed.length)
  assert.equal(result.summary?.parseMode, "worker-pool")
} else assert.equal((await storeResults(project,root,parsed)).rolledBackFiles,0)
const db = await BrainDatabase.getRawInstance(project)
const rows = () => db.prepare(`SELECT f.relative_path AS file, json_extract(r.metadata, '$.signatureShapeChecked') AS checked,
    json_extract(r.metadata, '$.signatureCompatibility') AS compatibility
  FROM brain_relationship r JOIN brain_symbol s ON s.id=r.source_symbol_id JOIN brain_file f ON f.id=s.file_id
  WHERE r.project_id=? AND r.relationship_type='overrides'
    AND s.owner_symbol_id IN (SELECT id FROM brain_symbol WHERE name='Child') ORDER BY f.relative_path`).all(project)
const expected = cases.flatMap(([, child, yes], i) => yes ? [{file:`${i}${split ? '-child' : ''}.php`,checked:1,compatibility:child.includes(": static") ? "unchecked" : "checked"}] : []).sort((a,b)=>a.file.localeCompare(b.file))
assert.deepEqual(rows(), expected)
const before = db.prepare('SELECT total_changes() AS n').get().n
assert.equal(reconcilePhpProjectOverrides(db,project).insertedOrUpdated,0)
assert.equal(db.prepare('SELECT total_changes() AS n').get().n,before)
if (process.argv.includes("--require-worker")) {
  const name = split ? '0-child.php' : '0.php'
  const file = join(root,name)
  const original = readFileSync(file,"utf8")
  writeFileSync(file,original.replace('class Child extends Base { function f($a)', 'class Child extends Base { function f($a, $b)'))
  assert.equal((await reindexFilesParallel(project,root,[{path:file,type:"modified"}],{logger})).errors,0)
  assert.ok(!rows().some((r:any)=>r.file===name))
  writeFileSync(file,original)
  assert.equal((await reindexFilesParallel(project,root,[{path:file,type:"modified"}],{logger})).errors,0)
  assert.deepEqual(rows(),expected)
}
console.log(JSON.stringify({passed:true,cases:cases.length,overrides:expected.length,native:process.argv.includes("--native"),worker:process.argv.includes("--require-worker")}))
process.exit(0)

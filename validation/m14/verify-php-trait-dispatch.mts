import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdtempSync, readFileSync, statSync, writeFileSync, unlinkSync } from "node:fs"
import { join } from "node:path"

const mutation = process.argv.find(arg => arg.startsWith("--mutate="))?.split("=")[1]
const changes: Record<string, [string, string]> = {
  traits: ['for (const group of type.traits)', 'for (const group of [])'],
  aliases: ['if (alias.alias === name)', 'if (false)'],
  precedence: ['if (composed.status !== "absent") {', 'if (false) {'],
  exclusion: ['filter(identity => !excluded.has(identity))', 'filter(identity => true)'],
  conflict: ['if (concrete.size > 1) return unknown', 'if (false) return unknown'],
  unqualified: ['choose(group.traits.map(identity => fromTrait(identity, alias.method)))', 'choose(original(alias.method))'],
  localOverride: ['if (!candidate && base?.metadata?.phpTraits?.length) break', '/* composed override skipped */'],
  projectOverride: ['if (!target && ancestor.hasTraits) {', 'if (false) {'],
}
if (mutation) {
  assert.ok(mutation in changes)
  Bun.plugin({ name: "php-trait-dispatch-control", setup(build) {
    const module = mutation === 'localOverride' ? 'real-php-analyzer' : mutation === 'projectOverride' ? 'php-project-overrides' : 'php-member-dispatch'
    build.onLoad({ filter: new RegExp(`${module}\\.ts$`) }, ({ path }) => {
      const text = readFileSync(path, "utf8")
      const [before, after] = changes[mutation]
      assert.ok(text.includes(before), `mutation target ${mutation}`)
      console.log(`APPLIED trait mutation: ${mutation}`)
      return { contents: text.replace(before, after), loader: "ts" }
    })
  } })
}
const { ASTEngine } = await import("../../src/ast/engine")
const { storeResults, indexProjectParallel, reindexFilesParallel } = await import("../../src/ast/parallel-indexer")
const { BrainDatabase } = await import("../../src/brain/database")
const { resolveMemberTargetsByOwner } = await import("../../src/ast/member-owner-resolution")
const { handler: graph } = await import("../../src/mcp/tools/bb_graph/handler")
const root = mkdtempSync("/tmp/bb-php-traits-")
process.env.BB_DATA_DIR = mkdtempSync("/tmp/bb-php-trait-data-")
const project = "php-trait-dispatch"
const sources = {
  "library.php": String.raw`<?php namespace Library;
trait One { function run() { return __METHOD__; } }
trait Two { function run() { return __METHOD__; } }
trait Wrapped { use One; }
trait Marker {}
trait Required { abstract function run(); }
trait RequiredWrapper { use Required; }
trait AliasWrapper { use One { run as wrapped; } }
trait Data { public $value = 'trait-property'; public const VALUE = 'trait-constant'; }
class Base { function run() { return __METHOD__; } }
class Middle extends Base { function run() { return __METHOD__; } }
interface RootContract { public const TOKEN = 'interface'; function action(); }
interface DerivedContract extends RootContract {}
`,
  "consumers.php": String.raw`<?php namespace App;
use Library\One as First;
use Library\{Two, Wrapped, Marker, Data, Base, Middle, RequiredWrapper, AliasWrapper};
class Precedence extends Base { use First; function probe() { return $this->run(); } }
class Own extends Base { use First; function run() { return __METHOD__; } function probe() { return $this->run(); } }
class Adapted extends Base { use First, Two { First::run insteadof Two; Two::run as alternate; } function probe() { return $this->run(); } function probeAlias() { return $this->alternate(); } }
class BareAlias { use First { run as duplicate; } function probe() { return $this->duplicate(); } }
class Nested extends Base { use Wrapped; function probe() { return $this->run(); } }
class Inherited extends Precedence { function probe() { return $this->run(); } }
class EmptyTrait extends Base { use Marker; function probe() { return $this->run(); } }
class Nearest extends Middle { function probe() { return $this->run(); } }
class Requirement extends Base { use RequiredWrapper; function probe() { return $this->run(); } }
class NestedAlias { use AliasWrapper; function probe() { return $this->wrapped(); } }
class DataUse { use Data; function probeProperty() { return $this->value; } function probeConstant() { return self::VALUE; } }
class ContractUser implements \Library\DerivedContract { function action() {} function probeConstant() { return self::TOKEN; } function probeContract(\Library\DerivedContract $value) { $value->action(); } }
class OverrideChild extends Precedence { function run() { return __METHOD__; } }
class LocalRoot { function run() {} }
trait LocalTrait { function run() {} }
class LocalParent extends LocalRoot { use LocalTrait; }
class LocalChild extends LocalParent { function run() {} }
enum Choice { use First; case A; function probe() { return $this->run(); } }
`,
  "invalid.php": String.raw`<?php namespace Invalid;
use Library\One; use Library\Two;
trait CycleA { use CycleB; } trait CycleB { use CycleA; }
class Missing extends \Library\Base { use Absent; function probe() { return $this->run(); } }
class Conflict extends \Library\Base { use \Library\One, \Library\Two; function probe() { return $this->run(); } }
class Cycle extends \Library\Base { use CycleA; function probe() { return $this->run(); } }
class ParentData { public $value = 'parent'; public const VALUE = 'parent'; }
class VersionSensitive extends ParentData { use \Library\Data; function probeProperty() { return $this->value; } function probeConstant() { return self::VALUE; } }
class ExcludedAlias { use One, Two { One::run insteadof Two; run as kept; } function probe() { return $this->kept(); } }
`,
}
const expected: Record<string, string | null> = {
  "App\\Precedence::probe": "Library\\One::run",
  "App\\Own::probe": "App\\Own::run",
  "App\\Adapted::probe": "Library\\One::run",
  "App\\Adapted::probeAlias": "Library\\Two::run",
  "App\\BareAlias::probe": "Library\\One::run",
  "App\\Nested::probe": "Library\\One::run",
  "App\\Inherited::probe": "Library\\One::run",
  "App\\EmptyTrait::probe": "Library\\Base::run",
  "App\\Nearest::probe": "Library\\Middle::run",
  "App\\Requirement::probe": "Library\\Base::run",
  "App\\NestedAlias::probe": "Library\\One::run",
  "Invalid\\ExcludedAlias::probe": null,
  "App\\DataUse::probeProperty": "Library\\Data::value",
  "App\\DataUse::probeConstant": "Library\\Data::VALUE",
  "App\\ContractUser::probeConstant": "Library\\RootContract::TOKEN",
  "App\\ContractUser::probeContract": "Library\\RootContract::action",
  "App\\Choice::probe": "Library\\One::run",
  "Invalid\\Missing::probe": null,
  "Invalid\\Conflict::probe": null,
  "Invalid\\Cycle::probe": null,
  "Invalid\\VersionSensitive::probeProperty": null,
  "Invalid\\VersionSensitive::probeConstant": null,
}
const parsed = []
for (const [name, source] of Object.entries(sources)) {
  const filePath = join(root, name)
  writeFileSync(filePath, source)
  const result = await ASTEngine.parseFile(filePath, source)
  assert.deepEqual(result.errors, [], name)
  assert.ok(!result.relationships.some(edge => edge.type === 'overrides' && edge.source === 'LocalChild.run'), 'do not skip a composed method to claim an older ancestor override')
  const stat = statSync(filePath)
  parsed.push({ ...result, filePath, success: true, fileHash: createHash("sha256").update(source).digest("hex").slice(0, 16), sizeBytes: stat.size, lastModified: stat.mtimeMs })
}
if (process.argv.includes("--native")) {
  const load = ["library.php", "consumers.php"].map(name => `require ${JSON.stringify(join(root, name))};`).join("\n")
  const native = execFileSync(process.env.PHP_BIN ?? "php", ["-n", "-r", load + String.raw`
$out = [];
foreach (['Precedence','Own','Adapted','BareAlias','Nested','Inherited','EmptyTrait','Nearest','Requirement','NestedAlias'] as $name) {
  $type = 'App\\' . $name;
  $out[$type . '::probe'] = (new $type)->probe();
}
$out['App\\Adapted::probeAlias'] = (new App\Adapted)->probeAlias();
$out['App\\Choice::probe'] = App\Choice::A->probe();
$out['property'] = (new App\DataUse)->probeProperty();
$out['constant'] = (new App\DataUse)->probeConstant();
$out['interface'] = (new App\ContractUser)->probeConstant();
echo json_encode($out, JSON_THROW_ON_ERROR);
`], { encoding: "utf8", timeout: 10_000 })
  const runtime = JSON.parse(native)
  assert.equal(runtime.property, "trait-property")
  assert.equal(runtime.constant, "trait-constant")
  assert.equal(runtime.interface, "interface")
  delete runtime.property; delete runtime.constant; delete runtime.interface
  for (const [name, target] of Object.entries(runtime)) assert.equal(target, expected[name], name)
  assert.equal(Object.keys(runtime).length, 12)
  const ambiguous = spawnSync(process.env.PHP_BIN ?? "php", ["-n", "-r",
    'trait A { function f() {} } trait B { function f() {} } class C { use A, B { A::f insteadof B; f as alias; } }'], { encoding: "utf8", timeout: 10_000 })
  assert.equal(ambiguous.error, undefined)
  assert.equal(ambiguous.signal, null)
  assert.equal(ambiguous.status, 255)
  assert.match(ambiguous.stdout + ambiguous.stderr, /alias.*ambiguity/s)
}
const logger = { log() {}, write() {} }
const worker = process.argv.includes("--require-worker")
if (worker) {
  const result = await indexProjectParallel(project, root, { logger })
  assert.equal(result.successFiles, 3)
  assert.equal(result.summary?.parseMode, "worker-pool")
} else assert.equal((await storeResults(project, root, parsed)).rolledBackFiles, 0)
const db = await BrainDatabase.getRawInstance(project)
const snapshot = (database = db, id = project) => {
  const rows = database.prepare(`SELECT
  json_extract(so.annotations,'$.fqn') || '::' || s.name AS source,
  json_extract(tow.annotations,'$.fqn') || '::' || t.name AS target
  FROM brain_relationship r JOIN brain_symbol s ON s.id=r.source_symbol_id
  JOIN brain_symbol so ON so.id=s.owner_symbol_id
  LEFT JOIN brain_symbol t ON t.id=r.target_symbol_id
  LEFT JOIN brain_symbol tow ON tow.id=t.owner_symbol_id
  WHERE r.project_id=? AND s.name LIKE 'probe%' AND r.relationship_type IN ('calls','uses')
  AND json_extract(r.metadata,'$.phpMemberReference')=1`).all(id)
  assert.equal(rows.length, Object.keys(expected).length, "each call/read site must survive exactly once")
  assert.equal(database.prepare(`SELECT count(*) AS n FROM brain_relationship r
    JOIN brain_symbol s ON s.id=r.source_symbol_id LEFT JOIN brain_symbol t ON t.id=r.target_symbol_id
    WHERE r.project_id=? AND json_extract(r.metadata,'$.phpMemberReference')=1
    AND r.is_cross_file != CASE WHEN t.id IS NOT NULL AND t.file_id != s.file_id THEN 1 ELSE 0 END`).get(id).n, 0)
  return Object.fromEntries(rows.map((row: any) => [row.source, row.target]))
}
assert.deepEqual(snapshot(), expected)
assert.deepEqual(db.prepare(`SELECT owner.name AS source, targetOwner.name AS target FROM brain_relationship r
  JOIN brain_symbol s ON s.id=r.source_symbol_id JOIN brain_symbol owner ON owner.id=s.owner_symbol_id
  JOIN brain_symbol t ON t.id=r.target_symbol_id JOIN brain_symbol targetOwner ON targetOwner.id=t.owner_symbol_id
  WHERE r.project_id=? AND r.relationship_type='overrides' AND owner.name IN ('OverrideChild','LocalChild') ORDER BY source`).all(project),
  [{source:'LocalChild',target:'LocalTrait'}, {source:'OverrideChild',target:'One'}],
  'composed overrides bind the original trait declaration, never the replaced grandparent')
const totalChanges = () => db.prepare("SELECT total_changes() AS n").get().n
const before = totalChanges()
assert.equal(resolveMemberTargetsByOwner(db, project, { reconcile: true }).reconciledChanges, 0)
assert.equal(totalChanges(), before)
const answer = await graph({ symbol: "One", file: "library.php", direction: "callers", maxDepth: 1, relationshipTypes: ["calls"], refresh: false },
  { projectId: project, projectPath: root } as Parameters<typeof graph>[1])
assert.ok(!answer.isError, JSON.stringify(answer.content))
// Owner-family traversal must expose exactly the callers of this trait's implementation.
const payload = JSON.parse((answer.content[0] as { text: string }).text)
assert.equal(payload.callers?.length, 7, JSON.stringify(payload))
if (worker) {
  const file = join(root, "consumers.php")
  const changed = sources["consumers.php"].replace("First::run insteadof Two; Two::run as alternate", "Two::run insteadof First; First::run as alternate")
  writeFileSync(file, changed)
  assert.equal((await reindexFilesParallel(project, root, [{ path: file, type: "modified" }], { logger })).errors, 0)
  const changedExpected = { ...expected, "App\\Adapted::probe": "Library\\Two::run", "App\\Adapted::probeAlias": "Library\\One::run" }
  assert.deepEqual(snapshot(), changedExpected)
  const clean = "php-trait-clean"
  assert.equal((await indexProjectParallel(clean, root, { logger })).successFiles, 3)
  assert.deepEqual(snapshot(await BrainDatabase.getRawInstance(clean), clean), changedExpected)
  unlinkSync(join(root, "library.php"))
  assert.equal((await reindexFilesParallel(project, root, [{ path: join(root,"library.php"), type: "deleted" }], { logger })).errors, 0)
  assert.deepEqual(snapshot(), Object.fromEntries(Object.keys(expected).map(name => [name, name === "App\\Own::probe" ? "App\\Own::run" : null])))
  writeFileSync(join(root,"library.php"), sources["library.php"])
  assert.equal((await reindexFilesParallel(project, root, [{ path: join(root,"library.php"), type: "added" }], { logger })).errors, 0)
  assert.deepEqual(snapshot(), changedExpected)
}
console.log(JSON.stringify({ passed: true, relationships: Object.keys(expected).length, worker, native: process.argv.includes("--native") }))
process.exit(0)

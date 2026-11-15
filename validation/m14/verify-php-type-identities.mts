import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdtempSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
const mutations = {
  namespace: ["real-php-analyzer", "this.resolveClassIdentity(raw, this.activeNamespace, this.activeClassAliases)", "this.leafName(raw).toLowerCase()"],
  return: ["real-php-analyzer", " && c.startIndex !== returnType?.startIndex", ""],
  late: ["real-php-analyzer", 'if (relative === "static") return { phpTypeReference: true, lateStaticBinding: true }', 'if (relative === "static") return { phpTypeReference: true, targetIdentity: own }'],
  relative: ["real-php-analyzer", ' || child.type === "relative_name"', ""],
  kinds: ["php-type-resolution", "row.relationship_type === 'instantiates' ? candidate.kind === 'class'", "row.relationship_type === 'instantiates' ? true"],
  external: ["real-php-analyzer", "const kind = typed", "const kind = false && typed"],
  source: ["parallel-indexer", 'sourceId = sourceIdFromSpan', 'sourceId = null /* discard established source identity */'],
  binding: ["php-type-resolution", "const declarations = types.get(identity)", "const declarations = undefined"],
} as const
const mutation = process.argv.find(arg => arg.startsWith("--mutate="))?.slice("--mutate=".length)
let mutated = false
if (mutation) {
  assert.ok(mutation in mutations, mutation)
  const [module, before, after] = mutations[mutation as keyof typeof mutations]
  Bun.plugin({
    name: "php-type-identity-mutation",
    setup(build) {
      build.onLoad({ filter: new RegExp(`${module}\\.ts$`) }, ({ path }) => {
        const source = readFileSync(path, "utf8")
        assert.ok(source.includes(before), "mutation must reach the production decision")
        mutated = true
        console.log(`APPLIED type mutation: ${mutation}`)
        return { contents: source.replace(before, after), loader: "ts" }
      })
    },
  })
}
const { ASTEngine } = await import("../../src/ast/engine")
const { indexProjectParallel, reindexFilesParallel, storeResults } = await import("../../src/ast/parallel-indexer")
const { BrainDatabase } = await import("../../src/brain/database")
const { reconcilePhpTypeTargets } = await import("../../src/ast/php-type-resolution")
const { derivePhpEdges, derivePhpDeclaredTypeEdgesIndependent } = await import("../../script/m14/differential")

const root = mkdtempSync("/tmp/bb-php-types-")
process.env.BB_DATA_DIR = mkdtempSync("/tmp/bb-php-types-data-")
const inputs = {
  "duplicate-owners.php": String.raw`<?php
namespace First {
  use RightSide\Base as ActualParent;
  class Same extends ActualParent {
    function fromRight(parent $value): parent { return $value; }
  }
}
namespace Second {
  use LeftSide\Base as OtherParent;
  class Same extends OtherParent {
    function fromLeft(parent $value): parent { return $value; }
  }
}
`,
  "self.php": String.raw`<?php namespace Application;
use Application\Aliased as ImportedSelf;
class Selfish extends Selfish {}
class Aliased extends ImportedSelf {}
`,
  "global.php": String.raw`<?php
class Shared {}
interface SharedContract {}
interface Marker {}
interface Token {}
`,
  "left.php": String.raw`<?php namespace LeftSide;
class Widget {}
class Base {}
interface Contract {}
trait Mix {}
`,
  "right.php": String.raw`<?php namespace RightSide;
class Widget {}
class Base {}
interface Contract {}
trait Mix {}
`,
  "consumer.php": String.raw`<?php namespace Application;
use RightSide\{Widget as Imported, Base as ParentAlias, Contract as InterfaceAlias, Mix as TraitAlias};
use RightSide\Widget as Exception;
class Demo extends ParentAlias implements InterfaceAlias {
  use TraitAlias;
  public Imported $field;
  public ?self $same = null;
  function build(Imported $argument): Imported { return new Imported(); }
  function explicit() { return new \LeftSide\Widget(); }
  function relative() { return new namespace\LocalWidget(); }
  function own() { return new self(); }
  function base() { return new parent(); }
  function late() { return new static(); }
  function lateTyped(): STATIC { return new STATIC(); }
  function aliasBuiltin() { return new Exception(); }
  function globalBuiltin() { return new \Exception(); }
  function badNew() { return new InterfaceAlias(); }
}
class LocalWidget {}
class Sub extends Demo {}
class Shared extends \Shared {}
interface SharedContract extends \SharedContract {}
class Marker implements \Marker {}
enum Token implements \Token { case One; }
$topLevel = new Imported();
`,
  "missing.php": String.raw`<?php namespace Application;
class MissingUser extends \Absent\Base implements \Absent\Contract {
  use \Absent\Mix;
  function missing(\Absent\Widget $argument): \Absent\Widget { return new \Absent\Widget(); }
}
function namespacedBuiltin() { return new Exception(); }
`,
}
const parsed = []
for (const [name, source] of Object.entries(inputs)) {
  const filePath = join(root, name)
  writeFileSync(filePath, source)
  const result = await ASTEngine.parseFile(filePath, source)
  assert.deepEqual(result.errors, [], name)
  const { tree } = await ASTEngine.parseTree(filePath, source)
  const heritage = new Set(["extends", "implements"])
  assert.deepEqual(derivePhpEdges(tree.rootNode, true).filter(edge => heritage.has(edge.label)).map(edge => [edge.label, edge.from, edge.target]).sort(),
    result.relationships.filter(edge => heritage.has(String(edge.type))).map(edge => [edge.type, edge.source, edge.target]).sort(), name)
  const unique = (tuples: unknown[][]) => [...new Map(tuples.map(tuple => [JSON.stringify(tuple), tuple])).values()].sort()
  assert.deepEqual(unique(derivePhpEdges(tree.rootNode, true).filter(edge => edge.label === "instantiates")
    .map(edge => [edge.from, edge.target, edge.targetUnverified === true])),
    unique(result.relationships.filter(edge => edge.type === "instantiates").map(edge => [edge.source, edge.target, edge.metadata?.lateStaticBinding === true])), name)
  assert.deepEqual(unique(derivePhpDeclaredTypeEdgesIndependent(tree.rootNode, result.symbols)
    .map(edge => [edge.from, edge.target, edge.targetUnverified === true])),
    unique(result.relationships.filter(edge => edge.type === "references").map(edge => [edge.source, edge.target, edge.metadata?.lateStaticBinding === true])), name)
  tree.delete()
  if (name === "self.php") assert.equal(result.relationships.some(edge => edge.type === "extends"), false)
  if (name === "duplicate-owners.php") {
    assert.deepEqual(result.relationships.filter(edge => edge.type === "references").map(edge => [edge.source, edge.target]).sort(), [
      ["fromLeft", "OtherParent"], ["fromRight", "ActualParent"],
    ])
  }
  const stat = statSync(filePath)
  parsed.push({ ...result, filePath, success: true,
    fileHash: createHash("sha256").update(source).digest("hex").slice(0, 16), sizeBytes: stat.size, lastModified: stat.mtimeMs })
}
const project = "php-type-identities"
if (process.argv.includes("--require-worker")) {
  const result = await indexProjectParallel(project, root, { logger: { log() {}, write() {} } })
  assert.equal(result.successFiles, Object.keys(inputs).length)
  assert.equal(result.summary?.parseMode, "worker-pool")
} else assert.equal((await storeResults(project, root, parsed)).rolledBackFiles, 0)
const database = await BrainDatabase.getRawInstance(project)
if (mutation) assert.ok(mutated)
const rows = database.prepare(`
  SELECT source.name AS source, r.relationship_type AS kind,
    json_extract(target.annotations, '$.fqn') AS destination,
    json_extract(r.metadata, '$.lateStaticBinding') AS late_static
    , json_extract(r.metadata, '$.external') AS external
  FROM brain_relationship r
  JOIN brain_symbol source ON source.id = r.source_symbol_id
  LEFT JOIN brain_symbol target ON target.id = r.target_symbol_id
  WHERE r.project_id = ? AND r.relationship_type IN ('extends','implements','mixes_in','instantiates','references')
  ORDER BY source, kind, destination
`).all(project) as Array<{ source: string; kind: string; destination: string | null; late_static: number | null; external: number | null }>
const tuples = [...new Map(rows.map(row => {
  const tuple = [row.source, row.kind, row.destination]
  return [JSON.stringify(tuple), tuple]
})).values()].sort()
assert.deepEqual(tuples, [
  ["Demo", "extends", "RightSide\\Base"],
  ["Demo", "implements", "RightSide\\Contract"],
  ["Demo", "mixes_in", "RightSide\\Mix"],
  ["Demo", "references", "RightSide\\Widget"],
  ["Demo", "references", "Application\\Demo"],
  ["MissingUser", "extends", null],
  ["MissingUser", "implements", null],
  ["MissingUser", "mixes_in", null],
  ["Sub", "extends", "Application\\Demo"],
  ["Same", "extends", "LeftSide\\Base"],
  ["Same", "extends", "RightSide\\Base"],
  ["Shared", "extends", "Shared"],
  ["SharedContract", "extends", "SharedContract"],
  ["Marker", "implements", "Marker"],
  ["Token", "implements", "Token"],
  ["badNew", "instantiates", null],
  ["aliasBuiltin", "instantiates", "RightSide\\Widget"],
  ["base", "instantiates", "RightSide\\Base"],
  ["build", "instantiates", "RightSide\\Widget"],
  ["build", "references", "RightSide\\Widget"],
  ["explicit", "instantiates", "LeftSide\\Widget"],
  ["late", "instantiates", null],
  ["lateTyped", "instantiates", null],
  ["lateTyped", "references", null],
  ["globalBuiltin", "instantiates", null],
  ["fromLeft", "references", "LeftSide\\Base"],
  ["fromRight", "references", "RightSide\\Base"],
  ["missing", "instantiates", null],
  ["missing", "references", null],
  ["namespacedBuiltin", "instantiates", null],
  ["own", "instantiates", "Application\\Demo"],
  ["relative", "instantiates", "Application\\LocalWidget"],
].sort())
assert.equal(rows.find(row => row.source === "late")?.late_static, 1)
assert.notEqual(rows.find(row => row.source === "aliasBuiltin")?.external, 1)
assert.equal(rows.find(row => row.source === "globalBuiltin")?.external, 1)
assert.notEqual(rows.find(row => row.source === "namespacedBuiltin")?.external, 1)
const classImports = database.prepare(`
  SELECT json_extract(target.annotations, '$.fqn') AS destination
  FROM brain_relationship r LEFT JOIN brain_symbol target ON target.id = r.target_symbol_id
  WHERE r.project_id = ? AND r.relationship_type = 'imports'
  ORDER BY destination
`).all(project) as Array<{ destination: string }>
assert.deepEqual(classImports.map(row => row.destination), ["Application\\Aliased", "LeftSide\\Base", "RightSide\\Base", "RightSide\\Base", "RightSide\\Contract", "RightSide\\Mix", "RightSide\\Widget", "RightSide\\Widget"])
const topLevel = database.prepare(`
  SELECT r.source_external AS source, r.is_cross_file AS cross_file,
    json_extract(target.annotations, '$.fqn') AS destination
  FROM brain_relationship r LEFT JOIN brain_symbol target ON target.id = r.target_symbol_id
  WHERE r.project_id = ? AND r.source_symbol_id IS NULL AND r.relationship_type = 'instantiates'
`).all(project)
assert.deepEqual(topLevel, [{ source: "consumer.php", cross_file: 1, destination: "RightSide\\Widget" }])
const changes = () => database.prepare("SELECT total_changes() AS count").get().count
const countBefore = changes()
assert.equal(reconcilePhpTypeTargets(database, project).changed, 0)
assert.equal(changes(), countBefore)

if (process.argv.includes("--native")) {
  const quote = (value: string) => "'" + value.replaceAll("\\", "\\\\").replaceAll("'", "\\'") + "'"
  const load = ["global.php", "left.php", "right.php", "consumer.php", "duplicate-owners.php"].map(name => "require " + quote(join(root, name)) + ";").join("\n")
  const output = JSON.parse(execFileSync(process.env.PHP_BIN ?? "php", ["-n", "-r", load + String.raw`
$class = new ReflectionClass('Application\Demo');
$build = $class->getMethod('build');
$object = $class->newInstance();
$out = [
  $class->getParentClass()->getName(), $class->getInterfaceNames()[0], $class->getTraitNames()[0],
  $class->getProperty('field')->getType()->getName(),
  $build->getParameters()[0]->getType()->getName(), $build->getReturnType()->getName(),
  get_class($object->build(new \RightSide\Widget())), get_class($object->explicit()),
  get_class($object->relative()), get_class($object->own()), get_class($object->base()),
  get_class((new \Application\Sub())->late())
  , get_class((new \Application\Sub())->lateTyped()), get_class($object->aliasBuiltin())
  , (new ReflectionClass('Application\Shared'))->getParentClass()->getName()
  , (new ReflectionClass('Application\SharedContract'))->getInterfaceNames()[0]
  , (new ReflectionClass('Application\Marker'))->getInterfaceNames()[0]
  , (new ReflectionClass('Application\Token'))->getInterfaceNames()[0]
  , (new ReflectionMethod('First\Same', 'fromRight'))->getDeclaringClass()->getParentClass()->getName()
  , (new ReflectionMethod('Second\Same', 'fromLeft'))->getDeclaringClass()->getParentClass()->getName()
];
echo json_encode($out, JSON_THROW_ON_ERROR);
`], { encoding: "utf8", timeout: 30_000 }))
  assert.deepEqual(output, ["RightSide\\Base", "RightSide\\Contract", "RightSide\\Mix",
    "RightSide\\Widget", "RightSide\\Widget", "RightSide\\Widget", "RightSide\\Widget",
    "LeftSide\\Widget", "Application\\LocalWidget", "Application\\Demo", "RightSide\\Base", "Application\\Sub",
    "Application\\Sub", "RightSide\\Widget", "Shared", "SharedContract", "Marker", "Token", "RightSide\\Base", "LeftSide\\Base"])
}
if (process.argv.includes("--require-worker")) {
  const logger = { log() {}, write() {} }
  async function snapshot(id: string) {
    const db = await BrainDatabase.getRawInstance(id)
    return db.prepare(`
      SELECT source.name AS source, sf.relative_path AS source_file, r.source_external,
        r.relationship_type AS kind, r.target_external AS spelling, r.line_number AS site,
        target.name AS target, tf.relative_path AS target_file, r.is_cross_file AS cross_file
      FROM brain_relationship r LEFT JOIN brain_symbol source ON source.id = r.source_symbol_id
      LEFT JOIN brain_file sf ON sf.id = source.file_id
      LEFT JOIN brain_symbol target ON target.id = r.target_symbol_id
      LEFT JOIN brain_file tf ON tf.id = target.file_id
      WHERE r.project_id = ? ORDER BY source_file, source, kind, spelling, site, target_file
    `).all(id)
  }
  writeFileSync(join(root, "consumer.php"), inputs["consumer.php"].replaceAll("RightSide\\", "LeftSide\\"))
  assert.equal((await reindexFilesParallel(project, root, [{ path: join(root, "consumer.php"), type: "modified" }], { logger })).errors, 0)
  assert.equal((await indexProjectParallel("php-types-full", root, { logger })).successFiles, Object.keys(inputs).length)
  assert.deepEqual(await snapshot(project), await snapshot("php-types-full"))
  unlinkSync(join(root, "left.php"))
  assert.equal((await reindexFilesParallel(project, root, [{ path: join(root, "left.php"), type: "deleted" }], { logger })).errors, 0)
  assert.equal((await indexProjectParallel("php-types-deleted-full", root, { logger })).successFiles, Object.keys(inputs).length - 1)
  assert.deepEqual(await snapshot(project), await snapshot("php-types-deleted-full"))
  writeFileSync(join(root, "left.php"), inputs["left.php"])
  assert.equal((await reindexFilesParallel(project, root, [{ path: join(root, "left.php"), type: "added" }], { logger })).errors, 0)
  assert.deepEqual(await snapshot(project), await snapshot("php-types-full"))
}
console.log(JSON.stringify({ passed: true, tuples: tuples.length, classImports: classImports.length, native: process.argv.includes("--native"), worker: process.argv.includes("--require-worker") }))
process.exit(0)

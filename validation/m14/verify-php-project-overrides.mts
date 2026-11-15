import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdtempSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
const mutations = {
  private: ['target && target.visibility !== "private"', 'target'],
  static: ['target.static !== method.static || ', ''],
  final: ['target.final || ', ''],
  visibility: [' || visibilityRank(method.visibility) < visibilityRank(target.visibility)', ''],
  ancestry: ['parent = ancestor.parent', 'parent = undefined'],
  withdrawal: ['withdraw.run(projectId, row.id)', '/* stale override intentionally retained */'],
  cycles: ['if (cyclicTypes.has(owner.id)) continue', '/* cyclic class hierarchy accepted */'],
  ambiguity: ['if (declarations?.length !== 1) break', 'if (!declarations?.length) break'],
} as const
const mutation = process.argv.find(arg => arg.startsWith("--mutate="))?.slice("--mutate=".length)
let mutated = false
if (mutation) {
  assert.ok(mutation in mutations, mutation)
  const [before, after] = mutations[mutation as keyof typeof mutations]
  Bun.plugin({
    name: "php-project-override-mutation",
    setup(build) {
      build.onLoad({ filter: /php-project-overrides\.ts$/ }, ({ path }) => {
        const source = readFileSync(path, "utf8")
        assert.ok(source.includes(before), "mutation must reach the production branch")
        mutated = true
        console.log(`APPLIED override mutation: ${mutation}`)
        return { contents: source.replaceAll(before, after), loader: "ts" }
      })
    },
  })
}
const { ASTEngine } = await import("../../src/ast/engine")
const { indexProjectParallel, reindexFilesParallel, storeResults } = await import("../../src/ast/parallel-indexer")
const { BrainDatabase } = await import("../../src/brain/database")
const { reconcilePhpProjectOverrides } = await import("../../src/ast/php-project-overrides")
const { handler: graph } = await import("../../src/mcp/tools/bb_graph/handler")
const { handler: impact } = await import("../../src/mcp/tools/bb_impact/handler")

for (const source of [
  '<?php class Base { function f() {} function f() {} } class Child extends Base { function f() {} }',
  '<?php class Base { function f() {} } class Child extends Base { function f() {} function f() {} }',
]) {
  const result = await ASTEngine.parseFile('/tmp/php-duplicate-methods.php', source)
  assert.equal(result.relationships.filter(edge => edge.type === 'overrides').length, 0, 'duplicate local methods must not select a declaration arbitrarily')
}

const root = mkdtempSync("/tmp/bb-php-project-overrides-")
process.env.BB_DATA_DIR = mkdtempSync("/tmp/bb-php-project-overrides-data-")
const inputs = {
  "base.php": String.raw`<?php namespace Vendor;
class Base {
  protected function Work() {}
  private function hidden() {}
  public static function staticWork() {}
  final public function locked() {}
}
`,
  "decoy.php": String.raw`<?php namespace Decoy;
class Base {
  public function Work() {}
  public function newOnly() {}
}
`,
  "middle.php": String.raw`<?php namespace Bridge;
use Vendor\Base as Imported;
class Middle extends Imported {}
`,
  "child.php": String.raw`<?php namespace Application;
use Bridge\Middle as Imported;
class Child extends Imported {
  public function work() {}
  public function hidden() {}
  public static function staticWork() {}
  public function newOnly() {}
}
`,
  "local.php": String.raw`<?php namespace LocalExample;
class ParentClass { public function localWork() {} }
class Child extends ParentClass { public function localWork() {} }
`,
  "invalid.php": String.raw`<?php namespace Invalid;
class InvalidChild extends \Vendor\Base {
  public function locked() {}
  public function staticWork() {}
  private function Work() {}
}
`,
  "duplicate-one.php": String.raw`<?php namespace Colliding;
class Base { public function duel() {} }
`,
  "duplicate-two.php": String.raw`<?php namespace Colliding;
class Base { public function duel() {} }
`,
  "ambiguous-child.php": String.raw`<?php namespace Application;
class AmbiguousChild extends \Colliding\Base { public function duel() {} }
`,
  "cyclic.php": String.raw`<?php namespace Cyclic;
class First extends Second { public function cycle() {} }
class Second extends First { public function cycle() {} }
`,
}
const results = []
for (const [name, source] of Object.entries(inputs)) {
  const filePath = join(root, name)
  writeFileSync(filePath, source)
  const parsed = await ASTEngine.parseFile(filePath, source)
  assert.deepEqual(parsed.errors, [], name)
  if (name === "cyclic.php") assert.equal(parsed.relationships.filter(edge => edge.type === "overrides").length, 0, "local cycles must not produce override candidates")
  const stat = statSync(filePath)
  results.push({ ...parsed, filePath, fileHash: createHash("sha256").update(source).digest("hex").slice(0, 16),
    sizeBytes: stat.size, lastModified: stat.mtimeMs, success: true })
}
const project = "php-project-overrides"
const logger = { log() {}, write() {} }
const pipeline = process.argv.includes("--require-worker")
if (pipeline) {
  const indexed = await indexProjectParallel(project, root, { logger })
  assert.equal(indexed.successFiles, Object.keys(inputs).length)
  assert.equal(indexed.summary?.parseMode, "worker-pool")
} else {
  assert.equal((await storeResults(project, root, results)).rolledBackFiles, 0)
}
async function snapshot(id: string) {
  const database = await BrainDatabase.getRawInstance(id)
  return database.prepare(`
    SELECT json_extract(so.annotations, '$.fqn') || '::' || source.name AS source,
      json_extract(towner.annotations, '$.fqn') || '::' || target.name AS target,
      sf.relative_path AS source_file, tf.relative_path AS target_file,
      r.target_external AS spelling, r.confidence, r.is_cross_file AS cross_file,
      json_extract(r.metadata, '$.evidenceClass') AS evidence
    FROM brain_relationship r
    JOIN brain_symbol source ON source.id = r.source_symbol_id
    JOIN brain_file sf ON sf.id = source.file_id
    LEFT JOIN brain_symbol so ON so.id = source.owner_symbol_id
    LEFT JOIN brain_symbol target ON target.id = r.target_symbol_id
    LEFT JOIN brain_symbol towner ON towner.id = target.owner_symbol_id
    LEFT JOIN brain_file tf ON tf.id = target.file_id
    WHERE r.project_id = ? AND r.relationship_type = 'overrides' AND sf.language = 'php'
    ORDER BY source
  `).all(id) as Array<{ source: string; target: string; source_file: string; target_file: string; spelling: string; confidence: number; cross_file: number; evidence: string }>
}
const rows = await snapshot(project)
if (mutation) assert.ok(mutated)
assert.deepEqual(rows.map(row => [row.source, row.target]), [
  ["Application\\Child::staticWork", "Vendor\\Base::staticWork"],
  ["Application\\Child::work", "Vendor\\Base::Work"],
  ["LocalExample\\Child::localWork", "LocalExample\\ParentClass::localWork"],
])
assert.deepEqual(rows.map(row => row.cross_file), [1, 1, 0])
assert.ok(rows.every(row => row.evidence === "inferred" && row.confidence === 0.85))
const db = await BrainDatabase.getRawInstance(project)
const totalChanges = () => db.prepare("SELECT total_changes() AS count").get().count
const before = totalChanges()
assert.deepEqual(reconcilePhpProjectOverrides(db, project), { methods: 20, candidates: 3, insertedOrUpdated: 0, withdrawn: 0, changedSourceIds: [], changedTargetIds: [] })
assert.equal(totalChanges(), before, "an unchanged declaration graph must cause zero writes")

const context = { projectId: project, projectPath: root } as Parameters<typeof graph>[1]
const args = { symbol: "Work", file: "base.php", direction: "callers", relationshipTypes: ["overrides"], refresh: false }
const answer = await graph(args, context)
assert.ok(!answer.isError, JSON.stringify(answer.content))
const payload = JSON.parse((answer.content[0] as { text: string }).text)
assert.deepEqual(payload.callers.map((edge: any) => edge.from.name), ["work"])
const affected = await impact(args, context)
assert.ok(!affected.isError, JSON.stringify(affected.content))
assert.deepEqual(JSON.parse((affected.content[0] as { text: string }).text).impact.map((edge: any) => edge.name), ["work"])

if (process.argv.includes("--native")) {
  const quote = (value: string) => "'" + value.replaceAll("\\", "\\\\").replaceAll("'", "\\'") + "'"
  const load = ["base.php", "decoy.php", "middle.php", "child.php", "local.php"]
    .map(name => "require " + quote(join(root, name)) + ";").join("\n")
  const native = execFileSync(process.env.PHP_BIN ?? "php", ["-n", "-r", load + String.raw`
$out = [];
foreach (['Application\Child', 'LocalExample\Child'] as $type) {
  foreach ((new ReflectionClass($type))->getMethods() as $method) {
    if ($method->getDeclaringClass()->getName() !== $type || !$method->hasPrototype()) continue;
    $base = $method->getPrototype();
    $out[] = [$type . '::' . $method->getName(), $base->getDeclaringClass()->getName() . '::' . $base->getName()];
  }
}
sort($out);
echo json_encode($out, JSON_THROW_ON_ERROR);
`], { encoding: "utf8", timeout: 30_000 })
  assert.deepEqual(rows.map(row => [row.source, row.target]), JSON.parse(native))
}

if (pipeline) {
  writeFileSync(join(root, "middle.php"), inputs["middle.php"].replace("use Vendor\\Base", "use Decoy\\Base"))
  assert.equal((await reindexFilesParallel(project, root, [{ path: join(root, "middle.php"), type: "modified" }], { logger })).errors, 0)
  const changed = await snapshot(project)
  assert.deepEqual(changed.map(row => [row.source, row.target]), [
    ["Application\\Child::newOnly", "Decoy\\Base::newOnly"],
    ["Application\\Child::work", "Decoy\\Base::Work"],
    ["LocalExample\\Child::localWork", "LocalExample\\ParentClass::localWork"],
  ])
  assert.equal((await indexProjectParallel("php-override-full", root, { logger })).successFiles, Object.keys(inputs).length)
  assert.deepEqual(changed, await snapshot("php-override-full"))

  unlinkSync(join(root, "decoy.php"))
  assert.equal((await reindexFilesParallel(project, root, [{ path: join(root, "decoy.php"), type: "deleted" }], { logger })).errors, 0)
  assert.deepEqual((await snapshot(project)).map(row => row.source), ["LocalExample\\Child::localWork"])
  writeFileSync(join(root, "decoy.php"), inputs["decoy.php"])
  assert.equal((await reindexFilesParallel(project, root, [{ path: join(root, "decoy.php"), type: "added" }], { logger })).errors, 0)
  assert.deepEqual(await snapshot(project), changed)
}
console.log(JSON.stringify({ passed: true, pipeline, native: process.argv.includes("--native"), overrides: rows.length }))
process.exit(0)

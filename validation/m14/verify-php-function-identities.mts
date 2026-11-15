import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdtempSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const mutations = {
  aliases: ["real-php-analyzer", "this.activeFunctionAliases.get(raw.toLowerCase())", "undefined"],
  fallback: ["real-php-analyzer", "return ns ? [local, raw.toLowerCase()] : [local]", "return [local]"],
  qualified: ["real-php-analyzer", "return [this.resolveClassIdentity(raw, ns, this.activeClassAliases)]", "return [raw.toLowerCase()]"],
  builtin: ["real-php-analyzer", "functionCandidates.length === 1 && PHP_BUILTINS.has(functionCandidates[0])", "PHP_BUILTINS.has(callName.toLowerCase())"],
  kind: ["php-function-resolution", "s.symbol_type = 'function'", "s.symbol_type IN ('function','class','method')"],
  ambiguity: ["php-function-resolution", "if (declarations.length === 1)", "if (declarations.length > 0)"],
  withdrawal: ["php-function-resolution", "const targetId = target?.id ?? null", "const targetId = target?.id ?? row.target_symbol_id"],
  nested: ["real-php-analyzer", "childNs = nm\n", "if (nm && !this.findChildByType(n, 'compound_statement')) childNs = nm\n"],
  source: ["real-php-analyzer", "if (body) this.walkBody(body, symbols, relationships, imports, undefined, ns, name,", "if (body) this.walkBody(body, symbols, relationships, imports, undefined, ns, inFunction,"],
} as const
const mutation = process.argv.find(arg => arg.startsWith("--mutate="))?.slice(9)
let mutated = false
if (mutation) {
  assert.ok(mutation in mutations)
  const [module, before, after] = mutations[mutation as keyof typeof mutations]
  Bun.plugin({ name: "php-function-mutation", setup(build) {
    build.onLoad({ filter: new RegExp(`${module}\\.ts$`) }, ({ path }) => {
      const source = readFileSync(path, "utf8")
      assert.ok(source.includes(before), "production decision must exist")
      mutated = true
      console.log(`APPLIED function mutation: ${mutation}`)
      return { contents: source.replace(before, after), loader: "ts" }
    })
  } })
}
const { ASTEngine } = await import("../../src/ast/engine")
const { indexProjectParallel, reindexFilesParallel, storeResults } = await import("../../src/ast/parallel-indexer")
const { BrainDatabase } = await import("../../src/brain/database")
const { reconcilePhpFunctionTargets } = await import("../../src/ast/php-function-resolution")
const { phpFunctionReferenceCandidates } = await import("../../script/m14/oracles/php-class-names")
const { derivePhpEdges } = await import("../../script/m14/differential")
const { handler: graph } = await import("../../src/mcp/tools/bb_graph/handler")
const { handler: impact } = await import("../../src/mcp/tools/bb_impact/handler")
const root = mkdtempSync("/tmp/bb-php-functions-")
process.env.BB_DATA_DIR = mkdtempSync("/tmp/bb-php-functions-data-")
const inputs = {
  "global.php": String.raw`<?php
function globalOnly() { return __FUNCTION__; }
function shared() { return __FUNCTION__; }
function repeated() { return __FUNCTION__; }
class Decoy { static function orphan() {} }
`,
  "library.php": String.raw`<?php namespace Library;
function Task() { return __FUNCTION__; }
class Task {}
function count() { return __FUNCTION__; }
const MARKER = 1;
class Thing {}
`,
  "decoy.php": String.raw`<?php namespace Decoy;
function Task() { return __FUNCTION__; }
`,
  "shadow.php": String.raw`<?php namespace App;
function shared() { return __FUNCTION__; }
function count() { return __FUNCTION__; }
function add_action() { return __FUNCTION__; }
`,
  "consumer.php": String.raw`<?php namespace App;
use function Library\Task as Imported;
use function Library\{Task as Grouped, count as CustomCount};
use Library\{function Task as Mixed, Thing, const MARKER};
use Library as Space;
use Library\Thing as Imported;
use function Library\count as Space;
function localTask() { return __FUNCTION__; }
function importedCall() { return Imported(); }
function groupedCall() { return Grouped(); }
function mixedCall() { return Mixed(); }
function qualifiedCall() { return \Library\tAsK(); }
function prefixCall() { return Space\Task(); }
function separateAliasTables() { return Space(); }
function relativeCall() { return namespace\localTask(); }
function localCall() { return localTask(); }
function globalCall() { return globalOnly(); }
function shadowCall() { return shared(); }
function aliasCount() { return CustomCount(); }
function qualifiedCount() { return \Library\count(); }
function shadowCount() { return count(); }
function relativeCount() { return namespace\count(); }
function builtinCount() { return \CoUnT([]); }
function wpCall() { return add_action(); }
function missingCall() { return \Absent\Task(); }
function methodDecoy() { return orphan(); }
function tearOff() { return Imported(...); }
function absentRelative() { return namespace\globalOnly(); }
function absentQualified() { return Sub\globalOnly(); }
function missingBuiltin() { return strlen('x'); }
function conditional() { if (false) { function inside() {} } }
`,
  "nested.php": String.raw`<?php namespace Braced {
function enclosing() { function nested() { return \Library\Task(); } }
}
`,
  // Invalid duplicate declarations are indexed as separate files but never loaded together by PHP.
  "duplicate-one.php": String.raw`<?php namespace App; function repeated() {}`,
  "duplicate-two.php": String.raw`<?php namespace APP; function repeated() {}`,
  "ambiguous.php": String.raw`<?php namespace App; function ambiguousCall() { repeated(); }`,
}
const parsed = []
for (const [name, source] of Object.entries(inputs)) {
  const filePath = join(root, name)
  writeFileSync(filePath, source)
  const result = await ASTEngine.parseFile(filePath, source)
  assert.deepEqual(result.errors, [], name)
  const { tree } = await ASTEngine.parseTree(filePath, source)
  const pending = [tree.rootNode]
  while (pending.length) {
    const node = pending.pop()!
    if (node.type === "function_call_expression") {
      const fn = node.childForFieldName("function")!
      const fact = result.relationships.find(r => r.metadata?.phpFunctionReference && r.line_number === fn.startPosition.row + 1)
      if (fact) assert.deepEqual(fact.metadata?.functionCandidates, phpFunctionReferenceCandidates(node, fn.text), `${name}:${fn.text}`)
    }
    pending.push(...node.namedChildren)
  }
  assert.deepEqual(derivePhpEdges(tree.rootNode, true).filter(r => r.label === "calls").map(r => [r.from, r.target]).sort(),
    result.relationships.filter(r => r.type === "calls").map(r => [r.source, r.target]).sort(), name)
  tree.delete()
  if (name === "nested.php") assert.equal(result.symbols.find(s => s.name === "nested")?.metadata?.fqn, "Braced\\nested")
  if (name === "consumer.php") {
    assert.ok(result.relationships.some(r => r.source === "qualifiedCount" && r.type === "calls"))
    assert.ok(!result.relationships.some(r => r.source === "builtinCount" && r.type === "calls"))
  }
  const stat = statSync(filePath)
  parsed.push({ ...result, filePath, success: true, fileHash: createHash("sha256").update(source).digest("hex").slice(0, 16), sizeBytes: stat.size, lastModified: stat.mtimeMs })
}
const project = "php-function-identities"
if (process.argv.includes("--require-worker")) {
  const result = await indexProjectParallel(project, root, { logger: { log() {}, write() {} } })
  assert.equal(result.successFiles, Object.keys(inputs).length)
  assert.equal(result.summary?.parseMode, "worker-pool")
} else assert.equal((await storeResults(project, root, parsed)).rolledBackFiles, 0)
const db = await BrainDatabase.getRawInstance(project)
if (mutation) assert.ok(mutated)
const snapshot = (database: any, id: string) => database.prepare(`
  SELECT source.name AS source, r.relationship_type AS kind, r.target_external AS spelling,
    COALESCE(json_extract(target.annotations, '$.fqn'), target.qualified_name) AS destination, target.symbol_type AS target_kind,
    tf.relative_path AS target_file, r.is_cross_file AS cross_file
  FROM brain_relationship r LEFT JOIN brain_symbol source ON source.id = r.source_symbol_id
  LEFT JOIN brain_symbol target ON target.id = r.target_symbol_id
  LEFT JOIN brain_file tf ON tf.id = target.file_id
  WHERE r.project_id = ? AND json_extract(r.metadata, '$.phpFunctionReference') = 1
  ORDER BY source, kind, spelling
`).all(id) as Array<{ source: string; kind: string; spelling: string; destination: string | null; target_kind: string | null }>
const expectations: Record<string, string | null> = {
  importedCall: "Library\\Task", groupedCall: "Library\\Task", mixedCall: "Library\\Task",
  qualifiedCall: "Library\\Task", prefixCall: "Library\\Task", separateAliasTables: "Library\\count", relativeCall: "App\\localTask",
  localCall: "App\\localTask", globalCall: "globalOnly", shadowCall: "App\\shared",
  aliasCount: "Library\\count", qualifiedCount: "Library\\count", shadowCount: "App\\count",
  relativeCount: "App\\count", wpCall: "App\\add_action", missingCall: null,
  methodDecoy: null, tearOff: "Library\\Task", absentRelative: null,
  absentQualified: null, missingBuiltin: null, ambiguousCall: null,
  nested: "Library\\Task",
}
const rows = snapshot(db, project)
assert.deepEqual(rows.filter(r => r.kind !== "imports").map(r => [r.source, r.destination]).sort(), Object.entries(expectations).sort())
assert.equal(rows.find(r => r.source === "tearOff")?.kind, "uses")
assert.ok(rows.every(r => r.target_kind === null || r.target_kind === "function"))
assert.deepEqual(rows.filter(r => r.kind === "imports").map(r => r.destination).sort(), ["Library\\Task", "Library\\Task", "Library\\Task", "Library\\count", "Library\\count"].sort())
// Force a bad generic name-only binding and prove the authoritative pass withdraws it.
const wrong = db.prepare("SELECT id FROM brain_symbol WHERE name = 'orphan'").get().id
db.prepare("UPDATE brain_relationship SET target_symbol_id = ? WHERE source_symbol_id IN (SELECT id FROM brain_symbol WHERE name = 'methodDecoy') AND relationship_type = 'calls'").run(wrong)
assert.equal(reconcilePhpFunctionTargets(db, project).changed, 1)
assert.equal(snapshot(db, project).find(r => r.source === "methodDecoy")?.destination, null)
const before = db.prepare("SELECT total_changes() AS count").get().count
assert.equal(reconcilePhpFunctionTargets(db, project).changed, 0)
assert.equal(db.prepare("SELECT total_changes() AS count").get().count, before)
const context = { projectId: project, projectPath: root } as Parameters<typeof graph>[1]
const args = { symbol: "shared", file: "shadow.php", direction: "callers", relationshipTypes: ["calls"], refresh: false }
const answer = await graph(args, context)
assert.ok(!answer.isError, JSON.stringify(answer.content))
assert.deepEqual(JSON.parse((answer.content[0] as { text: string }).text).callers.map((edge: any) => edge.from.name), ["shadowCall"])
const globalShared = await graph({ ...args, file: "global.php" }, context)
assert.ok(!globalShared.isError)
assert.deepEqual(JSON.parse((globalShared.content[0] as { text: string }).text).callers, [])
const affected = await impact(args, context)
assert.ok(!affected.isError, JSON.stringify(affected.content))
assert.deepEqual(JSON.parse((affected.content[0] as { text: string }).text).impact.map((edge: any) => edge.name), ["shadowCall"])

if (process.argv.includes("--native")) {
  const quote = (value: string) => "'" + value.replaceAll("\\", "\\\\").replaceAll("'", "\\'") + "'"
  const load = ["global.php", "library.php", "decoy.php", "shadow.php", "consumer.php", "nested.php"].map(name => "require " + quote(join(root, name)) + ";").join("\n")
  const calls = Object.entries(expectations).filter(([name, value]) => value !== null && name !== "tearOff" && name !== "nested")
  const program = load + "\n$out = [];\n" + calls.map(([name]) => "$out[] = \\App\\" + name + "();").join("\n") + String.raw`
$closure = \App\tearOff();
$out[] = (new ReflectionFunction($closure))->getName();
\Braced\enclosing();
$out[] = \Braced\nested();
foreach (['missingCall','methodDecoy','absentRelative','absentQualified'] as $name) {
  try { call_user_func('App\\'.$name); $out[] = 'unexpected success'; }
  catch (Error $e) { $out[] = 'undefined function'; }
}
$out[] = \App\missingBuiltin();
echo json_encode($out, JSON_THROW_ON_ERROR);
`
  const native = JSON.parse(execFileSync(process.env.PHP_BIN ?? "php", ["-n", "-r", program], { encoding: "utf8", timeout: 30_000 }))
  assert.deepEqual(native, [...calls.map(([, value]) => value), "Library\\Task", "Library\\Task", ...Array(4).fill("undefined function"), 1])
}
if (process.argv.includes("--require-worker")) {
  const logger = { log() {}, write() {} }
  const source = inputs["consumer.php"].replace("use function Library\\Task as Imported;", "use function Decoy\\Task as Imported;")
  writeFileSync(join(root, "consumer.php"), source)
  assert.equal((await reindexFilesParallel(project, root, [{ path: join(root, "consumer.php"), type: "modified" }], { logger })).errors, 0)
  assert.equal(snapshot(db, project).find(r => r.source === "importedCall")?.destination, "Decoy\\Task")
  assert.equal(snapshot(db, project).find(r => r.source === "tearOff")?.destination, "Decoy\\Task")
  assert.equal(snapshot(db, project).find(r => r.source === "groupedCall")?.destination, "Library\\Task")
  assert.equal((await indexProjectParallel("php-functions-full", root, { logger })).successFiles, Object.keys(inputs).length)
  assert.deepEqual(snapshot(db, project), snapshot(await BrainDatabase.getRawInstance("php-functions-full"), "php-functions-full"))
  // A declaration added in another file changes an untouched caller's fallback.
  const shadowed = inputs["shadow.php"] + "\nfunction globalOnly() {}\n"
  writeFileSync(join(root, "shadow.php"), shadowed)
  assert.equal((await reindexFilesParallel(project, root, [{ path: join(root, "shadow.php"), type: "modified" }], { logger })).errors, 0)
  assert.equal(snapshot(db, project).find(r => r.source === "globalCall")?.destination, "App\\globalOnly")
  writeFileSync(join(root, "shadow.php"), inputs["shadow.php"])
  assert.equal((await reindexFilesParallel(project, root, [{ path: join(root, "shadow.php"), type: "modified" }], { logger })).errors, 0)
  assert.equal(snapshot(db, project).find(r => r.source === "globalCall")?.destination, "globalOnly")
  assert.deepEqual(snapshot(db, project), snapshot(await BrainDatabase.getRawInstance("php-functions-full"), "php-functions-full"))
  unlinkSync(join(root, "decoy.php"))
  assert.equal((await reindexFilesParallel(project, root, [{ path: join(root, "decoy.php"), type: "deleted" }], { logger })).errors, 0)
  assert.equal(snapshot(db, project).find(r => r.source === "importedCall")?.destination, null)
  assert.equal((await indexProjectParallel("php-functions-deleted", root, { logger })).successFiles, Object.keys(inputs).length - 1)
  assert.deepEqual(snapshot(db, project), snapshot(await BrainDatabase.getRawInstance("php-functions-deleted"), "php-functions-deleted"))
  writeFileSync(join(root, "decoy.php"), inputs["decoy.php"])
  assert.equal((await reindexFilesParallel(project, root, [{ path: join(root, "decoy.php"), type: "added" }], { logger })).errors, 0)
  assert.deepEqual(snapshot(db, project), snapshot(await BrainDatabase.getRawInstance("php-functions-full"), "php-functions-full"))
}
console.log(JSON.stringify({ passed: true, files: Object.keys(inputs).length, functionFacts: rows.length, native: process.argv.includes("--native"), worker: process.argv.includes("--require-worker") }))
process.exit(0)

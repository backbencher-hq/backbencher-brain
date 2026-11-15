import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const mutations = {
  assignments: ['if (left) invalidateVariables(left)', 'if (false && left) invalidateVariables(left)'],
  escape: ['      invalidateVariables(node)', '      if (false) invalidateVariables(node)'],
  dynamic: ['return new Map()', 'return types'],
  unions: ['if (!name || type?.type !== "named_type") continue', 'if (!name || !type) continue; if (type.type === "union_type") type = type.namedChild(0)!'],
} as const
const mutation = process.argv.find(arg => arg.startsWith("--mutate="))?.slice(9)
let mutated = false
if (mutation) {
  assert.ok(mutation in mutations)
  const [before, after] = mutations[mutation as keyof typeof mutations]
  Bun.plugin({ name: "php-parameter-receiver-mutation", setup(build) {
    build.onLoad({ filter: /php-receiver-types\.ts$/ }, ({ path }) => {
      const source = readFileSync(path, "utf8")
      assert.ok(source.includes(before))
      mutated = true
      console.log(`APPLIED parameter mutation: ${mutation}`)
      return { contents: source.replace(before, after), loader: "ts" }
    })
  } })
}
const { ASTEngine } = await import("../../src/ast/engine")
const { indexProjectParallel, reindexFilesParallel, storeResults } = await import("../../src/ast/parallel-indexer")
const { BrainDatabase } = await import("../../src/brain/database")
const { handler: graph } = await import("../../src/mcp/tools/bb_graph/handler")
const root = mkdtempSync("/tmp/bb-php-parameter-receivers-")
process.env.BB_DATA_DIR = mkdtempSync("/tmp/bb-php-parameter-receiver-data-")
const inputs = {
  "types.php": String.raw`<?php namespace Model;
class Alpha { public $field = 'alpha'; const TOKEN = 'alpha'; function run() { return __METHOD__; } function own(self $value) { return $value->field; } }
class Beta { public $field = 'beta'; const TOKEN = 'beta'; function run() { return __METHOD__; } }
`,
  "consumer.php": String.raw`<?php namespace App;
use Model\Alpha as Input;
use Model\Beta;
function positive(Input $value) { return $value->run(); }
function nullable(?Input $value) { return $value?->run(); }
function property(Input $value) { return $value->field; }
function constant(Input $value) { return $value::TOKEN; }
function tearOff(Input $value) { return $value->run(...); }
function other(Beta $value) { return $value->run(); }
function noType($value) { return $value->run(); }
function reassigned(Input $value) { $value = new Beta(); return $value->run(); }
function branch(Input $value, $flag) { if ($flag) $value = new Beta(); return $value->run(); }
function unionType(Input|Beta $value) { return $value->run(); }
function byReference(Input &$value) { return $value->run(); }
function variadic(Input ...$value) { return $value->run(); }
function passEscape(Input $value) { replaceValue($value); return $value->run(); }
function replaceValue(&$input) { $input = new Beta(); }
function aliasEscape(Input $value) { $alias =& $value; $alias = new Beta(); return $value->run(); }
function foreachBind(Input $value) { foreach ([new Beta()] as $value) {} return $value->run(); }
function unsetBind(Input $value) { unset($value); return $value->run(); }
function capture(Input $value) { $fn = function() use (&$value) { $value = new Beta(); }; $fn(); return $value->run(); }
function extraction(Input $value) { extract(['value' => new Beta()]); return $value->run(); }
function dynamic(Input $value) { $name = 'value'; $$name = new Beta(); return $value->run(); }
function nestedShadow(Input $value) {
  $fn = function(Beta $value) { return $value->run(); };
  return [$value->run(), $fn(new Beta())];
}
function arrowShadow(Input $value) {
  $fn = fn(Beta $value) => $value->run();
  return [$value->run(), $fn(new Beta())];
}
function nestedNamed(Input $value) {
  function named(Beta $value) { return $value->run(); }
  return $value->run();
}
`,
}
const parsed = []
for (const [name, source] of Object.entries(inputs)) {
  const filePath = join(root, name)
  writeFileSync(filePath, source)
  const result = await ASTEngine.parseFile(filePath, source)
  assert.deepEqual(result.errors, [])
  for (const edge of result.relationships.filter(edge => edge.metadata?.receiverTypeEvidence === "stable-parameter")) {
    assert.ok(!String(edge.target).includes("."), "inferred receivers retain written member spelling")
  }
  const stat = statSync(filePath)
  parsed.push({ ...result, filePath, success: true, fileHash: createHash("sha256").update(source).digest("hex").slice(0, 16), sizeBytes: stat.size, lastModified: stat.mtimeMs })
}
const project = "php-parameter-receivers"
if (process.argv.includes("--require-worker")) {
  const result = await indexProjectParallel(project, root, { logger: { log() {}, write() {} } })
  assert.equal(result.successFiles, 2)
  assert.equal(result.summary?.parseMode, "worker-pool")
} else assert.equal((await storeResults(project, root, parsed)).rolledBackFiles, 0)
if (mutation) assert.ok(mutated)
const db = await BrainDatabase.getRawInstance(project)
const rows = () => db.prepare(`
  SELECT source.name AS source, r.line_number AS site, r.relationship_type AS kind,
    owner.name AS destination, json_extract(r.metadata, '$.ownerIdentity') AS identity,
    json_extract(r.metadata, '$.receiverTypeEvidence') AS evidence,
    json_extract(r.metadata, '$.evidenceClass') AS tier, r.confidence
  FROM brain_relationship r JOIN brain_symbol source ON source.id = r.source_symbol_id
  LEFT JOIN brain_symbol target ON target.id = r.target_symbol_id
  LEFT JOIN brain_symbol owner ON owner.id = target.owner_symbol_id
  WHERE r.project_id = ? AND json_extract(r.metadata, '$.phpMemberReference') = 1
  ORDER BY site
`).all(project) as Array<{source: string; site: number; kind: string; destination: string | null; identity: string | null; evidence: string | null; tier: string; confidence: number}>
const actual = rows()
const positives = new Map([
  ["positive", "Alpha"], ["nullable", "Alpha"], ["property", "Alpha"], ["constant", "Alpha"],
  ["tearOff", "Alpha"], ["other", "Beta"], ["named", "Beta"], ["nestedNamed", "Alpha"],
  ["own", "Alpha"],
])
for (const [source, target] of positives) {
  const row = actual.find(row => row.source === source)!
  assert.ok(row, source)
  assert.equal(row.destination, target, source)
}
for (const source of ["noType", "reassigned", "branch", "unionType", "byReference", "variadic", "passEscape", "aliasEscape", "foreachBind", "unsetBind", "capture", "extraction", "dynamic"]) {
  const row = actual.find(row => row.source === source)!
  assert.ok(row, source)
  assert.equal(row.destination, null, source)
  assert.equal(row.identity, null, source)
}
for (const source of ["nestedShadow", "arrowShadow"]) {
  assert.deepEqual(actual.filter(r => r.source === source).map(r => r.destination), ["Beta", "Alpha"], source)
}
for (const row of actual.filter(row => row.destination !== null)) {
  assert.equal(row.evidence, "stable-parameter")
  assert.equal(row.tier, "inferred")
  assert.equal(row.confidence, 0.8)
}
const answer = await graph({ symbol: "run", file: "types.php", direction: "callers", relationshipTypes: ["calls"], refresh: false },
  { projectId: project, projectPath: root } as Parameters<typeof graph>[1])
assert.ok(!answer.isError, JSON.stringify(answer.content))
const callers = JSON.parse((answer.content[0] as {text: string}).text).callers
assert.ok(callers.some((edge: any) => edge.from.name === "positive"))
assert.ok(!callers.some((edge: any) => edge.from.name === "reassigned"))
if (process.argv.includes("--native")) {
  const quote = (value: string) => "'" + value.replaceAll("\\", "\\\\").replaceAll("'", "\\'") + "'"
  const load = Object.keys(inputs).map(name => "require " + quote(join(root, name)) + ";").join("\n")
  const native = JSON.parse(execFileSync(process.env.PHP_BIN ?? "php", ["-n", "-r", load + String.raw`
$a = new \Model\Alpha(); $b = new \Model\Beta();
echo json_encode([
  \App\positive($a), \App\nullable($a), \App\nullable(null), \App\property($a), \App\constant($a),
  (\App\tearOff($a))(), \App\other($b), \App\reassigned($a), \App\branch($a, true),
  \App\passEscape($a), \App\aliasEscape($a), \App\foreachBind($a), \App\capture($a),
  \App\extraction($a), \App\dynamic($a), \App\nestedShadow($a), \App\arrowShadow($a), \App\nestedNamed($a)
], JSON_THROW_ON_ERROR);
`], { encoding: "utf8", timeout: 30_000 }))
  assert.deepEqual(native, ["Model\\Alpha::run", "Model\\Alpha::run", null, "alpha", "alpha", "Model\\Alpha::run", "Model\\Beta::run",
    ...Array(8).fill("Model\\Beta::run"), ["Model\\Alpha::run", "Model\\Beta::run"], ["Model\\Alpha::run", "Model\\Beta::run"], "Model\\Alpha::run"])
}
if (process.argv.includes("--require-worker")) {
  const logger = { log() {}, write() {} }
  writeFileSync(join(root, "consumer.php"), inputs["consumer.php"].replace("return $value->run();", "$value = new Beta(); return $value->run();"))
  assert.equal((await reindexFilesParallel(project, root, [{ path: join(root, "consumer.php"), type: "modified" }], { logger })).errors, 0)
  assert.equal(rows().find(row => row.source === "positive")?.destination, null)
  writeFileSync(join(root, "consumer.php"), inputs["consumer.php"])
  assert.equal((await reindexFilesParallel(project, root, [{ path: join(root, "consumer.php"), type: "modified" }], { logger })).errors, 0)
  assert.equal(rows().find(row => row.source === "positive")?.destination, "Alpha")
}
console.log(JSON.stringify({passed: true, facts: actual.length, native: process.argv.includes("--native"), worker: process.argv.includes("--require-worker")}))
process.exit(0)

import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"
const mutation = process.argv.find(arg => arg.startsWith("--mutate="))?.slice("--mutate=".length)
if (mutation) {
  assert.ok(["withdrawal", "tag"].includes(mutation), mutation)
  const module = mutation === "tag" ? "real-php-analyzer" : "member-owner-resolution"
  const before = mutation === "tag" ? "phpMemberReference: true" : "for (const row of unknown)"
  const after = mutation === "tag" ? "phpMemberReference: false" : "for (const row of [])"
  Bun.plugin({
    name: "php-unknown-receiver-mutation",
    setup(build) {
      build.onLoad({ filter: new RegExp(`${module}\\.ts$`) }, ({ path }) => {
        const original = readFileSync(path, "utf8")
        assert.ok(original.includes(before), "mutation must reach production")
        console.log(`APPLIED receiver mutation: ${mutation}`)
        return { contents: original.replaceAll(before, after), loader: "ts" }
      })
    },
  })
}
const { ASTEngine } = await import("../../src/ast/engine")
const { indexProjectParallel, reindexFilesParallel, storeResults } = await import("../../src/ast/parallel-indexer")
const { BrainDatabase } = await import("../../src/brain/database")
const { handler: graph } = await import("../../src/mcp/tools/bb_graph/handler")
const { resolveMemberTargetsByOwner } = await import("../../src/ast/member-owner-resolution")

const source = String.raw`<?php
class Alpha {
  public $value = 'alpha';
  public const TOKEN = 'alpha';
  public function run() { return __METHOD__; }
}
class Beta {
  public $value = 'beta';
  public const TOKEN = 'beta';
  public function run() { return __METHOD__; }
  public static function staticRun() { return __METHOD__; }
}
function run() { return 'function'; }
function callUnknown($service) { return $service->run(); }
function callNullsafe($service) { return $service?->run(); }
function readUnknown($service) { return $service->value; }
function scopeUnknown($type) { return $type::TOKEN; }
function tearoffUnknown($service) { return $service->run(...); }
function known() { return Beta::staticRun(); }
function plain() { return run(); }
`
const root = mkdtempSync("/tmp/bb-php-unresolved-")
process.env.BB_DATA_DIR = mkdtempSync("/tmp/bb-php-unresolved-data-")
const file = join(root, "receivers.php")
writeFileSync(file, source)
const parsed = await ASTEngine.parseFile(file, source)
assert.deepEqual(parsed.errors, [])
const project = "php-unresolved-receivers"
if (process.argv.includes("--require-worker")) {
  const result = await indexProjectParallel(project, root, { logger: { log() {}, write() {} } })
  assert.equal(result.successFiles, 1)
  assert.equal(result.summary?.parseMode, "worker-pool")
} else {
  const stat = statSync(file)
  assert.equal((await storeResults(project, root, [{ ...parsed, filePath: file, success: true,
    fileHash: createHash("sha256").update(source).digest("hex").slice(0, 16), sizeBytes: stat.size, lastModified: stat.mtimeMs }])).rolledBackFiles, 0)
}
const db = await BrainDatabase.getRawInstance(project)
const rows = db.prepare(`
  SELECT source.name AS source, target.name AS target, r.is_cross_file AS cross_file
  FROM brain_relationship r JOIN brain_symbol source ON source.id = r.source_symbol_id
  LEFT JOIN brain_symbol target ON target.id = r.target_symbol_id
  WHERE r.project_id = ? AND r.relationship_type IN ('calls','uses')
    AND instr(r.target_external, char(0)) = 0
  ORDER BY source
`).all(project) as Array<{ source: string; target: string | null; cross_file: number }>
assert.deepEqual(rows, [
  { source: "callNullsafe", target: null, cross_file: 0 },
  { source: "callUnknown", target: null, cross_file: 0 },
  { source: "known", target: "staticRun", cross_file: 0 },
  { source: "plain", target: "run", cross_file: 0 },
  { source: "readUnknown", target: null, cross_file: 0 },
  { source: "scopeUnknown", target: null, cross_file: 0 },
  { source: "tearoffUnknown", target: null, cross_file: 0 },
])
const countChanges = () => db.prepare("SELECT total_changes() AS count").get().count
const before = countChanges()
assert.equal(resolveMemberTargetsByOwner(db, project, { reconcile: true }).reconciledChanges, 0)
assert.equal(countChanges(), before)
const answer = await graph({ symbol: "run", file: "receivers.php", direction: "callers", relationshipTypes: ["calls"], refresh: false },
  { projectId: project, projectPath: root } as Parameters<typeof graph>[1])
assert.ok(!answer.isError, JSON.stringify(answer.content))
const payload = JSON.parse((answer.content[0] as { text: string }).text)
assert.equal(payload.root.candidates, 3)
assert.ok(payload.callers.every((edge: any) => !["callUnknown", "callNullsafe"].includes(edge.from.name)))
const known = await graph({ symbol: "staticRun", file: "receivers.php", direction: "callers", relationshipTypes: ["calls"], refresh: false },
  { projectId: project, projectPath: root } as Parameters<typeof graph>[1])
assert.ok(!known.isError, JSON.stringify(known.content))
assert.deepEqual(JSON.parse((known.content[0] as { text: string }).text).callers.map((edge: any) => edge.from.name), ["known"])
if (process.argv.includes("--native")) {
  const driver = String.raw`
echo json_encode([
  callUnknown(new Alpha()), callUnknown(new Beta()), callNullsafe(null),
  readUnknown(new Alpha()), readUnknown(new Beta()),
  scopeUnknown(Alpha::class), scopeUnknown(Beta::class),
  (tearoffUnknown(new Beta()))(), known(), plain()
], JSON_THROW_ON_ERROR);
`
  const values = JSON.parse(execFileSync(process.env.PHP_BIN ?? "php", ["-n"], { input: source + driver, encoding: "utf8", timeout: 30_000 }))
  assert.deepEqual(values, ["Alpha::run", "Beta::run", null, "alpha", "beta", "alpha", "beta", "Beta::run", "Beta::staticRun", "function"])
}
if (process.argv.includes("--require-worker")) {
  const logger = { log() {}, write() {} }
  writeFileSync(file, source.replace("$service->run();", "Beta::staticRun();"))
  assert.equal((await reindexFilesParallel(project, root, [{ path: file, type: "modified" }], { logger })).errors, 0)
  const nowKnown = db.prepare(`SELECT target.name FROM brain_relationship r
    JOIN brain_symbol caller ON caller.id = r.source_symbol_id
    JOIN brain_symbol target ON target.id = r.target_symbol_id
    WHERE r.project_id = ? AND caller.name = 'callUnknown' AND r.relationship_type = 'calls'`).all(project)
  assert.deepEqual(nowKnown, [{ name: "staticRun" }])
  writeFileSync(file, source)
  assert.equal((await reindexFilesParallel(project, root, [{ path: file, type: "modified" }], { logger })).errors, 0)
  assert.equal(db.prepare(`SELECT r.target_symbol_id AS target FROM brain_relationship r
    JOIN brain_symbol caller ON caller.id = r.source_symbol_id
    WHERE r.project_id = ? AND caller.name = 'callUnknown' AND r.relationship_type = 'calls'`).get(project)?.target, null)
}
console.log(JSON.stringify({ passed: true, unknownReceivers: 5, knownBindings: 2, native: process.argv.includes("--native"), worker: process.argv.includes("--require-worker") }))
process.exit(0)

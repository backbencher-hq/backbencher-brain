import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, unlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"

// Mutate executable decisions at module load, rather than editing the expected
// graph or altering output objects. The separate runner requires assertion
// failures and confirms that each intended production branch was reached.
const mutations = {
  "owner-identity": ["member-owner-resolution", "if (metadata.phpSpecific === true && identity)", "if (false && metadata.phpSpecific === true && identity)"],
  "parent-identity": ["php-member-dispatch", "const matches = identities.get(identity)", "const matches = undefined"],
  "method-case": ["php-member-dispatch", 'kind === "method" ? name.toLowerCase() : name, kind])', 'name, kind])'],
  "relative-receiver": ["real-php-analyzer", ' || receiver.type === "relative_name"', ""],
  "member-kind": ["member-owner-resolution", 'metadata.isConstFetch === true ? "constant"', 'metadata.isConstFetch === true ? "property"'],
  "bound-target-reconciliation": ["member-owner-resolution", '${opts.reconcile ? "" : "AND r.target_symbol_id IS NULL"}', "AND r.target_symbol_id IS NULL"],
} as const
const mutation = process.argv.find(arg => arg.startsWith("--mutate="))?.slice("--mutate=".length)
let mutationApplied = false
if (mutation) {
  assert.ok(mutation in mutations, `unknown mutation ${mutation}`)
  const [module, original, replacement] = mutations[mutation as keyof typeof mutations]
  Bun.plugin({
    name: "php-namespace-algorithm-mutation",
    setup(build) {
      build.onLoad({ filter: new RegExp(`${module}\\.ts$`) }, ({ path }) => {
        const source = readFileSync(path, "utf8")
        assert.ok(source.includes(original), `mutation must reach ${module}: ${original}`)
        mutationApplied = true
        console.log(`APPLIED namespace mutation: ${mutation}`)
        return { contents: source.replace(original, replacement), loader: "ts" }
      })
    },
  })
}
const { ASTEngine } = await import("../../src/ast/engine")
const { indexProjectParallel, reindexFilesParallel, storeResults } = await import("../../src/ast/parallel-indexer")
const { BrainDatabase } = await import("../../src/brain/database")
const { handler: graph } = await import("../../src/mcp/tools/bb_graph/handler")
const { resolveMemberTargetsByOwner } = await import("../../src/ast/member-owner-resolution")

const root = mkdtempSync("/tmp/bb-php-namespace-")
process.env.BB_DATA_DIR = mkdtempSync("/tmp/bb-php-namespace-data-")
const inputs = {
  "left.php": String.raw`<?php namespace LeftSide;
class Service { public static function Run() {} }
class Base { public function inherited() {} }
class Missing { public static function absent() {} }
class UniqueBase { public function unique() {} }
class Members {
  public $Value;
  public const VALUE = 3;
  public static function CaSeMember() {}
  public function readMembers() {
    $this->Value;
    $this->value;
    $this->CaSeMember;
    self::VALUE;
    self::Value;
    self::CASEMEMBER(...);
  }
}
`,
  "right.php": String.raw`<?php namespace RightSide;
class Service { public static function Run() {} }
class Base { public function inherited() {} }
`,
  "consumer.php": String.raw`<?php namespace Application;
use RightSide\Service as Imported;
use RightSide\Base as ParentAlias;
class Child extends ParentAlias {
  public function viaThis() { $this->inherited(); }
  public function viaParent() { parent::inherited(); }
  public function viaAlias() { Imported::Run(); }
  public function viaQualified() { \LeftSide\Service::Run(); }
  public function viaMissing() { Missing::absent(); }
}
`,
  "missing-parent.php": String.raw`<?php namespace Application;
class UnrelatedChild extends \Absent\Base {
  public function missingAncestor() { $this->inherited(); }
}
class UniqueChild extends \Absent\UniqueBase {
  public function missingUniqueAncestor() { $this->unique(); }
}
`,
  "case.php": String.raw`<?php namespace Application;
class CaseChild extends \rightside\base {
  public function caseInsensitive() { $this->INHERITED(); }
}
`,
  "twins.php": String.raw`<?php
namespace Noise {
  class Twin { public function inherited() {} }
}
namespace Application {
  class Twin extends \RightSide\Base {
    public function twinInherited() { $this->inherited(); }
  }
}
`,
  "relative.php": String.raw`<?php namespace RightSide;
function viaRelative() { namespace\Service::Run(); }
`,
  "aliases.php": String.raw`<?php
namespace First {
  use LeftSide\Service as Imported;
  function firstAlias() { Imported::Run(); }
}
namespace Second {
  use RightSide\Service as Imported;
  function secondAlias() { Imported::Run(); }
}
namespace First {
  function resetAlias() { Imported::Run(); }
}
`,
}
const parsed = []
for (const [name, source] of Object.entries(inputs)) {
  const filePath = join(root, name)
  writeFileSync(filePath, source)
  const result = await ASTEngine.parseFile(filePath, source)
  assert.deepEqual(result.errors, [], name)
  parsed.push({ ...result, filePath, fileHash: "fixture", success: true })
}
if (mutation) assert.ok(mutationApplied, "the production algorithm must actually be mutated")
const project = "php-stored-namespaces"
const pipeline = process.argv.includes("--pipeline") || process.argv.includes("--require-worker")
const logger = { log() {}, write() {} }
if (pipeline) {
  const initial = await indexProjectParallel(project, root, { logger })
  assert.equal(initial.successFiles, Object.keys(inputs).length)
  if (process.argv.includes("--require-worker")) assert.equal(initial.summary?.parseMode, "worker-pool")
} else {
  const stored = await storeResults(project, root, parsed)
  assert.equal(stored.rolledBackFiles, 0)
}
const db = await BrainDatabase.getRawInstance(project)
const rows = db.prepare(`
  SELECT s.name AS source, r.target_external AS spelling,
    target.name AS target, json_extract(owner.annotations, '$.fqn') AS owner,
    f.relative_path AS target_file
  FROM brain_relationship r
  JOIN brain_symbol s ON s.id = r.source_symbol_id
  LEFT JOIN brain_symbol target ON target.id = r.target_symbol_id
  LEFT JOIN brain_symbol owner ON owner.id = target.owner_symbol_id
  LEFT JOIN brain_file f ON f.id = target.file_id
  WHERE r.project_id = ? AND r.relationship_type = 'calls'
  ORDER BY source
`).all(project) as Array<{ source: string; spelling: string; target: string | null; owner: string | null; target_file: string | null }>
const bySource = new Map(rows.map(row => [row.source, row]))
assert.equal(rows.length, 13)
for (const source of ["viaThis", "viaParent", "caseInsensitive", "twinInherited"]) {
  assert.equal(bySource.get(source)?.owner, "RightSide\\Base", source)
  assert.equal(bySource.get(source)?.target, "inherited", source)
}
assert.equal(bySource.get("viaAlias")?.owner, "RightSide\\Service")
assert.equal(bySource.get("viaQualified")?.owner, "LeftSide\\Service")
assert.equal(bySource.get("viaRelative")?.owner, "RightSide\\Service")
assert.equal(bySource.get("firstAlias")?.owner, "LeftSide\\Service")
assert.equal(bySource.get("secondAlias")?.owner, "RightSide\\Service")
for (const source of ["viaMissing", "missingAncestor", "missingUniqueAncestor", "resetAlias"]) {
  assert.equal(bySource.get(source)?.target, null, source)
}
const reads = db.prepare(`
  SELECT target.name AS target, target.symbol_type AS kind
  FROM brain_relationship r JOIN brain_symbol source ON source.id = r.source_symbol_id
  LEFT JOIN brain_symbol target ON target.id = r.target_symbol_id
  WHERE r.project_id = ? AND source.name = 'readMembers' AND r.relationship_type = 'uses'
  ORDER BY r.line_number
`).all(project)
assert.deepEqual(reads, [
  { target: "Value", kind: "property" },
  { target: null, kind: null },
  { target: null, kind: null },
  { target: "VALUE", kind: "constant" },
  { target: null, kind: null },
  { target: "CaSeMember", kind: "method" },
])

const totalChanges = () => (db.prepare("SELECT total_changes() AS count").get() as { count: number }).count
const before = totalChanges()
assert.equal(resolveMemberTargetsByOwner(db, project, { reconcile: true }).reconciledChanges, 0)
assert.equal(totalChanges(), before, "reconciling an unchanged graph must perform no row writes")
db.prepare(`
  UPDATE brain_relationship SET target_symbol_id = (
    SELECT target.id FROM brain_symbol target
    JOIN brain_symbol owner ON owner.id = target.owner_symbol_id
    WHERE target.project_id = ? AND target.name = 'Run' AND json_extract(owner.annotations, '$.fqn') = 'LeftSide\\Service'
  ) WHERE project_id = ? AND relationship_type = 'calls'
    AND source_symbol_id IN (SELECT id FROM brain_symbol WHERE project_id = ? AND name IN ('viaAlias', 'viaMissing'))
`).run(project, project, project)
assert.equal(resolveMemberTargetsByOwner(db, project, { reconcile: true }).reconciledChanges, 2)
const restored = db.prepare(`
  SELECT source.name AS source, json_extract(owner.annotations, '$.fqn') AS owner
  FROM brain_relationship r JOIN brain_symbol source ON source.id = r.source_symbol_id
  LEFT JOIN brain_symbol target ON target.id = r.target_symbol_id
  LEFT JOIN brain_symbol owner ON owner.id = target.owner_symbol_id
  WHERE r.project_id = ? AND r.relationship_type = 'calls' AND source.name IN ('viaAlias', 'viaMissing')
  ORDER BY source
`).all(project)
assert.deepEqual(restored, [{ source: "viaAlias", owner: "RightSide\\Service" }, { source: "viaMissing", owner: null }])

// Exercise the real graph tool against the same declarations, rather than
// validating only the SQL rows that indexing produced.
const ctx = { projectId: project, projectPath: root } as Parameters<typeof graph>[1]
for (const [file, expected] of [
  ["right.php", ["secondAlias", "viaAlias", "viaRelative"]],
  ["left.php", ["firstAlias", "viaQualified"]],
] as const) {
  const answer = await graph({ symbol: "Run", file, direction: "callers", relationshipTypes: ["calls"], refresh: false }, ctx)
  assert.ok(!answer.isError, JSON.stringify(answer.content))
  const payload = JSON.parse((answer.content[0] as { text: string }).text)
  assert.deepEqual(payload.callers.map((edge: any) => edge.from.name).sort(), [...expected].sort(), file)
}

if (pipeline) {
  const consumer = join(root, "consumer.php")
  writeFileSync(consumer, inputs["consumer.php"].replace("use RightSide\\Base as ParentAlias", "use LeftSide\\Base as ParentAlias"))
  const update = await reindexFilesParallel(project, root, [{ path: consumer, type: "modified" }], { logger })
  assert.equal(update.errors, 0)
  const inherited = db.prepare(`
    SELECT json_extract(owner.annotations, '$.fqn') AS owner
    FROM brain_relationship r
    JOIN brain_symbol source ON source.id = r.source_symbol_id
    JOIN brain_symbol target ON target.id = r.target_symbol_id
    JOIN brain_symbol owner ON owner.id = target.owner_symbol_id
    WHERE r.project_id = ? AND r.relationship_type = 'calls' AND source.name IN ('viaThis', 'viaParent')
  `).all(project) as Array<{ owner: string }>
  assert.deepEqual(inherited.map(row => row.owner), ["LeftSide\\Base", "LeftSide\\Base"])

  async function snapshot(id: string) {
    const database = await BrainDatabase.getRawInstance(id)
    return database.prepare(`
      SELECT f.relative_path AS source_file, s.name AS source, s.line_start AS source_line,
        r.relationship_type AS kind, r.target_external AS spelling,
        tf.relative_path AS target_file, target.name AS target, target.line_start AS target_line,
        r.line_number AS site, r.confidence, r.is_cross_file AS cross_file
      FROM brain_relationship r
      LEFT JOIN brain_symbol s ON s.id = r.source_symbol_id
      LEFT JOIN brain_file f ON f.id = s.file_id
      LEFT JOIN brain_symbol target ON target.id = r.target_symbol_id
      LEFT JOIN brain_file tf ON tf.id = target.file_id
      WHERE r.project_id = ?
      ORDER BY source_file, source, source_line, kind, spelling, site, target_file, target_line
    `).all(id)
  }
  const rebuilt = await indexProjectParallel("php-namespace-full", root, { logger })
  assert.equal(rebuilt.successFiles, Object.keys(inputs).length)
  assert.deepEqual(await snapshot(project), await snapshot("php-namespace-full"))

  unlinkSync(join(root, "right.php"))
  const deleted = await reindexFilesParallel(project, root, [{ path: join(root, "right.php"), type: "deleted" }], { logger })
  assert.equal(deleted.errors, 0)
  assert.equal(deleted.derived?.pass, "bounded", "deletion-only runs must repair derived relationships")
  const lostReceivers = db.prepare(`
    SELECT source.name FROM brain_relationship r
    JOIN brain_symbol source ON source.id = r.source_symbol_id
    WHERE r.project_id = ? AND r.relationship_type = 'calls' AND r.target_symbol_id IS NOT NULL
      AND source.name IN ('secondAlias', 'viaAlias', 'viaRelative', 'caseInsensitive', 'twinInherited')
  `).all(project)
  assert.deepEqual(lostReceivers, [], "removing a namespace must not bind its receivers to a remaining short-name match")
  const afterDelete = await indexProjectParallel("php-namespace-deleted-full", root, { logger })
  assert.equal(afterDelete.successFiles, Object.keys(inputs).length - 1)
  assert.deepEqual(await snapshot(project), await snapshot("php-namespace-deleted-full"))

  writeFileSync(join(root, "right.php"), inputs["right.php"])
  const restored = await reindexFilesParallel(project, root, [{ path: join(root, "right.php"), type: "added" }], { logger })
  assert.equal(restored.errors, 0)
  assert.equal(restored.indexed, 1)
  assert.deepEqual(await snapshot(project), await snapshot("php-namespace-full"), "restoring a base must repair its untouched callers")
}
console.log(JSON.stringify({ passed: true, pipeline, calls: rows.length, memberReads: reads.length, graphQueries: 2, incrementalAliasAndDeletion: pipeline }))
process.exit(0)

import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtempSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { ASTEngine } from "../../src/ast/engine"
import { storeResults } from "../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../src/brain/database"

// Required interpreters, never a skip: use a system binary or explicitly
// supplied temporary runtime. Expected endpoints come from execution and
// reflection; the expected-side code never reads analyzer output.
const php = process.env.PHP_BIN ?? "php"
const ruby = process.env.RUBY_BIN ?? "ruby"
const root = mkdtempSync("/tmp/bb-native-bindings-")
process.env.BB_DATA_DIR = mkdtempSync("/tmp/bb-native-bindings-data-")
const inputs = {
  "left.php": String.raw`<?php namespace LeftSide;
class Service { public static function Run() { return __METHOD__; } }
class Base { public function inherited() { return __METHOD__; } }
class Missing { public static function absent() { return __METHOD__; } }
`,
  "right.php": String.raw`<?php namespace RightSide;
class Service { public static function Run() { return __METHOD__; } }
class Base { public function inherited() { return __METHOD__; } }
`,
  "consumer.php": String.raw`<?php namespace Application;
use RightSide\Base as ParentAlias;
use RightSide\Service as Imported;
class Child extends ParentAlias {
  function viaThis() { return $this->inherited(); }
  function viaParent() { return parent::inherited(); }
  function viaAlias() { return Imported::Run(); }
  function viaQualified() { return \LeftSide\Service::Run(); }
  function viaMissing() { return Missing::absent(); }
}
class CaseChild extends \rightside\base {
  function viaCase() { return $this->INHERITED(); }
}
`,
  "relative.php": String.raw`<?php namespace RightSide;
function viaRelative() { return namespace\Service::Run(); }
`,
}
const results = []
for (const [name, source] of Object.entries(inputs)) {
  const filePath = join(root, name)
  writeFileSync(filePath, source)
  const parsed = await ASTEngine.parseFile(filePath, source)
  assert.deepEqual(parsed.errors, [], name)
  results.push({ ...parsed, filePath, fileHash: "native", success: true })
}
const project = "native-php-bindings"
assert.equal((await storeResults(project, root, results)).rolledBackFiles, 0)
const db = await BrainDatabase.getRawInstance(project)
const stored = db.prepare(`
  SELECT source.name AS source,
    CASE WHEN target.id IS NULL THEN NULL
      ELSE json_extract(owner.annotations, '$.fqn') || '::' || target.name END AS destination
  FROM brain_relationship r
  JOIN brain_symbol source ON source.id = r.source_symbol_id
  LEFT JOIN brain_symbol target ON target.id = r.target_symbol_id
  LEFT JOIN brain_symbol owner ON owner.id = target.owner_symbol_id
  WHERE r.project_id = ? AND r.relationship_type = 'calls'
  ORDER BY source
`).all(project) as Array<{ source: string; destination: string | null }>
assert.equal(stored.length, 7)
const quotePhp = (value: string) => "'" + value.replaceAll("\\", "\\\\").replaceAll("'", "\\'") + "'"
const nativePhp = `
foreach (json_decode(${quotePhp(JSON.stringify(Object.keys(inputs).map(name => join(root, name))))}, true) as $file) require $file;
$child = new \\Application\\Child();
$out = [];
foreach (['viaThis', 'viaParent', 'viaAlias', 'viaQualified', 'viaMissing'] as $method) {
  try { $out[$method] = $child->$method(); }
  catch (\\Error $error) {
    if ($method !== 'viaMissing' || !str_contains($error->getMessage(), 'Application\\\\Missing')) throw $error;
    $out[$method] = null;
  }
}
$out['viaCase'] = (new \\Application\\CaseChild())->viaCase();
$out['viaRelative'] = \\RightSide\\viaRelative();
ksort($out);
echo json_encode($out, JSON_THROW_ON_ERROR);
`
const executed = JSON.parse(execFileSync(php, ["-n", "-r", nativePhp], { encoding: "utf8", timeout: 30_000 }))
assert.deepEqual(Object.fromEntries(stored.map(row => [row.source, row.destination])), executed)

const rubySource = `class Base
  def self.class_only; end
  def instance_only; end
  def instance_ok; end
  def self.class_ok; end
  class << self
    def block_ok; end
  end
end
class Child < Base
  def class_only; end
  def self.instance_only; end
  def instance_ok; end
  def self.class_ok; end
  class << self
    def block_ok; end
  end
end
class Mid < Base; end
class GrandChild < Mid
  def instance_ok; end
  def self.class_ok; end
end
`
const rubyResult = await ASTEngine.parseFile("native.rb", rubySource)
assert.deepEqual(rubyResult.errors, [])
const rubyDriver = `
owners = []
[Child, GrandChild].each do |klass|
  klass.instance_methods(false).each do |name|
    inherited = klass.instance_method(name).super_method
    owners << [klass.name + "." + name.to_s, "instance", inherited.owner.name, name.to_s] if inherited
  end
  klass.singleton_class.instance_methods(false).each do |name|
    inherited = klass.singleton_class.instance_method(name).super_method
    if inherited
      owner = inherited.owner == Base.singleton_class ? Base.name : inherited.owner.to_s
      owners << [klass.name + "." + name.to_s, "singleton", owner, name.to_s]
    end
  end
end
owners.sort.each { |tuple| puts tuple.join("\\t") }
`
const rubyRows = execFileSync(ruby, ["--disable-gems", "-"], { input: rubySource + rubyDriver, encoding: "utf8", timeout: 30_000 })
  .trim().split("\n").map(line => line.split("\t"))
assert.equal(rubyRows.length, 5)
const inferred = rubyResult.relationships.filter(edge => edge.type === "overrides").map(edge => {
  const dot = edge.target.lastIndexOf(".")
  return [edge.source, edge.metadata?.dispatchKind, edge.target.slice(0, dot), edge.target.slice(dot + 1)]
}).sort()
assert.deepEqual(inferred, rubyRows)

console.log(JSON.stringify({
  passed: true,
  php: execFileSync(php, ["-n", "-r", "echo PHP_VERSION;"], { encoding: "utf8" }),
  ruby: execFileSync(ruby, ["--disable-gems", "-e", "print RUBY_VERSION"], { encoding: "utf8" }),
  phpCallBindings: stored.length,
  rubyOverrides: rubyRows.length,
}))
process.exit(0)

import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { ASTEngine } from "../../src/ast/engine"
import { parseFile as parseWorkerFile } from "../../src/ast/pool-worker"

const root = mkdtempSync("/tmp/bb-php-receiver-")
const file = join(root, "receivers.php")
const source = String.raw`<?php
namespace Fixture {
  use Project\Base as Imported;
  class Child extends Imported {
    function callReceivers() {
      Imported::Work();
      namespace\Local::Work();
      SELF::Work();
      parent::Work();
    }
  }
  class Local { public static function Work() {} }
}
namespace Fixture {
  function noAlias() { Imported::Work(); }
}
`
writeFileSync(file, source)
const analyzed = await ASTEngine.parseFile(file, source)
assert.deepEqual(analyzed.errors, [])
const expected = [
  ["callReceivers", "project\\base"],
  ["callReceivers", "fixture\\local"],
  ["callReceivers", "fixture\\child"],
  ["callReceivers", "project\\base"],
  ["noAlias", "fixture\\imported"],
]
assert.deepEqual(analyzed.relationships.filter(edge => edge.type === "calls")
  .map(edge => [edge.source, edge.metadata?.ownerIdentity]), expected)
const child = analyzed.symbols.find(symbol => symbol.name === "Child")!
assert.deepEqual(child.metadata?.superTypeIdentities, ["project\\base"])

// Exercise the production projection even when OS-level worker spawning is
// unavailable. The end-to-end companion check also requires actual workers.
const worker = await parseWorkerFile(file, root)
assert.equal(worker.success, true)
assert.notEqual(worker.fallback, true)
const transported = worker.symbols?.find(symbol => symbol.name === "Child")
assert.equal(transported?.metadata?.phpSpecific, true)
assert.equal(transported?.metadata?.fqn, "Fixture\\Child")
assert.deepEqual(transported?.metadata?.superTypeIdentities, child.metadata?.superTypeIdentities)
assert.deepEqual(worker.relationships?.filter(edge => edge.type === "calls")
  .map(edge => [edge.source, edge.metadata?.ownerIdentity]), expected)
console.log("PHP receiver identities and canonical heritage survive the worker projection")
process.exit(0)

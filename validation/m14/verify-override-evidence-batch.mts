import assert from "node:assert/strict"
import { parseFile } from "../../src/ast/engine"

const csharp = await parseFile("Overrides.cs", `
class Parent { public virtual void Run(int value) {} }
class ExactChild : Parent { public override void Run(int value) {} }
class ExternalChild : Remote { public override void Run(int value) {} }
class UnverifiedChild : Unknown { public override void Run(int value) {} }
`, { overrideCompanion: new Map([["Remote", new Set(["Run"])]]) })
assert.deepEqual(csharp.errors, [])
const overrideOf = (source: string) => csharp.relationships.find(edge => edge.type === "overrides" && edge.source === source)
assert.equal(overrideOf("ExactChild.Run")?.metadata?.evidenceClass, "structural")
assert.equal(overrideOf("ExternalChild.Run")?.metadata?.evidenceClass, "inferred")
assert.equal(overrideOf("ExternalChild.Run")?.metadata?.declaringType, "Remote")
assert.equal(overrideOf("UnverifiedChild.Run")?.confidence, 0.5)

const php = await parseFile("Overrides.php", `<?php
class Grandparent {
  protected function run() {}
  private function hidden() {}
}
class ParentClass extends Grandparent {}
class Child extends ParentClass {
  protected function run() {}
  public function hidden() {}
}
`)
assert.deepEqual(php.errors, [])
const phpEdges = php.relationships.filter(edge => edge.type === "overrides")
assert.ok(phpEdges.some(edge => edge.source === "Child.run" && edge.target === "Grandparent.run"))
assert.ok(!phpEdges.some(edge => edge.source === "Child.hidden"))
const swift = await parseFile("Overrides.swift", `
class Service: RemoteBase {
  override func handle(_ value: Int) {}
}
`, { overrideCompanion: new Map([["RemoteBase", new Set(["handle"])]]) })
assert.deepEqual(swift.errors, [])
const swiftEdge = swift.relationships.find(edge => edge.type === "overrides" && edge.source === "Service.handle")
assert.equal(swiftEdge?.target, "RemoteBase.handle")
assert.equal(swiftEdge?.confidence, 0.65)
assert.equal(swiftEdge?.metadata?.evidenceClass, "inferred")
console.log("C#, PHP, and Swift override checks passed")
process.exit(0)

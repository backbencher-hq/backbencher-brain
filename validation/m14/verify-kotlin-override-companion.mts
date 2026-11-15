import assert from "node:assert/strict"
import { parseFile } from "../../src/ast/engine"

const source = `open class Wrong {
    open fun save(value: Int) {}
}
interface Right {
    fun save(value: String)
}
class Child : Wrong(), Right {
    override fun save(value: String) {}
}
open class Generic<T> {
    open fun save(value: T) {}
}
class GenericChild : Generic<Int>(), Right {
    override fun save(value: String) {}
}
class RemoteChild : RemoteParent() {
    override fun run() {}
}
`
const overrideCompanion = new Map([
  ["Wrong", new Set(["save"])],
  ["Right", new Set(["save"])],
  ["RemoteParent", new Set(["run"])],
])
const result = await parseFile("Override.kt", source, { overrideCompanion })
assert.deepEqual(result.errors, [])
const edges = result.relationships.filter(edge => edge.type === "overrides")
const verified = edges.find(edge => edge.source === "Child.save")
assert.equal(verified?.target, "Right.save")
assert.equal(verified?.metadata?.reasonCode, "in-file-verified")
assert.equal(edges.find(edge => edge.source === "GenericChild.save")?.target, "Right.save")
const remote = edges.find(edge => edge.source === "RemoteChild.run")
assert.equal(remote?.target, "RemoteParent.run")
assert.equal(remote?.metadata?.reasonCode, "companion-index")
assert.equal(remote?.metadata?.evidenceClass, "inferred")
console.log("Kotlin override companion preserves signature evidence")
process.exit(0)

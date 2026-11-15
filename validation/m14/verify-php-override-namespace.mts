import assert from "node:assert/strict"
import { ASTEngine } from "../../src/ast/engine"

const file = "override-namespace.php"
const source = String.raw`<?php
namespace Shared {
    class Ancestor { protected function Run() {} }
}
namespace Application {
    use Shared\{Ancestor as Imported};
    class Child extends Imported { protected function run() {} }
    class Local { public function go() {} }
    class Relative extends namespace\Local { public function go() {} }
}
namespace Application {
    class Separate extends Imported { protected function run() {} }
}
namespace Wrong {
    class Missing { public function act() {} }
    class Duplicate { public function act() {} }
}
namespace Right {
    class Duplicate { public function act() {} }
    class Absent extends Missing { public function act() {} }
    class Ambiguous extends Duplicate { public function act() {} }
    class Qualified extends \Shared\Ancestor { protected function run() {} }
}
`
const { tree } = await ASTEngine.parseTree(file, source)
assert.equal(tree.rootNode.hasError, false)
tree.delete()
const parsed = await ASTEngine.parseFile(file, source, {
  overrideCompanion: new Map([["Missing", new Set(["act"])]]),
})
assert.deepEqual(parsed.errors, [])
const overrides = parsed.relationships.filter(edge => edge.type === "overrides")
assert.deepEqual(overrides.map(edge => [edge.source, edge.target, edge.metadata?.reasonCode]).sort(), [
  ["Child.run", "Ancestor.Run", "in-file-verified"],
  ["Qualified.run", "Ancestor.Run", "in-file-verified"],
  ["Relative.go", "Local.go", "in-file-verified"],
])
const semicolon = await ASTEngine.parseFile(file, String.raw`<?php
namespace Shared;
class Ancestor { public function run() {} }
namespace Application;
use Shared\Ancestor as Imported;
class First extends Imported { public function run() {} }
namespace Application;
use function Shared\Ancestor as Imported;
class Second extends Imported { public function run() {} }
`)
assert.deepEqual(semicolon.errors, [])
assert.deepEqual(semicolon.relationships.filter(edge => edge.type === "overrides").map(edge => edge.source), ["First.run"])
console.log("PHP override namespace, alias, case and ambiguity checks passed")
process.exit(0)

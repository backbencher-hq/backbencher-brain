/**
 * THE GRAMMAR SHAPE BEHIND `field-receiver-probe.ts` — a class member's body sits behind a
 * `method_signature` WRAPPER, a top-level function's does not.
 *
 * This is the evidence for the finding in `validation/m14/verification/DART-FIX.md` §2.1: the
 * walker hands a body's previous named sibling to `extractParameters`, which reads a
 * `formal_parameter_list` DIRECT child of whatever it is given (`findChildByType`,
 * `real-dart-analyzer.ts:4877`). For a method that node is `method_signature`, whose direct
 * children are the inner signature — `function_signature`, `constructor_signature`,
 * `setter_signature`, `operator_signature` — so the list is one level deeper and the reader
 * returns NOTHING. `findInnerSignature` is the unwrapper the same walker already applies to the
 * same sibling for the call context.
 *
 * Printed as one line per declaration, so the four class-member spellings can be compared side by
 * side with the top-level function that WORKS.
 *
 * Usage: bun run validation/m14/fixtures/dart/_tree-probe.ts
 */
import { getParser } from "../../../../src/ast/engine"

const SRC = `class Helper { void poke() {} }
class A { A(Helper p) { p.poke(); } }
class B { set value(Helper p) { p.poke(); } }
class C { static void run(Helper p) { p.poke(); } }
class D { operator +(Helper p) { p.poke(); } }
void topLevel(Helper p) { p.poke(); }
`
const parser = await getParser("dart")
const tree = parser.parse(SRC)
console.log(
  tree.rootNode
    .toString()
    .replace(/\(class_definition name: \(identifier\) /g, "\n(CLASS ")
    .replace(/\(formal_parameter \(type_identifier\) name: \(identifier\)\)/g, "(PARAM:type_identifier name:identifier)"),
)

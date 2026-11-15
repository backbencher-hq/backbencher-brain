/**
 * UNTYPED-METHOD-AS-CONSTRUCTOR — the census.
 *
 * ## The defect
 *
 * `tree-sitter-dart` has no separate node for a method declared WITHOUT a
 * return type. `class A { noRetType() { } }` parses as
 *
 *     method_signature
 *       constructor_signature        <- the untyped method
 *         identifier  noRetType
 *         formal_parameter_list
 *
 * which is byte-identical in shape to a real constructor `A()`. The analyzer
 * reads the inner node's TYPE and routes both to `processConstructor`, so every
 * untyped method in the corpus is published as a `constructor` symbol named
 * `constructor`, and the method's real name is never published at all.
 *
 * ## The discriminator, and why it is the NAME
 *
 * The obvious test — "is the inner signature's parent a `method_signature`?" —
 * is WRONG, and this census measures that. The grammar ALSO wraps real
 * constructors in `method_signature` (`factory A.named()`, `A.named()`), so
 * that test classifies 559 real constructors as methods. The contingency table
 * below is the measurement of both tests against each other.
 *
 * The correct test is Dart's own naming rule: a constructor is named after its
 * class, and the unnamed one is spelled `.new`. A MEMBER may not share its
 * class's name (it is a compile error), so
 *
 *     lead === owner  ||  lead === "new"
 *
 * identifies a constructor and nothing else does. It reads the `name` FIELD of
 * the signature node, which the grammar populates for both shapes.
 *
 * ## What the analyzer must then do
 *
 * A signature that fails the naming rule is a METHOD: it goes to
 * `processFunctionOrMethod`, which publishes the member under its own name with
 * kind Method. That is not a new emission — the method symbol was being
 * SUPPRESSED while its body was still walked, so the calls inside an untyped
 * method had no owner to attribute to.
 *
 * ## No regex
 *
 * Node types and the `name` field only. No source text is scanned.
 */
import * as path from "node:path"
import { readFileSync } from "node:fs"
import { dartSample } from "./collect-sample"

const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
await WSP.init({
  locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm"),
})
const p = new WSP()
p.setLanguage(await (wts as any).Language.load(path.join(process.cwd(), "wasm", "tree-sitter-dart.wasm")))

const CTOR = new Set([
  "constructor_signature",
  "factory_constructor_signature",
  "constant_constructor_signature",
  "redirecting_factory_constructor_signature",
])
const TYPE_OWNER = new Set([
  "class_definition",
  "mixin_declaration",
  "enum_declaration",
  "extension_declaration",
])

/**
 * The owner name the ANALYZER resolves.
 *
 * `childForFieldName("name")` is empty on a `mixin_declaration`, so the
 * analyzer falls back to a direct `identifier` child there. This probe must do
 * the same or every mixin member reads as ownerless.
 */
function ownerNameOf(n: any): string | null {
  const nf = n.childForFieldName("name")
  if (nf) return nf.text
  for (let i = 0; i < n.namedChildCount; i++) {
    const c = n.namedChild(i)
    if (c.type === "identifier") return c.text
  }
  return null
}

function leadIdentifier(n: any): string | null {
  const nf = n.childForFieldName("name")
  if (nf) return nf.text
  for (let i = 0; i < n.namedChildCount; i++) {
    const c = n.namedChild(i)
    if (c.type === "identifier" || c.type === "type_identifier") return c.text
  }
  return null
}

interface Row {
  file: string
  line: number
  nodeType: string
  parent: string
  lead: string
  owner: string | null
  ownerKind: string
  text: string
}

/** DISCRIMINATOR A — parent node. Reported to show it does not work. */
const aSaysCtor = (r: Row): boolean => r.parent === "method_signature"

/** DISCRIMINATOR B — the Dart naming rule. This is the fix's test. */
const bSaysCtor = (r: Row): boolean => r.lead === "new" || (r.owner !== null && r.lead === r.owner)

const sample = dartSample()
const rows: Row[] = []
let parsed = 0
for (const f of sample) {
  let tree: any
  try {
    tree = p.parse(readFileSync(f, "utf-8"))
  } catch {
    continue
  }
  parsed++
  const rec = (n: any, owner: string | null, ownerKind: string): void => {
    let o = owner
    let ok = ownerKind
    if (TYPE_OWNER.has(n.type)) {
      const nm = ownerNameOf(n)
      if (nm !== null) {
        o = nm
        ok = n.type
      }
    }
    if (CTOR.has(n.type)) {
      rows.push({
        file: f,
        line: n.startPosition.row + 1,
        nodeType: n.nodeType ?? n.type,
        parent: n.parent?.type ?? "?",
        lead: leadIdentifier(n) ?? "<none>",
        owner: o,
        ownerKind: ok,
        text: n.text.split("\n")[0].slice(0, 70),
      })
    }
    for (let i = 0; i < n.namedChildCount; i++) rec(n.namedChild(i), o, ok)
  }
  rec(tree.rootNode, null, "<none>")
  tree.delete()
}

const ay_by = rows.filter((r) => aSaysCtor(r) && bSaysCtor(r)).length
const ay_bn = rows.filter((r) => aSaysCtor(r) && !bSaysCtor(r)).length
const an_by = rows.filter((r) => !aSaysCtor(r) && bSaysCtor(r)).length
const an_bn = rows.filter((r) => !aSaysCtor(r) && !bSaysCtor(r)).length
const misfires = rows.filter((r) => !bSaysCtor(r) && r.owner !== null)
const ownerless = rows.filter((r) => !bSaysCtor(r) && r.owner === null)

console.log(`UNTYPED-METHOD-AS-CONSTRUCTOR — ${parsed} files parsed of a ${sample.length}-file stride sample`)
console.log(`constructor-shaped signatures in the parse trees: ${rows.length}`)
console.log("")
console.log("DISCRIMINATOR CROSS-TAB")
console.log("  A: parent is method_signature — the shape the grammar gives an UNTYPED method")
console.log("  B: lead identifier === owner name, or === \"new\" — the Dart constructor naming rule")
console.log("")
console.log("              B=ctor    B=method    total")
console.log(`    A=ctor    ${String(ay_by).padStart(8)}${String(ay_bn).padStart(11)}${String(ay_by + ay_bn).padStart(10)}`)
console.log(`    A=method  ${String(an_by).padStart(8)}${String(an_bn).padStart(11)}${String(an_by + an_bn).padStart(10)}`)
console.log(`    total     ${String(ay_by + an_by).padStart(8)}${String(ay_bn + an_bn).padStart(11)}${String(rows.length).padStart(10)}`)
console.log("")
console.log(`  A alone would misclassify ${an_by} REAL constructors as methods — so A is not the test.`)
console.log(`  B is exact on both classes: ${ay_by + an_by} constructors, ${ay_bn + an_bn} untyped methods.`)
console.log("")
console.log(`MISFIRED — published as \`constructor\` when the node is a METHOD:`)
console.log(`  with a resolvable owner: ${misfires.length} of ${rows.length} (${((100 * misfires.length) / rows.length).toFixed(1)}%)`)
console.log(`  ownerless (extension type / no enclosing type): ${ownerless.length}`)
console.log("")
const perFile = new Map<string, number>()
for (const r of misfires) perFile.set(r.file, (perFile.get(r.file) ?? 0) + 1)
console.log(`  files holding >=1 misfired method: ${perFile.size} of ${parsed} (${((100 * perFile.size) / parsed).toFixed(1)}%)`)
console.log("  worst 15:")
for (const [f, n] of [...perFile.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
  console.log(`    ${String(n).padStart(4)}  ${f.replace("/home/ishaq2321/bb_tests/repositories/", "")}`)
}
console.log("")
const byNode = new Map<string, { ctor: number; method: number }>()
for (const r of rows) {
  const k = bSaysCtor(r) ? "ctor" : "method"
  const e = byNode.get(r.nodeType) ?? { ctor: 0, method: 0 }
  e[k]++
  byNode.set(r.nodeType, e)
}
console.log("  node type -> (real constructor / untyped method):")
for (const [k, v] of [...byNode.entries()].sort((x, y) => y[1].ctor + y[1].method - (x[1].ctor + x[1].method))) {
  console.log(`    ${k.padEnd(44)}${String(v.ctor).padStart(6)}${String(v.method).padStart(9)}`)
}
console.log("")
const byOwner = new Map<string, number>()
for (const r of misfires) byOwner.set(r.ownerKind, (byOwner.get(r.ownerKind) ?? 0) + 1)
console.log("  enclosing type of a misfired method:")
for (const [k, n] of [...byOwner.entries()].sort((a, b) => b[1] - a[1])) console.log(`    ${k.padEnd(28)}${n}`)
console.log("")
console.log("  20 misfires verbatim (owner / name the analyzer published instead / source text):")
for (const r of misfires.slice(0, 20)) {
  console.log(`    ${(r.owner ?? "?").padEnd(24)}${r.lead.padEnd(34)}${r.text}`)
}
console.log("")
console.log(`  ownerless rows verbatim (${ownerless.length}):`)
for (const r of ownerless.slice(0, 10)) console.log(`    ownerKind=${r.ownerKind.padEnd(24)}${r.text}`)
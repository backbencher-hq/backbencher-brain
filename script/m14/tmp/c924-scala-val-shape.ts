// c924-scala-val-shape — the node behind `val A, B = Value` (the scala E pattern-list site)
// and the instance_expression behind the synthesized anonymous-class name.
//
// The choice the fix has to make — split the list into one symbol per declared name, or
// refuse the pattern like the S1.19 tuple precedent — depends on what the grammar actually
// builds, so this reads the tree instead of guessing.
//
// Run: bun script/m14/tmp/c924-scala-val-shape.ts
import * as fs from "node:fs"
import * as path from "node:path"

const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const VAL_FILE = "/home/ishaq2321/bb_tests/repositories/scala3/sbt-test/scala2-compat/i24998/lib/EnumerationTests.scala"
const ANON_FILE = "/home/ishaq2321/bb_tests/repositories/cats-effect/std/native/src/main/scala/cats/effect/std/SecureRandomCompanionPlatform.scala"

const wts: any = await import("web-tree-sitter")
const P: any = wts.Parser ?? wts.default ?? wts
const L: any = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const language: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-scala.wasm")))
const p = new P()
p.setLanguage(language)
const flat = (s: string) => String(s).replace(/\s+/g, " ")

const dump = (n: any, label: string) => {
  console.log(`\n--- ${label} <${n.type}> line=${n.startPosition.row + 1} text=${JSON.stringify(flat(n.text).slice(0, 90))}`)
  for (let i = 0; i < n.childCount; i++) {
    const c = n.child(i)
    const f = typeof n.fieldNameForChild === "function" ? n.fieldNameForChild(i) : null
    console.log(`   [${i}]${f ? `(${f})` : ""}${c.isNamed ? " named" : " TOKEN"} <${c.type}> text=${JSON.stringify(flat(c.text).slice(0, 70))}`)
  }
}

const find = (root: any, pred: (n: any) => boolean, smallest = true): any => {
  let best: any = null
  const stack = [root]
  while (stack.length) {
    const n = stack.pop()!
    if (pred(n) && (!smallest || !best || n.endIndex - n.startIndex < best.endIndex - best.startIndex)) best = n
    for (let i = 0; i < n.namedChildCount; i++) stack.push(n.namedChild(i))
  }
  return best
}

// 1. `val A, B = Value`
{
  const tree = p.parse(fs.readFileSync(VAL_FILE, "utf8"))
  const vd = find(tree.rootNode, (n) => n.type === "val_definition" && flat(n.text).includes("A, B"))
  if (!vd) console.log("val_definition not found")
  else {
    dump(vd, "val_definition")
    const pat = vd.childForFieldName("pattern")
    console.log(`   childForFieldName("pattern") = ${pat ? `<${pat.type}> "${flat(pat.text)}"` : "null"}`)
    if (pat) {
      dump(pat, "the pattern field")
      console.log(`   pattern named children: ${[...Array(pat.namedChildCount).keys()].map((i) => `<${pat.namedChild(i).type}>`).join(", ")}`)
      for (let i = 0; i < pat.namedChildCount; i++) console.log(`      leaf[${i}] <${pat.namedChild(i).type}> = ${JSON.stringify(flat(pat.namedChild(i).text))}`)
    }
  }
}

// 2. the anonymous class expression
{
  const tree = p.parse(fs.readFileSync(ANON_FILE, "utf8"))
  const ie = find(tree.rootNode, (n) => n.type === "instance_expression" && flat(n.text).includes("with"))
  if (!ie) console.log("instance_expression with `with` not found")
  else {
    dump(ie, "instance_expression")
    const tn = ie.namedChild(0)
    if (tn) {
      dump(tn, "type node (namedChild(0))")
      const base = tn.childForFieldName("base") ?? tn.namedChild(0)
      if (base) {
        dump(base, "the `base` of the compound type")
        // The head type name: the LEFT-MOST type_identifier in source order, which is what
        // the patch has to reach — not the smallest node, and not the raw text.
        let head: any = null
        const walk = [base]
        while (walk.length) {
          const c = walk.shift()!
          if (c.type === "type_identifier" || c.type === "identifier") { head = c; break }
          for (let i = 0; i < c.namedChildCount; i++) walk.push(c.namedChild(i))
        }
        console.log(`   left-most identifier in source order: <${head?.type}> = ${JSON.stringify(head?.text)}`)
      }
      const g = find(tn, (n) => n.type === "generic_type")
      if (g) dump(g, "the `extra` supertype (generic_type)")
    }
  }
}

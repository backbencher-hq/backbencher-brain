// Probe: what does the PINNED csharp grammar actually produce for `record struct`,
// and what KIND does the real analyzer publish for it?
//
// Context: F1 (2026-09-23 regeneration) convicts two node-type literals the
// analyzer tests against — `record_struct_declaration` (9 sites) and
// `constraint_clause` — because the pinned wasm has neither (probe:
// script/m14/tmp/f1-csharp-record-probe.ts). The kind decision at
// real-csharp-analyzer.ts:952 is `stringIncludes(type, "struct")`, which is FALSE
// for `record_declaration` — so if the grammar yields record_declaration for
// `record struct`, the lane publishes kind=Class where Roslyn says Struct.
import * as fs from "fs"
import * as path from "path"

const ROOT = process.cwd()
const SRC = [
  "namespace Probe;",
  "public record class RC(int A);",
  "public record struct RS(double X, double Y);",
  "public struct Plain { public int F; }",
  "public class G<T> where T : class {",
  "  public T Make<U>(U u) where U : struct => default!;",
  "}",
].join("\n")

async function main() {
  const wts: any = await import("web-tree-sitter")
  const ParserClass = wts.Parser ?? wts.default ?? wts
  const Language = wts.Language ?? wts.default?.Language
  await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const grammar = await Language.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-c_sharp.wasm")))
  const parser = new ParserClass()
  parser.setLanguage(grammar)
  const tree = parser.parse(SRC)
  const types = new Set<string>()
  const walk = (n: any) => { types.add(n.type); for (const c of n.namedChildren) walk(c) }
  walk(tree.rootNode)
  console.log("TREE (root:", tree.rootNode.type, ")")
  console.log(tree.rootNode.toString())
  console.log("\ndeclaration-ish node types seen:", JSON.stringify([...types].filter(t => /declaration|struct|constraint/.test(t))))
  console.log("ERROR nodes:", (tree.rootNode.toString().match(/ERROR|MISSING/g) ?? []).length)

  // The discriminator question: `record struct` and `record class` parse as the SAME
  // node type, so something else must tell them apart. Print every child (NAMED and
  // unnamed token) of each top-level type declaration, with its text.
  console.log("\nCHILDREN of each top-level declaration (named + unnamed tokens):")
  for (const c of tree.rootNode.namedChildren) {
    const inner = c.namedChildren
    const target = /record|struct_declaration|class_declaration/.test(c.type) ? c : inner.find((x: any) => /record_declaration|struct_declaration|class_declaration/.test(x.type))
    if (!target) continue
    const kids: string[] = []
    for (let i = 0; i < target.childCount; i++) {
      const k = target.child(i)
      kids.push(`${k.isNamed ? "" : "*"}${k.type}${k.isNamed ? "" : `(${JSON.stringify(k.text)})`}`)
    }
    console.log(`  ${target.type}: ${kids.join(" ")}`)
  }

  const file = path.join(ROOT, "script/m14/tmp/fixtures-probe/record-struct.cs")
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, SRC)
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
  const res: any = await ASTEngine.parseFile(file, SRC)
  console.log("\nANALYZER SYMBOLS:")
  for (const s of res.symbols ?? []) {
    console.log(`  ${String(s.name).padEnd(10)} kind=${String(s.kind).padEnd(12)} owner=${s.ownerName ?? "-"}`)
  }
  console.log("\nANALYZER RELATIONSHIPS:")
  for (const r of res.relationships ?? []) {
    console.log(`  ${String(r.type).padEnd(14)} ${String(r.source ?? "?").padEnd(10)} -> ${r.target}`)
  }
  fs.rmSync(file)
}
main()

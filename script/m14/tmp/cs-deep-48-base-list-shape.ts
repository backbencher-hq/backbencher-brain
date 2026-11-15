// CS-DEEP-48 — what does a base_list actually contain, and which children are TYPES?
//
// The truth builds its base list with `baseTypes.push(leafOf(b.text))` over EVERY named child of
// the `base_list`, which is how `: ParsingTests(output)` produced a base named `(output)` and two
// F5 MISSING rows. The grammar's `base_list` also carries the CONSTRUCTOR ARGUMENT LIST, so the
// question is not "which children exist" but "which children are types" — and only the tree can
// answer that per shape.
import * as fs from "fs"
import * as path from "path"
const ROOT = process.cwd()
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const g = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-c_sharp.wasm")))
const p = new P(); p.setLanguage(g)
for (const f of [
  "/home/sano/ishaq/bb_tests/repositories/roslyn/src/Compilers/CSharp/Test/Syntax/Parsing/LambdaParameterParsingTests.cs",
  "/home/sano/ishaq/bb_tests/repositories/roslyn/src/Compilers/Test/Resources/Core/PerfTests/CSPerfTest.cs",
]) {
  const root = p.parse(fs.readFileSync(f, "utf8")).rootNode
  console.log(`\n  ${path.basename(f)}`)
  const stack: any[] = [root]
  let shown = 0
  while (stack.length > 0 && shown < 4) {
    const n = stack.pop()!
    if (n.type === "base_list") {
      const kids = (n.namedChildren ?? []).map((c: any) => `${c.type}:"${c.text.replace(/\s+/g, " ").slice(0, 30)}"`)
      console.log(`     line ${n.startPosition.row + 1}: [${kids.join("  |  ")}]`)
      shown++
    }
    for (let i = n.namedChildCount - 1; i >= 0; i--) { const c = n.namedChild(i); if (c) stack.push(c) }
  }
}

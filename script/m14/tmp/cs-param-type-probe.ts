// script/m14/tmp/cs-param-type-probe.ts — which parameter SHAPES reach the two
// branches the csharp R7 paydown changed?
//
// The paydown (M60.R7, csharp lane):
//   (1) `params` parameters were dropped ENTIRELY (the grammar does not wrap them
//       in a `parameter` node, and the loop read named `parameter` children only);
//   (2) a parameter whose type cannot be resolved published the literal
//       `"unknown"`, and `extractTypeString`'s last-resort scan can land on the
//       parameter's OWN NAME on a damaged list — the same fabrication class.
// Both are now absences. This probe finds the reachable shapes so the fixture can
// be authored from measurements rather than from what the code looks like.
import * as fs from "fs"
import * as path from "path"

const ROOT = process.cwd()

const SHAPES: Array<[string, string]> = [
  ["well-formed three params", `class C { void M(int a, string b, object c) { } }`],
  ["params array", `class C { void M(params object[] rest) { } }`],
  ["params after a plain param", `class C { void M(int a, params string[] rest) { } }`],
  ["params builtin array", `class C { void M(params int[] nums) { } }`],
  ["missing type on the last param", `class C { void M(int a, b) { } }`],
  ["missing type on the first param", `class C { void M(a, int b) { } }`],
  ["leading comma", `class C { void M(, int a) { } }`],
  ["bare keyword as a param", `class C { void M(int a, void) { } }`],
  ["extension `this`", `static class C { static void M(this string a) { } }`],
  ["ref/out/in modifiers", `class C { void M(ref int a, out int b, in int c) { } }`],
  ["attribute on a param", `class C { void M([System.Obsolete] int a) { } }`],
  ["params with no name", `class C { void M(params int[]) { } }`],
]

async function main() {
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
  const tmp = path.join(ROOT, "script/m14/tmp/_probe-param-shape.cs")
  for (const [label, src] of SHAPES) {
    fs.writeFileSync(tmp, src + "\n")
    let res: any
    try {
      res = await ASTEngine.parseFile(tmp, src + "\n")
    } catch (e: any) {
      console.log(`${label.padEnd(34)} THREW ${String(e?.message).slice(0, 80)}`)
      continue
    }
    const methods = (res.symbols ?? []).filter((s: any) => s.kind === "method" || s.kind === "function")
    const errs = (res.errors ?? []).length
    for (const m of methods) {
      const ps = (m.parameters ?? []).map((p: any) => `${p.name}:${p.type === undefined ? "<absent>" : p.type}`)
      console.log(`${label.padEnd(34)} ${m.name}(${ps.join(", ")})   [errors=${errs}]`)
    }
    if (!methods.length) console.log(`${label.padEnd(34)} NO METHOD SYMBOL   [errors=${errs}]`)
  }
  fs.unlinkSync(tmp)
}

main()

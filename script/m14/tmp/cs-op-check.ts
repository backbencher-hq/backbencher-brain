import * as fs from "fs"
import * as path from "path"
const ROOT = process.cwd()
const SHAPES = [
  "class C { public static implicit operator int(C c) => 0; }",
  "class C { public static explicit operator C(int v) => new C(); }",
  "class C { public static C operator +(C a, C b) => a; }",
  "class C { public static C operator checked +(C a, C b) => a; }",
  "class C { public static bool operator true(C c) => true; }",
  "class C { public static bool operator ==(C a, C b) => true; public static bool operator !=(C a, C b) => false; }",
  "class C { public static C<T> operator +(C<T> a, C<T> b) => a; }",
  "class C { public static implicit operator C < T > (D d) => null; }",
]
async function main() {
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
  const tmp = path.join(ROOT, "script/m14/tmp/_probe-op.cs")
  for (const src of SHAPES) {
    fs.writeFileSync(tmp, src)
    const res: any = await ASTEngine.parseFile(tmp, src)
    const names = (res.symbols ?? []).filter((s: any) => s.metadata?.isOperatorOverload).map((s: any) => JSON.stringify(s.name))
    console.log(names.join(", ").padEnd(34), "<<", src.slice(0, 62))
  }
  fs.unlinkSync(tmp)
}
main()

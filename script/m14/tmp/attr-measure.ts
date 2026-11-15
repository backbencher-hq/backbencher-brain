import * as fs from "fs"
import * as path from "path"
const ROOT = process.cwd()
async function main() {
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
  const f = path.join(ROOT, "validation/m14/fixtures/csharp/qualified-type-spelling.cs")
  const res: any = await ASTEngine.parseFile(f, fs.readFileSync(f, "utf8"))
  for (const s of res.symbols ?? []) {
    if ((s.decorators ?? []).length) console.log(`${s.kind} ${s.name}: ${JSON.stringify(s.decorators)}`)
  }
  console.log(`symbols with '::' anywhere: ${(res.symbols ?? []).filter((s: any) => JSON.stringify(s).includes("::")).map((s: any) => s.name).join(", ") || "none"}`)
}
main()

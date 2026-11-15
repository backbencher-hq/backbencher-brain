import * as path from "path"
const ROOT = process.cwd()
const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
const f = "validation/m14/fixtures/csharp/read-collides-with-call.cs"
const res: any = await ASTEngine.parseFile(f, (await import("fs")).readFileSync(f, "utf8"))
for (const r of res.relationships ?? []) {
  if ((r.type ?? r.relationshipType) !== "references") continue
  const md = r.metadata ?? {}
  if (!["Gadget","Doodad","Sprocket","Widget"].includes(String(r.target))) continue
  console.log(`  ${String(r.source).padEnd(26)} -> ${String(r.target).padEnd(9)} line=${String(r.line_number).padEnd(4)} marker=${md.relationshipType} declaredOn=${md.declaredOn ?? "-"}`)
}

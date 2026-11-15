// script/m14/tmp/cs-param-type-measure.ts — MEASURE the csharp parameter-honesty
// fixture (validation/m14/fixtures/csharp/param-type-honesty.cs): every method's
// parameter list and overload signature as the analyzer actually emits them. The
// expectation file is written from this output.
import * as fs from "fs"
import * as path from "path"

const ROOT = process.cwd()

async function main() {
  const file = path.join(ROOT, "validation/m14/fixtures/csharp/param-type-honesty.cs")
  const src = fs.readFileSync(file, "utf8")
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
  const res: any = await ASTEngine.parseFile(file, src)
  console.log("language:", res.language, "errors:", JSON.stringify(res.errors ?? []).slice(0, 300))
  for (const s of res.symbols ?? []) {
    if (s.kind !== "method" && s.kind !== "function") continue
    const ps = (s.parameters ?? []).map((p: any) => `${JSON.stringify(p.name)}:${p.type === undefined ? "<absent>" : JSON.stringify(p.type)}`)
    console.log(`${String(s.name).padEnd(20)} method owner=${s.ownerName ?? "-"} params=[${ps.join(", ")}] signature=${JSON.stringify(s.signature ?? null)}`)
  }
}

main()

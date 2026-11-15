// Measure the new fixture through the REAL engine path, so the expectation is written
// from output rather than from what the code looks like it does.
import * as fs from "fs"
import * as path from "path"

const ROOT = process.cwd()
const FILE = path.join(ROOT, "validation/m14/fixtures/csharp/record-struct-kind.cs")

async function main() {
  const src = fs.readFileSync(FILE, "utf8")
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
  const res: any = await ASTEngine.parseFile(FILE, src)
  console.log("language:", res.language, "| errors:", JSON.stringify((res.errors ?? []).map((e: any) => e.range ?? e)))
  console.log("\nSYMBOLS (name | kind | owner | metadata of interest):")
  for (const s of res.symbols ?? []) {
    const md = s.metadata ?? {}
    const bits = ["isStruct", "isValueType", "isRecord"].filter((k) => k in md).map((k) => `${k}=${md[k]}`)
    console.log(`  ${String(s.name).padEnd(12)} ${String(s.kind).padEnd(10)} owner=${String(s.ownerName ?? "-").padEnd(10)} ${bits.join(" ")}`)
  }
  console.log("\nRELATIONSHIPS (type | source -> target | line):")
  for (const r of res.relationships ?? []) {
    console.log(`  ${String(r.type).padEnd(13)} ${String(r.source ?? "?").padEnd(12)} -> ${String(r.target).padEnd(24)} line=${r.line_number ?? "-"}`)
  }
  console.log("\nfull symbol metadata for record symbols:")
  for (const s of res.symbols ?? []) {
    if (/^Rec|Plain/.test(String(s.name))) console.log(`  ${s.name}: ${JSON.stringify(s.metadata ?? {})}`)
  }
}
main()

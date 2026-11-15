// script/m14/tmp/cs-param-noname-probe.ts — `class C { void M(params int[]) { } }`
// measured a parameter with an EMPTY name. Which branch pushed it, and what does
// the raw object look like? (A name-bearing field carrying "" is the same
// fabrication class as `"unknown"` — it must be either a real name or an
// absence, never a blank.)
import * as fs from "fs"
import * as path from "path"

const ROOT = process.cwd()
const SRC = "class C { void M(params int[]) { } }\n"

async function main() {
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
  const tmp = path.join(ROOT, "script/m14/tmp/_probe-noname.cs")
  fs.writeFileSync(tmp, SRC)
  const res: any = await ASTEngine.parseFile(tmp, SRC)
  for (const s of res.symbols ?? []) {
    if (s.kind !== "method" && s.kind !== "function") continue
    console.log("symbol:", s.name, "parameters:", JSON.stringify(s.parameters, null, 1))
    console.log("signature:", JSON.stringify(s.signature), "metadata:", JSON.stringify(s.metadata ?? {}).slice(0, 200))
  }
  fs.unlinkSync(tmp)
}

main()

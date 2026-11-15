// R8 runtime check: after declaring + assigning the contract's `framework` key,
// what does a real file publish? The M12 framework corpus read
// `framework: "unknown", status: "default"` for rust rows, which is the engine's
// fallback when the analyzer omits the key.
//
// Run: bun script/m14/tmp/rust-798-framework-runtime.ts <file.rs> [more...]
import * as fs from "node:fs"
import { parseFile } from "../../../src/ast/engine"

for (const f of process.argv.slice(2)) {
  const src = fs.readFileSync(f, "utf8")
  const res: any = await parseFile(f, src)
  const m = res?.metadata ?? {}
  console.log(`${f.split("/").slice(-3).join("/")}: framework=${JSON.stringify(m.framework)} detected=${JSON.stringify(m.detectedFrameworks)} patterns=${(m.frameworkPatterns ?? []).length}`)
}

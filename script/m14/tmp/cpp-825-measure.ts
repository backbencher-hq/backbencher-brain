// M59.A7 cpp: what does the analyzer emit on the new fixture, with which line?
import fs from "node:fs"
import { ASTEngine } from "../../../src/ast/engine"

const FILE = "validation/m14/fixtures/cpp/callsite-lines-825.cpp"
const res: any = await ASTEngine.parseFile(FILE, fs.readFileSync(FILE, "utf8"))
console.log("symbols:")
for (const s of res.symbols ?? []) console.log(`  ${s.kind} ${s.name} @L${s.range?.startLine}`)
console.log("relationships:")
for (const r of res.relationships ?? []) {
  console.log(`  ${String(r.type).padEnd(12)} ${String(r.source).padEnd(14)} -> ${String(r.target).padEnd(16)} line_number=${JSON.stringify(r.line_number)} meta.line=${JSON.stringify(r.metadata?.line)}`)
}

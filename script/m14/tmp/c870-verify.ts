// #870 close-out: the exact site that produced the only unexplained edge in the
// 21-language sweep. Production entry (ASTEngine.parseFile), because that is
// what the pipeline uses. Expectation: the `uses -> msg` member read carries
// line 371 (the read expression), not 0.
import fs from "node:fs"
import { ASTEngine } from "../../../src/ast/engine"

const FILE = "<corpus-root>/bb_tests/repositories/fmt/test/std-test.cc"
const src = fs.readFileSync(FILE, "utf8")
const res: any = await ASTEngine.parseFile(FILE, src)

// Show the source line 371 so the expectation is auditable in the same output.
const lines = src.split("\n")
console.log(`source L371: ${JSON.stringify(lines[370])}`)
console.log(`source L365: ${JSON.stringify(lines[364])}`)

const rels: any[] = res.relationships ?? []
const msgRels = rels.filter((r) => r.target === "msg")
console.log(`\nrelationships targeting "msg": ${msgRels.length}`)
for (const r of msgRels) {
  console.log(`  ${String(r.type).padEnd(10)} ${String(r.source).padEnd(22)} -> msg  line_number=${JSON.stringify(r.line_number)} meta.line=${JSON.stringify(r.metadata?.line)}`)
}

const zero = rels.filter((r) => r.line_number === 0 || r.line_number === null || r.line_number === undefined)
console.log(`\nrows with a missing/zero line_number: ${zero.length} of ${rels.length}`)
for (const r of zero.slice(0, 10)) {
  console.log(`  ${String(r.type).padEnd(10)} ${String(r.source).padEnd(22)} -> ${String(r.target).padEnd(22)} line_number=${JSON.stringify(r.line_number)}`)
}

// M12.27 probe: dump the current Python analyzer's output on the M11 fixture.
import { parseFile } from "../../src/ast/pool-worker"

const file = process.argv[2] || "validation/m11/fixtures/python/models.py"
const p = await parseFile(file, process.cwd())
console.log("=== SYMBOLS ===")
for (const s of p.symbols ?? []) {
  console.log(`${s.kind || s.type}\t${s.name}\tL${s.startLine ?? s.range?.startLine}\towner=${s.ownerName || s.scope || ""}\t${s.metadata?.isLambda ? "lambda" : ""}${s.metadata?.isClassVariable ? "classvar" : ""}${s.metadata?.isTypeAlias ? "typealias" : ""}`)
}
console.log("=== RELATIONSHIPS ===")
for (const r of p.relationships ?? []) {
  const type = r.type || r.relationshipType
  const src = r.source || r.fromSymbol || ""
  const tgt = r.target || r.toSymbol || ""
  console.log(`${type}\t${src} -> ${tgt}${r.metadata?.isRaise ? " [raise]" : ""}${r.metadata?.isAwait ? " [await]" : ""}${r.metadata?.isExcept ? " [except]" : ""}${r.metadata?.isContextManager ? " [ctx]" : ""}${r.metadata?.isInstanceCheck ? " [isinstance]" : ""}`)
}
console.log("=== IMPORTS ===")
for (const i of p.imports ?? []) console.log(`${i.module} [${i.items?.join(",")}]${i.alias ? " as " + i.alias : ""}`)
console.log("=== EXPORTS ===")
for (const e of p.exports ?? []) console.log(`${e.name} [${e.type}]`)
console.log("=== ERRORS ===")
console.log(`count: ${(p.errors ?? []).length}`)

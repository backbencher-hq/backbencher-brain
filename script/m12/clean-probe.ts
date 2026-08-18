// M12.26 probe: dump the current Clean analyzer's output on the M11 fixture.
import { parseFile } from "../../src/ast/pool-worker"

const file = process.argv[2] || "validation/m11/fixtures/fp/Stats.icl"
const p = await parseFile(file, process.cwd())
console.log("=== SYMBOLS ===")
for (const s of p.symbols ?? []) {
  console.log(`${s.kind || s.type}\t${s.name}\tL${s.startLine ?? s.range?.startLine}\towner=${s.ownerName || s.scope || ""}\t${s.metadata?.isLambda ? "lambda" : ""}${s.metadata?.isRecordField ? "field" : ""}${s.metadata?.isADTConstructor ? "ctor" : ""}${s.metadata?.isClassMethod ? "clsmethod" : ""}`)
}
console.log("=== RELATIONSHIPS ===")
for (const r of p.relationships ?? []) {
  const type = r.type || r.relationshipType
  const src = r.source || ""
  const tgt = r.target || ""
  const meta = r.metadata || {}
  console.log(`${type}\t${src} -> ${tgt}${meta.fromApplication ? " [app]" : ""}${meta.isImportDependency ? " [import]" : ""}${meta.fromPatternMatch ? " [patmatch]" : ""}${meta.isADTConstructor ? " [ctor]" : ""}${meta.isApplicationArgument ? " [arg]" : ""}`)
}
console.log("=== IMPORTS ===")
for (const i of p.imports ?? []) console.log(`${i.module} [${i.items?.join(",")}]`)
console.log("=== EXPORTS ===")
for (const e of p.exports ?? []) console.log(e.name)
console.log("=== ERRORS ===")
console.log("count:", p.errors?.length ?? 0)

import path from "node:path"
import { readFileSync } from "node:fs"
const { parseFile } = await import(path.resolve("src/ast/engine.ts"))
const F = "<corpus-root>/bb_tests/repositories/sqlite/ext/jni/src/c/sqlite3-jni.c"
const res: any = await parseFile(F, readFileSync(F, "utf8"), { language: "c" })
const hits = (res.symbols ?? []).filter((s: any) => /1value_1text\b|xTokenize/.test(s.name) || s.range?.startLine === 5338 || s.range?.startLine === 6033)
for (const s of hits) console.log(`@${s.range?.startLine}-${s.range?.endLine} ${s.kind} ${s.name} rec=${!!s.metadata?.recoveredFromMacroWrappedHeader}`)
console.log("--- text at those lines ---")
const src = readFileSync(F, "utf8").split("\n")
for (const L of [5338, 6033]) console.log(`L${L}: ${src[L-1].slice(0, 90)}`)

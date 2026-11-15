import path from "node:path"
import { readFileSync } from "node:fs"
const { parseFile } = await import(path.resolve("src/ast/engine.ts"))
const F = "/home/ishaq2321/bb_tests/repositories/sqlite/ext/wasm/libcmpp.c"
const res: any = await parseFile(F, readFileSync(F, "utf8"), { language: "c" })
for (const n of ["cmpp_mfree", "cmpp_mrealloc", "cmpp_rc_cstr", "cmpp_b_reuse", "cmpp_b_borrow", "cmpp_dx_delim"]) {
  const hit = (res.symbols ?? []).filter((s: any) => s.name === n)
  console.log(`${n}: ${hit.length ? hit.map((h: any) => `${h.kind}@${h.range?.startLine} rec=${!!h.metadata?.recoveredFromMacroWrappedHeader} ret=${h.returnType} params=${JSON.stringify((h.parameters??[]).map((p:any)=>p.name))}`).join(", ") : "ABSENT"}`)
}

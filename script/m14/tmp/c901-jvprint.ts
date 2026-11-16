import { parseFile } from "../../../src/ast/pool-worker"
const F = "<corpus-root>/bb_tests/repositories/jq/src/jv_print.c"
const r: any = await parseFile(F, "<corpus-root>/bb_tests/repositories/jq")
const fns = (r.symbols ?? []).filter((s: any) => s.kind === "function")
console.log("jv_print.c function symbols:", fns.map((s: any) => `${s.name}@${s.range?.startLine ?? s.range?.start?.line ?? "?"}`).join(", "))
const want = ["jv_dumpf","jv_dump"]
for (const w of want) console.log(`${w}: ${fns.some((s: any) => s.name === w) ? "PRESENT" : "MISSING"}`)

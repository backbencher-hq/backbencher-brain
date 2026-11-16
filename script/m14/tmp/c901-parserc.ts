import { parseFile } from "../../../src/ast/pool-worker"
const F = "<corpus-root>/bb_tests/repositories/jq/src/parser.c"
const r: any = await parseFile(F, "<corpus-root>/bb_tests/repositories/jq")
const hits = (r.relationships ?? []).filter((x: any) => String(x.target) === "YY_INITIAL_VALUE" || String(x.target) === "YYDEFAULT")
console.log("edges targeting YY_INITIAL_VALUE:", hits.length, hits.map((x: any) => `${x.type} ${x.source}`).join(", "))
const fn = (r.symbols ?? []).filter((s: any) => s.name === "YY_INITIAL_VALUE").map((s: any) => s.kind)
console.log("symbol YY_INITIAL_VALUE:", fn.join(",") || "(none)")

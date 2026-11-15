import { parseFile } from "../../../src/ast/pool-worker"
const r: any = await parseFile("validation/m14/fixtures/c/callsite-lines-825.c", "validation/m14/fixtures/c")
console.log(JSON.stringify(r.symbols[6], null, 1).slice(0, 500))

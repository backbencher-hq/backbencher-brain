import { parseFile } from "../../../src/ast/pool-worker"
const r: any = await parseFile("/home/sano/ishaq/bb_tests/repositories/otp/lib/kernel/src/file.erl", "/home/sano/ishaq/bb_tests/repositories/otp")
const s = (r.symbols ?? [])[1]
console.log("all keys:", Object.keys(s).join(", "))
console.log(JSON.stringify(s, null, 1).slice(0, 700))

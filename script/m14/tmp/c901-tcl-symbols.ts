import { parseFile } from "../../../src/ast/pool-worker"
const F = "/home/ishaq2321/bb_tests/repositories/sqlite/src/tclsqlite.c"
const r: any = await parseFile(F, "/home/ishaq2321/bb_tests/repositories/sqlite")
const names = ["incrblobClose2","incrblobClose","incrblobInput","incrblobOutput","incrblobSeek","incrblobWatch","incrblobHandle","incrblobWideSeek","SQLITE_TCLAPI"]
console.log("symbols matching:", (r.symbols ?? []).filter((s: any) => names.includes(s.name)).map((s: any) => `${s.name}:${s.kind}`).join(", ") || "(none)")
console.log("total symbols:", (r.symbols ?? []).length, "| total edges:", (r.relationships ?? []).length)

import { parseFile } from "../../../../src/ast/pool-worker"
const f = "/home/ishaq2321/bb_tests/repositories/terraform/main.go"
const r: any = await parseFile(f, "/home/ishaq2321/bb_tests/repositories/terraform", { projectRoot: "/home/ishaq2321/bb_tests/repositories/terraform" } as any)
console.log("keys:", Object.keys(r).join(","))
console.log("imports:", JSON.stringify((r.imports ?? []).slice(0, 4), null, 1))

import { getProjectId } from "../../../../src/cli/index"
import { indexProjectParallel } from "../../../../src/ast/parallel-indexer"
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
const root = mkdtempSync(path.join(tmpdir(), "bb-diag-"))
mkdirSync(path.join(root, "src"), { recursive: true })
writeFileSync(path.join(root, "src", "app.ts"), "export function handleRequest(): string { return \"ok\" }\n")
const pid = getProjectId(root)
await indexProjectParallel(pid, root, {})
console.log(JSON.stringify({ root, pid, dataDir: process.env.BB_DATA_DIR }))

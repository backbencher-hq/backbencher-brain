import * as path from "node:path"
import { parseFile } from "../../../../../src/ast/pool-worker"
const ROOT = path.resolve(import.meta.dirname, "../../../../..")
const abs = path.join(ROOT, ".corpus", process.argv[2])
const repoRoot = path.join(ROOT, ".corpus", process.argv[2].split("/")[0])
const r: any = await parseFile(abs, repoRoot, { projectRoot: repoRoot } as any)
for (const e of r.relationships ?? []) if (String(e.type) === "exports") console.log(`exports ${e.source} -> ${e.target} @${e.line_number}`)

import path from "node:path"
import { fileURLToPath } from "node:url"
import { getProjectId } from "../../../../src/cli/index"
import { indexProjectParallel } from "../../../../src/ast/parallel-indexer"
import { searchContent } from "../../../../src/intelligence/search/content-search"
import { searchSymbols } from "../../../../src/intelligence/search/symbol-search"
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..")
const dir = path.join(repoRoot, "validation/tools/bb_search/work/rake-probe/rake")
const pid = getProjectId(dir) as any
await indexProjectParallel(pid, dir, {})
const hint = await searchSymbols(pid, "Application", { maxResults: 5 })
const target = hint[0] as any
console.log("target:", JSON.stringify(target))
const content = await searchContent(pid, target.symbolName, { maxResults: 5 })
console.log("count:", content.length, "total:", content.totalMatches, "mode:", content.matchMode)
for (const r of content) console.log(JSON.stringify(r).toLowerCase().includes(String(target.symbolName).toLowerCase()), r.symbolName, "|", r.file)

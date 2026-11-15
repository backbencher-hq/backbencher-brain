import path from "node:path"
import { fileURLToPath } from "node:url"
import { getProjectId } from "../../../../src/cli/index"
const { searchContent } = await import("./cs-copy")
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..")
const pid = getProjectId(path.join(repoRoot, "validation/tools/bb_search/work/project")) as any
const r: any = await searchContent(pid, "bodyOnlyNeedle", { maxResults: 10 })
console.log("keys", Object.keys(r), "total", r.totalMatches, "mode", r.matchMode, "body", r.bodyCoverage)

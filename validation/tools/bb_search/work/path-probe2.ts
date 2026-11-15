import path from "node:path"
import { fileURLToPath } from "node:url"
import { getProjectId } from "../../../../src/cli/index"
import { searchContent } from "../../../../src/intelligence/search/content-search"
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..")
const pid = getProjectId(path.join(repoRoot, "validation/tools/bb_search/work/project")) as any
for (const q of ["handleRequest", "how does handle request work", "bodyOnlyNeedle"]) {
  const r: any = await searchContent(pid, q, { maxResults: 10 })
  console.log(q, "=>", JSON.stringify({ keys: Object.keys(r), mode: r.matchMode, body: r.bodyCoverage, total: r.totalMatches, trunc: r.truncated }))
}

// Direct engine probes for content-search internals (same process, fixture index).
import path from "node:path"
import { fileURLToPath } from "node:url"
import { getProjectId } from "../../../../src/cli/index"
import { searchContent, contentQueryTerms } from "../../../../src/intelligence/search/content-search"
import { searchSymbols } from "../../../../src/intelligence/search/symbol-search"
import { searchRegex } from "../../../../src/intelligence/search/regex-search"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..")
const projectDir = path.join(repoRoot, "validation/tools/bb_search/work/project")
const pid = getProjectId(projectDir) as any

const out: any = {}
for (const q of ["bodyOnlyNeedle", "how does handle request work", "end to end"]) {
  const r = await searchContent(pid, q, { maxResults: 10 })
  out["content:" + q] = { n: r.length, total: r.totalMatches, mode: r.matchMode, termMatch: r.termMatch, bodyCoverage: r.bodyCoverage, rows: r.map((x: any) => x.symbolName) }
}
out.termsMulti = contentQueryTerms("how does handle request work")
out.termsBody = contentQueryTerms("bodyOnlyNeedle")
const sym = await searchSymbols(pid, "handleRequest")
out.offsets = { total: sym.totalMatches, truncated: sym.truncated, reason: sym.truncationReason }
const rg = await searchRegex(pid, "handle", {})
out.regex = { n: rg.length, total: rg.totalMatches, ranked: rg.rankedMatches, truncated: rg.truncated, reason: rg.truncationReason, searchMode: rg.searchMode }
console.log(JSON.stringify(out, null, 2))

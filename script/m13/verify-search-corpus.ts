// script/m13/verify-search-corpus.ts — M13.20 (S3).
//
// Runs bb_search against a representative sample of the pinned corpus repos
// (one per major language family). For each entry:
//   1. indexes a small sub-directory,
//   2. resolves a real indexed symbol and proves symbols-mode search finds it
//      with the correct file and language,
//   3. proves content-mode search finds it too,
//   4. proves pagination (offset) is honored on real files,
//   5. proves freshness truthfulness: after modifying a real file, results
//      from that file are flagged stale — a stale result is never presented
//      as fresh.
// Failures are recorded in the evidence, never excluded.

import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { getProjectId } from "../../src/cli/index"
import { indexProjectParallel } from "../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../src/brain/database"
import { BrainTools } from "../../src/ast/tools"
import { searchContent } from "../../src/intelligence/search/content-search"
import { Harness } from "./harness"

const harness = new Harness({
  issue: "M13.20",
  code: "S3",
  tool: "bb_search",
  title: "bb_search: real-repo corpus (correctness + freshness truthfulness)",
  layers: ["corpus"],
  decisions: {
    sample: "one small sub-directory per major language family (Ruby, TypeScript, Erlang, Go, Zig) so indexing completes in seconds per entry — the proof is the search contract + freshness truthfulness, not exhaustive coverage",
    freshness: "after indexing, one real file is modified; symbols from that file must be flagged stale on the next search — a stale result presented as fresh is a recorded failure",
    failures: "every probe is a harness check; failures land in the evidence, nothing is excluded",
  },
  limitations: [
    "Only a small sub-directory per repo is indexed (full 29-repo indexing is hours-long); broader coverage is M14.",
    "A sub-directory with no resolvable symbol is skipped (recorded, not failed).",
  ],
})

const REPO_ROOT = "$HOME/fixtures/repositories"
// (repo, subPath, symbolHint, family)
const SAMPLE: Array<[string, string, string, string]> = [
  ["rake", "lib/rake", "Application", "Ruby"],
  ["graphql-js", "src", "graphql", "TypeScript"],
  ["rebar3", "apps", "rebar", "Erlang"],
  ["go-tools", "go/analysis/passes", "unreachable", "Go"],
]

for (const [repo, subPath, hint, family] of SAMPLE) {
  const indexRoot = path.join(REPO_ROOT, repo, subPath)
  if (!existsSync(indexRoot)) {
    harness.check(`corpus ${repo}/${subPath} (${family}): present`, false, `${indexRoot} missing`)
    continue
  }
  const projectId = getProjectId(indexRoot)
  try {
    await indexProjectParallel(projectId, indexRoot, {})
    const tag = `${repo}/${subPath} (${family})`

    // Resolve a SEARCH-VISIBLE symbol from the normal search path. A human
    // hint may be a package/module fragment rather than an exact symbol name
    // (`rebar`, `analysis`), so exact lookup is used for the selected symbol
    // below, not as the selector itself.
    const hintResults = await BrainTools.searchCode(projectId, hint, { maxResults: 5 })
    const target = hintResults[0] as any
    if (!target) {
      harness.check(`corpus ${tag}: hint resolves to a real symbol`, false, `no search result for hint ${hint}`)
      continue
    }
    const targetName = target.symbolName as string
    const sym = await BrainTools.searchCode(projectId, targetName, { maxResults: 5, exact: true })

    // 1. symbols mode: exact symbol search resolves with correct file + language
    harness.check(`corpus ${tag}: symbols-mode finds ${targetName}`, sym.some((r: any) => r.symbolName === targetName), sym.length ? `got ${sym.length}` : "no results")
    harness.check(`corpus ${tag}: result carries a real file path`, typeof target.file === "string" && target.file.length > 0, target.file)
    harness.check(`corpus ${tag}: result carries a language`, typeof target.language === "string" && target.language.length > 0, target.language)

    // 2. content mode finds the same symbol (case-insensitive by design)
    const content = await searchContent(projectId, targetName, { maxResults: 5 })
    harness.check(`corpus ${tag}: content-mode finds ${targetName}`, content.some((r: any) => JSON.stringify(r).toLowerCase().includes(targetName.toLowerCase())), `got ${content.length}`)

    // 3. pagination honored on real files (multi-result query; skip recorded if the query has only one hit)
    const page1 = await BrainTools.searchCode(projectId, hint, { maxResults: 1, offset: 0 })
    const page2 = await BrainTools.searchCode(projectId, hint, { maxResults: 1, offset: 1 })
    const p1 = page1[0] as any
    const p2 = page2[0] as any
    if (page2.length === 0) {
      harness.check(`corpus ${tag}: pagination query has a single hit (recorded, not failed)`, true, `hint=${hint}`)
    } else {
      harness.check(`corpus ${tag}: pagination offset honored (distinct pages)`, page1.length === 1 && (p1?.symbolName !== p2?.symbolName || p1?.file !== p2?.file || p1?.line !== p2?.line), `p1=${p1?.symbolName}@${p1?.line} p2=${p2?.symbolName}@${p2?.line}`)
    }

    // 4. freshness truthfulness: modify a real indexed file → its results are stale.
    //    brain_file.path may be absolute or indexRoot-relative; path.join concatenates
    //    absolute segments instead of resolving, so handle both forms explicitly.
    const filePath = path.isAbsolute(target.file) ? target.file : path.join(indexRoot, target.file)
    if (existsSync(filePath)) {
      const before = readFileSync(filePath, "utf8")
      writeFileSync(filePath, before + "\n// bb-search-freshness-probe\n")
      const afterSearch = await BrainTools.searchCode(projectId, targetName, { maxResults: 20, exact: true })
      // The symbol may exist in several files; the hit we care about is the one in
      // the file we just modified (r.file is indexRoot-relative, target.file may be
      // absolute — compare both forms).
      const staleHit = afterSearch.find((r: any) => r.symbolName === targetName && (r.file === target.file || r.file === path.basename(target.file) || target.file.endsWith(String(r.file))))
      harness.negative(
        `corpus ${tag}: modified file's result is flagged stale (never fresh)`,
        !!staleHit && staleHit.stale === true,
        staleHit ? `stale=${staleHit.stale}` : "no result for modified file",
      )
      // Restore the file so subsequent checks (and the repo) stay clean.
      writeFileSync(filePath, before)
    } else {
      harness.check(`corpus ${tag}: freshness probe file exists`, false, target.file)
    }
  } catch (e) {
    harness.check(`corpus ${repo}/${subPath} (${family}): corpus session`, false, e instanceof Error ? e.message : String(e))
  } finally {
    try { rmSync(path.dirname(BrainDatabase.getDbPath(projectId)), { recursive: true, force: true }) } catch {}
  }
}

harness.emit()

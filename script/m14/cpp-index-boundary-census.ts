/**
 * cpp-index-boundary-census — the POPULATION half of the C++ project-index proposal (task-22):
 * exactly which extensions the index would cover, and the measured route of the `.h` boundary.
 *
 * WHY THIS IS ITS OWN INSTRUMENT: the C lane's proposal (`c-h-boundary`) measured that PRODUCTION
 * routes every `.h` to the C analyzer (path-only) while the ENGINE/GATE content-sniffs some `.h` to
 * cpp (3,095 of 17,709 tracked `.h` corpus-wide). A C++ index over headers must not silently answer
 * that boundary differently from the C lane, so the cpp-side numbers are measured here with the
 * ENGINE's own predicate (`engine.detectLanguage(path, content)`) and stated separately from the
 * production route.
 *
 * Output: tracked counts per extension, readable/over-cap/absent accounting, and the engine route of
 * the header files (by language), for every corpus repo that carries admitted C++ files.
 *
 * Run: BB_CORPUS_ROOT=$PWD/.corpus bun run script/m14/cpp-index-boundary-census.ts [--json=<path>]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, statSync } from "node:fs"
import * as path from "node:path"

const ROOT = path.resolve((import.meta as any).dirname, "..", "..")
const CR = process.env.BB_CORPUS_ROOT ?? path.join(ROOT, ".corpus")
const JSON_OUT = (() => { const j = process.argv.find((a) => a.startsWith("--json=")); return j ? j.slice("--json=".length) : null })()
const ADMITTED_EXT = new Set(["cpp", "cc", "cxx", "c++", "hpp", "hxx", "ipp", "inl", "cu"])
const HEADER_EXT = new Set(["h", "hh", "h++"])
const SIZE_CAP = 1024 * 1024
const extOf = (p: string): string => { const b = p.slice(p.lastIndexOf("/") + 1); const d = b.lastIndexOf("."); return d >= 0 ? b.slice(d + 1).toLowerCase() : "" }

const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
const detectLanguage = (p: string, c?: string) => ASTEngine.detectLanguage(p, c)

const repos = execFileSync("bash", ["-lc", `ls -d ${CR}/*/ 2>/dev/null`], { encoding: "utf8" }).trim().split("\n").filter(Boolean).map((d) => d.replace(/\/$/, ""))
const perExt: Record<string, { tracked: number; readable: number; overCap: number; absent: number }> = {}
const headerRoute: Record<string, number> = {}
const admittedByExt: Record<string, number> = {}
let cppRepos = 0
const repoSummary: any[] = []
for (const dir of repos) {
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", dir, "ls-files"], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 }).split("\n").filter(Boolean) } catch { continue }
  const admitted = tracked.filter((r) => ADMITTED_EXT.has(extOf(r)))
  const headers = tracked.filter((r) => HEADER_EXT.has(extOf(r)))
  if (admitted.length === 0 && headers.length === 0) continue
  if (admitted.length > 0) cppRepos++
  const repo = { repo: path.basename(dir), admitted: admitted.length, headers: headers.length, headerRoutes: {} as Record<string, number> }
  for (const rel of admitted) {
    const ext = extOf(rel)
    perExt[ext] ??= { tracked: 0, readable: 0, overCap: 0, absent: 0 }
    perExt[ext].tracked++
    admittedByExt[ext] = (admittedByExt[ext] ?? 0) + 1
    const abs = path.join(dir, rel)
    try {
      const st = statSync(abs)
      if (st.size > SIZE_CAP) perExt[ext].overCap++
      else perExt[ext].readable++
    } catch { perExt[ext].absent++ }
  }
  for (const rel of headers) {
    const abs = path.join(dir, rel)
    let content: string
    try {
      const st = statSync(abs)
      if (st.size > SIZE_CAP) { repo.headerRoutes["over-cap"] = (repo.headerRoutes["over-cap"] ?? 0) + 1; continue }
      content = readFileSync(abs, "utf8")
    } catch { repo.headerRoutes["absent"] = (repo.headerRoutes["absent"] ?? 0) + 1; continue }
    const lang: any = detectLanguage(abs, content)
    const key = (lang && (lang.language ?? lang)) || "null"
    repo.headerRoutes[String(key)] = (repo.headerRoutes[String(key)] ?? 0) + 1
    headerRoute[String(key)] = (headerRoute[String(key)] ?? 0) + 1
  }
  repoSummary.push(repo)
}
const sum = (m: any) => Object.values(m as Record<string, number>).reduce((a: number, b: any) => a + Number(b ?? 0), 0)
const report = {
  schemaVersion: 1,
  instrument: "script/m14/cpp-index-boundary-census.ts",
  measuredAt: new Date().toISOString(),
  corpus: CR,
  admittedExtensions: [...ADMITTED_EXT].sort(),
  headerExtensions: [...HEADER_EXT].sort(),
  reposWithCppFiles: cppRepos,
  admittedByExt,
  admittedTotals: { tracked: sum(admittedByExt), readable: Object.values(perExt).reduce((a, b) => a + b.readable, 0), overCap: Object.values(perExt).reduce((a, b) => a + b.overCap, 0), absent: Object.values(perExt).reduce((a, b) => a + b.absent, 0) },
  headerRoutes: headerRoute,
  headerTotal: sum(headerRoute),
  perExt,
  perRepo: repoSummary,
  note: "ENGINE/GATE route used (engine.detectLanguage = content sniff). PRODUCTION route is path-only (pool-worker detectLanguageFromPath): every .h there goes to the detected-by-path language (measured C lane: c 100% of .h). The divergence is the boundary question this census prices; the index must not answer it silently.",
}
const json = JSON.stringify(report, null, 1) + "\n"
if (JSON_OUT) { const fs = await import("node:fs"); const t = path.resolve(ROOT, JSON_OUT); fs.mkdirSync(path.dirname(t), { recursive: true }); fs.writeFileSync(t, json) }
console.log(JSON.stringify({ admittedTotals: report.admittedTotals, headerRoutes: report.headerRoutes, headerTotal: report.headerTotal, repos: cppRepos, admittedByExt: report.admittedByExt }, null, 1))

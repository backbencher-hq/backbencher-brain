/**
 * NAMESPACE-CLAIM ROWS — the ten hand-reads' evidence list, and nothing else.
 *
 * WHY IT EXISTS. The fix it measures (`real-python-analyzer.ts`:
 * `certifyLanguageNamespaceRoutes`) certifies `references`/`extends`/`implements` targets that
 * are names in the interpreter's builtin namespace. The M14 standard requires TEN of those edges
 * to be read by hand — file:line, the emitted target, and the declaration the code actually
 * MEANS — and this instrument produces exactly that list rather than a page a reader has to
 * filter by eye. It reads the PRODUCTION path (`parseFile`, the same call the pool worker makes)
 * and prints every edge carrying the claim.
 *
 * READ-ONLY. It writes nothing. Population: the first 400 admitted `.py` files of the corpus
 * (the same first-N slice `python-endpoint-resolution.ts --limit 400` measures, so the two
 * instruments describe one population).
 *
 *   bun run validation/m14/fixtures/python/namespace-claim-rows.mts [--limit N] [--repo SUBSTR]
 */
import { execFileSync } from "node:child_process"
import { readdirSync, statSync, readFileSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { parseFile } from "../../../../src/ast/pool-worker"

const argv = process.argv.slice(2)
const argOf = (f: string): string | undefined => {
  const i = argv.indexOf(f)
  return i >= 0 ? argv[i + 1] : undefined
}
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const LIMIT = Number(argOf("--limit") ?? "400")
const REPO_FILTER = argOf("--repo")
const MAX_BYTES = 1024 * 1024

const all: Array<{ repo: string; dir: string; rel: string; abs: string }> = []
for (const e of readdirSync(CR)) {
  const dir = path.join(CR, e)
  if (REPO_FILTER && !e.includes(REPO_FILTER)) continue
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch { continue }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
      .split("\0").filter(Boolean)
  } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    try { if (statSync(abs).size > MAX_BYTES) continue } catch { continue }
    if (detectLanguageFromPath(abs) !== "python") continue
    all.push({ repo: e, dir, rel, abs })
  }
  if (REPO_FILTER && all.length) break
}
const admitted = LIMIT ? all.slice(0, LIMIT) : all

const byType = new Map<string, number>()
const rows: string[] = []
for (const f of admitted) {
  let r: any
  try { r = await parseFile(f.abs, f.dir) } catch { continue }
  for (const rel of r?.relationships ?? []) {
    const md = rel?.metadata
    if (!md || typeof md !== "object") continue
    if (md.languageNamespace === undefined) continue
    const t = String(rel.type ?? rel.relationshipType ?? "")
    byType.set(t, (byType.get(t) ?? 0) + 1)
    // The SOURCE LINE TEXT is included so a hand-read can check the construct without a second
    // tool, and the line NUMBER is the edge's own (`line_number`), never an invented one.
    let text = ""
    try { text = readFileSync(f.abs, "utf8").split("\n")[(rel.line_number ?? 1) - 1]?.trim() ?? "" } catch { /* leave empty */ }
    rows.push([
      t,
      `${f.repo}/${f.rel}:${rel.line_number ?? "?"}`,
      String(rel.source ?? ""),
      String(rel.target ?? ""),
      String(md.reasonCode ?? "none"),
      String(rel.confidence ?? ""),
      text,
    ].join("\t"))
  }
}
console.log(`population: ${admitted.length} admitted .py files (first-N of ${all.length} across the corpus)`)
console.log(`claimed edges: ${rows.length}`)
for (const [t, n] of [...byType].sort((a, b) => b[1] - a[1])) console.log(`  ${t}\t${n}`)
console.log("type\tfile:line\tsource\ttarget\treasonCode\tconfidence\tsourceLine")
for (const row of rows) console.log(row)

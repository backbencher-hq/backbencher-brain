/**
 * TS TARGETLESS-EDGE CENSUS — the lane's own instrument for the gate's `noTarget` class.
 *
 * ## Why this exists
 *
 * The incoming gate counts and DISCLOSES edges whose target names nothing (`noTarget`): "an analyzer
 * published a relationship that names nothing — no resolver can bind it, no intent test can place
 * it". Two such edges existed on the whole typescript population (1 references, 1 extends over
 * 13,950 admitted files), and the gate can count them but not name their construct. This instrument
 * walks the SAME admitted population, runs the analyzer file by file, and reports every emitted
 * relationship whose target is whitespace-empty, with its file/source/line — so a targetless class
 * is root-caused by MEASUREMENT rather than inferred from the count.
 *
 * It is also the after-fix record: run it on any commit and it prints `EMPTY-TARGET RELATIONSHIPS: 0`
 * when the class is closed. It is not a resolution instrument and does not replace the gate.
 *
 * ## Usage
 *
 *   export BB_CORPUS_ROOT=$PWD/.corpus
 *   bun run script/m14/ts-targetless-census.ts
 *
 * Population: every git-tracked `.ts` file across the corpus repos, excluding files over the 1 MiB
 * cap — the same rule the gate's per-file population uses (13,950 files, 40 repos at the 2026-10-18
 * corpus head).
 */
import { execFileSync } from "node:child_process"
import * as fs from "node:fs"
import * as path from "node:path"
import { ASTEngine } from "../../src/ast/engine"
import { RealTypeScriptAnalyzer } from "../../src/ast/real-typescript-analyzer"

const CR = process.env.BB_CORPUS_ROOT ?? path.join(process.cwd(), ".corpus")
const repos = fs.readdirSync(CR).filter((r) => {
  try { return fs.statSync(path.join(CR, r)).isDirectory() } catch { return false }
}).sort()
const files: string[] = []
for (const repo of repos) {
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", path.join(CR, repo), "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
  } catch { continue }
  for (const rel of tracked) {
    if (!rel.endsWith(".ts")) continue
    const abs = path.join(CR, repo, rel)
    try { if (fs.statSync(abs).size > 1024 * 1024) continue } catch { continue }
    files.push(abs)
  }
}
files.sort()
console.log(`population: ${files.length} files (${repos.length} repos, ≤1 MiB, .ts)`)
const parser = await ASTEngine.getParser("typescript" as any)
const counts = new Map<string, number>()
const samples: string[] = []
for (const abs of files) {
  const content = fs.readFileSync(abs, "utf8")
  const tree = parser.parse(content)
  if (tree === null) continue
  const rel = abs.slice(CR.length + 1)
  let result: any
  try { result = new RealTypeScriptAnalyzer().analyze(tree.rootNode, content, rel) } catch (e) { console.log("ANALYZE-ERROR", rel, String(e)); continue }
  for (const r of result.relationships ?? []) {
    if (String(r.target ?? "").trim() !== "") continue
    const k = String(r.type)
    counts.set(k, (counts.get(k) ?? 0) + 1)
    if (samples.length < 10) samples.push(`${rel} :: ${k} from ${JSON.stringify(r.source)} line ${r.line_number ?? "-"}`)
  }
}
console.log("EMPTY-TARGET RELATIONSHIPS:", counts.size === 0 ? "0" : JSON.stringify(Object.fromEntries(counts)))
for (const s of samples) console.log("  sample", s)

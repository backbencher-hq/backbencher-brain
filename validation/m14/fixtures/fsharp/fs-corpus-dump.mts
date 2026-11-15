// FULL-CORPUS SYMBOL + EXPORT DUMP (the denominator for two questions at once).
//
//   1. `exports`: how many importable names does the FS-D8 surface publish over the WHOLE
//      admitted F# population (all 26 git repos that carry .fs/.fsi/.fsx), when the walk is
//      the gate's own discovery rule (git ls-files, <= 1 MB, sorted)?
//   2. the incoming split: the name/qualified-name key space PER REPOSITORY, so an unresolved
//      target can be asked "is this declared ANYWHERE in the project?" instead of "in the 60
//      files the stride happened to pick".
//
// Output: JSONL, one line per file — {repo, file, symbols:[{n,q,k,o,l}], exports:[{n,q,k,v,l}]}.
// Written incrementally so a partial run is still usable, and `progress` lines go to stderr.
import { execFileSync } from "node:child_process"
import { appendFileSync, existsSync, readFileSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"

const REPO = "/home/ishaq2321/mcp/backbencher-brain"
const CR = process.env.BB_CORPUS || "/home/ishaq2321/bb_tests/repositories"
const OUT = `${REPO}/.tmp-probe/fsharp-lane/fs-corpus-dump.jsonl`
const CAP = 1024 * 1024
const EXTS = [".fs", ".fsi", ".fsx"]

const { getParser } = await import(`${REPO}/src/ast/engine.ts`)
const { RealFsharpAnalyzer } = await import(`${REPO}/src/ast/real-fsharp-analyzer.ts`)

// THE GATE'S OWN DISCOVERY RULE, byte for byte (incoming-gate.ts discoverFiles): a real git
// checkout, `git ls-files`, the extension, the 1 MB cap, sorted; no stride here, because the
// question is the whole population.
const files = []
const repos = []
for (const name of execFileSync("ls", [CR], { encoding: "utf8" }).split("\n").filter(Boolean).sort()) {
  const dir = path.join(CR, name)
  try { if (!statSync(dir).isDirectory()) continue } catch { continue }
  try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
  let tracked
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
  } catch { continue }
  let kept = 0
  for (const rel of tracked) {
    if (!EXTS.some((e) => rel.toLowerCase().endsWith(e))) continue
    const abs = path.join(dir, rel)
    try { if (statSync(abs).size > CAP) continue } catch { continue }
    files.push({ repo: name, abs }); kept++
  }
  if (kept) repos.push(`${name}:${kept}`)
}
files.sort((a, b) => (a.repo + a.abs).localeCompare(b.repo + b.abs))
console.error(`corpus ${CR}: ${files.length} admitted F# files across ${repos.length} repos`)
writeFileSync(`${REPO}/.tmp-probe/fsharp-lane/fs-corpus-dump.meta.json`, JSON.stringify({ generatedAt: new Date().toISOString(), cr: CR, files: files.length, repos }, null, 2))
writeFileSync(OUT, "")

const parser = await getParser("fsharp")
const analyzer = new RealFsharpAnalyzer()
const failLog: string[] = []
let n = 0, failed = 0
const t0 = Date.now()
let buf = []
for (const { repo, abs } of files) {
  n++
  let content
  try { content = readFileSync(abs, "utf8") } catch (e) { failed++; if (failLog.length < 12) failLog.push(`READ ${repo}/${abs.slice(CR.length + 1)}: ${String((e as any)?.message ?? e).slice(0, 90)}`); continue }
  try {
    const tree = await parser.parse(content, abs)
    const root = tree.rootNode
    const res = analyzer.analyze(root, content, abs)
    // THE TREES WERE NEVER FREED, and the first run of this probe proves what that costs:
    // web-tree-sitter allocates in WASM memory and `parse` does not release the previous
    // tree, so after ~4,047 files EVERY subsequent parse threw and the walk recorded
    // `failed 7760` of 11,807 — a failure curve that looks like a corpus property and is a
    // leak in the probe. `delete()` is what the engine's own callers do.
    tree.delete()
    const rel = abs.slice(CR.length + 1)
    buf.push(JSON.stringify({
      repo,
      file: rel,
      symbols: (res.symbols ?? []).map((s) => ({
        n: s.name,
        q: typeof s.metadata?.fqn === "string" ? s.metadata.fqn : "",
        k: s.kind,
        o: s.ownerName ?? "",
        l: s.range?.startLine ?? 0,
      })),
      exports: (res.exports ?? []).map((e) => ({
        n: e.name,
        k: e.kind,
        v: e.visibility ?? "",
        l: e.range?.startLine ?? 0,
      })),
    }))
  } catch (e) { failed++; if (failLog.length < 12) failLog.push(`WALK ${repo}: ${String((e as any)?.message ?? e).slice(0, 90)}`) }
  if (buf.length >= 200) { appendFileSync(OUT, buf.join("\n") + "\n"); buf = [] }
  if (n % 500 === 0) console.error(`  ${n}/${files.length} files, ${((Date.now() - t0) / 1000).toFixed(0)}s, failed ${failed}`)
}
if (buf.length) appendFileSync(OUT, buf.join("\n") + "\n")
console.error(failLog.join("\n"))
console.error(`done: ${n} files, failed ${failed}, ${((Date.now() - t0) / 1000).toFixed(0)}s -> ${OUT}`)

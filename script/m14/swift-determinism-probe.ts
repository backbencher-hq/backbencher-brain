/**
 * SWIFT DETERMINISM PROBE — does the analyzer return the same graph twice for
 * the same file?
 *
 * WHY THIS EXISTS. A re-run of the lane's own census
 * (script/m14/swift-ontology-census.ts) over the SAME corpus pins and the SAME
 * analyzer blob (`7fa6c355e1a6e2302376e3ff9fc637bb7c7c3c17`) produced two
 * counts that differ from the committed census artifact:
 *
 *     contains   27,329 -> 27,330   (+1, swift-corpus)
 *     exports     2,610 ->  2,609   (-1, swift-corpus)
 *
 * Every other type matched to the edge (calls 42,493 · uses 34,822 · imports
 * 2,834 · references 3,070 · extends 1,336 · implements 2,977 · overrides 281 ·
 * instantiates 10,754 · 40,921 symbols · 244 grammar-error files · 0 crashes),
 * and the corpus working tree is clean at the pinned SHA with every admitted
 * file present and non-empty. So the difference is either (a) the admitted file
 * LIST differed between the two runs, or (b) the analyzer's output for some
 * file is not a function of that file. (b) is the one that matters: an index
 * built in a different file order would then be a different graph, and every
 * count in every baseline would carry an unstated order-dependence.
 *
 * This separates the two, per file, and reports which one it is:
 *
 *   PASS 1 / PASS 2  the same admitted list, parsed twice each, through the
 *                    PRODUCTION entry point. Every file's symbol and
 *                    relationship arrays are compared as JSON, in ORDER — an
 *                    order difference is a difference too, because the stored
 *                    graph keeps the order it was given.
 *   listSha           sha256 of the admitted list, so the two possible causes
 *                    can be told apart in one glance: a changed listSha is (a),
 *                    a matching listSha with a differing pass is (b).
 *
 * WRITES validation/m14/tmp/swift-determinism.json. Nothing else.
 *
 * Usage: bun script/m14/swift-determinism-probe.ts [--repo swift-corpus] [--cap 600]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync, statSync } from "node:fs"
import { createHash } from "node:crypto"
import * as path from "node:path"
import { parseFile } from "../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const OUT = "validation/m14/tmp/swift-determinism.json"
const arg = (k: string, d: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d
const REPO = arg("repo", "swift-corpus")
const CAP = Number(arg("cap", "600"))

function admittedFiles(repo: string): string[] {
  const dir = path.join(CR, repo)
  const tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], {
    encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
  }).split("\0").filter(Boolean)
  const out: string[] = []
  for (const rel of tracked) {
    if (!rel.endsWith(".swift")) continue
    const abs = path.join(dir, rel)
    try { const st = statSync(abs); if (st.isFile() && st.size > 0) out.push(rel) } catch { continue }
  }
  return out
}

const pin = execFileSync("git", ["-C", path.join(CR, REPO), "rev-parse", "HEAD"], { encoding: "utf8" }).trim()
const dirty = execFileSync("git", ["-C", path.join(CR, REPO), "status", "--porcelain"], { encoding: "utf8" }).trim()
const rels = admittedFiles(REPO).slice(0, CAP)
const listSha = createHash("sha256").update(rels.join("\n")).digest("hex")
console.log(`swift determinism probe — ${REPO} @ ${pin}, ${rels.length} admitted files`)
console.log(`  working tree: ${dirty === "" ? "clean" : `DIRTY (${dirty.split("\n").length} lines)`}`)
console.log(`  admitted list sha256: ${listSha}`)

type Sig = { symbols: number; rels: number; byType: Record<string, number>; digest: string }
async function sig(abs: string, dir: string): Promise<Sig | null> {
  let r: any
  try { r = await parseFile(abs, dir) } catch { return null }
  if (r.fallback) return null
  const byType: Record<string, number> = {}
  for (const rel of r.relationships ?? []) {
    const t = String(rel.type ?? rel.relationshipType ?? "")
    byType[t] = (byType[t] ?? 0) + 1
  }
  // In ORDER, not sorted: the stored graph keeps the order it is handed, so a
  // reordering is a difference a consumer can observe.
  const digest = createHash("sha256")
    .update(JSON.stringify(r.symbols ?? []))
    .update(JSON.stringify(r.relationships ?? []))
    .update(JSON.stringify(r.imports ?? []))
    .update(JSON.stringify(r.exports ?? []))
    .digest("hex")
  return { symbols: (r.symbols ?? []).length, rels: (r.relationships ?? []).length, byType, digest }
}

const pass = async (label: string): Promise<Map<string, Sig>> => {
  const out = new Map<string, Sig>()
  let i = 0
  const worker = async (): Promise<void> => {
    while (true) {
      const k = i++
      if (k >= rels.length) return
      const abs = path.join(CR, REPO, rels[k])
      const s = await sig(abs, path.join(CR, REPO))
      if (s) out.set(rels[k], s)
    }
  }
  const t0 = Date.now()
  await Promise.all(Array.from({ length: 8 }, () => worker()))
  console.log(`  ${label}: ${out.size} files, ${((Date.now() - t0) / 1000).toFixed(1)}s`)
  return out
}

const p1 = await pass("pass 1")
const p2 = await pass("pass 2")

const differing: string[] = []
const typeTotals: Record<string, number> = {}
let symbols = 0, relationships = 0
for (const [rel, a] of p1) {
  const b = p2.get(rel)
  symbols += a.symbols
  relationships += a.rels
  for (const [t, n] of Object.entries(a.byType)) typeTotals[t] = (typeTotals[t] ?? 0) + n
  if (!b || b.digest !== a.digest) differing.push(rel)
}

const out = {
  at: new Date().toISOString(),
  instrument: "script/m14/swift-determinism-probe.ts",
  why: "the census re-run over identical corpus pins and an identical analyzer blob differed by +1 contains and -1 exports in swift-corpus, so the two possible causes (a changed admitted list, b output that is not a function of the file) have to be told apart",
  repo: REPO, pin, workingTreeClean: dirty === "", admittedFiles: rels.length, admittedListSha256: listSha,
  filesParsedBothPasses: p1.size,
  symbolsPass1: symbols,
  relationshipsPass1: relationships,
  byTypePass1: Object.fromEntries(Object.entries(typeTotals).sort((a, b) => b[1] - a[1])),
  filesDifferingBetweenPasses: differing.length,
  differingFiles: differing.slice(0, 25),
  verdict: differing.length === 0
    ? "DETERMINISTIC on this draw: every file's symbol/relationship/import/export arrays were byte-identical across two passes through parseFile, in order"
    : `NOT DETERMINISTIC on this draw: ${differing.length} file(s) produced different output on a second parse of the same bytes`,
}
writeFileSync(OUT, JSON.stringify(out, null, 2))
console.log(`\nwrote ${OUT}`)
console.log(`files differing between two passes of the SAME bytes: ${differing.length}`)
for (const d of differing.slice(0, 25)) console.log(`  ${d}`)
console.log(`\n${out.verdict}`)
if (differing.length > 0) process.exitCode = 1

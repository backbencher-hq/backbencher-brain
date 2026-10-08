/**
 * IS THE VB ANALYZER DETERMINISTIC? Two runs of the SAME analyzer over the SAME
 * corpus disagree, and a relationship graph whose size depends on which run you
 * ask is not a measurement.
 *
 * THE OBSERVATION. `vb-ontology-census.ts` over the identical 2,658-file draw:
 *
 *     recorded BEFORE artifact (validation/m14/results/
 *       vb-ontology-census-full2658-BEFORE.json)   34,676 symbols  102,395 rels
 *     re-measured on this branch                     34,702 symbols  102,399 rels
 *
 * Same admitted files (2,658), same parse-error files (1,271), same grammar node
 * types (185), same `vbGaps` (`call-without-enclosing-declaration: 21`), and a
 * clean `git status` in every corpus repo — so it is not corpus drift. The
 * per-type deltas are +15 calls, +25 contains, +5 imports, +32 references,
 * +4 extends, +23 overrides: a spread over EVERY type, which is the signature of
 * a varying SET OF FILES rather than of a varying per-file answer.
 *
 * WHICH of the two it is is the whole question, and the two have opposite
 * consequences:
 *
 *   nondeterministic per file  a shipped edge is unreproducible — the worst kind
 *                             of defect, because it is invisible to every gate
 *                             (they all read one run) and it is not a rounding
 *                             difference in a count
 *   nondeterministic file set a corpus that is not what its own artifact claims
 *                             to have measured — a provenance defect, which is
 *                             serious but is a property of the corpus, not of the
 *                             analyzer
 *
 * So this measures both, separately:
 *   1. REPEAT a fixed file set N times through production `parseFile` and compare
 *      the serialized relationship list BYTE FOR BYTE per file. Any difference
 *      here is the analyzer.
 *   2. Report the per-file digest of every file in the corpus, so a second run
 *      anywhere can be compared file by file rather than only in total.
 *
 * CLI: npx tsx script/m14/vb-determinism-probe.ts [--repeats 5] [--sample 400]
 *      [--digest out.json]
 */
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { readFileSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../src/ast/language-detection"
import { parseFile } from "../../src/ast/pool-worker"

function argOf(flag: string, dflt?: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : dflt
}
const CR = process.env.BB_VB_CORPUS_ROOT ?? "$HOME/fixtures/vb-corpus"
const REPOS = (argOf("--repo", "p3d,dismt,pcl,tankex,runtime") ?? "").split(",").map((s) => s.trim()).filter(Boolean)
const REPEATS = Math.max(2, parseInt(argOf("--repeats", "5") ?? "5"))
const SAMPLE = parseInt(argOf("--sample", "400") ?? "400")
const DIGEST = argOf("--digest")

const files: { repo: string; dir: string; rel: string; abs: string }[] = []
for (const e of REPOS) {
  const dir = path.join(CR, e)
  try { statSync(dir); execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
  for (const rel of tracked) {
    if (!rel.toLowerCase().endsWith(".vb")) continue
    const abs = path.join(dir, rel)
    let size: number
    try { size = statSync(abs).size } catch { continue }
    if (size > 512 * 1024) continue
    let text = ""
    try { text = readFileSync(abs, "utf8").replace(/^\uFEFF/, "") } catch { continue }
    if (detectLanguageFromPath(abs, text) !== "vb") continue
    files.push({ repo: e, dir, rel, abs })
  }
}
files.sort((a, b) => (a.repo + "/" + a.rel < b.repo + "/" + b.rel ? -1 : 1))
const draw = SAMPLE > 0 ? files.slice(0, SAMPLE) : files
console.log(`vb determinism probe — corpus ${CR}  admitted ${files.length}  drawn ${draw.length}  repeats ${REPEATS}\n`)

/** The part of a ParseResult that is the analyzer's ANSWER, not the parser's. */
function digestOf(r: any): string {
  const payload = {
    symbols: (r?.symbols ?? []).map((s: any) => [s.name, String(s.kind), s.ownerName ?? null]),
    relationships: (r?.relationships ?? []).map((x: any) => [x.source, x.target, String(x.type), x.line_number ?? 0, x.confidence ?? null]),
  }
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 16)
}

const perFile = new Map<string, string[]>()
let idx = 0
for (let round = 0; round < REPEATS; round++) {
  idx = 0
  const concurrent = async (): Promise<void> => {
    while (true) {
      const i = idx++
      if (i >= draw.length) return
      const f = draw[i]
      let d = "THREW"
      try { d = digestOf(await parseFile(f.abs, f.dir)) } catch { /* recorded as THREW */ }
      const label = `${f.repo}/${f.rel}`
      const seen = perFile.get(label)
      if (seen) seen.push(d)
      else perFile.set(label, [d])
    }
  }
  await Promise.all(Array.from({ length: 8 }, () => concurrent()))
  console.log(`round ${round + 1}/${REPEATS} done`)
}

const unstable: Array<{ file: string; digests: string[] }> = []
for (const [file, ds] of [...perFile].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
  if (new Set(ds).size !== 1) unstable.push({ file, digests: ds })
}
console.log(`\nfiles compared: ${perFile.size}`)
console.log(`files whose ANALYZER ANSWER CHANGED between repeats: ${unstable.length}`)
for (const u of unstable.slice(0, 20)) console.log(`  ${u.file}  ${u.digests.join(" ")}`)

if (DIGEST) {
  writeFileSync(DIGEST, JSON.stringify({
    corpusRoot: CR, admitted: files.length, drawn: draw.length, repeats: REPEATS,
    unstableFiles: unstable.length,
    perFile: Object.fromEntries([...perFile].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([k, v]) => [k, v[0]])),
  }, null, 2))
  console.log(`\nwrote ${DIGEST}`)
}
process.exitCode = unstable.length === 0 ? 0 : 1

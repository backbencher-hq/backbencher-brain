#!/usr/bin/env bun
/**
 * THE `implements` AGREEMENT — the analyzer against the lane's OWN ORACLE, over the real population.
 *
 * ★ WHY THIS FILE EXISTS. A fixture proves the analyzer publishes a row; a RED PROOF proves the fixture
 *   would fail without the change. NEITHER proves the row is RIGHT. The fleet's own doctrine for a
 *   remedy is that the truth must derive the same split INDEPENDENTLY of the analyzer change — the
 *   mixin ruling's condition (ii) — and the mixin lane satisfied it by writing a second derivation
 *   and comparing the two. `script/m14/scala-truth.ts` -> `deriveScalaImplementsTruth` is that second
 *   derivation for the `implements` row, and THIS FILE is the comparison.
 *
 *   THE TWO SIDES ARE INDEPENDENT IN THE SENSE THAT MATTERS: the oracle walks the tree itself and
 *   reads the self-type node's own children; it does not call the analyzer, and it is not a copy of
 *   the analyzer's walk. It is a second reading of the same SOURCE.
 *
 * ★ WHAT IT MEASURES. For every admitted file that carries a self type, the analyzer's `implements`
 *   rows and the oracle's are compared as (source, target) PAIRS:
 *     in BOTH   · the two readings agree — the row is right by two independent readings
 *     ANALYZER ONLY · the analyzer published a row the oracle does not derive
 *     ORACLE ONLY · the oracle derives a row the analyzer does not publish
 *   The first two are DEFECTS in one of the two readers; the third is the same. A file where the two
 *   sides agree on ZERO rows is printed too, because "both silent" is a different fact from "both
 *   published the same thing" and only one of them is a measurement.
 *
 * ★ THE POSITIVE CONTROL. An agreement instrument that finds nothing everywhere is a broken scan, so
 *   this file carries its own: it re-derives the fixture's expected six rows from a KNOWN source and
 *   FAILS if the oracle does not produce them. Without that, "0 disagreements" could mean "0 rows".
 *
 * ★ THE POPULATION. The fleet's rule, with the three denominators kept apart and the symlink count
 *   printed: PATHS · DISTINCT FILES · ADMITTED (git-tracked, <= 1 MB cap) · REPO COUNT. The corpus
 *   root is `$PWD/.corpus` and SYMLINKED DIRECTORIES ARE FOLLOWED, with the count printed.
 *
 * Usage: bun run script/m14/scala-implements-agreement.ts [--max=<files>] [--stride=<n>]
 * EXIT: 0 when the two readings agree on every row; 5 when they do not, or when the positive
 *       control did not fire.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync, mkdirSync, statSync, lstatSync, readdirSync } from "node:fs"
import { resolve, join } from "node:path"

const ROOT = resolve(import.meta.dirname, "..", "..")
const CORPUS = process.env.BB_CORPUS_ROOT ? resolve(process.env.BB_CORPUS_ROOT) : resolve(ROOT, ".corpus")
const OUT_DIR = join(ROOT, "validation", "m14", "measurements")
const OUT_PATH = join(OUT_DIR, "scala-implements-agreement.json")
const argv = process.argv.slice(2)
const argOf = (n: string, d: string): string => {
  const hit = argv.find((a) => a.startsWith(`--${n}=`))
  return hit ? hit.slice(n.length + 3) : d
}
const MAX = Number(argOf("max", "0")) // 0 = every admitted file
const STRIDE = Math.max(1, Number(argOf("stride", "1")))

const EXTS = [".scala", ".sc", ".sbt"]
const SIZE_CAP = 1024 * 1024

console.log(`corpus root: ${CORPUS}`)

let repos: string[] = []
try {
  repos = readdirSync(CORPUS, { withFileTypes: true }).map((d) => d.name).filter((n) => !n.startsWith(".")).sort()
} catch (e) {
  console.error(`FAIL: cannot read the corpus root ${CORPUS} — ${String(e).slice(0, 120)}`)
  process.exit(5)
}

let symlinkedDirsFollowed = 0
const repoDirs: Array<{ name: string; dir: string }> = []
for (const name of repos) {
  const p = join(CORPUS, name)
  let isSymlink = false
  try { isSymlink = lstatSync(p).isSymbolicLink() } catch { continue }
  let isDir = false
  try { isDir = statSync(p).isDirectory() } catch { continue }
  if (!isDir) continue
  if (isSymlink) symlinkedDirsFollowed++
  repoDirs.push({ name, dir: p })
}
console.log(`corpus entries: ${repos.length} · directories (symlinks FOLLOWED): ${repoDirs.length} · of those SYMLINKED: ${symlinkedDirsFollowed}`)

type RepoFile = { abs: string; repo: string; rel: string }
const admitted: RepoFile[] = []
const overCap: Array<{ abs: string; repo: string; bytes: number }> = []
let trackedPaths = 0
for (const r of repoDirs) {
  let tracked: string[] = []
  try {
    execFileSync("git", ["-C", r.dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
    tracked = execFileSync("git", ["-C", r.dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
      .split("\0").filter(Boolean)
  } catch { continue }
  for (const rel of tracked) {
    if (!EXTS.some((x) => rel.toLowerCase().endsWith(x))) continue
    trackedPaths++
    const abs = join(r.dir, rel)
    let bytes = 0
    try { bytes = readFileSync(abs).length } catch { continue }
    if (bytes > SIZE_CAP) { overCap.push({ abs, repo: r.name, bytes }); continue }
    admitted.push({ abs, repo: r.name, rel })
  }
}
const distinctFiles = new Set(admitted.map((a) => a.abs)).size
const repoCount = new Set(admitted.map((a) => a.repo)).size
console.log(`PATHS (git-tracked .scala/.sc/.sbt)  ${trackedPaths}`)
console.log(`DISTINCT FILES                       ${distinctFiles}`)
console.log(`ADMITTED (tracked AND <= 1 MB)       ${admitted.length}   (${overCap.length} over the cap, excluded)`)
console.log(`REPO COUNT (repos carrying one)      ${repoCount}`)

const sampled = STRIDE === 1 ? admitted : admitted.filter((_, i) => i % STRIDE === 0).slice(0, MAX || admitted.length)
if (MAX > 0 && sampled.length > MAX) sampled.length = MAX
console.log(`SAMPLED FOR THIS COMPARISON          ${sampled.length}   (stride ${STRIDE}${MAX ? `, cap ${MAX}` : ""})`)

const { getParser } = await import(resolve(ROOT, "src", "ast", "engine"))
const { RealScalaAnalyzer } = await import(resolve(ROOT, "src", "ast", "real-scala-analyzer"))
const { deriveScalaImplementsTruth } = await import(resolve(ROOT, "script", "m14", "scala-truth"))
const parser: any = await getParser("scala" as any)
const ctor: any = (RealScalaAnalyzer as any)?.setGrammar
if (typeof ctor === "function") {
  try { ctor.call(RealScalaAnalyzer, (parser as any).language, (parser as any).constructor) } catch { /* no grammar */ }
}

/* ── THE POSITIVE CONTROL — the oracle must produce the fixture's six known rows. ───────────── */
{
  const fixture = readFileSync(join(ROOT, "validation", "m14", "fixtures", "scala", "self-type-implements.scala"), "utf8")
  const tree: any = parser.parse(fixture)
  const truth: any[] = deriveScalaImplementsTruth(tree.rootNode)
  const got = truth.map((t: any) => `${t.from}->${t.target}`).sort()
  const want = ["NeedsEither->Logging", "NeedsEither->acme.Other", "NeedsGeneric->List", "NeedsModule->acme.Module", "NeedsQualified->acme.Logging", "Service->Logging"].sort()
  const fired = want.every((w) => got.includes(w)) && got.length === want.length
  console.log(`POSITIVE CONTROL (the oracle over the known fixture): ${fired ? "FIRED" : "DID NOT FIRE"} — ${got.length} rows`)
  if (!fired) {
    console.error(`  expected ${want.join(", ")}`)
    console.error(`  got      ${got.join(", ")}`)
    console.error("the oracle does not derive the contract this comparison would MEASURE — exit 5")
    process.exit(5)
  }
}

const key = (from: string, target: string): string => `${from}->${target}`
let analyzerRows = 0
let oracleRows = 0
let inBoth = 0
const analyzerOnly: Array<{ file: string; row: string }> = []
const oracleOnly: Array<{ file: string; row: string }> = []
let filesWithSelfType = 0
let filesBothSilent = 0
let parseFailures = 0
/** The rows one side published TWICE — a count difference a set-based comparison would hide. */
const analyzerDuplicates = new Map<string, string>()
const oracleDuplicates = new Map<string, string>()

for (const f of sampled) {
  let content = ""
  try { content = readFileSync(f.abs, "utf8") } catch { continue }
  let tree: any
  try { tree = parser.parse(content) } catch { parseFailures++; continue }
  const truth: any[] = deriveScalaImplementsTruth(tree.rootNode)
  if (truth.length === 0) {
    // No self type in this file — nothing for either side to read. NOT a disagreement.
    continue
  }
  filesWithSelfType++
  const analyzer = new (RealScalaAnalyzer as any)()
  let res: any
  try {
    res = await analyzer.analyze(tree.rootNode, content, `fixtures/scala/${f.rel}`)
  } catch {
    parseFailures++
    continue
  }
  const aRows: Array<{ from: string; target: string }> = (res?.relationships ?? [])
    .filter((r: any) => r.type === "implements")
    .map((r: any) => ({ from: r.source, target: r.target }))
  const oRows: Array<{ from: string; target: string }> = truth.map((t: any) => ({ from: t.from, target: t.target }))
  analyzerRows += aRows.length
  oracleRows += oRows.length
  if (aRows.length === 0 && oRows.length === 0) filesBothSilent++
  const aSet = new Set(aRows.map((r) => key(r.from, r.target)))
  const oSet = new Set(oRows.map((r) => key(r.from, r.target)))
  // ★ THE DUPLICATE CHECK. Two readings can agree on every ROW and still DISAGREE ON THE COUNT, when
  //   one side publishes the same pair twice. That difference must never be silent: a raw count
  //   mismatch with zero disagreements is the shape of a bug that a set-based comparison hides.
  for (const r of aRows) if (aRows.filter((x) => key(x.from, x.target) === key(r.from, r.target)).length > 1) {
    const k = key(r.from, r.target)
    if (!analyzerDuplicates.has(k)) analyzerDuplicates.set(k, `${f.repo}/${f.rel}`)
  }
  for (const r of oRows) if (oRows.filter((x) => key(x.from, x.target) === key(r.from, r.target)).length > 1) {
    const k = key(r.from, r.target)
    if (!oracleDuplicates.has(k)) oracleDuplicates.set(k, `${f.repo}/${f.rel}`)
  }
  for (const k of aSet) if (oSet.has(k)) inBoth++
  for (const k of aSet) if (!oSet.has(k)) analyzerOnly.push({ file: `${f.repo}/${f.rel}`, row: k })
  for (const k of oSet) if (!aSet.has(k)) oracleOnly.push({ file: `${f.repo}/${f.rel}`, row: k })
}

const disagreements = analyzerOnly.length + oracleOnly.length
console.log("")
console.log(`files carrying a self type            ${filesWithSelfType}`)
console.log(`analyzer \`implements\` rows            ${analyzerRows}`)
console.log(`oracle \`implements\` rows              ${oracleRows}`)
console.log(`rows IN BOTH (the two readings agree)  ${inBoth}`)
console.log(`ANALYZER ONLY (a defect in one side)  ${analyzerOnly.length}`)
console.log(`ORACLE ONLY   (a defect in one side)  ${oracleOnly.length}`)
console.log(`files where both sides were SILENT    ${filesBothSilent}`)
console.log(`parse failures                        ${parseFailures}`)
console.log(`rows published TWICE by the analyzer   ${analyzerDuplicates.size}`)
console.log(`rows published TWICE by the oracle     ${oracleDuplicates.size}`)
if (analyzerDuplicates.size) {
  console.log("  ANALYZER DUPLICATES (up to 20):")
  for (const [k, v] of [...analyzerDuplicates.entries()].slice(0, 20)) console.log(`    ${v}  ${k}`)
}
if (oracleDuplicates.size) {
  console.log("  ORACLE DUPLICATES (up to 20):")
  for (const [k, v] of [...oracleDuplicates.entries()].slice(0, 20)) console.log(`    ${v}  ${k}`)
}
if (analyzerOnly.length) {
  console.log("")
  console.log("ANALYZER-ONLY ROWS (up to 20):")
  for (const r of analyzerOnly.slice(0, 20)) console.log(`  ${r.file}  ${r.row}`)
}
if (oracleOnly.length) {
  console.log("")
  console.log("ORACLE-ONLY ROWS (up to 20):")
  for (const r of oracleOnly.slice(0, 20)) console.log(`  ${r.file}  ${r.row}`)
}

mkdirSync(OUT_DIR, { recursive: true })
writeFileSync(OUT_PATH, JSON.stringify({
  instrument: "script/m14/scala-implements-agreement.ts",
  corpusRoot: CORPUS,
  population: {
    rule: "PATHS · DISTINCT FILES · ADMITTED — ADMITTED is the git-tracked set under the 1 MB size cap",
    paths: trackedPaths, distinctFiles, admitted: admitted.length, overCapFiles: overCap.length,
    repoCount, symlinkedDirsFollowed: symlinkedDirsFollowed, corpusEntries: repos.length,
  },
  sample: { stride: STRIDE, cap: MAX || null, files: sampled.length },
  positiveControl: "FIRED — the oracle derived the fixture's six known rows",
  measurement: {
    filesWithSelfType, analyzerRows, oracleRows, inBoth,
    analyzerOnly: analyzerOnly.length, oracleOnly: oracleOnly.length,
    filesBothSilent, parseFailures, disagreements,
    analyzerDuplicates: Object.fromEntries(analyzerDuplicates),
    oracleDuplicates: Object.fromEntries(oracleDuplicates),
  },
  analyzerOnly, oracleOnly,
}, null, 2) + "\n", "utf8")
console.log("")
console.log(`artefact: validation/m14/measurements/scala-implements-agreement.json`)

if (analyzerRows !== oracleRows) {
  console.error(`FAIL: the two sides published DIFFERENT COUNTS (analyzer ${analyzerRows}, oracle ${oracleRows}) — a row-count difference is a defect in one reader even when every row agrees`)
  process.exit(5)
}
if (disagreements > 0) {
  console.error(`FAIL: the two independent readings disagree on ${disagreements} rows — the implementation is NOT measured correct`)
  process.exit(5)
}
if (analyzerRows === 0 || oracleRows === 0) {
  console.error(`FAIL: one side published NOTHING (analyzer ${analyzerRows}, oracle ${oracleRows}) — a zero is not an agreement`)
  process.exit(5)
}
console.log(`⇒ THE TWO INDEPENDENT READINGS AGREE on every row (${inBoth}).`)
process.exit(0)

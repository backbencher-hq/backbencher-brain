/**
 * PER-FILE `imports` DELTA — which file gained an edge across the module pass.
 *
 * ## The question this exists to settle
 *
 * The 1-worker census moved `imports` from 13,364 at sha256 `1475e53d0e528d0a` to
 * 13,365 at `deeab0756e0c4c1f`, while the other nine types stayed byte-identical. The
 * module pass adds a SYMBOL (`publishModuleSymbol`) and normalises three edge TARGETS.
 * Neither operation can add an edge, so a +1 is either a walk artefact or a second
 * effect of the pass this lane has not identified.
 *
 * A 600-file window cannot localise it: the ceiling artifact records `imports` 3,681 at
 * BOTH digests, so the change is in one of the other 5,463 files.
 *
 * ## Why it is worth two full walks
 *
 * The workstream brief names the fabricated edge as this lane's most expensive
 * available mistake, and a +1 with no identified cause is the shape that mistake takes
 * before anyone finds it. "Probably the parser heap" is not a measurement, and it has
 * already been the wrong answer twice in this lane: an early version of
 * `import-resolution-probe.mts` read 13,363 against the census's 13,365 and attributed
 * the difference to a lost file, and the census carries a degraded-walk guard precisely
 * because the first such attribution was wrong.
 *
 * So the delta is located rather than argued. Both analyzer versions are walked over the
 * SAME 6,063 files, per-file `imports` counts are compared, and every differing file is
 * printed with the edges at the differing line numbers.
 *
 * ## How the two sides are run, and why it costs two walks
 *
 * `parseFile` dispatches through the engine's analyzer registry, which is bound at import
 * time, so both sides cannot be live in one process. The analyzer FILE is therefore
 * swapped between two complete passes: before → walk → after → walk. Each swap is
 * digest-verified against the source it was asked to write, and a `finally` restores the
 * working tree and re-verifies the digest, so a throw cannot leave the lane on the wrong
 * blob. This is stated rather than hidden because it is why the run takes ~25 min.
 *
 * READ-ONLY with respect to committed state: nothing outside
 * `validation/m14/measurements/nim/` is written.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { parseFile } from "../../../../src/ast/pool-worker"

const WORKERS = Math.max(1, Number(process.env.BB_NIM_WORKERS ?? 1) || 1)
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const LANG = "nim"
const OUT = process.argv[2] && process.argv[2].endsWith(".json") ? process.argv[2] : null

const ANALYZER = "src/ast/real-nim-analyzer.ts"
const ORIGINAL = readFileSync(ANALYZER, "utf8")
const currentSha = createHash("sha256").update(ORIGINAL).digest("hex")

/** The BEFORE blob comes from git, never from the working tree, so the comparison cannot
 *  be defeated by a tree that has already moved.
 *
 *  `BB_NIM_BEFORE` is a git REF, not a digest: the digest a reader wants to compare
 *  against is an artifact's, and the only way to obtain those bytes is by commit. The
 *  default is `HEAD~1`, which is the right default for "what did my last commit do" and
 *  the WRONG one for "what did the module pass do" once that pass is itself HEAD~1 or
 *  older — which is exactly the mistake the EXPECTED digest below exists to surface. It
 *  is reported on every run rather than only on a mismatch, because a reader who does
 *  not see the line cannot tell which two blobs were compared. */
const BEFORE_REF = process.env.BB_NIM_BEFORE ?? "HEAD~1"
const EXPECTED_BEFORE = process.env.BB_NIM_EXPECT ?? "1475e53d0e528d0a"
const beforeSrc = execFileSync("git", ["show", `${BEFORE_REF}:src/ast/real-nim-analyzer.ts`], {
  encoding: "utf8",
  maxBuffer: 1 << 28,
})
const beforeSha = createHash("sha256").update(beforeSrc).digest("hex")

console.log(`nim per-file imports delta — production parseFile, same file set, two analyzer digests`)
console.log(`before : sha256 ${beforeSha.slice(0, 16)}  (git ${BEFORE_REF}; caller expected ${EXPECTED_BEFORE})`)
console.log(`after  : sha256 ${currentSha.slice(0, 16)}  (${ANALYZER})`)
if (beforeSha.slice(0, 16) !== EXPECTED_BEFORE) {
  console.log(
    `  REPORTING THE DIGESTS ACTUALLY WALKED: \`${BEFORE_REF}\` is ${beforeSha.slice(0, 16)}, not ${EXPECTED_BEFORE}.`,
  )
  console.log(`  Re-run with BB_NIM_BEFORE=<ref> naming the commit that INTRODUCED ${EXPECTED_BEFORE}.`)
}
console.log(`corpus root : ${CR}`)
console.log(`workers     : ${WORKERS}`)

// Same file set as census.ts: sub-directories that are git repos, `git ls-files`,
// 512 KB cap, content-aware language detection.
const files: { repo: string; rel: string; abs: string }[] = []
for (const e of readdirSync(CR)) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch {
    continue
  }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], {
      encoding: "utf8",
      maxBuffer: 512 * 1024 * 1024,
    })
      .split("\0")
      .filter(Boolean)
  } catch {
    continue
  }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text: string
    try {
      if (statSync(abs).size > 512 * 1024) continue
      text = readFileSync(abs, "utf8")
    } catch {
      continue
    }
    if (detectLanguageFromPath(abs, text) !== LANG) continue
    files.push({ repo: e, rel, abs })
  }
}
files.sort((a, b) => (a.repo === b.repo ? (a.rel < b.rel ? -1 : 1) : a.repo < b.repo ? -1 : 1))
console.log(`files       : ${files.length.toLocaleString()}`)

type Edge = { line: number; target: string; written: string }
type Rec = { n: number; edges: Edge[] }

const collect = (r: any, into: Map<string, Rec>, label: string): number => {
  const edges: Edge[] = []
  for (const e of r?.relationships ?? []) {
    if (String(e?.type ?? "").toLowerCase() !== "imports") continue
    edges.push({
      line: Number(e?.line_number ?? -1),
      target: String(e?.target ?? ""),
      written: String(e?.metadata?.nimModulePath ?? ""),
    })
  }
  into.set(label, { n: edges.length, edges })
  return edges.length
}

const walkOnce = async (into: Map<string, Rec>): Promise<{ total: number; threw: number; emptyKind: number }> => {
  let cursor = 0
  let total = 0
  let threw = 0
  let emptyKind = 0
  const run = async (): Promise<void> => {
    for (;;) {
      const i = cursor++
      if (i >= files.length) return
      const f = files[i] as { repo: string; rel: string; abs: string }
      let content: string
      try {
        content = readFileSync(f.abs, "utf8")
      } catch {
        continue
      }
      let r: any
      try {
        r = await parseFile(f.abs, content)
      } catch {
        threw++
        continue
      }
      // The degraded-walk signal. `parseFile` does NOT throw when the WASM parser
      // exhausts its heap; it returns fewer symbols and fewer edges. An empty `kind`
      // is what that costs, so it is what is counted — a `threw` counter alone reads 0
      // on a walk that lost a file.
      for (const s of r?.symbols ?? []) if (String(s?.kind ?? "") === "") emptyKind++
      total += collect(r, into, `${f.repo}/${f.rel}`)
    }
  }
  await Promise.all(Array.from({ length: WORKERS }, () => run()))
  return { total, threw, emptyKind }
}

const withAnalyzer = async <T>(srcText: string, body: () => Promise<T>): Promise<T> => {
  writeFileSync(ANALYZER, srcText)
  const got = createHash("sha256").update(readFileSync(ANALYZER)).digest("hex")
  const want = createHash("sha256").update(srcText).digest("hex")
  if (got !== want) throw new Error(`analyzer swap did not land: ${got.slice(0, 16)} != ${want.slice(0, 16)}`)
  return body()
}

const before = new Map<string, Rec>()
const after = new Map<string, Rec>()
let resBefore = { total: 0, threw: 0, emptyKind: 0 }
let resAfter = { total: 0, threw: 0, emptyKind: 0 }
try {
  console.log(`\nwalk 1/2 — BEFORE ${beforeSha.slice(0, 16)}`)
  resBefore = await withAnalyzer(beforeSrc, () => walkOnce(before))
  console.log(`  imports ${resBefore.total.toLocaleString()}  threw ${resBefore.threw}  empty-kind ${resBefore.emptyKind}`)
  console.log(`\nwalk 2/2 — AFTER ${currentSha.slice(0, 16)}`)
  resAfter = await withAnalyzer(ORIGINAL, () => walkOnce(after))
  console.log(`  imports ${resAfter.total.toLocaleString()}  threw ${resAfter.threw}  empty-kind ${resAfter.emptyKind}`)
} finally {
  writeFileSync(ANALYZER, ORIGINAL)
  const back = createHash("sha256").update(readFileSync(ANALYZER)).digest("hex")
  console.log(
    `\nanalyzer restored: ${back.slice(0, 16)}${back === currentSha ? "  (unchanged)" : "  *** RESTORE FAILED — DO NOT COMMIT ***"}`,
  )
}

const key = (e: Edge): string => `${e.line}|${e.target}`
const differing: {
  label: string
  before: number
  after: number
  added: Edge[]
  removed: Edge[]
}[] = []
for (const f of files) {
  const label = `${f.repo}/${f.rel}`
  const b = before.get(label)
  const a = after.get(label)
  if ((b?.n ?? -1) === (a?.n ?? -1)) continue
  const bKeys = new Set((b?.edges ?? []).map(key))
  const aKeys = new Set((a?.edges ?? []).map(key))
  differing.push({
    label,
    before: b?.n ?? -1,
    after: a?.n ?? -1,
    added: (a?.edges ?? []).filter((e) => !bKeys.has(key(e))),
    removed: (b?.edges ?? []).filter((e) => !aKeys.has(key(e))),
  })
}

const delta = resAfter.total - resBefore.total
console.log("")
console.log(
  `imports total  before ${resBefore.total.toLocaleString()}  after ${resAfter.total.toLocaleString()}  delta ${delta >= 0 ? "+" : ""}${delta}`,
)
console.log(`files whose imports count differs: ${differing.length} of ${files.length.toLocaleString()}`)
for (const d of differing) {
  console.log(`\n  ${d.label}   ${d.before} -> ${d.after}`)
  for (const e of d.added) console.log(`    + line ${e.line}  target \`${e.target}\`  written \`${e.written}\``)
  for (const e of d.removed) console.log(`    - line ${e.line}  target \`${e.target}\`  written \`${e.written}\``)
}

const out = {
  instrument: "per-file imports delta across the module pass",
  beforeSha256: beforeSha,
  afterSha256: currentSha,
  expectedBefore: EXPECTED_BEFORE,
  corpusRoot: CR,
  files: files.length,
  workers: WORKERS,
  before: resBefore,
  after: resAfter,
  importsDelta: delta,
  filesDiffering: differing.length,
  differing,
}
if (OUT) {
  writeFileSync(OUT, JSON.stringify(out, null, 2))
  console.log(`\nwrote ${OUT}`)
}

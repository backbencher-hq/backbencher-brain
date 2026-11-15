/**
 * STRIDE-PREDICATE PROBE — julia lane.
 *
 * PURPOSE
 * -------
 * `docs/analyzers/julia.md` claims that the 120-file `firing-check` run reads 8/10
 * because all three files carrying `overrides` edges are excluded BY ARITHMETIC: firing-check walks
 * `all` in `corpusRepos()` order x `git ls-files` order, takes a stride of
 * `floor(1985/120) = 8`, and the doc names the three sorted indices as 77, 781 and 867 with the
 * remainders 5, 5 and 3 — none a multiple of 8.
 *
 * Two independent things have to be true for that sentence to be an explanation rather than a
 * story, and this probe checks BOTH against firing-check's OWN enumeration, re-derived here:
 *
 *   1. POPULATION IDENTITY. The doc's claim is about a specific corpus. This prints the corpus
 *      fingerprint (repo set + per-repo file counts + a hash of the ordered `all` array) so the
 *      indices mean something only while the population holds still.
 *   2. THE INDEX ARITHMETIC. The index of each overrides-bearing file in `all`, its remainder mod 8,
 *      and therefore whether the stride can reach it.
 *
 * It also reports what a GLOBAL ALPHABETICAL SORT would give, because that is a DIFFERENT order and
 * produces different indices — the two must never be conflated, and the probe says which one it used.
 *
 * READ-ONLY. No regex: `git ls-files -z` is NUL-delimited and the split is on NUL.
 */
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const LANG = "julia"
const LIMIT = 120

type Repo = { name: string; dir: string }

function corpusRepos(): Repo[] {
  const out: Repo[] = []
  let entries: string[]
  try {
    entries = readdirSync(CR)
  } catch {
    return out
  }
  for (const name of entries.sort()) {
    const dir = path.join(CR, name)
    try {
      if (!statSync(dir).isDirectory()) continue
    } catch {
      continue
    }
    try {
      execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
    } catch {
      continue
    }
    out.push({ name, dir })
  }
  return out
}

function trackedFiles(repo: Repo): string[] {
  try {
    const raw = execFileSync("git", ["-C", repo.dir, "ls-files", "-z"], {
      encoding: "utf8",
      maxBuffer: 512 * 1024 * 1024,
    })
    return raw.split("\0").filter(Boolean)
  } catch {
    return []
  }
}

// ---- rebuild `all` exactly as filesForLanguage does
const perRepo: Record<string, number> = {}
const all: string[] = []
for (const repo of corpusRepos()) {
  const hits: string[] = []
  for (const rel of trackedFiles(repo)) {
    if (detectLanguageFromPath(rel) !== LANG) continue
    hits.push(path.join(repo.dir, rel))
  }
  perRepo[repo.name] = hits.length
  all.push(...hits)
}

const corpusTotal = all.length
const stride = corpusTotal <= LIMIT ? 1 : Math.max(1, Math.floor(corpusTotal / LIMIT))
const picked: string[] = []
if (corpusTotal <= LIMIT) {
  picked.push(...all.sort())
} else {
  for (let i = 0; i < all.length && picked.length < LIMIT; i += stride) picked.push(all[i])
}
const pickedSet = new Set(picked.map((p) => p))

console.log(`corpus root      ${CR}`)
console.log(`corpusTotal      ${corpusTotal}`)
console.log(`LIMIT            ${LIMIT}`)
console.log(`stride           ${stride}   (floor(${corpusTotal}/${LIMIT}))`)
console.log(`picked           ${picked.length}`)
console.log(
  `population hash  sha256(all joined by \\0) = ${createHash("sha256")
    .update(all.join("\0"))
    .digest("hex")
    .slice(0, 16)}`,
)
console.log(`\nrepos contributing (${Object.keys(perRepo).filter((k) => perRepo[k] > 0).length}):`)
for (const [name, n] of Object.entries(perRepo).filter(([, n]) => n > 0)) {
  console.log(`  ${name.padEnd(28)} ${n}`)
}

// ---- the three overrides files, as named by the census run
const OVERRIDES_FILES = [
  "julia/Compiler/test/contextual.jl",
  "julia/test/meta.jl",
  "julia/test/reflection.jl",
]

// firing-check stores ABSOLUTE paths in `all`; the census stores repo-relative. Compare on suffix.
console.log(`\nINDEX ARITHMETIC — order used: corpusRepos() x git ls-files (firing-check's own order)`)
console.log(`  ${"file (repo-relative)".padEnd(42)} ${"index".padStart(6)} ${"%8".padStart(4)}  in 120-sample?`)
const verdicts: { file: string; idx: number; rem: number; inSample: boolean }[] = []
for (const rel of OVERRIDES_FILES) {
  const abs = all.find((a) => a.endsWith("/" + rel))
  const idx = abs ? all.indexOf(abs) : -1
  const rem = idx >= 0 ? idx % stride : -1
  const inSample = abs ? pickedSet.has(abs) : false
  verdicts.push({ file: rel, idx, rem, inSample })
  console.log(
    `  ${rel.padEnd(42)} ${String(idx).padStart(6)} ${String(rem).padStart(4)}  ${inSample ? "YES" : "no"}`,
  )
}

// ---- the same three files under a GLOBAL ALPHABETICAL SORT, which is a DIFFERENT order
const sortedAll = [...all].sort()
console.log(`\nCONTRAST — order used: global alphabetical sort of the same paths`)
console.log(`  ${"file (repo-relative)".padEnd(42)} ${"index".padStart(6)} ${"%8".padStart(4)}`)
for (const rel of OVERRIDES_FILES) {
  const abs = all.find((a) => a.endsWith("/" + rel))
  const idx = abs ? sortedAll.indexOf(abs) : -1
  console.log(`  ${rel.padEnd(42)} ${String(idx).padStart(6)} ${String(idx % stride).padStart(4)}`)
}

// ---- the claim itself
const allExcluded = verdicts.every((v) => !v.inSample)
console.log(`\nCLAIM UNDER TEST — "no multiple of ${stride}, so all three are excluded by arithmetic"`)
console.log(`  remainders        ${verdicts.map((v) => v.rem).join(", ")}`)
console.log(`  any remainder 0?  ${verdicts.some((v) => v.rem === 0) ? "YES — CLAIM FAILS" : "no"}`)
console.log(`  all three absent from the ${LIMIT}-sample?  ${allExcluded ? "YES — claim holds" : "NO — claim fails"}`)

const docIdx = [77, 781, 867]
const actualIdx = verdicts.map((v) => v.idx)
console.log(`\nDOC'S NAMED INDICES  ${JSON.stringify(docIdx)}`)
console.log(`MEASURED INDICES     ${JSON.stringify(actualIdx)}`)
console.log(
  `  agreement          ${JSON.stringify(docIdx) === JSON.stringify(actualIdx) ? "MATCH" : "MISMATCH — the doc's indices are wrong; the remainder argument may still hold"}`,
)

// ---- determinism: run it twice in one process by re-deriving, and report the arrays' stability
const again: string[] = []
for (const repo of corpusRepos()) for (const rel of trackedFiles(repo)) {
  if (detectLanguageFromPath(rel) === LANG) again.push(path.join(repo.dir, rel))
}
console.log(
  `\nDETERMINISM (same process, re-derived)  ${again.length === all.length && again.every((v, i) => v === all[i]) ? "identical order, identical length" : "DIFFERS"}`,
)
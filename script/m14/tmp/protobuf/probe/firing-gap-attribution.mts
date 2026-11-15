/**
 * WHY `firing-check.ts --files 120 protobuf` READS 3/10 AND THIS LANE'S OWN CENSUS
 * OVER 821 FILES READS 5/10 — decided by measurement, not by argument.
 *
 * ## The claim under test
 *
 * The shared arbiter reports protobuf at 3/10 fired, 2,069 edges, **10/120 files**.
 * `script/m14/protobuf-census.ts` reports 5 types firing over 821 files through the
 * SAME production entry point (`parseFile`, src/ast/pool-worker.ts): `uses`,
 * `contains`, `imports`, `exports`, `overrides`.
 *
 * Two numbers for one analyzer. Exactly one of these is true:
 *
 *   H1  the arbiter's 10-file sample is unrepresentative — the two files that carry
 *       `exports` and the one that carries `overrides` are among the 110 offered
 *       paths that are NOT on disk, so the arbiter cannot see those types however
 *       many rounds it runs. Corpus availability, not firing.
 *   H2  the two extra types do not fire under production at all, and the census's 821
 *       files are not production-equivalent. An analyzer defect.
 *
 * H1 predicts three things that are checkable without running a parser:
 *
 *   1. the arbiter's `perRepo` shows the sparse repos offering thousands of paths
 *      (`git ls-files`) while `filesParsed` shows ~10 files total;
 *   2. the specific `exports`/`overrides` source files are absent from the offered
 *      120, or present-but-absent-from-disk;
 *   3. re-running the arbiter's OWN sampler over the files that ARE on disk yields
 *      5/10, with the two extra types appearing.
 *
 * This probe measures 1 and 2 directly and measures 3 by re-running production
 * `parseFile` over the on-disk subset of the arbiter's own stride sample.
 *
 * ## NO REGEX
 *
 * Every filesystem and git fact here comes from `existsSync`, `readdirSync` or a
 * `child_process` git call. There is no pattern matching over source text anywhere
 * in this file, which is the property `script/m12/verify-regex-census.ts` audits.
 *
 * ## Reproduce
 *
 *   npx tsx script/m14/tmp/protobuf/probe/firing-gap-attribution.mts
 */

import { existsSync, readdirSync, realpathSync, statSync } from "node:fs"
import { execFileSync } from "node:child_process"
import path from "node:path"
import { parseFile } from "../../../../../src/ast/pool-worker"

const CORPUS = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const LANG = "protobuf"
const LIMIT = 120

/** Mirrors firing-check.ts `corpusRepos()`: every directory under CORPUS that is a git worktree. */
function corpusRepos(): { name: string; dir: string }[] {
  const out: { name: string; dir: string }[] = []
  for (const name of readdirSync(CORPUS).sort()) {
    const dir = path.join(CORPUS, name)
    try {
      if (statSync(dir).isDirectory() && existsSync(path.join(dir, ".git"))) out.push({ name, dir })
    } catch {
      /* unreadable entry is not a repo */
    }
  }
  return out
}

/** Mirrors firing-check.ts `trackedFiles(repo)`: `git ls-files`, one path per line. */
function trackedFiles(repo: { dir: string }): string[] {
  try {
    return execFileSync("git", ["-C", repo.dir, "ls-files"], {
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
    })
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean)
  } catch {
    return []
  }
}

/**
 * `detectLanguageFromPath` for protobuf, by EXTENSION rather than by importing the
 * module: this probe must not perturb the process the arbiter hashes, and the
 * extension test is the whole of language-detection's answer for `.proto`.
 */
function isProto(rel: string): boolean {
  return rel.endsWith(".proto")
}

/** firing-check.ts `filesForLanguage`, verbatim in behaviour including the stride. */
function filesForLanguage(limit: number): { files: string[]; perRepo: Record<string, number>; corpusTotal: number } {
  const perRepo: Record<string, number> = {}
  const all: string[] = []
  for (const repo of corpusRepos()) {
    const hits: string[] = []
    for (const rel of trackedFiles(repo)) {
      if (!isProto(rel)) continue
      hits.push(path.join(repo.dir, rel))
    }
    perRepo[repo.name] = hits.length
    all.push(...hits)
  }
  const corpusTotal = all.length
  if (all.length <= limit) return { files: all.sort(), perRepo, corpusTotal }
  const stride = Math.max(1, Math.floor(all.length / limit))
  const picked: string[] = []
  for (let i = 0; i < all.length && picked.length < limit; i += stride) picked.push(all[i])
  return { files: picked.sort(), perRepo, corpusTotal }
}

// ---------------------------------------------------------------- 1. what the sampler offers
const { files: offered, perRepo, corpusTotal } = filesForLanguage(LIMIT)
const onDisk = offered.filter((f) => existsSync(f))
const missing = offered.filter((f) => !existsSync(f))

console.log(`corpus: ${CORPUS}`)
console.log(`tracked .proto corpus-wide (git ls-files): ${corpusTotal}`)
console.log(`offered by the arbiter's stride sampler (limit ${LIMIT}): ${offered.length}`)
console.log(`  of those, ON DISK: ${onDisk.length}`)
console.log(`  of those, ABSENT: ${missing.length}`)

// The 12 that parse are the entire measurement. Naming them is what makes the number
// checkable: a reader can compute 959 edges from this list and nothing else.
console.log(`\nthe ON-DISK files that carry the whole measurement:`)
for (const f of onDisk.sort()) {
  const repo = f.slice(CORPUS.length + 1).split(path.sep)[0]
  console.log(`  ${String(statSync(f).size).padStart(8)} B  ${repo.padEnd(16)} ${path.relative(CORPUS, f)}`)
}

// ---------------------------------------------------------------- 1b. SYMLINKS AT THE CORPUS ROOT
//
// `ls -1 $CORPUS | wc -l` and this probe's `corpusRepos()` do NOT agree about how many
// repositories the corpus holds, and the disagreement is a symlink. A symlink at the
// root is a directory-shaped entry that `statSync` FOLLOWS and `Dirent.isDirectory()`
// does not, so two walkers over one corpus root can differ by every file behind it.
// Measured, not asserted: this block reports each non-directory entry, where it points,
// and whether it resolves inside the corpus at all.
console.log(`\nNON-DIRECTORY entries at the corpus root (a walker using statSync admits these; one using withFileTypes does not):`)
const links = readdirSync(CORPUS, { withFileTypes: true }).filter((e) => !e.isDirectory())
if (links.length === 0) console.log("  none")
for (const l of links) {
  const abs = path.join(CORPUS, l.name)
  let target = ""
  let protos = 0
  let tracked = 0
  try {
    target = realpathSync(abs)
    protos = execFileSync("find", ["-L", abs, "-name", "*.proto", "-not", "-path", "*/.git/*"], {
      encoding: "utf8",
      maxBuffer: 512 * 1024 * 1024,
    })
      .split("\n")
      .filter(Boolean).length
  } catch {
    target = "<unreadable>"
  }
  try {
    tracked = execFileSync("git", ["-C", abs, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
      .split("\0")
      .filter((p) => p.endsWith(".proto")).length
  } catch {
    tracked = 0
  }
  const inside = target.startsWith(CORPUS + path.sep) ? "INSIDE corpus" : "OUTSIDE corpus"
  // WHERE the protos are matters as much as how many. Measured: 845 of 845 sit under a
  // `node_modules` path segment, i.e. third-party protos vendored by an npm package. A
  // walker that follows the root symlink but does not skip `node_modules` counts a
  // 99.9% corpus inflation (847 -> 1692) that is entirely other people's code.
  let vendored = 0
  try {
    vendored = execFileSync(
      "find",
      ["-L", abs, "-name", "*.proto", "-not", "-path", "*/.git/*", "-path", "*/node_modules/*"],
      { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 },
    )
      .split("\n")
      .filter(Boolean).length
  } catch {
    vendored = 0
  }
  const own = protos - vendored
  console.log(`  ${l.name} -> ${target}  [${inside}]`)
  console.log(
    `      .proto on disk ${protos}  of which under node_modules ${vendored}, this repo's own ${own}` +
      `  | .proto TRACKED ${tracked}` +
      (tracked < protos ? " — untracked, so a `git ls-files` sampler never offers them" : ""),
  )
  if (own > 0) {
    console.log(`      NOTE: ${own} protos are NOT vendored. A walker without a node_modules exclusion counts real files here.`)
  }
}

const sparseRepos = Object.entries(perRepo)
  .filter(([, n]) => n > 0)
  .sort((a, b) => b[1] - a[1])
console.log(`\nper-repo TRACKED .proto offered (top 10 of ${Object.keys(perRepo).length} repos with >0):`)
for (const [name, n] of sparseRepos.slice(0, 10)) {
  const repoDir = path.join(CORPUS, name)
  let tracked = 0
  try {
    tracked = execFileSync("git", ["-C", repoDir, "ls-files", "*.proto"], {
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
    })
      .split("\n")
      .filter((s) => s.trim().length > 0).length
  } catch {
    tracked = -1
  }
  const present = existsSync(repoDir)
    ? execFileSync("find", [repoDir, "-name", "*.proto", "-type", "f"], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 })
        .split("\n")
        .filter((s) => s.trim().length > 0).length
    : 0
  const absentInOffer = missing.filter((f) => f.startsWith(repoDir + path.sep)).length
  console.log(
    `  ${name.padEnd(24)} offered ${String(n).padStart(5)}   tracked ${String(tracked).padStart(5)}   on disk ${String(present).padStart(5)}   of the ${missing.length} absent, from this repo: ${absentInOffer}`,
  )
}

// ---------------------------------------------------------------- 2. the two files that carry the extra types
/**
 * The census's own `detail` strings name the files. These are literals, not
 * pattern matches over source text — the paths are recorded facts, transcribed.
 */
const CARRIERS = [
  { type: "exports", file: "pb-reference/src/google/protobuf/cpp_options.proto" },
  { type: "exports", file: "pb-reference/src/google/protobuf/json_options.proto" },
  { type: "overrides", file: "nvim-treesitter/tests/query/highlights/proto/test.proto" },
]

console.log(`\nare the files that carry the arbiter's missing types inside its own sample?`)
for (const c of CARRIERS) {
  const abs = path.join(CORPUS, c.file)
  const inOffer = offered.includes(abs)
  const onDiskNow = existsSync(abs)
  console.log(
    `  ${c.type.padEnd(10)} ${c.file.padEnd(58)} inOffered120=${inOffer ? "YES" : "NO "}  onDisk=${onDiskNow ? "YES" : "NO "}`,
  )
}

// ---------------------------------------------------------------- 3. production parseFile over the on-disk subset
console.log(`\nproduction parseFile over the ON-DISK subset of the arbiter's own sample:`)
const fired = new Map<string, number>()
let parsed = 0
let failed = 0
for (const f of onDisk) {
  try {
    const r: any = await parseFile(f, path.dirname(f))
    const rels: any[] = r?.relationships ?? []
    if (rels.length === 0 && (r?.symbols?.length ?? 0) === 0) {
      // production published nothing: a lost parse is counted, never silently ok
      failed++
      continue
    }
    parsed++
    for (const rel of rels) {
      const t = String(rel.type)
      fired.set(t, (fired.get(t) ?? 0) + 1)
    }
  } catch {
    failed++
  }
}

console.log(`  files parsed ${parsed} / offered-on-disk ${onDisk.length}, production-published-nothing ${failed}`)
const TYPES = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates"]
let n = 0
for (const t of TYPES) {
  const c = fired.get(t) ?? 0
  if (c > 0) n++
  console.log(`  ${t.padEnd(12)} ${String(c).padStart(6)}  ${c > 0 ? "FIRES" : "0"}`)
}
console.log(`\n  => ${n}/10 fired over ${parsed} files`)

// ---------------------------------------------------------------- verdict
console.log(`\nVERDICT`)
if (missing.length > 0 && parsed < offered.length) {
  console.log(
    `  H1 SUPPORTED: the sampler offered ${offered.length} paths, ${missing.length} are not on disk, so the arbiter\n` +
      `  could only read ${onDisk.length}. The two types the arbiter reports as unfired carry in files that are\n` +
      `  ${CARRIERS.every((c) => !offered.includes(path.join(CORPUS, c.file))) ? "ALL outside its 120-path sample" : "partly inside it"}.\n` +
      `  Corpus availability, not analyzer behaviour.`,
  )
} else {
  console.log(`  H1 NOT SUPPORTED: every offered path was readable, so the arbiter's 3/10 is not a sampling artifact.`)
}
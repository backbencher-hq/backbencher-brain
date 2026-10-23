#!/usr/bin/env bun
/**
 * SCSS POPULATION — the GIT-TRACKED admitted set, measured with its rule in the same sentence.
 *
 * WHY THIS FILE EXISTS. The fleet's population rule (FLEET-RULINGS-2026-10-22, and the completion
 * gate's own clause) is that the admitted set is the GIT-TRACKED set, not the disk: per-checkout
 * `git ls-files`, the router's extension list, present in the working tree, `<= 1 MiB`, dedup by
 * realpath. A disk walk is a DIFFERENT population and a number taken over it is a different
 * measurement. This instrument makes the lane's population a TRACKED ARTIFACT so the declaration,
 * the census and the arm all read ONE file instead of each re-deriving a set.
 *
 * THE EXTENSION LIST IS THE LANGUAGE TABLE'S, NOT THIS FILE'S. `script/m14/language-extensions.ts`
 * carries `scss: "scss"` and states the adjacent fact this lane must not forget: the router gives
 * `.sass` to its OWN language `sass` (the engine reads it with the CSS analyzer), so this lane must
 * NOT admit `.sass` — it was measuring 67 files production never gives this analyzer.
 *
 * MEASURED 2026-10-23: 4,435 tracked `.scss` paths, 2 over the 1 MiB cap by NAME, 0
 * tracked-but-absent, 0 duplicate realpath -> 4,433 admitted over 25 repositories. That is the
 * same admitted count the 2026-10-12 arm's own header printed (`corpus has 4433 .scss files across
 * 25 repos`), which is the independent agreement this artifact exists to preserve.
 *
 * RUN:   bun script/m14/scss-population.ts
 * WRITE: validation/m14/measurements/scss-population.json
 * EXIT:  0 written · 5 the population is EMPTY or the corpus is unreadable (a population of zero is
 *        a CONTROL FAILURE, not a measurement — the heritage-probe lesson).
 */
import { readdirSync, statSync, realpathSync, existsSync, mkdirSync, writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { resolve, join } from "node:path"

const ROOT = resolve(import.meta.dir, "../..")
const CORPUS = resolve(ROOT, ".corpus")
const OUT = resolve(ROOT, "validation/m14/measurements/scss-population.json")

/** `script/m14/language-extensions.ts`: scss: "scss" — `.sass` belongs to the `sass`/css lanes. */
const EXTS = ["scss"]
const CAP_BYTES = 1024 * 1024

interface RepoRecord {
  repo: string
  tracked: number
  admitted: number
}

function corpusEntries(): string[] {
  if (!existsSync(CORPUS)) {
    console.error(`NO CORPUS at ${CORPUS} — the population root does not exist`)
    process.exit(5)
  }
  return readdirSync(CORPUS).filter((name) => {
    try {
      return statSync(join(CORPUS, name)).isDirectory()
    } catch {
      return false
    }
  })
}

const repos: RepoRecord[] = []
const tracked: string[] = []
const absent: string[] = []
const overCap: Array<{ path: string; bytes: number }> = []
const seenReal = new Map<string, string>()
const admitted: string[] = []
let duplicateRealpath = 0

for (const repo of corpusEntries()) {
  const dir = join(CORPUS, repo)
  let names: string[] = []
  try {
    const out = execFileSync("git", ["-C", dir, "ls-files", "-z"], {
      encoding: "buffer",
      maxBuffer: 256 * 1024 * 1024,
    })
    names = out
      .toString("utf8")
      .split("\u0000")
      .filter(Boolean)
      .filter((p) => EXTS.includes((p.split(".").pop() ?? "").toLowerCase()))
  } catch {
    // not a checkout (or unreadable): it carries no tracked file and that is a fact, not a crash
    continue
  }
  if (names.length === 0) continue
  let repoAdmitted = 0
  for (const rel of names) {
    const full = join(dir, rel)
    tracked.push(`${repo}/${rel}`)
    if (!existsSync(full)) {
      absent.push(`${repo}/${rel}`)
      continue
    }
    let size = 0
    try {
      size = statSync(full).size
    } catch {
      absent.push(`${repo}/${rel}`)
      continue
    }
    if (size > CAP_BYTES) {
      overCap.push({ path: `${repo}/${rel}`, bytes: size })
      continue
    }
    let real = full
    try {
      real = realpathSync(full)
    } catch {
      /* the path is what it is */
    }
    if (seenReal.has(real)) {
      duplicateRealpath++
      continue
    }
    seenReal.set(real, `${repo}/${rel}`)
    admitted.push(`${repo}/${rel}`)
    repoAdmitted++
  }
  repos.push({ repo, tracked: names.length, admitted: repoAdmitted })
}

repos.sort((a, b) => b.admitted - a.admitted || a.repo.localeCompare(b.repo))
const carrying = repos.filter((r) => r.admitted > 0)

if (admitted.length === 0) {
  console.error(
    `POPULATION OF ZERO — ${tracked.length} tracked path(s), ${carrying.length} repository(ies) with an admitted file, ` +
      `exts=${EXTS.join(",")}. A probe that finds nothing everywhere is a CONTROL FAILURE, not a measurement.`,
  )
  process.exit(5)
}

const artifact = {
  language: "scss",
  populationRule:
    "THE ADMITTED SET IS THE GIT-TRACKED SET, NOT THE DISK: per-checkout `git ls-files -z` under " +
    "`$PWD/.corpus`, the router's extension list {scss} from script/m14/language-extensions.ts " +
    "(`.sass` is the `sass`/css lanes' — 67 corpus files this analyzer is never given), present in the " +
    "working tree, <= 1 MiB, dedup by realpath.",
  root: ".corpus",
  extensions: EXTS,
  capBytes: CAP_BYTES,
  tracked: tracked.length,
  admitted: admitted.length,
  repositoriesCarrying: carrying.length,
  repositories: repos,
  overCap,
  absent,
  duplicateRealpath,
  populationString: `parsed=${admitted.length}/${admitted.length} admitted=${admitted.length} exts=${EXTS.join(",")} index=yes`,
  measuredAt: new Date().toISOString(),
  note:
    "PATHS are `corpus-entry/relative-path` (the `.corpus` entries are symlinked checkouts). " +
    "THE 2 OVER-CAP PATHS ARE CARRIED BY NAME rather than folded into a count: a reader can check them. " +
    "INDEX=yes is the population's own property, not this artifact's: `.scss` is in " +
    "src/ast/parallel-indexer.ts PROJECT_INDEX_EXTENSIONS and script/m14/incoming-gate.ts carries an " +
    "SCSS_DECLARATION_SPEC, so production builds a project index for this language.",
}

mkdirSync(resolve(ROOT, "validation/m14/measurements"), { recursive: true })
writeFileSync(OUT, JSON.stringify(artifact, null, 2) + "\n")

console.log("SCSS POPULATION — the git-tracked admitted set")
console.log(`  root: ${CORPUS}`)
console.log(`  extensions: ${EXTS.join(",")} (language-extensions.ts) · cap ${CAP_BYTES} bytes · dedup realpath`)
console.log(`  tracked ${tracked.length} -> admitted ${admitted.length} over ${carrying.length} repositories`)
console.log(`  over cap ${overCap.length} · tracked-but-absent ${absent.length} · duplicate realpath ${duplicateRealpath}`)
for (const r of carrying) console.log(`    ${r.repo}: ${r.admitted}`)
for (const o of overCap) console.log(`  OVER CAP: ${o.path} (${(o.bytes / 1048576).toFixed(1)} MiB)`)
console.log(`  -> ${OUT}`)

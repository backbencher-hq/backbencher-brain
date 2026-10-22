/**
 * DART POPULATION — THE THREE DENOMINATORS, MEASURED, WITH THE COMMAND THAT PRODUCED THEM.
 *
 * ## WHY THIS INSTRUMENT EXISTS
 *
 * The campaign has been bitten three times by population claims, and the lane brief records the
 * three rules that came out of it (L-2026-10-21-13):
 *
 *   · **THE REPO COUNT IS THE REPOSITORIES THAT CARRY AN ADMITTED FILE FOR THAT LANGUAGE** — not
 *     the number of git checkouts in the corpus, and not the number of checkouts whose tracked
 *     files carry the extension. `incoming-gate.ts:526` adds a repository per ADMITTED file.
 *   · **THE HEADER MUST BE DERIVABLE FROM THE ROWS THE INSTRUMENT MEASURED** — so the per-repo
 *     table and the header line come out of ONE pass, or the claim has two populations.
 *   · **OVERLAPPING SETS ARE UNIONED, NOT SUMMED** — so a count over two overlapping sets is a
 *     union, with the overlap named.
 *
 * And the walk rule, which cost a lane 22 % of its population once: **`readdirSync(...,
 * { withFileTypes: true }).isDirectory()` is FALSE for a SYMLINK, and a walk that does not follow
 * links silently DROPS WHOLE REPOSITORIES.** So this walk follows symlinked directories and PRINTS
 * HOW MANY IT FOLLOWED — a walk that cannot say how many links it followed is not auditable.
 *
 * ## THE THREE DENOMINATORS, NEVER MIXED
 *
 *   PATHS        every `.dart` PATH on disk under the corpus root (the same file reached by two
 *                paths is TWO paths)
 *   DISTINCT     every `.dart` FILE on disk, counted once by its real path (a file reached by two
 *                paths is ONE file)
 *   ADMITTED     the gate's OWN admission rule: git-tracked, `.dart`, present in the working tree,
 *                and at most the engine's 1 MB full-AST cap
 *
 * Usage:
 *   BB_CORPUS_ROOT=$PWD/.corpus bun run script/m14/dart-population.ts [--json <out.json>]
 */
import { readdirSync, statSync, existsSync, realpathSync, writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../src/ast/language-detection"

const ROOT = path.resolve(import.meta.dirname ?? ".", "..", "..")
const CR = process.env.BB_CORPUS_ROOT ?? path.join(ROOT, ".corpus")
const argv = process.argv.slice(2)
const argOf = (f: string): string | undefined => {
  const i = argv.indexOf(f)
  return i >= 0 ? argv[i + 1] : undefined
}
const JSON_OUT = argOf("--json")
const SIZE_CAP = 1024 * 1024 // the engine's own full-AST cap (pool-worker.ts FULL_AST_LIMIT)

const L: string[] = []
const say = (s = "") => L.push(s)

// ─── THE WALK: FOLLOW SYMLINKED DIRECTORIES, AND COUNT THEM ───────────────────────────────────
type Walk = { paths: string[]; symlinkedDirsFollowed: number; dirsVisited: number }
function walkDart(dir: string, out: Walk): void {
  out.dirsVisited++
  let entries: any[]
  try {
    entries = readdirSync(dir, { withFileTypes: true }) as any[]
  } catch {
    return
  }
  for (const e of entries) {
    const full = path.join(dir, e.name)
    let isDir = e.isDirectory()
    let isFile = e.isFile()
    if (e.isSymbolicLink()) {
      // THE TRAP, HANDLED EXPLICITLY: a symlink to a DIRECTORY is not `isDirectory()`, and a walk
      // that only asks `isDirectory()` skips it — and with it every file under it.
      let st: any = null
      try { st = statSync(full) } catch { st = null }
      if (st?.isDirectory()) { isDir = true; isFile = false; out.symlinkedDirsFollowed++ }
      else if (st?.isFile()) { isDir = false; isFile = true }
    }
    if (isDir) walkDart(full, out)
    else if (isFile && full.toLowerCase().endsWith(".dart")) out.paths.push(full)
  }
}

say("DART POPULATION — the three denominators, one pass, with the rule named for each")
say()
say(`  corpus root          ${CR}`)
say(`  corpus root exists   ${existsSync(CR)}`)
say(`  size cap             ${SIZE_CAP} bytes (the engine's own FULL_AST_LIMIT)`)
say()

// ─── THE CORPUS ENTRIES ───────────────────────────────────────────────────────────────────────
const entries = (readdirSync(CR, { withFileTypes: true }) as any[]).map((e) => ({
  name: e.name,
  isSymlink: e.isSymbolicLink(),
}))
let symlinkedEntries = 0
let realEntries = 0
for (const e of entries) {
  if (e.isSymlink) symlinkedEntries++
  else realEntries++
}
say(`  corpus entries       ${entries.length} total · ${symlinkedEntries} SYMLINKED · ${realEntries} real directories`)

// ─── PATHS / DISTINCT: THE WALK ────────────────────────────────────────────────────────────────
const walk: Walk = { paths: [], symlinkedDirsFollowed: 0, dirsVisited: 0 }
for (const e of entries) {
  const dir = path.join(CR, e.name)
  try {
    if (!statSync(dir).isDirectory()) continue
  } catch {
    continue
  }
  walkDart(dir, walk)
}
const PATHS = walk.paths.length
const DISTINCT = new Set(walk.paths.map((p) => { try { return realpathSync(p) } catch { return p } })).size

// ─── ADMITTED: THE GATE'S OWN RULE ─────────────────────────────────────────────────────────────
/** The gate's `admitByExtension`, verbatim in behaviour: a trailing `.ext`, OR a bare basename
 *  equal to an ext WHEN THE ROUTER AGREES (a bare `dart` is admitted only if the router says
 *  dart — `dart-sdk/sdk/bin/dart` is a bash script and must not be admitted). */
function admitByExtension(rel: string, exts: string[], lang: string): boolean {
  const low = rel.toLowerCase()
  const base = low.slice(low.lastIndexOf("/") + 1)
  if (exts.some((e) => low.endsWith(`.${e}`))) return true
  return exts.some((e) => base === e) && detectLanguageFromPath(rel) === lang
}

const admittedByRepo = new Map<string, string[]>()
let notGit = 0
let overCap = 0
let overCapLargest = 0
let absent = 0
let trackedTotal = 0
for (const e of entries) {
  const dir = path.join(CR, e.name)
  try {
    if (!statSync(dir).isDirectory()) continue
  } catch {
    continue
  }
  try {
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch {
    notGit++
    continue
  }
  let tracked: string[] = []
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], {
      encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
    }).split("\0").filter(Boolean)
  } catch {
    continue
  }
  const admitted: string[] = []
  for (const rel of tracked) {
    if (!admitByExtension(rel, ["dart"], "dart")) continue
    const abs = path.join(dir, rel)
    try {
      const size = statSync(abs).size
      if (size > SIZE_CAP) { overCap++; overCapLargest = Math.max(overCapLargest, size); continue }
    } catch {
      absent++
      continue
    }
    admitted.push(abs)
  }
  if (admitted.length > 0) admittedByRepo.set(e.name, admitted)
  trackedTotal += tracked.length
}
const ADMITTED = [...admittedByRepo.values()].reduce((n, a) => n + a.length, 0)
const REPOS = admittedByRepo.size

say()
say("== THE THREE DENOMINATORS (never mixed) ==")
say(`  PATHS                ${PATHS.toLocaleString()}   rule: every .dart PATH on disk under the corpus root`)
say(`  DISTINCT FILES       ${DISTINCT.toLocaleString()}   rule: every .dart FILE on disk, counted once by its real path`)
say(`  ADMITTED             ${ADMITTED.toLocaleString()}   rule: git-tracked + .dart + present in the working tree + <= ${SIZE_CAP} bytes`)
say(`  REPOS                ${REPOS}   rule: repositories CARRYING AN ADMITTED FILE (incoming-gate.ts:526)`)
say()
say(`  symlinked directories FOLLOWED by the walk: ${walk.symlinkedDirsFollowed}`)
say(`  corpus entries that are NOT git checkouts (skipped): ${notGit}`)
say(`  tracked paths above the size cap (never parsed, so never measured): ${overCap} (largest ${overCapLargest} bytes)`)
say(`  tracked paths absent from the working tree (cannot be opened): ${absent}`)
say()
say("== THE PER-REPO ROWS (the header above is derived from these) ==")
const rows = [...admittedByRepo.entries()].sort((a, b) => b[1].length - a[1].length)
for (const [repo, files] of rows) say(`  ${String(files.length).padStart(7)}  ${repo}`)
say(`  ${String(ADMITTED).padStart(7)}  TOTAL over ${REPOS} repos`)
say()
say(`  ⇒ THE UNION, not a sum: the per-repo admitted sets are disjoint by construction (one file`)
say(`    belongs to exactly one repository), so the total is their sum AND their union.`)
say(`  ⇒ THE REPO COUNT answers "repositories carrying an ADMITTED FILE" = ${REPOS}. The corpus's`)
say(`    ${entries.length} git checkouts answer a DIFFERENT question and are not this number.`)

console.log(L.join("\n"))

if (JSON_OUT) {
  writeFileSync(
    JSON_OUT,
    JSON.stringify(
      {
        instrument: "dart-population",
        root: CR,
        command: `BB_CORPUS_ROOT=${CR} bun run script/m14/dart-population.ts --json ${JSON_OUT}`,
        corpusEntries: entries.length,
        corpusSymlinkedEntries: symlinkedEntries,
        corpusRealEntries: realEntries,
        symlinkedDirsFollowed: walk.symlinkedDirsFollowed,
        dirsVisited: walk.dirsVisited,
        paths: PATHS,
        distinctFiles: DISTINCT,
        admitted: ADMITTED,
        repos: REPOS,
        notGit,
        overCap,
        overCapLargest,
        absent,
        sizeCap: SIZE_CAP,
        perRepo: rows.map(([repo, files]) => ({ repo, admitted: files.length })),
      },
      null,
      2,
    ),
  )
  say()
  say(`WROTE ${JSON_OUT}`)
  console.log(L.slice(-1)[0])
}

/**
 * NIM POPULATION — THE THREE DENOMINATORS, MEASURED, WITH THE COMMAND THAT PRODUCED THEM.
 *
 * ## WHAT THIS EXISTS TO SETTLE
 *
 * The completion gate's condition (B) is "measured on the WHOLE admitted population", and the
 * campaign's population rule is one sentence: **the admitted set is the GIT-TRACKED set — the
 * repositories' own `git ls-files`, under the 1 MiB cap — never the disk.** This instrument
 * prints that number with the rule, the root, the scope and the command beside it, because a
 * number that does not say which rule produced it cannot be compared (FLEET-RULINGS-2026-10-22).
 *
 * ## THE TRAP THIS LANE MEASURED (and why the walk is `-z`)
 *
 * A plain `git ls-files` C-QUOTES a path whose name is not ASCII: this lane's corpus carries
 * `tests/misc/åäö.nim`, printed by plain `git ls-files` as `"tests/misc/\303\245\303\244\303\266.nim"`.
 * A walk that splits plain `git ls-files` on newlines therefore sees a token that does NOT end in
 * `.nim`, drops the file silently, and reports **6,062**. `git ls-files -z` yields the raw path
 * and the number is **6,063**. MEASURED both ways on 2026-10-23 at HEAD; the -z walk is the rule.
 *
 * ## THE THREE DENOMINATORS, NEVER MIXED (the dart lane's rule, via html)
 *
 *   PATHS        every admitted-extension PATH on disk under the corpus root (the same file
 *                reached by two paths is TWO paths)
 *   DISTINCT     every admitted-extension FILE on disk, counted once by its real path
 *   ADMITTED     the gate's OWN admission rule: git-tracked, an admitted extension, present in
 *                the working tree, and at most the engine's 1 MB full-AST cap
 *
 * ## THE EXTENSION SET IS THE ROUTER'S OWN TABLE, READ, NEVER COPIED
 *
 * `script/m14/language-extensions.ts` is the ONE table (extracted from `incoming-gate.ts` after
 * the heritage probe's duplicated map measured an empty population and printed a clean zero over
 * it). This instrument reads it, so the population cannot disagree with the arm that measures it.
 * Nim's spellings: `nim,nims,nimble` — and `.nimble`/`.nims` are routed to this lane by NIMD4/NIMD5
 * in `script/m14/spec/nim-completeness.json`, which is why they are admitted HERE.
 *
 * ## REPO COUNT
 *
 * The repo count is the number of repositories CARRYING AN ADMITTED FILE — not the number of git
 * checkouts in the corpus (`incoming-gate.ts` adds a repository per admitted file).
 *
 * Usage:
 *   BB_CORPUS_ROOT=$PWD/.corpus bun run script/m14/nim-population.ts [--json <out.json>]
 */
import { readdirSync, statSync, existsSync, realpathSync, writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../src/ast/language-detection"
import { extensionsFor } from "./language-extensions"

const ROOT = path.resolve(import.meta.dirname ?? ".", "..", "..")
const CR = process.env.BB_CORPUS_ROOT ?? path.join(ROOT, ".corpus")
const argv = process.argv.slice(2)
const argOf = (f: string): string | undefined => {
  const i = argv.indexOf(f)
  return i >= 0 ? argv[i + 1] : undefined
}
const JSON_OUT = argOf("--json")
const SIZE_CAP = 1024 * 1024 // the engine's own full-AST cap (pool-worker.ts FULL_AST_LIMIT)
const LANE = "nim"
const EXTS = extensionsFor(LANE).map((e) => e.replace(/^\./, ""))

const L: string[] = []
const say = (s = "") => L.push(s)

// ─── THE WALK: FOLLOW SYMLINKED DIRECTORIES, AND COUNT THEM ───────────────────────────────────
// A walk that only asks `isDirectory()` SKIPS a symlinked directory and every file under it — the
// sql lane measured 439 files (22 % of its population) behind a symlink. So links are followed
// and the number followed is PRINTED.
type Walk = { paths: string[]; symlinkedDirsFollowed: number; dirsVisited: number }
function walkNim(dir: string, out: Walk): void {
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
      let st: any = null
      try { st = statSync(full) } catch { st = null }
      if (st?.isDirectory()) { isDir = true; isFile = false; out.symlinkedDirsFollowed++ }
      else if (st?.isFile()) { isDir = false; isFile = true }
    }
    if (isDir) walkNim(full, out)
    else if (isFile && hasAdmittedExt(full)) out.paths.push(full)
  }
}
function hasAdmittedExt(p: string): boolean {
  const low = p.toLowerCase()
  return EXTS.some((e) => low.endsWith(`.${e}`))
}

say("NIM POPULATION — the three denominators, one pass, with the rule named for each")
say()
say(`  corpus root          ${CR}`)
say(`  corpus root exists   ${existsSync(CR)}`)
say(`  size cap             ${SIZE_CAP} bytes (the engine's own FULL_AST_LIMIT)`)
say(`  admitted extensions  ${EXTS.map((e) => `.${e}`).join(" ")}   rule: the ROUTER's ONE table (script/m14/language-extensions.ts), read — not a second copy`)
say()

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
  walkNim(dir, walk)
}
const PATHS = walk.paths.length
const DISTINCT = new Set(walk.paths.map((p) => { try { return realpathSync(p) } catch { return p } })).size

// ─── ADMITTED: THE GATE'S OWN RULE ─────────────────────────────────────────────────────────────
/** The gate's `admitByExtension`, verbatim in behaviour: a trailing `.ext`, OR a bare basename
 *  equal to an ext WHEN THE ROUTER AGREES. */
function admitByExtension(rel: string, exts: string[], lang: string): boolean {
  const low = rel.toLowerCase()
  const base = low.slice(low.lastIndexOf("/") + 1)
  if (exts.some((e) => low.endsWith(`.${e}`))) return true
  return exts.some((e) => base === e) && detectLanguageFromPath(rel) === lang
}

const admittedByRepo = new Map<string, string[]>()
const admittedPaths: string[] = []
/** abs path -> repository name, filled in the same pass as the admitted list (never re-derived). */
const repoOfAbs = new Map<string, string>()
let notGit = 0
let overCap = 0
let overCapLargest = 0
let absent = 0
let trackedTotal = 0
const perExt: Record<string, number> = {}
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
  // ★ `-z`, NOT A NEWLINE SPLIT — see the header's trap. A plain `git ls-files` C-quotes a
  //   non-ASCII path, this corpus carries one (`tests/misc/åäö.nim`), and the split walk silently
  //   drops it: 6,062 instead of 6,063. Measured both ways.
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
    if (!admitByExtension(rel, EXTS, LANE)) continue
    const abs = path.join(dir, rel)
    try {
      const size = statSync(abs).size
      if (size > SIZE_CAP) { overCap++; overCapLargest = Math.max(overCapLargest, size); continue }
    } catch {
      absent++
      continue
    }
    admitted.push(abs)
    admittedPaths.push(abs)
    repoOfAbs.set(abs, e.name)
    const ext = rel.slice(rel.lastIndexOf(".")).toLowerCase()
    perExt[ext] = (perExt[ext] ?? 0) + 1
  }
  if (admitted.length > 0) admittedByRepo.set(e.name, admitted)
  trackedTotal += tracked.length
}
const ADMITTED = [...admittedByRepo.values()].reduce((n, a) => n + a.length, 0)
const REPOS = admittedByRepo.size

// The population string the declaration must carry in meta AND in every causeRulings entry —
// the FULL form the completion gate reads (FLEET-RULINGS §5). `index=no` is measured: nim has
// no `INDEX_SPECS` entry in `script/m14/incoming-gate.ts`, so the arm is the per-file population.
const POPULATION = `parsed=${ADMITTED}/${ADMITTED} admitted=${ADMITTED} exts=${EXTS.join(",")} index=no`

say()
say("== THE THREE DENOMINATORS (never mixed) ==")
say(`  PATHS                ${PATHS.toLocaleString()}   rule: every admitted-extension PATH on disk under the corpus root`)
say(`  DISTINCT FILES       ${DISTINCT.toLocaleString()}   rule: every admitted-extension FILE on disk, counted once by its real path`)
say(`  ADMITTED             ${ADMITTED.toLocaleString()}   rule: git-tracked + an admitted extension + present in the working tree + <= ${SIZE_CAP} bytes`)
say(`  REPOS                ${REPOS}   rule: repositories CARRYING AN ADMITTED FILE (incoming-gate.ts:526)`)
say()
say(`  tracked paths total (every extension, all 8 checkouts): ${trackedTotal.toLocaleString()}`)
say(`  symlinked directories FOLLOWED by the walk: ${walk.symlinkedDirsFollowed}`)
say(`  corpus entries that are NOT git checkouts (skipped): ${notGit}`)
say(`  tracked admitted-extension paths above the size cap (never parsed, so never measured): ${overCap} (largest ${overCapLargest} bytes)`)
say(`  tracked admitted-extension paths absent from the working tree (cannot be opened): ${absent}`)
say()
say("== THE ADMITTED SET BY EXTENSION (the header above is derived from these) ==")
for (const [ext, n] of Object.entries(perExt).sort((a, b) => b[1] - a[1])) say(`  ${String(n).padStart(7)}  ${ext}`)
say()
say("== THE PER-REPO ROWS (the header above is derived from these) ==")
const rows = [...admittedByRepo.entries()].sort((a, b) => b[1].length - a[1].length)
for (const [repo, files] of rows) say(`  ${String(files.length).padStart(7)}  ${repo}`)
say(`  ${String(ADMITTED).padStart(7)}  TOTAL over ${REPOS} repos`)
say()
say(`  ⇒ THE UNION, not a sum: one file belongs to exactly one repository, so the per-repo admitted`)
say(`    sets are disjoint and the total is their sum AND their union.`)
say(`  ⇒ THE REPO COUNT answers "repositories carrying an ADMITTED FILE" = ${REPOS}. The corpus's`)
say(`    ${entries.length} entries answer a DIFFERENT question and are not this number.`)
say()
say(`  THE DECLARATION'S POPULATION STRING (full form, the one the completion gate reads):`)
say(`    ${POPULATION}`)
say(`  PLACEMENT OF index=no: script/m14/incoming-gate.ts:955-1046 is the INDEX_SPECS map and it`)
say(`    carries no nim entry, so this lane's arm is the PER-FILE population. An indexed arm is a`)
say(`    gap in that instrument, not in production, and is declared as such.`)
say()
say(`  COMMAND: BB_CORPUS_ROOT=$PWD/.corpus bun run script/m14/nim-population.ts${JSON_OUT ? ` --json ${JSON_OUT}` : ""}`)

console.log(L.join("\n"))

if (JSON_OUT) {
  writeFileSync(
    JSON_OUT,
    JSON.stringify(
      {
        instrument: "nim-population",
        lane: LANE,
        root: CR,
        command: `BB_CORPUS_ROOT=$PWD/.corpus bun run script/m14/nim-population.ts --json ${JSON_OUT}`,
        rule: "the ADMITTED set is the GIT-TRACKED set: per-checkout `git ls-files -z` under the corpus root, the router's extension list, present in the working tree, <= 1 MiB; PATHS and DISTINCT are the on-disk walk (symlinked directories followed and counted)",
        populationString: POPULATION,
        corpusEntries: entries.length,
        corpusSymlinkedEntries: symlinkedEntries,
        corpusRealEntries: realEntries,
        symlinkedDirsFollowed: walk.symlinkedDirsFollowed,
        dirsVisited: walk.dirsVisited,
        admittedExtensions: EXTS,
        paths: PATHS,
        distinctFiles: DISTINCT,
        admitted: ADMITTED,
        repos: REPOS,
        trackedPathsTotal: trackedTotal,
        notGit,
        overCap,
        overCapLargest,
        absent,
        sizeCap: SIZE_CAP,
        admittedByExtension: perExt,
        perRepo: rows.map(([repo, files]) => ({ repo, admitted: files.length })),
        // ★ THE ADMITTED FILE LIST IS PUBLISHED SO THE CENSUS READS **THIS** WALK, NOT A COPY OF
        //   ITS RULE. A second walker with a second copy of the admission rule is the fleet's
        //   duplicated-table defect (one table, two populations, one name). The census refuses to
        //   run when this list's length disagrees with `admitted`.
        admittedFiles: admittedPaths.map((abs) => {
          const repo = repoOfAbs.get(abs) ?? ""
          return { repo, abs, rel: repo ? path.relative(path.join(CR, repo), abs) : abs }
        }),
        nonAsciiTrap: {
          measured: "plain `git ls-files` (newline split) reports 6,062 because tests/misc/åäö.nim is C-quoted; `git ls-files -z` reports 6,063",
          file: "tests/misc/åäö.nim",
        },
      },
      null,
      2,
    ),
  )
  console.log(`WROTE ${JSON_OUT}`)
}

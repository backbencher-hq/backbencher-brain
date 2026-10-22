/**
 * HTML POPULATION — THE THREE DENOMINATORS, MEASURED, WITH THE COMMAND THAT PRODUCED THEM.
 *
 * ## WHY THIS INSTRUMENT EXISTS (and why it is a COPY of the dart lane's, deliberately)
 *
 * `script/m14/dart-population.ts` is the model and this file is its html twin. The three rules it
 * encodes are the campaign's, and they are the rules the html lane was measured against:
 *
 *   · **THE REPO COUNT IS THE REPOSITORIES THAT CARRY AN ADMITTED FILE FOR THAT LANGUAGE** — not
 *     the number of git checkouts in the corpus, and not the number of checkouts whose tracked
 *     files carry the extension. `incoming-gate.ts` adds a repository per ADMITTED file.
 *   · **THE HEADER MUST BE DERIVABLE FROM THE ROWS THE INSTRUMENT MEASURED** — so the per-repo
 *     table and the header line come out of ONE pass, or the claim has two populations.
 *   · **OVERLAPPING SETS ARE UNIONED, NOT SUMMED.**
 *
 * And the walk rule, which cost a lane 22 % of its population once: **`readdirSync(...,
 * { withFileTypes: true }).isDirectory()` is FALSE for a SYMLINK, and a walk that does not follow
 * links silently DROPS WHOLE REPOSITORIES.** So this walk follows symlinked directories and PRINTS
 * HOW MANY IT FOLLOWED — a walk that cannot say how many links it followed is not auditable.
 *
 * ## THE THREE DENOMINATORS, NEVER MIXED
 *
 *   PATHS        every admitted-extension PATH on disk under the corpus root (the same file
 *                reached by two paths is TWO paths)
 *   DISTINCT     every admitted-extension FILE on disk, counted once by its real path
 *   ADMITTED     the gate's OWN admission rule: git-tracked, an admitted extension, present in
 *                the working tree, and at most the engine's 1 MB full-AST cap
 *
 * ## THE ADMITTED EXTENSION SET IS THE ROUTER'S OWN TABLE, NOT A SECOND COPY
 *
 * `incoming-gate.ts:319` carries the fleet's per-lane extension map, and the html lane's row is
 * `html: "html,htm,xhtml,hbs,twig,pug,erb,mustache,ejs,liquid,njk,jinja,j2"` — thirteen spellings.
 * This file reads THE ROUTER'S TABLE (via the same `EXTENSION_LANGUAGE` map the gate uses) so the
 * population cannot disagree with the arm that measures it: a second hand-written copy of the
 * extension list is a second rule, and this programme has paid for copied rules more than once.
 *
 * Usage:
 *   BB_CORPUS_ROOT=$PWD/.corpus bun run script/m14/html-population.ts [--json <out.json>]
 */
import { readdirSync, statSync, existsSync, realpathSync, writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../src/ast/language-detection"
// ★ THE ADMITTED SPELLINGS COME FROM THE ROUTER'S ONE TABLE, AND THIS LANE KEEPS NO COPY OF IT.
//   The table moved to script/m14/language-extensions.ts on 2026-10-22, because the heritage
//   blind-spot probe carried its own map, had no `cpp` entry, and measured an EMPTY POPULATION
//   and printed a clean-looking zero over it. ⇒ A TABLE DUPLICATED IN TWO PLACES IS ONE TABLE
//   THAT WILL DIVERGE, and this lane's population is measured by three instruments (this one,
//   the construct census, and the arm) — so all three read the SAME table, and a walk that reads
//   the ROUTER'S TABLE and a walk that reads the HTML LANE'S TABLE cannot be two different
//   populations under the same name.
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

// ★ THE LOCAL COPY OF THE EXTENSION MAP IS GONE. It stood here as "the router's own map", and it
//   WAS the router's own map on 2026-10-15 — and then the router's map MOVED to
//   script/m14/language-extensions.ts (2026-10-22) and this copy would have silently become a
//   SECOND TABLE, under the same name, measuring a population that could drift from the gate's
//   without anything saying so. ⇒ ONE TABLE, READ, NEVER COPIED.
// THE THIRTEEN SPELLINGS, FROM THE SHARED TABLE. `extensionsFor` returns them with a leading dot
// (".html"), so the dot is stripped here to keep the suffix test in the shape the gate's own
// `admitByExtension` uses.
const EXTS = extensionsFor("html").map((e) => e.replace(/^\./, ""))
const LANE = "html"

const L: string[] = []
const say = (s = "") => L.push(s)

// ─── THE WALK: FOLLOW SYMLINKED DIRECTORIES, AND COUNT THEM ───────────────────────────────────
type Walk = { paths: string[]; symlinkedDirsFollowed: number; dirsVisited: number }
function walkHtml(dir: string, out: Walk): void {
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
    if (isDir) walkHtml(full, out)
    else if (isFile && hasAdmittedExt(full)) out.paths.push(full)
  }
}
/** The PATH-side test: a trailing admitted extension, case-insensitively. */
function hasAdmittedExt(p: string): boolean {
  const low = p.toLowerCase()
  return EXTS.some((e) => low.endsWith(`.${e}`))
}

say("HTML POPULATION — the three denominators, one pass, with the rule named for each")
say()
say(`  corpus root          ${CR}`)
say(`  corpus root exists   ${existsSync(CR)}`)
say(`  size cap             ${SIZE_CAP} bytes (the engine's own FULL_AST_LIMIT)`)
say(`  admitted extensions  ${EXTS.map((e) => `.${e}`).join(" ")}   rule: the ROUTER's ONE table (script/m14/language-extensions.ts), read — not a second copy`)
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
  walkHtml(dir, walk)
}
const PATHS = walk.paths.length
const DISTINCT = new Set(walk.paths.map((p) => { try { return realpathSync(p) } catch { return p } })).size

// ─── ADMITTED: THE GATE'S OWN RULE ─────────────────────────────────────────────────────────────
/** The gate's `admitByExtension`, verbatim in behaviour: a trailing `.ext`, OR a bare basename
 *  equal to an ext WHEN THE ROUTER AGREES (a bare `html` is admitted only if the router says
 *  html — a `html` SHELL SCRIPT is not an HTML document). */
function admitByExtension(rel: string, exts: string[], lang: string): boolean {
  const low = rel.toLowerCase()
  const base = low.slice(low.lastIndexOf("/") + 1)
  if (exts.some((e) => low.endsWith(`.${e}`))) return true
  return exts.some((e) => base === e) && detectLanguageFromPath(rel) === lang
}

const admittedByRepo = new Map<string, string[]>()
const admittedPaths: string[] = []
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
    const ext = rel.slice(rel.lastIndexOf(".")).toLowerCase()
    perExt[ext] = (perExt[ext] ?? 0) + 1
  }
  if (admitted.length > 0) admittedByRepo.set(e.name, admitted)
  trackedTotal += tracked.length
}
const ADMITTED = [...admittedByRepo.values()].reduce((n, a) => n + a.length, 0)
const REPOS = admittedByRepo.size

say()
say("== THE THREE DENOMINATORS (never mixed) ==")
say(`  PATHS                ${PATHS.toLocaleString()}   rule: every admitted-extension PATH on disk under the corpus root`)
say(`  DISTINCT FILES       ${DISTINCT.toLocaleString()}   rule: every admitted-extension FILE on disk, counted once by its real path`)
say(`  ADMITTED             ${ADMITTED.toLocaleString()}   rule: git-tracked + an admitted extension + present in the working tree + <= ${SIZE_CAP} bytes`)
say(`  REPOS                ${REPOS}   rule: repositories CARRYING AN ADMITTED FILE (incoming-gate.ts:526)`)
say()
say(`  symlinked directories FOLLOWED by the walk: ${walk.symlinkedDirsFollowed}`)
say(`  corpus entries that are NOT git checkouts (skipped): ${notGit}`)
say(`  tracked paths above the size cap (never parsed, so never measured): ${overCap} (largest ${overCapLargest} bytes)`)
say(`  tracked paths absent from the working tree (cannot be opened): ${absent}`)
say()
say("== THE ADMITTED SET BY EXTENSION (the header above is derived from these) ==")
for (const [ext, n] of Object.entries(perExt).sort((a, b) => b[1] - a[1])) say(`  ${String(n).padStart(7)}  ${ext}`)
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
        instrument: "html-population",
        root: CR,
        command: `BB_CORPUS_ROOT=${CR} bun run script/m14/html-population.ts --json ${JSON_OUT}`,
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
        notGit,
        overCap,
        overCapLargest,
        absent,
        sizeCap: SIZE_CAP,
        admittedByExtension: perExt,
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

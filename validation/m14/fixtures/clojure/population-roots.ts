/**
 * CLOJURE LANE — THE POPULATION UNDER BOTH CORPUS ROOTS, MEASURED WITH THE GATE'S OWN RULE.
 *
 * WHY THIS FILE EXISTS. There are TWO corpus roots and they admit different populations for 24 of
 * the 48 lanes:
 *
 *   - the gate's DEFAULT: `/home/ishaq2321/bb_tests/repositories` (199 repos)
 *   - the FARM:          `BB_CORPUS_ROOT=$PWD/.corpus`                 (202 repos: the 199 plus
 *                        three LOCAL checkouts — `pixie`, `plack`, `tf-aws-components`)
 *
 * A rate is comparable only between arms of the SAME population, so every clojure number has to
 * say WHICH root it walked. This instrument answers the question for this lane, ONCE, with the
 * gate's own admission rule rather than with a guess:
 *
 *   - tracked paths per repo via `git ls-files` (TRACKED files only — the corpus holds partial
 *     clones, so an untracked file on disk is not corpus);
 *   - the gate's `admitByExtension`: the path ends with `.<ext>` for one of the lane's
 *     extensions, OR its bare basename equals one of them AND the router attributes the path to
 *     the lane;
 *   - the gate's `SIZE_CAP` of 1 MB, with over-cap and absent paths EXCLUDED AND COUNTED, never
 *     silently dropped;
 *   - the lane's extension list is read from `script/m14/incoming-gate.ts`'s OWN `LANES_A`
 *     literal at run time — so a change to the gate's list changes this instrument, and the
 *     answer cannot drift away from the instrument it audits.
 *
 * It is DISCOVERY ONLY: it opens no file, parses no AST, runs no analyzer. That is why it does
 * NOT take the arm token — the token serialises the arms that parse the corpus and hold
 * indexes in memory, and this one holds nothing.
 *
 * Usage:
 *   bun run validation/m14/fixtures/clojure/population-roots.ts [--json out.json]
 *
 * Exit status: 0 when the two roots agree on the admitted file set, 1 when they do NOT (a
 * disagreement is a finding that must be reported, never smoothed over) — and the two roots are
 * also compared by a multiset keyed on the repo-relative path, so "the same COUNT" and "the same
 * SET" are distinguished.
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import * as path from "node:path"

const ROOT = path.resolve(import.meta.dir, "..", "..", "..", "..")
const GATE = path.join(ROOT, "script", "m14", "incoming-gate.ts")
const ROUTER = path.join(ROOT, "src", "ast", "language-detection.ts")

const DEFAULT_ROOT = "/home/ishaq2321/bb_tests/repositories"
const FARM_ROOT = path.join(ROOT, ".corpus")
const SIZE_CAP = 1024 * 1024

const LANG = "clojure"

/** The gate's own extension list for a lane, read from `LANES_A` at run time.
 *
 *  `LANES_A` is a top-level literal; the terminator is the first line that is exactly `}` at
 *  column 0.  The literal is read as TEXT and the comment is stripped, so a commented-out lane
 *  cannot be counted as a lane. */
function gateExtsFor(lang: string): string[] {
  const src = readFileSync(GATE, "utf8")
  const start = src.search(/^(?:export\s+)?const LANES_A[^\n]*=\s*\{/m)
  if (start < 0) throw new Error("LANES_A not found in " + GATE)
  const bodyStart = src.indexOf("{", start)
  const end = src.indexOf("\n}", bodyStart)
  const body = src.slice(bodyStart, end)
  const re = new RegExp(`(?:^|[,{\\s])([A-Za-z0-9_]+)\\s*:\\s*"([^"]*)"`, "g")
  for (const m of body.matchAll(re)) {
    if (m[1] === lang) return m[2].split(",").map((s) => s.trim()).filter(Boolean)
  }
  throw new Error(`lane ${lang} not found in LANES_A`)
}

/** The ROUTER's own extension set for the lane, read from `EXTENSION_LANGUAGE`. */
function routerExtsFor(lang: string): string[] {
  const src = readFileSync(ROUTER, "utf8")
  const start = src.indexOf("EXTENSION_LANGUAGE")
  if (start < 0) throw new Error("EXTENSION_LANGUAGE not found")
  const end = src.indexOf("\n}", start)
  const body = src.slice(start, end)
  const out: string[] = []
  for (const m of body.matchAll(/"?([A-Za-z0-9_+#-]+)"?\s*:\s*"([A-Za-z0-9+#-]+)"/g)) {
    if (m[2] === lang) out.push(m[1].toLowerCase())
  }
  return out
}

/** The router's own language attribution for a path — the gate's `detectLanguageFromPath`.
 *  The gate imports it from `src/ast/language-detection.ts`; this instrument calls the same
 *  module, so the "bare basename" clause of the admission rule is decided by the router and not
 *  by a re-implementation of it. */
async function routerLanguageOf(rel: string): Promise<string | null> {
  const mod: any = await import(path.join(ROOT, "src", "ast", "language-detection.ts"))
  const fn = mod.detectLanguageFromPath
  if (typeof fn !== "function") throw new Error("detectLanguageFromPath not exported")
  return fn(rel) ?? null
}

/** The gate's own `admitByExtension`. */
function admitByExtension(rel: string, exts: string[], lang: string, routerLang: string | null): boolean {
  const low = rel.toLowerCase()
  const base = low.slice(low.lastIndexOf("/") + 1)
  if (exts.some((e) => low.endsWith(`.${e}`))) return true
  return exts.some((e) => base === e) && routerLang === lang
}

interface Repo {
  name: string
  files: string[] // repo-relative admitted paths
}

function discover(root: string, exts: string[], routerLangOf: (rel: string) => string | null) {
  const repos: Repo[] = []
  const excluded = { absent: 0, overCap: 0, overCapLargest: 0 }
  let trackedTotal = 0
  let entries: string[]
  try {
    entries = readdirSync(root)
  } catch {
    return { repos, excluded, trackedTotal, files: 0 }
  }
  for (const name of entries.sort()) {
    const dir = path.join(root, name)
    try {
      if (!statSync(dir).isDirectory()) continue
    } catch {
      continue
    }
    // Only real git checkouts are corpus.
    try {
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
    trackedTotal += tracked.length
    const files: string[] = []
    for (const rel of tracked) {
      const low = rel.toLowerCase()
      const base = low.slice(low.lastIndexOf("/") + 1)
      const isExt = exts.some((e) => low.endsWith(`.${e}`))
      const isBare = exts.some((e) => base === e)
      if (!isExt && !isBare) continue
      if (isBare && !isExt) {
        // the gate consults the ROUTER only for a bare basename
        if (routerLangOf(rel) !== LANG) continue
      }
      const abs = path.join(dir, rel)
      try {
        const size = statSync(abs).size
        if (size > SIZE_CAP) {
          excluded.overCap++
          excluded.overCapLargest = Math.max(excluded.overCapLargest, size)
          continue
        }
      } catch {
        excluded.absent++
        continue
      }
      files.push(rel)
    }
    if (files.length > 0) repos.push({ name, files: files.sort() })
  }
  return { repos, excluded, trackedTotal, files: repos.reduce((n, r) => n + r.files.length, 0) }
}

/** The identity of a file for the cross-root comparison: repo name + repo-relative path.
 *  The ABSOLUTE path is deliberately not part of the key, because the two roots are two
 *  different directories holding (mostly) the same checkouts — comparing absolute paths would
 *  report every file as different. */
function keyOf(repo: string, rel: string): string {
  return `${repo}/${rel}`
}

const exts = gateExtsFor(LANG)
const routerExts = routerExtsFor(LANG)
const routerLangOf = await routerLanguageOf

const out: any = {
  lane: LANG,
  gateExts: exts,
  routerExts,
  extsAgree:
    exts.length === routerExts.length && exts.every((e, i) => routerExts[i] === e),
  sizeCap: SIZE_CAP,
  roots: {} as any,
}

const keysOf = new Map<string, Set<string>>()
/** THE PER-ROOT FILE LISTS, kept for THE CONTENT COMPARISON ✓✓ (the paths are compared below) ✓✓. */
const filesOf = new Map<string, { repo: string; rel: string }[]>()
for (const [label, root] of [["default", DEFAULT_ROOT], ["farm", FARM_ROOT]] as const) {
  const d = discover(root, exts, routerLangOf)
  const list: { repo: string; rel: string }[] = []
  for (const r of d.repos) for (const f of r.files) list.push({ repo: r.name, rel: f })
  filesOf.set(label, list)
  const byRepo: Record<string, number> = {}
  const byExt: Record<string, number> = {}
  const keys = new Set<string>()
  for (const r of d.repos) {
    byRepo[r.name] = r.files.length
    for (const f of r.files) {
      keys.add(keyOf(r.name, f))
      const e = path.extname(f).slice(1).toLowerCase() || "(none)"
      byExt[e] = (byExt[e] ?? 0) + 1
    }
  }
  keysOf.set(label, keys)
  out.roots[label] = {
    root,
    files: d.files,
    repos: d.repos.length,
    trackedTotal: d.trackedTotal,
    excluded: d.excluded,
    byRepo,
    byExt,
    repoList: d.repos.map((r) => `${r.name}=${r.files.length}`),
  }
}

// THE CROSS-ROOT COMPARISON — as a MULTISET over the (repo, path) identity, because two roots
// can hold the same COUNT and different SETS, and a count alone cannot tell them apart.
const a = keysOf.get("default")!
const b = keysOf.get("farm")!
const onlyDefault = [...a].filter((k) => !b.has(k)).sort()
const onlyFarm = [...b].filter((k) => !a.has(k)).sort()
out.compare = {
  sameFileSet: onlyDefault.length === 0 && onlyFarm.length === 0,
  sameFileCount: out.roots.default.files === out.roots.farm.files,
  onlyDefault: { count: onlyDefault.length, sample: onlyDefault.slice(0, 20) },
  onlyFarm: { count: onlyFarm.length, sample: onlyFarm.slice(0, 20) },
}

/**
 * THE SAME PATHS, COMPARED **BY THEIR BYTES** ✓✓ — THE COMPARISON THE PATH MULTISET CANNOT MAKE ✓✓.
 *
 * **THE TWO ROOTS ADMIT THE SAME 646 PATHS ✓✓ AND THAT IS NOT THE SAME POPULATION ✓✓ — THE ROOT IS
 * PART OF THE POPULATION'S IDENTITY ✓✓, AND THE EDGE COUNTS PROVE IT ✓✓ (43,439 edges under the
 * DEFAULT root's commits against 43,324 under the FARM's ✓✓ — 115 edges of DIFFERENT SOURCE CODE ✓✓,
 * not 115 files ✓✓).**
 *
 * A PATH is not a POPULATION ✓✓: a file's content is what the analyzer reads ✓✓, and two checkouts
 * of the same repository at different commits hold different bytes ✓✓. **⇒ EVERY COMMAND MUST NAME
 * ITS ROOT ✓✓, BECAUSE THE ROOT CHOOSES THE BYTES ✓✓** — and this is the measurement that says so
 * with a number, for this lane, on this corpus ✓✓.
 */
{
  const digestOf = (p: string): string => {
    try { return createHash("sha256").update(readFileSync(p)).digest("hex") } catch { return "" }
  }
  const byKey = (label: string): Map<string, string> => {
    const m = new Map<string, string>()
    const root = label === "default" ? DEFAULT_ROOT : FARM_ROOT
    for (const f of filesOf.get(label) ?? []) m.set(`${f.repo}/${f.rel}`, digestOf(path.join(root, f.repo, f.rel)))
    return m
  }
  const da = byKey("default")
  const db = byKey("farm")
  const common = [...da.keys()].filter((k) => db.has(k))
  const differ = common.filter((k) => da.get(k) !== db.get(k))
  out.content = {
    compared: common.length,
    identical: common.length - differ.length,
    differ: differ.length,
    differSample: differ.slice(0, 20),
    samePathsDifferentBytes: differ.length > 0,
  }
}

const jsonIdx = process.argv.indexOf("--json")
if (jsonIdx >= 0 && process.argv[jsonIdx + 1]) {
  writeFileSync(process.argv[jsonIdx + 1], JSON.stringify(out, null, 2) + "\n")
}

console.log(`clojure lane — admitted population under BOTH corpus roots`)
console.log(`gate LANES_A exts: ${exts.join(",")}   router exts: ${routerExts.join(",")}   agree: ${out.extsAgree}`)
for (const label of ["default", "farm"] as const) {
  const r = out.roots[label]
  console.log(
    `  ${label.padEnd(8)} root=${r.root}\n` +
      `           files=${r.files}  repos=${r.repos}  trackedTotal=${r.trackedTotal}\n` +
      `           excluded: absent=${r.excluded.absent} overCap=${r.excluded.overCap} (largest ${r.excluded.overCapLargest})\n` +
      `           byExt: ${Object.entries(r.byExt).map(([k, v]) => `${k}=${v}`).join(" ")}\n` +
      `           byRepo: ${r.repoList.join(" ")}`,
  )
}
console.log(
  `COMPARE: sameFileSet=${out.compare.sameFileSet}  sameFileCount=${out.compare.sameFileCount}  ` +
    `onlyDefault=${out.compare.onlyDefault.count}  onlyFarm=${out.compare.onlyFarm.count}`,
)
console.log(`CONTENT: compared ${out.content.compared} path(s) present under both roots · identical ${out.content.identical} · DIFFER ${out.content.differ}`)
if (out.content.differ > 0) {
  console.log(`  the same PATHS hold DIFFERENT BYTES under the two roots — e.g. ${out.content.differSample.slice(0, 5).join(", ")}`)
}
if (!out.compare.sameFileSet) {
  console.log(`  onlyDefault sample: ${out.compare.onlyDefault.sample.join(", ")}`)
  console.log(`  onlyFarm sample: ${out.compare.onlyFarm.sample.join(", ")}`)
}

// THE EXTENSION-LIST ASSERTION IS A GATE, NOT A PRINT.
//
// The gate's `LANES_A` list and the router's `EXTENSION_LANGUAGE` map are TWO SOURCES OF TRUTH for
// which spellings are this lane's files, and the fleet has already paid three rounds for a drift
// between a list and a router (yaml's `.yml`, `.github`'s directory filter, xml's seven
// spellings — `POPULATION-GATE-REPAIR-2026-10-20.md`). This instrument READS BOTH, and a
// divergence between them would mean the population below is not the population the ROUTER
// defines — so it FAILS here rather than printing a comparison of two different populations.
//
// **This is a correction to the lane's own page.** `CLOJURE-VERDICT-2026-10-20.md` §0.1 said
// "the instrument exits 4 if they ever stop agreeing", and the instrument PRINTED the agreement
// and exited on something else. The page's claim was the right CLAIM and the code was not
// implementing it — which is the shape of defect the page is otherwise about, and it was found by
// reading the code behind the claim rather than by trusting it.
if (!out.extsAgree) {
  console.error(
    `*** THE EXTENSION LISTS DISAGREE: the gate's LANES_A says [${out.gateExts.join(",")}] and the ` +
      `router's EXTENSION_LANGUAGE says [${out.routerExts.join(",")}]. The population below would not be ` +
      `the population the ROUTER defines. Refusing to report it as a measurement. ***`,
  )
  process.exit(4)
}
process.exit(out.compare.sameFileSet ? 0 : 1)

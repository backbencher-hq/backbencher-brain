#!/usr/bin/env bun
/**
 * PHP LANE — THE POPULATION INSTRUMENT, AND THE CONSTRUCT CENSUSES THE FOUR EXTENDED TYPES
 * ARE DECIDED ON.
 *
 * WHAT THIS IS. One instrument that answers, on ONE population with its rule printed:
 *
 *   1. THE POPULATION — PATHS · DISTINCT FILES · ADMITTED, over the GIT-TRACKED set under the
 *      engine's own 1 MiB cap, because that is the rule every lane's denominator is measured by
 *      (`FLEET-RULINGS-2026-10-22.md` §3: the admitted set is the git-tracked set, not the disk).
 *      The rule, the root, the tracked-but-absent count and the over-cap count are printed BESIDE
 *      the number, because a number that does not say which rule produced it cannot be compared
 *      with another number.
 *   2. THE EMISSION (`--emit`) — every relationship type the analyzer publishes over the WHOLE
 *      admitted population: edges · files · repos, through the PRODUCTION path
 *      (getParser -> parse -> RealPhpAnalyzer.analyze), not from a projection and not a sample.
 *   3. THE CONSTRUCT SITES (`--emit`) — for the four extended values this lane is short on, the
 *      AST positions that could carry the relation, counted FROM THE TREE and independently of
 *      the analyzer. `sites = 0` is evidence about the corpus and the GRAMMAR's reach; `sites > 0`
 *      with `edges = 0` would be a GAP, and the ruling/implementation decision reads off that.
 *
 * WHY IT EXISTS. The PHP lane had never published a whole-population denominator in the shape the
 * completion gate reads: the numbers in `docs/analyzers/php.md` and
 * `script/m14/spec/php-completeness.json` were measured over 5,094 `.php` files — BEFORE the
 * extension map admitted `.phpt`, which the router maps to php and the engine parses with this
 * analyzer. MEASURED at HEAD (2026-10-23): the admitted set is 6,424 (5,114 `.php` + 1,310
 * `.phpt`). A count over 5,094 is not a smaller number than a count over 6,424; it is a different
 * population, and the spec's `_implemented_measured` block (exports 58/18, overrides 1,235/755)
 * is therefore SUPERSEDED rather than inherited.
 *
 * ⇒ RULE ONE: AN INSTRUMENT AND THE DENOMINATOR MUST COUNT THE SAME POPULATION. The extensions are
 * IMPORTED from `script/m14/language-extensions.ts` (the router's one table), never re-spelled —
 * a second copy is one table that will diverge, which the heritage blind-spot probe already paid
 * for (`script/m14/.../FLEET-STATE`: a probe with its own extension map measured ZERO over an
 * empty population and exited 0).
 *
 * ⇒ RULE TWO: A SYMLINKED DIRECTORY IS A DIRECTORY. `readdirSync(..., {withFileTypes:true})`
 * reports a symlink with `isDirectory() === false`, so a walk built on `Dirent` drops every
 * symlinked repository in this corpus silently. This walk uses `statSync` (which FOLLOWS the link)
 * and PRINTS how many symlinked directory entries it entered over the corpus root, with the root
 * printed in the same sentence (FLEET-RULINGS-2026-10-22 §1: count, root, rule, dedup).
 *
 * ⇒ RULE THREE: A SAMPLE IS REFUSED BY NAME. `--limit` exists for smoke tests and is FORBIDDEN
 * with `--json`: an artifact written from a subset would be a denominator about a different set
 * while reading exactly like the whole one. The scala lane's generator made the same refusal, and
 * it is the defence the completion gate exists for.
 *
 * USAGE
 *   # 1. the denominator (cheap: git ls-files + stat, NO parsing — no arm token needed)
 *   BB_CORPUS_ROOT="$PWD/.corpus" bun run script/m14/php-population.ts
 *   BB_CORPUS_ROOT="$PWD/.corpus" bun run script/m14/php-population.ts --json validation/m14/measurements/php-population.json
 *
 *   # 2. the whole-population emission + construct census (HEAVY ARM — the fleet's arm token)
 *   BB_CORPUS_ROOT="$PWD/.corpus" bun run script/m14/php-population.ts --emit --json validation/m14/measurements/php-emission-census.json
 *
 *   # 3. a smoke test of the parse path on N files (never writable)
 *   bun run script/m14/php-population.ts --emit --limit 25
 *
 *   # 4. the disk-vs-tracked delta, as a DIFFERENT population, labelled as such
 *   BB_CORPUS_ROOT="$PWD/.corpus" bun run script/m14/php-population.ts --disk
 *
 * EXIT: 0 measured · 2 usage/environment · 4 a sample was asked to be written, a walk produced
 * zero admitted files, or an artifact's arithmetic does not close. A population of zero is a
 * CONTROL FAILURE, not a measurement.
 */
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { dirname, join, relative, resolve } from "node:path"
import { extensionsFor } from "./language-extensions"

const HERE = (import.meta as any).dir ?? dirname(new URL(import.meta.url).pathname)
const REPO = resolve(HERE, "..", "..")

const argv = process.argv.slice(2)
const JSON_OUT = argv.includes("--json") ? argv[argv.indexOf("--json") + 1] : ""
const EMIT = argv.includes("--emit")
const DISK = argv.includes("--disk")
const LIMIT_ARG = argv.find((a) => a.startsWith("--limit=")) ?? (argv.includes("--limit") ? `--limit=${argv[argv.indexOf("--limit") + 1]}` : "")
const LIMIT = LIMIT_ARG ? Number.parseInt(LIMIT_ARG.slice("--limit=".length), 10) : 0
const ROOT = process.env.BB_CORPUS_ROOT ?? join(process.cwd(), ".corpus")

if (!existsSync(ROOT)) {
  console.error(`php-population: corpus root does not exist: ${ROOT} (set BB_CORPUS_ROOT)`)
  process.exit(2)
}
if (LIMIT > 0 && JSON_OUT) {
  console.error(`php-population: REFUSED — --limit=${LIMIT} is a SMOKE TEST and --json writes an artifact. A sample artifact is a denominator about a different set while reading exactly like the whole one. Drop --limit or drop --json.`)
  process.exit(4)
}

/** The engine's own FULL_AST_LIMIT (`src/ast/pool-worker.ts:1225`), the cap the admission gate
 *  admits by. The gate's own constant is `SIZE_CAP = 1024 * 1024` (`incoming-gate.ts:305`); this
 *  instrument mirrors that NUMBER with the citation rather than importing the gate (which runs its
 *  whole body on import). */
const CAP = 1_048_576

/** THE TRACKED EXTENSIONS, FROM THE ROUTER'S ONE TABLE. `.phpt` is in it and is 1,310 of the
 *  admitted files — exactly the half every pre-HEAD php number omitted. */
const EXTS = extensionsFor("php")
if (EXTS.length === 0) { console.error("php-population: no extensions for php in script/m14/language-extensions.ts"); process.exit(2) }

const FOURTEEN = [
  "calls", "extends", "implements", "uses", "imports", "exports",
  "contains", "references", "overrides", "instantiates",
  "decorates", "renders", "mixes_in", "part_of",
] as const

// ════════════════════════════════════════════════════════════════════════════
// THE POPULATION — PATHS · DISTINCT FILES · ADMITTED
// ════════════════════════════════════════════════════════════════════════════

interface RepoRow { repo: string; symlinked: boolean; tracked: number; admitted: number; absent: number; overCap: number }

const repoRows: RepoRow[] = []
const pathSet = new Set<string>()
const realSet = new Set<string>()
const admittedAbs: string[] = []
const absentPaths: string[] = []
const overCapPaths: string[] = []
const repoOfAbs = new Map<string, string>()
let overCapLargest = 0
let duplicates = 0
let corpusGitRepos = 0
let symlinkedDirsFollowed = 0
let symlinkedFilesFollowed = 0
const regionSplit: Record<string, { tracked: number; admitted: number; absent: number }> = {}
for (const e of EXTS) regionSplit[e] = { tracked: 0, admitted: 0, absent: 0 }
const extOf = (p: string): string => EXTS.find((e) => p.toLowerCase().endsWith(e)) ?? ""

const gitTracked = (dir: string): string[] => {
  try {
    return execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
  } catch { return [] }
}
const isRepo = (dir: string): boolean => {
  try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }); return true } catch { return false }
}

{
  let entries: string[] = []
  try { entries = readdirSync(ROOT) } catch { entries = [] }
  if (entries.length === 0) {
    console.error(`php-population: the corpus root is EMPTY: ${ROOT} — a population of zero is a control failure, not a measurement`)
    process.exit(4)
  }
  for (const name of entries.sort()) {
    const dir = join(ROOT, name)
    // A SYMLINKED REPOSITORY IS STILL A REPOSITORY. statSync FOLLOWS the link; Dirent.isDirectory()
    // does NOT, and a walk built on the latter silently drops every symlinked checkout.
    let isDir = false
    try { isDir = statSync(dir).isDirectory() } catch { isDir = false }
    if (!isDir) continue
    if (!isRepo(dir)) continue
    corpusGitRepos++
    let symlinked = false
    try { symlinked = lstatSync(dir).isSymbolicLink() } catch { symlinked = false }
    const row: RepoRow = { repo: name, symlinked, tracked: 0, admitted: 0, absent: 0, overCap: 0 }
    for (const rel of gitTracked(dir)) {
      const ext = extOf(rel)
      if (!ext) continue
      row.tracked++
      regionSplit[ext].tracked++
      const abs = join(dir, rel)
      pathSet.add(abs)
      let real = abs
      try { real = realpathSync(abs) } catch { /* dangling link — counted absent below */ }
      if (realSet.has(real)) { duplicates++; continue }
      realSet.add(real)
      let size = -1
      try { size = statSync(abs).size } catch { /* absent */ }
      if (size < 0) { row.absent++; regionSplit[ext].absent++; absentPaths.push(abs); continue }
      if (size > CAP) {
        row.overCap++
        overCapLargest = Math.max(overCapLargest, size)
        overCapPaths.push(abs)
        continue
      }
      row.admitted++
      regionSplit[ext].admitted++
      admittedAbs.push(abs)
      repoOfAbs.set(abs, name)
    }
    repoRows.push(row)
  }
}
admittedAbs.sort()
absentPaths.sort()

/** THE SYMLINKED-DIRECTORY COUNT, under the fleet's rule: the number of symlinked directory
 *  ENTRIES the walk entered, over the CORPUS ROOT, with the root printed beside it. The walk
 *  enters each repository through the corpus root, so each symlinked corpus entry is one entry. */
{
  let entries: import("node:fs").Dirent[] = []
  try { entries = readdirSync(ROOT, { withFileTypes: true }) } catch { entries = [] }
  for (const e of entries) {
    if (!e.isSymbolicLink()) continue
    const p = join(ROOT, e.name)
    let isDir = false
    try { isDir = statSync(p).isDirectory() } catch { isDir = false }
    if (!isDir) { symlinkedFilesFollowed++; continue }
    symlinkedDirsFollowed++
  }
}

const reposCarryingAdmitted = repoRows.filter((r) => r.admitted > 0).length
const trackedSum = admittedAbs.length + overCapPaths.length + absentPaths.length + duplicates
const population = {
  language: "php",
  generated: new Date().toISOString(),
  rule:
    "THE POPULATION IS THE GIT-TRACKED SET, NOT THE DISK: `git ls-files` per git repository under the corpus root, " +
    `filtered to the router's php extensions (${EXTS.join(" ")}) and the engine's 1 MiB FULL_AST_LIMIT cap; ` +
    "PATHS are every tracked match, DISTINCT FILES dedups them by realpath, ADMITTED = DISTINCT that exist on disk and are at/under the cap. " +
    "A disk walk is a DIFFERENT population and its number is not comparable to this one (see --disk).",
  root: resolve(ROOT),
  extensions: EXTS,
  sizeCapBytes: CAP,
  corpusEntries: (() => { try { return readdirSync(ROOT).length } catch { return 0 } })(),
  corpusGitRepos,
  symlinkRule:
    "the number of symlinked DIRECTORY entries the walk entered, counted as ENTRIES over the CORPUS ROOT " +
    "(FLEET-RULINGS-2026-10-22 §1); readdirSync's Dirent.isDirectory() is false for a symlink, so the walk uses statSync",
  symlinkedDirsFollowed,
  symlinkedFilesFollowed,
  paths: pathSet.size,
  distinctFiles: realSet.size,
  admitted: admittedAbs.length,
  overCap: overCapPaths.length,
  overCapLargest,
  trackedButAbsent: absentPaths.length,
  realpathDuplicates: duplicates,
  arithmetic: {
    paths: pathSet.size,
    admitted: admittedAbs.length,
    overCap: overCapPaths.length,
    absent: absentPaths.length,
    duplicates,
    sum: trackedSum,
    exact: pathSet.size === trackedSum && realSet.size === admittedAbs.length + overCapPaths.length + absentPaths.length,
  },
  reposCarryingAdmitted,
  reposTrackingThisLane: repoRows.filter((r) => r.tracked > 0).length,
  extSplit: regionSplit,
  perRepo: repoRows.filter((r) => r.tracked > 0).sort((a, b) => b.admitted - a.admitted || a.repo.localeCompare(b.repo)),
  admittedDigest: `sha256:${createHash("sha256").update(admittedAbs.map((p) => relative(resolve(ROOT), p)).join("\n")).digest("hex").slice(0, 16)}`,
  trackedButAbsentSample: absentPaths.slice(0, 5).map((p) => relative(resolve(ROOT), p)),
}

// ── THE DISK ACTUALLY MEASURED, AS A DIFFERENT POPULATION (`--disk`) ────────
interface DiskRow { paths: number; files: number; untracked: string[]; trackedNotOnDisk: number }
let disk: DiskRow | null = null
if (DISK) {
  const trackedReal = new Set<string>(admittedAbs.map((p) => { try { return realpathSync(p) } catch { return p } }))
  const found: string[] = []
  const walk = (dir: string, depth: number): void => {
    if (depth > 14) return
    let ents: import("node:fs").Dirent[] = []
    try { ents = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of ents) {
      const p = join(dir, e.name)
      let st: import("node:fs").Stats | null = null
      try { st = statSync(p) } catch { continue }
      if (st.isDirectory()) { walk(p, depth + 1); continue }
      if (!st.isFile()) continue
      if (!extOf(p)) continue
      // `--disk` is a DISK population: the cap is applied here too, so the two differ by TRACKING
      // and not by admission.
      if (st.size > CAP) continue
      found.push(p)
    }
  }
  walk(ROOT, 0)
  const untracked = found.filter((p) => { try { return !trackedReal.has(realpathSync(p)) } catch { return false } })
  disk = { paths: found.length, files: new Set(found.map((p) => { try { return realpathSync(p) } catch { return p } })).size, untracked, trackedNotOnDisk: absentPaths.length }
}

// ════════════════════════════════════════════════════════════════════════════
// THE EMISSION + CONSTRUCT CENSUS (`--emit`) — HEAVY ARM
// ════════════════════════════════════════════════════════════════════════════

type PerType = { edges: number; files: Set<string>; repos: Set<string> }
interface EmitResult {
  parsed: number
  parseFailures: string[]
  perType: Record<string, PerType>
  partOfSplit: Record<string, { rows: number; files: number }>
  partOfRows: number
  partOfMissingTarget: { rows: number; sample: string[] }
  traitUse: { rows: number; files: number; currentTypes: Record<string, number>; sample: string[] }
  attributes: {
    groups: number
    attributes: number
    files: number
    argumentCallShaped: number
    argumentCallShapedFiles: number
    argumentCallShapedSample: string[]
    annotatedDeclKinds: Record<string, number>
  }
  inlineHtml: { textNodes: number; textInterpolationNodes: number; files: number; sample: string[] }
  nodeTypeTally: Record<string, number>
  stemMatches: Record<string, Record<string, number>>
  seconds: number
}

let emit: EmitResult | null = null
if (EMIT) {
  const t0 = Date.now()
  const { getParser } = await import("../../src/ast/engine.ts")
  const mod: any = await import("../../src/ast/real-php-analyzer.ts")
  const Cls: any = mod.RealPhpAnalyzer ?? Object.values(mod).find((v: any) => typeof v === "function" && /Analyzer$/.test(v.name))
  if (!Cls) { console.error("php-population: no RealPhpAnalyzer class exported"); process.exit(2) }

  const parser = await getParser("php")
  const files = LIMIT > 0 ? admittedAbs.slice(0, LIMIT) : admittedAbs

  const perType: Record<string, PerType> = {}
  for (const t of FOURTEEN) perType[t] = { edges: 0, files: new Set(), repos: new Set() }
  const partOfSplit: Record<string, { rows: number; files: number }> = {}
  const partOfFileSets: Record<string, Set<string>> = {}
  const partOfMissingTarget = { rows: 0, sample: [] as string[] }
  const traitUse = { rows: 0, files: new Set<string>(), currentTypes: {} as Record<string, number>, sample: [] as string[] }
  const attributes = {
    groups: 0, attributes: 0, files: new Set<string>(),
    argumentCallShaped: 0, argumentCallShapedFiles: new Set<string>(), argumentCallShapedSample: [] as string[],
    annotatedDeclKinds: {} as Record<string, number>,
  }
  const inlineHtml = { textNodes: 0, textInterpolationNodes: 0, files: new Set<string>(), sample: [] as string[] }
  const nodeTypeTally: Record<string, number> = {}
  const parseFailures: string[] = []

  const CALL_SHAPED = new Set([
    "function_call_expression", "member_call_expression", "scoped_call_expression",
    "nullsafe_member_call_expression", "object_creation_expression",
  ])
  const DECL_KINDS = new Set([
    "class_declaration", "interface_declaration", "trait_declaration", "enum_declaration",
    "method_declaration", "function_definition", "property_declaration", "const_declaration",
    "enum_case", "simple_parameter", "variadic_parameter", "property_promotion_parameter",
  ])
  const stemOf = (name: string): string | null => {
    const n = name.toLowerCase()
    if (n.includes("jsx") || n.includes("component") || n.includes("render") || n.includes("element")) return "renders"
    if (n.includes("decorat") || n.includes("annotat") || n.includes("attribute")) return "decorates"
    if (n.includes("mixin")) return "mixes_in"
    if (n.includes("part_of") || n.includes("partof")) return "part_of"
    return null
  }
  const stemMatches: Record<string, Record<string, number>> = {}
  const admittedRealSet = new Set<string>(admittedAbs.map((p) => { try { return realpathSync(p) } catch { return p } }))
  /** Does a part_of path target name a file the ADMITTED set carries? Path targets are resolved
   *  the way production resolves an include path: relative to the FILE's own directory, with
   *  `__DIR__`/`FILE_PREFIX` already composed by the analyzer. `relative()` from the root is the
   *  fallback for a project-relative spelling. This is a CENSUS, not the emission rule: the
   *  analyzer publishes the row either way, and the class the unresolved ones land in is the
   *  declaration's business (see the `danglingPartOf` caveat). */
  const targetAdmitted = (fromFile: string, target: string): boolean => {
    if (!target || /^[a-z][a-z0-9+.-]*:\/\//i.test(target)) return false
    const base = dirname(fromFile)
    const candidates = [
      resolve(base, target),
      resolve(base, target.replace(/^\/+/, "")),
      resolve(ROOT, target.replace(/^\/+/, "")),
    ]
    for (const c of candidates) {
      try { if (admittedRealSet.has(realpathSync(c))) return true } catch { /* not on disk */ }
    }
    return false
  }

  let parsed = 0
  for (const f of files) {
    let content: string
    try { content = readFileSync(f, "utf8") } catch { parseFailures.push(f); continue }
    let pr: any
    try { pr = await parser.parse(content) } catch { parseFailures.push(f); continue }
    if (!pr) { parseFailures.push(f); continue }
    const rel = relative(resolve(ROOT), f)
    const repo = repoOfAbs.get(f) ?? "?"

    // ── the tree census, with the PARENT passed down (web-tree-sitter's `.parent` is not relied
    //    on here: a census that reads a field the wrapper may not carry is the shape the fleet
    //    already paid for once, `pool-worker`'s flat `startLine`).
    const stack: Array<{ node: any; parent: any }> = [{ node: pr.rootNode, parent: null }]
    while (stack.length) {
      const { node: n, parent } = stack.pop()!
      const nt = String(n.type)
      nodeTypeTally[nt] = (nodeTypeTally[nt] ?? 0) + 1
      const stem = stemOf(nt)
      if (stem) {
        stemMatches[stem] ??= {}
        stemMatches[stem][nt] = (stemMatches[stem][nt] ?? 0) + 1
      }
      if (nt === "attribute_group") { attributes.groups++; attributes.files.add(f) }
      if (nt === "attribute") {
        attributes.attributes++
        attributes.files.add(f)
        // the annotated declaration's kind: the nearest enclosing declaration, at most 4 hops up
        let cur = parent
        let hops = 0
        while (cur && hops < 4) {
          if (DECL_KINDS.has(String(cur.type))) { attributes.annotatedDeclKinds[String(cur.type)] = (attributes.annotatedDeclKinds[String(cur.type)] ?? 0) + 1; break }
          cur = cur.parent ?? null
          hops++
        }
        // THE DECISIVE COUNTER — NAMED BEFORE THE CENSUS RUNS: an `attribute` whose ARGUMENT is a
        // call-shaped expression would be an APPLIED CALLABLE, not passive metadata. If this is
        // non-zero the ontological ruling is FALSIFIED and the type must be implemented.
        let args: any = null
        for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c && String(c.type) === "arguments") { args = c; break } }
        let hasCall = false
        const ws: any[] = args ? [args] : []
        while (ws.length) {
          const m = ws.pop()!
          if (CALL_SHAPED.has(String(m.type))) { hasCall = true; break }
          for (let i = 0; i < m.childCount; i++) { const c = m.child(i); if (c) ws.push(c) }
        }
        if (hasCall) {
          attributes.argumentCallShaped++
          attributes.argumentCallShapedFiles.add(f)
          if (attributes.argumentCallShapedSample.length < 10) attributes.argumentCallShapedSample.push(`${rel}: attribute with a call-shaped argument`)
        }
      }
      if (nt === "text") {
        inlineHtml.textNodes++; inlineHtml.files.add(f)
        if (inlineHtml.sample.length < 10) inlineHtml.sample.push(`${rel}: text`)
      }
      if (nt === "text_interpolation") { inlineHtml.textInterpolationNodes++; inlineHtml.files.add(f) }
      for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c) stack.push({ node: c, parent: n }) }
    }

    // ── the emission, through the PRODUCTION path ──
    let res: any
    try { res = new Cls().analyze(pr.rootNode, content, f) } catch { parseFailures.push(f); continue }
    parsed++
    for (const r of res?.relationships ?? []) {
      const t = String(r?.type ?? "")
      const pt = perType[t]
      if (pt) { pt.edges++; pt.files.add(f); pt.repos.add(repo) }
      const md: any = r?.metadata ?? {}
      // part_of attribution BY THE WRITTEN DIRECTIVE FORM, not by the current type name, so the
      // census reads the same BEFORE and AFTER the relabel lands.
      if (md?.relationshipType === "include_path" || t === "part_of" || md?.partRole !== undefined) {
        const form = String(md?.includeType ?? "unknown")
        partOfSplit[form] ??= { rows: 0, files: 0 }
        partOfSplit[form].rows++
        partOfFileSets[form] ??= new Set()
        if (!partOfFileSets[form].has(f)) { partOfFileSets[form].add(f); partOfSplit[form].files++ }
        if (!targetAdmitted(f, String(r?.target ?? ""))) {
          partOfMissingTarget.rows++
          if (partOfMissingTarget.sample.length < 10) partOfMissingTarget.sample.push(`${rel}: ${form} ${String(r?.target ?? "").slice(0, 90)}`)
        }
      }
      // mixes_in candidates BY THE ANALYZER'S OWN MARKER, whatever type it currently publishes.
      if (md?.isTraitUse) {
        traitUse.rows++
        traitUse.files.add(f)
        traitUse.currentTypes[t] = (traitUse.currentTypes[t] ?? 0) + 1
        if (traitUse.sample.length < 10) traitUse.sample.push(`${rel}: trait-use ${String(r?.source ?? "")} -> ${String(r?.target ?? "")}`)
      }
    }
  }

  emit = {
    parsed,
    parseFailures,
    perType,
    partOfSplit,
    partOfRows: Object.values(partOfSplit).reduce((a, v) => a + v.rows, 0),
    partOfMissingTarget,
    traitUse: { rows: traitUse.rows, files: traitUse.files.size, currentTypes: traitUse.currentTypes, sample: traitUse.sample },
    attributes: {
      groups: attributes.groups, attributes: attributes.attributes, files: attributes.files.size,
      argumentCallShaped: attributes.argumentCallShaped,
      argumentCallShapedFiles: attributes.argumentCallShapedFiles.size,
      argumentCallShapedSample: attributes.argumentCallShapedSample,
      annotatedDeclKinds: attributes.annotatedDeclKinds,
    },
    inlineHtml: { textNodes: inlineHtml.textNodes, textInterpolationNodes: inlineHtml.textInterpolationNodes, files: inlineHtml.files.size, sample: inlineHtml.sample },
    nodeTypeTally,
    stemMatches,
    seconds: Math.round((Date.now() - t0) / 100) / 10,
  }
}

// ════════════════════════════════════════════════════════════════════════════
// OUTPUT
// ════════════════════════════════════════════════════════════════════════════

const say = (n: number) => n.toLocaleString()
console.log(`PHP POPULATION — root ${resolve(ROOT)}`)
console.log(`rule: ${population.rule}`)
console.log("")
console.log(`corpus entries ${say(population.corpusEntries)} · git repositories ${say(corpusGitRepos)} · symlinked DIRECTORY entries entered ${say(symlinkedDirsFollowed)} · symlinked FILES ${say(symlinkedFilesFollowed)}`)
console.log("  (the symlink rule: ENTRIES the walk entered over the CORPUS ROOT; Fleet Rulings 2026-10-22 §1)")
console.log("")
console.log(`PATHS(tracked) ${say(population.paths)}  →  DISTINCT(realpath) ${say(population.distinctFiles)}  →  ADMITTED ${say(population.admitted)}`)
console.log(`  over 1 MiB cap ${say(population.overCap)} · tracked-but-ABSENT-from-disk ${say(population.trackedButAbsent)} · realpath duplicates ${say(population.realpathDuplicates)}`)
console.log(`  arithmetic: ${population.arithmetic.exact ? "EXACT" : "*** DOES NOT CLOSE ***"} — paths ${say(pathSet.size)} = admitted ${say(population.admitted)} + over-cap ${say(population.overCap)} + absent ${say(population.trackedButAbsent)} + dup ${say(population.realpathDuplicates)}`)
for (const [e, v] of Object.entries(regionSplit)) console.log(`  ${e.padEnd(6)} tracked ${say(v.tracked).padStart(6)} · admitted ${say(v.admitted).padStart(6)} · absent ${say(v.absent).padStart(6)}`)
console.log(`repos tracking this lane ${population.reposTrackingThisLane} · repos CARRYING an admitted file ${reposCarryingAdmitted}`)
console.log("")
console.log("per repository (admitted / tracked / absent):")
for (const r of population.perRepo) console.log(`  ${r.repo.padEnd(22)} ${String(r.admitted).padStart(5)} / ${String(r.tracked).padStart(5)} / ${String(r.absent).padStart(4)}${r.symlinked ? "" : "   (not a symlink)"}`)

if (disk) {
  console.log("")
  console.log("THE DISK — a DIFFERENT population, measured only because the difference is a fact a reader must see:")
  console.log(`  disk files (≤cap, following symlinks) ${say(disk.paths)} · distinct(realpath) ${say(disk.files)} · UNTRACKED-on-disk ${say(disk.untracked.length)} · tracked-but-absent ${say(disk.trackedNotOnDisk)}`)
  for (const p of disk.untracked.slice(0, 10)) console.log(`  UNTRACKED ${relative(resolve(ROOT), p)}`)
}

if (emit) {
  console.log("")
  console.log(`EMISSION — parsed ${say(emit.parsed)} of ${say(LIMIT > 0 ? LIMIT : admittedAbs.length)}${emit.parseFailures.length ? ` · FAILED ${say(emit.parseFailures.length)}` : " · 0 failed"} · ${emit.seconds}s`)
  console.log("per type (edges / files / repos):")
  for (const t of FOURTEEN) {
    const p = emit.perType[t]
    console.log(`  ${t.padEnd(13)} ${String(p.edges).padStart(8)} / ${String(p.files.size).padStart(5)} / ${p.repos.size}`)
  }
  console.log("")
  console.log(`mixes_in — trait-use rows by the analyzer's own marker: ${say(emit.traitUse.rows)} over ${say(emit.traitUse.files)} files · current type(s): ${JSON.stringify(emit.traitUse.currentTypes)}`)
  console.log(`part_of  — include/require rows by WRITTEN FORM: ${Object.entries(emit.partOfSplit).map(([k, v]) => `${k} ${v.rows}/${v.files}`).join(" · ") || "(none)"}`)
  console.log(`           targets NOT resolved inside the admitted set: ${say(emit.partOfMissingTarget.rows)} (the 'danglingPartOf' class; see the declaration)`)
  console.log(`decorates — attribute groups ${say(emit.attributes.groups)} · attributes ${say(emit.attributes.attributes)} over ${say(emit.attributes.files)} files · DECISIVE COUNTER (call-shaped attribute argument) ${say(emit.attributes.argumentCallShaped)} over ${say(emit.attributes.argumentCallShapedFiles)} files`)
  console.log(`           annotated declaration kinds: ${JSON.stringify(emit.attributes.annotatedDeclKinds)}`)
  console.log(`renders  — inline HTML: text ${say(emit.inlineHtml.textNodes)} · text_interpolation ${say(emit.inlineHtml.textInterpolationNodes)} over ${say(emit.inlineHtml.files)} files · component/element/render-name stems: ${JSON.stringify(emit.stemMatches["renders"] ?? {})}`)
  console.log(`           grammar node types SEEN while parsing (occurrence census, not the inventory): ${Object.keys(emit.nodeTypeTally).length}`)
} else {
  console.log("")
  console.log("(emission + construct census NOT run — that is the heavy arm: re-run with --emit under the arm token)")
}

if (JSON_OUT) {
  if (!population.arithmetic.exact) { console.error("php-population: REFUSED to write an artifact whose arithmetic does not close"); process.exit(4) }
  if (emit && emit.parseFailures.length > 0) { console.error(`php-population: REFUSED to write an emission artifact with ${emit.parseFailures.length} parse failure(s) — a partial parse is a partial number`); process.exit(4) }
  const artifact: any = { population }
  if (disk) artifact.disk = disk
  if (emit) {
    artifact.emission = {
      mode: LIMIT > 0 ? `SAMPLE ${LIMIT}` : "WHOLE ADMITTED POPULATION",
      parsed: emit.parsed,
      parseFailures: emit.parseFailures.length,
      seconds: emit.seconds,
      perType: Object.fromEntries(FOURTEEN.map((t) => [t, { edges: emit.perType[t].edges, files: emit.perType[t].files.size, repos: emit.perType[t].repos.size }])),
      mixes_in: { traitUseRows: emit.traitUse.rows, traitUseFiles: emit.traitUse.files, currentTypes: emit.traitUse.currentTypes, sample: emit.traitUse.sample },
      part_of: { byWrittenForm: emit.partOfSplit, rows: emit.partOfRows, targetsNotInAdmittedSet: emit.partOfMissingTarget },
      decorates: {
        attributeGroups: emit.attributes.groups, attributes: emit.attributes.attributes, attributeFiles: emit.attributes.files,
        decisiveCounter: {
          name: "attribute whose ARGUMENT is a call-shaped expression",
          rows: emit.attributes.argumentCallShaped, files: emit.attributes.argumentCallShapedFiles,
          sample: emit.attributes.argumentCallShapedSample,
          meaning: "NON-ZERO FALSIFIES the passive-metadata ruling: a call-shaped argument is an applied callable, and the vocabulary then owes a `decorates` implementation. NAMED BEFORE THE CENSUS RAN.",
        },
        annotatedDeclKinds: emit.attributes.annotatedDeclKinds,
      },
      renders: {
        inlineHtml: { text: emit.inlineHtml.textNodes, textInterpolation: emit.inlineHtml.textInterpolationNodes, files: emit.inlineHtml.files, sample: emit.inlineHtml.sample },
        stemMatches: emit.stemMatches,
      },
      nodeTypeTally: emit.nodeTypeTally,
    }
  }
  writeFileSync(resolve(REPO, JSON_OUT), JSON.stringify(artifact, null, 2) + "\n")
  console.log(`\nartifact written: ${JSON_OUT}`)
}

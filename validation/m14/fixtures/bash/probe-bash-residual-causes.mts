/**
 * BASH — THE RESIDUAL, BUCKETED BY NAMED CAUSE, AND EVERY CANDIDATE MARKER PRICED BEFORE IT EXISTS.
 *
 * ## The question
 *
 * `incoming-gate.ts bash sh,bash,zsh 400` reads `16284 edges · 11153 resolved · 264 amb(decl) ·
 * 4832 unresolved · extOK 0 · ext? 20 · extFAIL 15 · causeOK 0`. This probe answers the two
 * questions that table cannot:
 *
 *   1. WHAT ARE THE 4832? — every unresolved edge, bucketed by the construct it points at,
 *      with the marker keys the analyzer already publishes on it.
 *   2. WHAT WOULD A MARKER COST? — for each candidate rule, how many edges it moves AND how many
 *      of those name a declaration the PROJECT actually holds (the false-in-fact class the
 *      claim would deny). A count that moves is not a count that is true.
 *
 * ## The rule is imported, never copied
 *
 * `classifyEdge`, `externalClaimOf`, `emptyOutcomes`, `tally` come from
 * `script/m14/incoming-rule.ts`. The call is the GATE'S OWN CALL, all seven arguments:
 * `containsLike` for `contains` (omitting it is the defect the programme has hit twice — this
 * lane's `probe-bash-incoming-split.mts` reads `amb 1458` against the gate's `264`, and the
 * difference is exactly the 1194 `contains` collisions) and `ownFileDeclares`, which the gate
 * computes from the same `(file, line)` declaration positions this probe keeps.
 *
 * ## The population is the gate's, and `--compare` REFUSES to speak without it
 *
 * Discovery is the gate's rule (git checkouts under the corpus root, `git ls-files`, the admitted
 * extension set, the 1 MB cap, sorted, then a stride). `--compare <gate.json>` checks every
 * column this probe shares with the gate's `--json` capture and exits 2 when they disagree, so a
 * bucket table can never be read as evidence about a run it does not reproduce.
 *
 * ## The second key space (--repo-wide)
 *
 * The gate resolves against the SAMPLE's key space, so a target declared in an unsampled file of
 * the same repository reads `unresolved`. That class is a budget, not a defect, and it is exactly
 * the class a marker would be WRONG about: the analyzer would claim "this name is not a project
 * declaration" on an edge whose project declares it. `--repo-wide` parses the whole admitted
 * population of the sampled repositories and splits every bucket by it. That split is the
 * false-in-fact measurement, and it is the number that decides whether a candidate marker may
 * exist at all.
 *
 * CLI:
 *   npx tsx validation/m14/fixtures/bash/probe-bash-residual-causes.mts \
 *       [--ext sh,bash,zsh] [--nf 400] [--compare <gate.json>] [--repo-wide] [--top 25]
 *
 * Read-only. Writes nothing.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../../../src/ast/pool-worker"
import { classifyEdge, externalClaimOf, emptyOutcomes, tally } from "../../../../script/m14/incoming-rule"
import type { Outcomes, ProjectFacts, ExternalClaim } from "../../../../script/m14/incoming-rule"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const argv = process.argv.slice(2)
const flag = (n: string): string | undefined => {
  const i = argv.indexOf(`--${n}`)
  return i >= 0 ? argv[i + 1] : undefined
}
/** The lane's DECLARED population (`LANES_B.bash` and the router both carry all three). */
const EXTS = (flag("ext") ?? "sh,bash,zsh").toLowerCase().split(",").map((x) => x.trim()).filter(Boolean)
const NF = Number(flag("nf") ?? "400")
const COMPARE = flag("compare")
const COMPARE_BEFORE = flag("compare-before")
const REPO_WIDE = argv.includes("--repo-wide")
const TOP = Number(flag("top") ?? "20")
const SIZE_CAP = 1024 * 1024

const ALL_TYPES = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates"] as const
type Type = (typeof ALL_TYPES)[number]

// ------------------------------------------------------------------ discovery (the gate's rule)
const found: string[] = []
const repos = new Set<string>()
let absent = 0
let overCap = 0
for (const name of readdirSync(CR).sort()) {
  const dir = path.join(CR, name)
  try { if (!statSync(dir).isDirectory()) continue } catch { continue }
  try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
  for (const rel of tracked) {
    if (!EXTS.some((x) => rel.toLowerCase().endsWith(`.${x}`))) continue
    const abs = path.join(dir, rel)
    try { if (statSync(abs).size > SIZE_CAP) { overCap++; continue } } catch { absent++; continue }
    found.push(abs)
    repos.add(name)
  }
}
found.sort()
const corpusTotal = found.length
let files = found
if (NF > 0 && corpusTotal > NF) {
  const stride = Math.max(1, Math.floor(corpusTotal / NF))
  const picked: string[] = []
  for (let i = 0; i < found.length && picked.length < NF; i += stride) picked.push(found[i])
  files = picked
}
const repoOf = (f: string): string => path.relative(CR, f).split(path.sep)[0]

/** name -> declarations, kinds — keyed on `name` AND on the `qualifiedName` alias, the gate's rule. */
type KeySpace = { decl: Map<string, number>; kinds: Map<string, Set<string>> }
const newKeySpace = (): KeySpace => ({ decl: new Map(), kinds: new Map() })
const addSymbol = (ks: KeySpace, name: string, kind: string): void => {
  ks.decl.set(name, (ks.decl.get(name) ?? 0) + 1)
  let s = ks.kinds.get(name)
  if (!s) ks.kinds.set(name, (s = new Set()))
  s.add(kind)
}
const addSymbolWithAlias = (ks: KeySpace, name: string, qname: string, kind: string): void => {
  addSymbol(ks, name, kind)
  if (qname.length > 0 && qname !== name) addSymbol(ks, qname, kind)
}

/** Every marker key the analyzer publishes, kept per edge — the bucket keys come from THESE. */
type Pending = {
  label: Type
  tgt: string
  claim: ExternalClaim | null
  repo: string
  file: string
  line: number | null
  md: Record<string, unknown>
}
const pending: Pending[] = []
const sampleSpaces = new Map<string, KeySpace>()
const factsByRepo = new Map<string, ProjectFacts>()
{
  const admittedByRepo = new Map<string, string[]>()
  for (const f of found) {
    const repo = repoOf(f)
    const list = admittedByRepo.get(repo)
    if (list) list.push(f)
    else admittedByRepo.set(repo, [f])
  }
  for (const [repo, list] of admittedByRepo) {
    const set = new Set<string>()
    for (const abs of list) {
      const rel = path.relative(path.join(CR, repo), abs)
      if (rel.length > 0) set.add(rel.split(path.sep).join("/"))
    }
    factsByRepo.set(repo, { packages: new Set<string>(), files: set, sdkLib: false })
  }
}
/** WHERE each declaration lives — the gate's `declPos`, the input to `classifyIntent`. */
const declPos = new Map<string, { file: string; line: number }[]>()
let parsed = 0
let failed = 0
let degraded = 0
let fallbackRows = 0
for (const f of files) {
  let r: any
  try { r = await parseFile(f, repoOf(f), { projectRoot: repoOf(f) } as any) } catch { failed++; continue }
  if (!r) { failed++; continue }
  parsed++
  if (r.fallback === true || r.metadata?.analysisVersion === "2.0-basic-fallback") degraded++
  const repo = repoOf(f)
  let ks = sampleSpaces.get(repo)
  if (!ks) sampleSpaces.set(repo, (ks = newKeySpace()))
  for (const s of Array.isArray(r.symbols) ? r.symbols : []) {
    const name = String(s?.name ?? "")
    if (name.length === 0) continue
    const symLine = Number((s as any)?.range?.startLine ?? (s as any)?.range?.start_line ?? (s as any)?.line_start ?? (s as any)?.lineStart ?? (s as any)?.startLine ?? (s as any)?.line ?? 0) || null
    const pos = { file: f, line: symLine ?? -1 }
    const qual = String(s?.qualifiedName ?? "")
    // the name, and the qualifiedName ALIAS when it is a different spelling — exactly the gate's
    // `countKey` rule, because a per-file claim is tested against the same positions the gate uses.
    for (const key of qual.length > 0 && qual !== name ? [name, qual] : [name]) {
      const at = declPos.get(key)
      if (!at) declPos.set(key, [pos])
      else if (!at.some((d) => d.file === f && d.line === pos.line)) at.push(pos)
    }
    addSymbolWithAlias(ks, name, String(s?.qualifiedName ?? ""), String(s?.kind ?? ""))
  }
  for (const rel of Array.isArray(r.relationships) ? r.relationships : []) {
    const label = String(rel?.type ?? rel?.relationshipType ?? "") as Type
    if (!ALL_TYPES.includes(label)) continue
    const tgt = String(rel?.target ?? rel?.to ?? rel?.toSymbol ?? "")
    if (tgt.length === 0) continue
    if (String((rel as any)?.metadata?.method ?? "") === "regex") fallbackRows++
    pending.push({
      label, tgt, claim: externalClaimOf(rel), repo, file: f,
      line: Number((rel as any)?.line_number ?? (rel as any)?.lineNumber ?? (rel as any)?.line ?? 0) || null,
      md: ((rel as any)?.metadata ?? {}) as Record<string, unknown>,
    })
  }
}

// ------------------------------------------------------------------ classification (the gate's own call)
type Row = Outcomes & { edges: number }
const rows = new Map<Type, Row>()
for (const t of ALL_TYPES) rows.set(t, { ...emptyOutcomes(), edges: 0 })
const LINE_IS_TARGET_LINE = new Set(["contains", "exports"])
type Intent = { intended: number; sameFileUnproven: number; arbitraryTwin: number; nothingAnywhere: number }
const emptyIntent = (): Intent => ({ intended: 0, sameFileUnproven: 0, arbitraryTwin: 0, nothingAnywhere: 0 })
const intentRows = new Map<Type, Intent>()
for (const t of ALL_TYPES) intentRows.set(t, emptyIntent())
const unresolved: Pending[] = []
/** THE PRE-FIX OUTCOMES, computed in the SAME run. The change this probe accompanies is PURELY
 *  ADDITIVE METADATA: an edge either carries `externalEvidence=shellDefinedVariable` or it does
 *  not, and that key is the ONLY difference the fix makes to any row. So the pre-fix outcome of
 *  every edge is the present edge's classification with THAT ONE CLAIM REMOVED — which makes a
 *  whole-population before/after pair measurable in one pass, and `--compare` checks the simulated
 *  BEFORE column against the pre-fix gate capture so the simulation is falsified if it drifts. */
const rowsBefore = new Map<Type, Row>()
for (const t of ALL_TYPES) rowsBefore.set(t, { ...emptyOutcomes(), edges: 0 })
for (const e of pending) {
  const ks = sampleSpaces.get(e.repo) ?? newKeySpace()
  const facts = factsByRepo.get(e.repo)
  const isContains = e.label === "contains"
  const ownFileDeclares = (declPos.get(e.tgt) ?? []).some((d) => d.file === e.file)
  const c = classifyEdge(ks.decl, ks.kinds, e.tgt, e.claim, facts, isContains, ownFileDeclares)
  const row = rows.get(e.label)!
  row.edges++
  tally(row, c, e.tgt, e.label)
  // THE SIMULATED PRE-FIX ROW: the same edge with the shell-defined-variable claim removed.
  const claimBefore = e.md.externalEvidence === "shellDefinedVariable" ? null : e.claim
  const rb = rowsBefore.get(e.label)!
  rb.edges++
  tally(rb, classifyEdge(ks.decl, ks.kinds, e.tgt, claimBefore, facts, isContains, ownFileDeclares), e.tgt, e.label)
  if (c.outcome === "unresolved") unresolved.push(e)
  // THE INTENT TEST, mirroring incoming-gate.ts:604-617 — same predicate, same input fields.
  const decls = declPos.get(e.tgt)
  const it = intentRows.get(e.label)!
  if (!decls || decls.length === 0) it.nothingAnywhere++
  else {
    const sameFile = decls.filter((d) => d.file === e.file)
    if (sameFile.length === 0) it.arbitraryTwin++
    else if (LINE_IS_TARGET_LINE.has(e.label) && e.line !== null && sameFile.some((d) => d.line === e.line)) it.intended++
    else it.sameFileUnproven++
  }
}

// ------------------------------------------------------------------ the second key space
/** repo -> name -> kinds, over the WHOLE admitted population of the sampled repositories. */
const projectNames = new Map<string, Map<string, Set<string>>>()
let projectFilesParsed = 0
if (REPO_WIDE) {
  const sampleRepos = new Set(files.map(repoOf))
  for (const f of found) {
    const repo = repoOf(f)
    if (!sampleRepos.has(repo)) continue
    let r: any
    try { r = await parseFile(f, repo, { projectRoot: repo } as any) } catch { continue }
    if (!r) continue
    projectFilesParsed++
    let byName = projectNames.get(repo)
    if (!byName) projectNames.set(repo, (byName = new Map()))
    for (const s of Array.isArray(r.symbols) ? r.symbols : []) {
      const name = String(s?.name ?? "")
      if (name.length === 0) continue
      let set = byName.get(name)
      if (!set) byName.set(name, (set = new Set()))
      set.add(String(s?.kind ?? ""))
    }
  }
}
const declaredInProject = (repo: string, tgt: string): string => {
  if (!REPO_WIDE) return "(repo-wide OFF)"
  const set = projectNames.get(repo)?.get(tgt)
  if (!set || set.size === 0) return "nowhere in project"
  return "declared: " + [...set].sort().join("|")
}

// ------------------------------------------------------------------ candidate name sets
/**
 * THE POSIX MANDATED UTILITIES — POSIX.1-2017 XCU, the utilities a conforming system must
 * provide. It is here to PRICE a candidate marker, not because it was adopted: a name in this
 * list is a name the STANDARD defines, which is the c lane's ISO-C test, and a project may still
 * wrap `grep` in a function of its own — which is what the false-in-fact column below measures.
 * Builtins and reserved words are deliberately absent: they never reach a `calls` edge.
 */
const POSIX_UTILITIES = new Set([
  "admin", "alias", "ar", "asa", "at", "awk", "basename", "batch", "bc", "bg", "c99", "cal",
  "cat", "cd", "cflow", "chgrp", "chmod", "chown", "cksum", "cmp", "comm", "command", "compress",
  "cp", "crontab", "csplit", "ctags", "cut", "cxref", "date", "dd", "delta", "df", "diff",
  "dirname", "du", "echo", "ed", "env", "ex", "expand", "expr", "false", "fc", "fg", "file",
  "find", "fold", "fort77", "fuser", "gencat", "get", "getconf", "getopts", "grep", "hash",
  "head", "iconv", "id", "ipcrm", "ipcs", "jobs", "join", "kill", "lex", "link", "ln", "locale",
  "localedef", "logger", "logname", "lp", "ls", "m4", "mailx", "make", "man", "mesg", "mkdir",
  "mkfifo", "more", "mv", "newgrp", "nice", "nl", "nm", "nohup", "od", "paste", "patch", "pathchk",
  "pax", "pr", "printf", "prs", "ps", "pwd", "qalter", "qdel", "qhold", "qmove", "qmsg", "qrerun",
  "qrls", "qselect", "qsig", "qstat", "qsub", "read", "renice", "rm", "rmdel", "rmdir", "sact",
  "sccs", "sed", "sh", "sleep", "sort", "split", "strings", "strip", "stty", "tabs", "tail", "talk",
  "tee", "test", "time", "touch", "tput", "tr", "true", "tsort", "tty", "type", "ulimit", "umask",
  "unalias", "uname", "uncompress", "unexpand", "uniq", "unlink", "uucp", "uudecode", "uuencode",
  "uustat", "uux", "val", "vi", "wait", "wc", "what", "who", "write", "xargs", "yacc", "zcat",
])
/**
 * THE POSIX ENVIRONMENT VARIABLES — POSIX.1-2017 XCU §8, the names a conforming environment
 * supplies. Priced here as the NEXT candidate for the `uses` residual, and NOT adopted: the
 * analyzer's own `SHELL_DEFINED_VARS` is a closed list the interpreter defines, while this one
 * is a list the ENVIRONMENT defines and a project may legitimately bind every name in it (the
 * `HOSTNAME` counter-example in §9 of the report is exactly that shape). The false-in-fact
 * column below is why the decision is a measurement rather than a preference.
 */
const POSIX_ENV_VARS = new Set([
  "HOME", "PATH", "PWD", "OLDPWD", "TZ", "LANG", "LC_ALL", "LC_COLLATE", "LC_CTYPE",
  "LC_MESSAGES", "LC_MONETARY", "LC_NUMERIC", "LC_TIME", "NLSPATH", "COLUMNS", "LINES",
  "LOGNAME", "USER", "SHELL", "TERM", "MAIL", "MAILCHECK", "MAILPATH", "PS1", "PS2", "PS3",
  "PS4", "IFS", "ENV", "EXINIT", "FCEDIT", "HISTFILE", "HISTSIZE", "CDPATH", "EDITOR", "PAGER",
  "VISUAL", "TMPDIR", "TMOUT", "REPLY", "OPTARG", "OPTIND", "OPTERR",
])

/** The reason keys the analyzer already publishes, read here as bucket labels. */
const reasonOf = (md: Record<string, unknown>): string => {
  const parts: string[] = []
  if (md.isExternalCommand === true) parts.push("isExternalCommand")
  if (md.isFunctionCall === true) parts.push("isFunctionCall")
  if (md.isVariableReference === true) parts.push("isVariableReference")
  if (md.isShellDefined === true) parts.push("isShellDefined")
  if (md.isAssignedInFile === true) parts.push("isAssignedInFile")
  if (md.isSourceImport === true) parts.push("isSourceImport")
  if (md.isSourceDependency === true) parts.push("isSourceDependency")
  if (typeof md.resolution === "string") parts.push(`resolution:${String(md.resolution)}`)
  if (typeof md.targetResolution === "string") parts.push(`targetResolution:${String(md.targetResolution)}`)
  if (md.commandInErrorRecovery === true) parts.push("commandInErrorRecovery")
  if (md.redefinition === true) parts.push("redefinition")
  return parts.length > 0 ? parts.join("+") : "(no reason published)"
}
const shapeOf = (t: string): string => {
  const dyn = t.includes("$") || t.includes("`")
  if (t.includes("/") || t.includes("\\")) return dyn ? "dynamic path" : "path"
  if (dyn) return "dynamic (expansion)"
  if (t.includes("::")) return "namespaced identifier (::)"
  return "bare identifier"
}

// ------------------------------------------------------------------ the buckets
type Bucket = { edges: number; names: Set<string>; examples: string[] }
const buckets = new Map<string, Bucket>()
const bump = (map: Map<string, Bucket>, key: string, e: Pending): void => {
  let b = map.get(key)
  if (!b) map.set(key, (b = { edges: 0, names: new Set(), examples: [] }))
  b.edges++
  b.names.add(e.tgt)
  if (b.examples.length < 3) b.examples.push(`${e.tgt} @ ${path.relative(CR, e.file)}:${e.line}`)
}
/** The bucket KEY is the named construct: type · target shape · the analyzer's own reason · where
 *  the name is declared. No bucket is a restatement of "unresolved". */
const byCause = new Map<string, Bucket>()
const byReason = new Map<string, Bucket>()
const callNameCount = new Map<string, { n: number; repo: string; md: Record<string, unknown> }>()
const useNameCount = new Map<string, { n: number; repo: string; md: Record<string, unknown> }>()
const falseInFact = new Map<string, Bucket>()
for (const e of unresolved) {
  const declared = declaredInProject(e.repo, e.tgt)
  const dshort = declared === "nowhere in project" ? "not-in-project" : declared.startsWith("declared") ? "DECLARED-IN-PROJECT" : declared
  bump(byCause, `${e.label} · ${shapeOf(e.tgt)} · ${reasonOf(e.md)} · ${dshort}`, e)
  bump(byReason, `${e.label} · ${reasonOf(e.md)}`, e)
  const bumpName = (m: Map<string, { n: number; repo: string; md: Record<string, unknown> }>, t: string, r: string, md: Record<string, unknown>) => {
    const cur = m.get(t)
    if (cur) cur.n++
    else m.set(t, { n: 1, repo: r, md })
  }
  if (e.label === "calls") bumpName(callNameCount, e.tgt, e.repo, e.md)
  if (e.label === "uses") bumpName(useNameCount, e.tgt, e.repo, e.md)
  // THE FALSE-IN-FACT CLASS, per candidate rule: an edge a marker would claim is external while
  // the project it belongs to declares the name.
  for (const [rule, hit] of [
    ["ALL bare isExternalCommand calls", e.label === "calls" && e.md.isExternalCommand === true && !e.tgt.includes("/")],
    ["POSIX-utility-name calls", e.label === "calls" && POSIX_UTILITIES.has(e.tgt)],
    ["SHELL_DEFINED_VARS uses", e.label === "uses" && e.md.isShellDefined === true],
    ["POSIX-environment-variable uses", e.label === "uses" && POSIX_ENV_VARS.has(e.tgt)],
  ] as [string, boolean][]) {
    if (!hit) continue
    bump(falseInFact, `${rule} · ${dshort}`, e)
  }
}

// ------------------------------------------------------------------ the cause channel, probed
//
// THE FLEET'S FINDING (a) IS "the reason is published on a key the gate does not read". For bash
// the obvious wiring is the DECLARED-CAUSE channel (`baseBeyondRunScope`). It is measured here
// rather than assumed, on the two shapes this lane emits, with the gate's own `classifyEdge`.
const causeProbe = (tgt: string): string => {
  const c = classifyEdge(new Map(), new Map(), tgt, { kind: "cause", base: tgt, conflict: false })
  return `${tgt} -> ${c.outcome}`
}
const causeProbePath = (tgt: string, owner: string): string => {
  const c = classifyEdge(new Map(), new Map(), tgt, { kind: "cause", base: owner, conflict: false })
  return `${tgt} (base=${owner}) -> ${c.outcome}`
}

// ------------------------------------------------------------------ print
const sum = <T extends Record<string, number>>(m: Map<Type, T>, k: keyof T): number =>
  [...m.values()].reduce((n, r) => n + Number(r[k] ?? 0), 0)
const sumRow = (k: keyof Row): number => [...rows.values()].reduce((n, r) => n + Number(r[k] ?? 0), 0)
const totalEdges = sumRow("edges")

console.log(`PROBE-BASH-RESIDUAL-CAUSES  lang=bash ext=${EXTS.map((x) => "." + x).join(",")} nf=${NF}`)
console.log(`  population: ${files.length} sampled of ${corpusTotal} tracked files in ${repos.size} repos; parsed=${parsed} failed=${failed} degraded=${degraded}; fallback rows (a different instrument) ${fallbackRows}`)
console.log(`  excluded from the population: ${absent} tracked-but-absent/unreadable + ${overCap} over the 1 MB cap`)
console.log(`  second key space: ${REPO_WIDE ? `ON — ${projectFilesParsed} files of the sampled repos parsed (declared-anywhere-in-the-project)` : "OFF (--repo-wide to build it)"}`)
console.log("")
console.log("TABLE 1 REPRODUCTION — the gate's own columns, the gate's own call (containsLike + ownFileDeclares + facts)")
console.log(`  ${"type".padEnd(13)} ${"edges".padStart(6)} ${"resolved".padStart(9)} ${"collRes".padStart(8)} ${"amb(decl)".padStart(10)} ${"amb(kind)".padStart(10)} ${"unres".padStart(6)} ${"extOK".padStart(6)} ${"ext?".padStart(5)} ${"extFAIL".padStart(8)} ${"causeOK".padStart(8)} ${"causeFAIL".padStart(10)}`)
for (const t of ALL_TYPES) {
  const r = rows.get(t)!
  if (r.edges === 0) continue
  console.log(`  ${t.padEnd(13)} ${String(r.edges).padStart(6)} ${String(r.resolved).padStart(9)} ${String(r.resolvedAmongCollision).padStart(8)} ${String(r.ambiguousByDecl).padStart(10)} ${String(r.ambiguousByKind).padStart(10)} ${String(r.unresolved).padStart(6)} ${String(r.externalVerified).padStart(6)} ${String(r.externalUnverified).padStart(5)} ${String(r.externalRefuted).padStart(8)} ${String(r.causeDeclared).padStart(8)} ${String(r.causeRefuted).padStart(10)}`)
}
console.log(`  ${"TOTAL".padEnd(13)} ${String(totalEdges).padStart(6)} ${String(sumRow("resolved")).padStart(9)} ${String(sumRow("resolvedAmongCollision")).padStart(8)} ${String(sumRow("ambiguousByDecl")).padStart(10)} ${String(sumRow("ambiguousByKind")).padStart(10)} ${String(sumRow("unresolved")).padStart(6)} ${String(sumRow("externalVerified")).padStart(6)} ${String(sumRow("externalUnverified")).padStart(5)} ${String(sumRow("externalRefuted")).padStart(8)} ${String(sumRow("causeDeclared")).padStart(8)} ${String(sumRow("causeRefuted")).padStart(10)}`)
console.log("")
console.log("BEFORE -> AFTER, THE TWO AXES AND THE INTENT SPLIT (the pre-fix column is the same edges with the claim removed)")
{
  const b = (k: keyof Row): number => [...rowsBefore.values()].reduce((n, r) => n + Number(r[k] ?? 0), 0)
  const pairs: [string, number, number][] = [
    ["edges", b("edges"), sumRow("edges")],
    ["resolved", b("resolved"), sumRow("resolved")],
    ["collRes", b("resolvedAmongCollision"), sumRow("resolvedAmongCollision")],
    ["amb(decl)", b("ambiguousByDecl"), sumRow("ambiguousByDecl")],
    ["unresolved", b("unresolved"), sumRow("unresolved")],
    ["extOK", b("externalVerified"), sumRow("externalVerified")],
    ["ext?", b("externalUnverified"), sumRow("externalUnverified")],
    ["extFAIL", b("externalRefuted"), sumRow("externalRefuted")],
    ["causeOK", b("causeDeclared"), sumRow("causeDeclared")],
    ["causeFAIL", b("causeRefuted"), sumRow("causeRefuted")],
  ]
  console.log(`  ${"column".padEnd(12)} ${"BEFORE".padStart(8)} ${"AFTER".padStart(8)} ${"delta".padStart(8)}`)
  for (const [k, x, y] of pairs) console.log(`  ${k.padEnd(12)} ${String(x).padStart(8)} ${String(y).padStart(8)} ${String(y - x).padStart(8)}`)
}
console.log("")
console.log(`BINDING INTENT (claim-independent by construction; the fix cannot move a row)`)
console.log(`  ${"type".padEnd(13)} ${"edges".padStart(6)} ${"intended".padStart(9)} ${"sameFileUnproven".padStart(17)} ${"arbitraryTwin".padStart(14)} ${"nothingAnywhere".padStart(16)}`)
for (const t of ALL_TYPES) {
  const r = rows.get(t)!
  if (r.edges === 0) continue
  const it = intentRows.get(t)!
  console.log(`  ${t.padEnd(13)} ${String(r.edges).padStart(6)} ${String(it.intended).padStart(9)} ${String(it.sameFileUnproven).padStart(17)} ${String(it.arbitraryTwin).padStart(14)} ${String(it.nothingAnywhere).padStart(16)}`)
}
{
  const ti = emptyIntent()
  for (const it of intentRows.values()) for (const k of Object.keys(ti) as (keyof Intent)[]) ti[k] += it[k]
  console.log(`  ${"TOTAL".padEnd(13)} ${String(totalEdges).padStart(6)} ${String(ti.intended).padStart(9)} ${String(ti.sameFileUnproven).padStart(17)} ${String(ti.arbitraryTwin).padStart(14)} ${String(ti.nothingAnywhere).padStart(16)}`)
}
if (COMPARE) {
  try {
    const g = JSON.parse(readFileSync(COMPARE, "utf8"))
    const t = g?.totals ?? {}
    const per = g?.perType ?? {}
    const rowsToCheck: [string, number, number][] = []
    for (const ty of ALL_TYPES) {
      const pr = per[ty]
      if (!pr) continue
      const mine = rows.get(ty)!
      rowsToCheck.push([`${ty}.edges`, mine.edges, Number(pr.edges)])
      // The gate's JSON publishes `project`, not a flat row.
      const p = pr.project ?? pr
      rowsToCheck.push([`${ty}.resolved`, mine.resolved, Number(p.resolved)])
      rowsToCheck.push([`${ty}.collRes`, mine.resolvedAmongCollision, Number(p.resolvedAmongCollision)])
      rowsToCheck.push([`${ty}.amb`, mine.ambiguousByDecl, Number(p.ambiguousByDecl)])
      rowsToCheck.push([`${ty}.unresolved`, mine.unresolved, Number(p.unresolved)])
      rowsToCheck.push([`${ty}.extOK`, mine.externalVerified, Number(p.externalVerified)])
      rowsToCheck.push([`${ty}.ext?`, mine.externalUnverified, Number(p.externalUnverified)])
      rowsToCheck.push([`${ty}.extFAIL`, mine.externalRefuted, Number(p.externalRefuted)])
    }
    for (const [k, mine, gate] of [
      // `totals.edges` IS NOT PUBLISHED by the gate's JSON (the per-type rows carry it), so the
      // total is summed from `perType` — which this comparison checks row by row anyway.
      ["TOTAL.edges", totalEdges, ALL_TYPES.reduce((n, ty) => n + Number(per[ty]?.edges ?? 0), 0)],
      ["TOTAL.resolved", sumRow("resolved"), Number(t.resolved)],
      ["TOTAL.collRes", sumRow("resolvedAmongCollision"), Number(t.resolvedAmongCollision)],
      ["TOTAL.amb", sumRow("ambiguousByDecl"), Number(t.ambiguousByDecl)],
      ["TOTAL.unresolved", sumRow("unresolved"), Number(t.unresolved)],
      ["TOTAL.extOK", sumRow("externalVerified"), Number(t.externalVerified)],
      ["TOTAL.ext?", sumRow("externalUnverified"), Number(t.externalUnverified)],
      ["TOTAL.extFAIL", sumRow("externalRefuted"), Number(t.externalRefuted)],
    ] as [string, number, number][]) rowsToCheck.push([k, mine, gate])
    const bad = rowsToCheck.filter(([, mine, gate]) => mine !== gate)
    console.log("")
    console.log(`COMPARISON against ${COMPARE}`)
    if (bad.length === 0) console.log(`  REPRODUCES every shared column exactly (${rowsToCheck.length} checked) — the buckets below are evidence about THAT run`)
    else {
      for (const [k, mine, gate] of bad) console.log(`  *** DISAGREES: ${k} probe=${mine} gate=${gate}`)
      console.log(`  the bucket table below is NOT evidence about that gate run`)
      process.exitCode = 2
    }
  } catch (err) {
    console.log(`  *** COMPARE FAILED to read ${COMPARE}: ${String(err)}`)
    process.exitCode = 2
  }
}
if (COMPARE_BEFORE) {
  // THE SIMULATION'S FALSIFIER. The pre-fix column is derived (claim removed), not measured by a
  // second build of the analyzer, so it is only evidence while it reproduces the PRE-FIX capture
  // of the SAME population. It does, or this exits 2 and the whole-population pair below is void.
  try {
    const g = JSON.parse(readFileSync(COMPARE_BEFORE, "utf8"))
    const t = g?.totals ?? {}
    const sb = (k: keyof Row): number => [...rowsBefore.values()].reduce((n, r) => n + Number(r[k] ?? 0), 0)
    const checks: [string, number, number][] = [
      ["TOTAL.resolved", sb("resolved"), Number(t.resolved)],
      ["TOTAL.collRes", sb("resolvedAmongCollision"), Number(t.resolvedAmongCollision)],
      ["TOTAL.amb", sb("ambiguousByDecl"), Number(t.ambiguousByDecl)],
      ["TOTAL.unresolved", sb("unresolved"), Number(t.unresolved)],
      ["TOTAL.extOK", sb("externalVerified"), Number(t.externalVerified)],
      ["TOTAL.ext?", sb("externalUnverified"), Number(t.externalUnverified)],
      ["TOTAL.extFAIL", sb("externalRefuted"), Number(t.externalRefuted)],
    ]
    const bad = checks.filter(([, mine, gate]) => mine !== gate)
    console.log("")
    console.log(`THE SIMULATED PRE-FIX COLUMN against ${COMPARE_BEFORE}`)
    if (bad.length === 0) console.log(`  REPRODUCES the pre-fix run exactly (${checks.length} totals) — the before/after pair below is measured, not asserted`)
    else {
      for (const [k, mine, gate] of bad) console.log(`  *** DISAGREES: ${k} simulated=${mine} gate=${gate}`)
      process.exitCode = 2
    }
  } catch (err) {
    console.log(`  *** COMPARE-BEFORE FAILED to read ${COMPARE_BEFORE}: ${String(err)}`)
    process.exitCode = 2
  }
}

console.log("")
console.log(`THE ${unresolved.length} UNRESOLVED EDGES, BY NAMED CAUSE (construct · shape · the analyzer's own published reason · where the name is declared)`)
const sorted = [...byCause.entries()].sort((a, b) => b[1].edges - a[1].edges)
for (const [k, b] of sorted) {
  console.log(`  ${String(b.edges).padStart(5)}  ${k}`)
  console.log(`         ${b.names.size} distinct target(s); e.g. ${b.examples.join(" · ")}`)
}
console.log(`  ${String(sorted.reduce((n, [, b]) => n + b.edges, 0)).padStart(5)}  SUM OF BUCKETS (must equal ${unresolved.length} — the buckets are a partition)`)
console.log("")
console.log(`UNRESOLVED BY THE REASON THE ANALYZER ALREADY PUBLISHED (the fleet's finding (a): a reason on a key the gate does not read)`)
for (const [k, b] of [...byReason.entries()].sort((a, b) => b[1].edges - a[1].edges)) {
  console.log(`  ${String(b.edges).padStart(5)}  ${k}${b.names.size > 0 ? `   [${b.names.size} names]` : ""}`)
}
console.log("")
console.log(`TOP UNRESOLVED CALL TARGETS (of ${[...callNameCount.values()].reduce((a, b) => a + b.n, 0)} unresolved calls, ${callNameCount.size} distinct)`)
for (const [n, v] of [...callNameCount.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, TOP)) {
  console.log(`  ${String(v.n).padStart(5)}  ${n.padEnd(34)} POSIX-utility=${POSIX_UTILITIES.has(n) ? "yes" : "no"}  ${declaredInProject(v.repo, n)}`)
}
console.log("")
console.log(`TOP UNRESOLVED USES TARGETS (of ${[...useNameCount.values()].reduce((a, b) => a + b.n, 0)} unresolved uses, ${useNameCount.size} distinct)`)
for (const [n, v] of [...useNameCount.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, TOP)) {
  console.log(`  ${String(v.n).padStart(5)}  ${n.padEnd(30)} isShellDefined=${v.md.isShellDefined === true ? "yes" : "no"}  ${declaredInProject(v.repo, n)}`)
}
console.log("")
console.log("CANDIDATE MARKERS, PRICED — how many edges each would move, and how many of those the PROJECT declares (the false-in-fact class)")
for (const [k, b] of [...falseInFact.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1)) {
  console.log(`  ${String(b.edges).padStart(5)}  ${k}`)
}
console.log("")
console.log("THE DECLARED-CAUSE CHANNEL, PROBED (the fleet's finding (a) says to route the reason there; this lane's shapes are bare names and paths)")
console.log(`  bare name, cause base = the target itself: ${causeProbe("grep")}`)
console.log(`  bare name, cause base = the target itself: ${causeProbe("dirname")}`)
console.log(`  dotted target, cause base = its owner:    ${causeProbePath("util.grep", "util")}`)
console.log(`  path target, cause base = the file name:  ${causeProbePath("./hack/lib/util.sh", "hack")}`)
console.log("")
// ---------------------------------------------------------------- the marked set, as a TSV
//
// `--list-marked` prints EVERY edge carrying the shell-defined-variable claim, so the ten edges a
// report hand-reads are sampled from the set the change actually causes, and the false-in-fact
// column is per edge rather than per rule.
if (argv.includes("--list-marked")) {
  const marked: Pending[] = []
  for (const e of pending) {
    if (e.md.externalEvidence !== "shellDefinedVariable") continue
    marked.push(e)
  }
  console.log(`MARKED EDGES (externalEvidence=shellDefinedVariable) — ${marked.length} edges, TSV below`)
  // THE CLAIM IS READ ONLY WHERE THE KEY SPACE DECLARES NOTHING, so a marked edge that RESOLVED is
  // one where the marker is inert — and, where the sample declares the name, a statement the SAMPLE
  // contradicts. Counted rather than assumed: it is the price of a per-file analyzer publishing a
  // project-scoped claim, and it is the one number a reader must see beside the reduction.
  const byOutcome = new Map<string, number>()
  for (const e of marked) {
    const ks = sampleSpaces.get(e.repo) ?? newKeySpace()
    const c = classifyEdge(ks.decl, ks.kinds, e.tgt, e.claim, factsByRepo.get(e.repo), e.label === "contains",
      (declPos.get(e.tgt) ?? []).some((d) => d.file === e.file))
    byOutcome.set(c.outcome, (byOutcome.get(c.outcome) ?? 0) + 1)
  }
  console.log(`MARKED EDGES BY OUTCOME: ${[...byOutcome.entries()].sort().map(([k, v]) => `${k}=${v}`).join(" · ")}`)
  console.log(`  (only the unresolved ones are READ by the gate — the others carry a claim nothing consults)`)
  console.log(`file\tline\ttype\ttarget\trepo\tdeclared-in-project`)
  for (const e of marked.sort((a, b) => (a.file === b.file ? (a.line ?? 0) - (b.line ?? 0) : a.file < b.file ? -1 : 1))) {
    console.log(`${path.relative(CR, e.file)}\t${e.line ?? ""}\t${e.label}\t${e.tgt}\t${e.repo}\t${declaredInProject(e.repo, e.tgt)}`)
  }
}
console.log(`READING: ${unresolved.length} unresolved; the largest bucket is named above with its construct, not with the word "unresolved".`)

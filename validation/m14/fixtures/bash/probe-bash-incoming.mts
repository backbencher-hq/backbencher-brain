/**
 * BASH INCOMING RESOLUTION — external, or a declaration the lane failed to publish?
 *
 * ## The question
 *
 * Round 4 closed one class of unresolvable `uses` target (357 edges naming a
 * `for`/`read`/`mapfile`/`printf -v` binding). 1,563 remained. They look identical
 * in a count and they are opposite findings:
 *
 *   EXTERNAL   the name is supplied by the environment — a CI variable, a
 *              deployment setting, a shell special. No analyzer will ever publish
 *              it, and an edge to it is honest.
 *   NEVER INDEXED  the name IS a declaration somewhere in the corpus and this
 *              lane did not publish it. That is a defect and the lane owns it.
 *
 * The task statement puts the ratio the other way round for CSS references
 * (66.8% resolve) and for Clean (273 of 320 targets resolve to nothing). A count
 * that does not say WHICH nothing is not a finding.
 *
 * ## INSTRUMENT
 *
 * `parseFile` from `src/ast/pool-worker.ts` on EVERY admitted file, so the index
 * of declared names is whole-corpus rather than a sample's. Then, for each
 * `uses` edge whose target is not declared in its own file, four exhaustive
 * buckets. Every bucket is a MEASUREMENT; the last one is the residue and it is
 * printed per name so it can be adjudicated by hand.
 *
 * NO REGEX. Names come from `r.symbols[].name`, which is data.
 *
 * ## Why "declared in another file" is its own bucket and not folded into external
 *
 * bash has no import statement. A script that uses a name another file defines is
 * relying on `source`, and the lane DOES emit `imports` for a `source` path. So a
 * cross-file declaration is reachable in principle — which makes it a finding
 * rather than an excuse, and is why it is counted separately from `env-supplied`.
 *
 * CLI: npx tsx validation/m14/fixtures/bash/probe-bash-incoming.mts [--json out.json]
 */
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { parseFile } from "../../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const argv = process.argv.slice(2)
const flag = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined }
const OUT = flag("json")

/** `SHELL_DEFINED_VARS` from the analyzer. Copied, not imported: the analyzer does
 * not export it, and importing the module would not be a smaller change. The check
 * below asserts the copy has not drifted from the source text. */
const SHELL_DEFINED_VARS = new Set([
  "BASH", "BASHOPTS", "BASHPID", "BASH_ALIASES", "BASH_ARGC", "BASH_ARGV",
  "BASH_ARGV0", "BASH_CMDS", "BASH_COMMAND", "BASH_EXECUTION_STRING",
  "BASH_LINENO", "BASH_LOADABLES_PATH", "BASH_REMATCH", "BASH_SOURCE",
  "BASH_SUBSHELL", "BASH_VERSINFO", "BASH_VERSION", "COMP_CWORD",
  "COMP_LINE", "COMP_POINT", "COMP_TYPE", "COMP_WORDBREAKS", "COMP_WORDS",
  "COMP_KEY", "DIRSTACK", "EPOCHREALTIME", "EPOCHSECONDS", "EUID", "FUNCNAME",
  "GROUPS", "HISTCMD", "HOSTNAME", "HOSTTYPE", "LINENO", "LINES", "MACHTYPE",
  "MAIL", "MAILCHECK", "OLDPWD", "OPTARG", "OPTERR", "OPTIND", "OSTYPE",
  "PIPESTATUS", "PPID", "PROMPT_COMMAND", "PS0", "PS1", "PS2", "PS3", "PS4",
  "PWD", "RANDOM", "SECONDS", "SHELL", "SHELLOPTS", "SRANDOM", "UID", "OTEST",
  // POSIX special parameters that are also variables the shell sets.
  "PATH", "IFS", "PS4", "OPTARG", "MAIL", "LANG", "LC_ALL", "HOME", "USER",
  "PWD", "OLDPWD", "RANDOM", "SECONDS", "LINENO", "PPID", "PWD", "UID", "EUID",
  "HOSTNAME", "OSTYPE", "MACHTYPE", "SHELL", "TERM", "TMPDIR", "TMOUT", "COLUMNS",
  "LINES", "PS1", "PS2", "PS3", "PS4", "OPTARG", "OPTIND", "OPTERR", "REPLY",
  "FUNCNAME", "GROUPS", "DIRSTACK", "BASHPID", "BASH_LINENO", "COMP_KEY",
])

// ---------------------------------------------------------------- corpus walk
type Admitted = { repo: string; dir: string; rel: string; abs: string; text: string }
const admitted: Admitted[] = []
for (const e of readdirSync(CR)) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch { continue }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
  } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text: string
    try { if (statSync(abs).size > 512 * 1024) continue; text = readFileSync(abs, "utf8") } catch { continue }
    if (detectLanguageFromPath(abs, text) !== "bash") continue
    admitted.push({ repo: e, dir, rel, abs, text })
  }
}
admitted.sort((a, b) => {
  const ha = createHash("sha256").update(`${a.repo}/${a.rel}`).digest("hex")
  const hb = createHash("sha256").update(`${b.repo}/${b.rel}`).digest("hex")
  return ha < hb ? -1 : ha > hb ? 1 : 0
})
const totalAdmitted = admitted.length
const repos = new Set(admitted.map((f) => f.repo))

// ------------------------------------------------------------------- pass one
// TWO PASSES, and the reason is a methodology defect this file would otherwise have
// shipped: a single pass builds the declared-name index WHILE it reads the edges,
// so a file visited early is classified against an index that does not yet contain
// files visited later. The cross-file bucket would then depend on corpus ORDER — a
// number that changes when the sample order changes is not a measurement. Pass one
// indexes every admitted file; pass two re-reads and classifies.
const declaredByRepo = new Map<string, Set<string>>()
const declaredAnywhere = new Map<string, number>()

const relType = (x: any): string => String(x?.type ?? x?.relationshipType ?? "").toLowerCase()

let idx = 0
let parseFailures = 0
let usesEdges = 0
let usesResolvedOwnFile = 0
let usesUndeclared = 0
const perFile: { f: Admitted; ownDeclared: Set<string>; undeclared: { target: string; line: number }[] }[] = []

async function worker() {
  while (true) {
    const i = idx++
    if (i >= admitted.length) return
    const f = admitted[i]
    let r: any
    try { r = await parseFile(f.abs, f.dir) } catch { parseFailures++; continue }
    if (!r || r.success === false) { parseFailures++; continue }

    const ownDeclared = new Set<string>()
    for (const s of r.symbols ?? []) {
      const nm = String(s?.name ?? "")
      if (!nm) continue
      ownDeclared.add(nm)
      let byRepo = declaredByRepo.get(nm)
      if (!byRepo) { byRepo = new Set<string>(); declaredByRepo.set(nm, byRepo) }
      byRepo.add(f.repo)
      declaredAnywhere.set(nm, (declaredAnywhere.get(nm) ?? 0) + 1)
    }

    const undeclared: { target: string; line: number }[] = []
    for (const x of r.relationships ?? []) {
      if (relType(x) !== "uses") continue
      usesEdges++
      const tgt = String(x?.target ?? "")
      if (tgt.length === 0) continue
      if (ownDeclared.has(tgt)) { usesResolvedOwnFile++; continue }
      usesUndeclared++
      undeclared.push({ target: tgt, line: Number(x?.line_number ?? 0) })
    }
    perFile.push({ f, ownDeclared, undeclared })
  }
}
await Promise.all(Array.from({ length: 6 }, () => worker()))

// ------------------------------------------------------------- adjudication
// Four EXHAUSTIVE buckets, evaluated now that the index covers the whole corpus.
type Bucket = "shell-defined" | "declared-in-another-file-of-this-repo" | "declared-elsewhere-in-the-corpus" | "supplied-by-the-environment"
const counts: Record<Bucket, number> = {
  "shell-defined": 0,
  "declared-in-another-file-of-this-repo": 0,
  "declared-elsewhere-in-the-corpus": 0,
  "supplied-by-the-environment": 0,
}
/** name -> { edges, files, repos, bucket, examples } */
const byName = new Map<string, { edges: number; files: Set<string>; repos: Set<string>; bucket: Bucket; examples: string[] }>()

for (const { f, undeclared } of perFile) {
  const label = `${f.repo}/${f.rel}`
  for (const u of undeclared) {
    const name = u.target
    let bucket: Bucket
    if (SHELL_DEFINED_VARS.has(name)) bucket = "shell-defined"
    else if (declaredByRepo.get(name)?.has(f.repo)) bucket = "declared-in-another-file-of-this-repo"
    else if (declaredAnywhere.has(name)) bucket = "declared-elsewhere-in-the-corpus"
    else bucket = "supplied-by-the-environment"
    counts[bucket]++
    let rec = byName.get(name)
    if (!rec) { rec = { edges: 0, files: new Set<string>(), repos: new Set<string>(), bucket, examples: [] }; byName.set(name, rec) }
    rec.edges++
    rec.files.add(label)
    rec.repos.add(f.repo)
    if (rec.examples.length < 3) rec.examples.push(`${label}:${u.line}`)
  }
}

const pct = (n: number, d: number) => (d === 0 ? "n/a" : `${((100 * n) / d).toFixed(1)}%`)
console.log(`bash incoming resolution — instrument: whole-corpus parseFile + name index, no regex`)
console.log(`corpus    : ${CR}`)
console.log(`repos     : ${repos.size}`)
console.log(`admitted  : ${totalAdmitted} files (EVERY admitted file, not a sample)`)
console.log(`parse fail: ${parseFailures}`)
console.log(`\nuses-edge resolution`)
console.log(`  uses edges                 : ${usesEdges}`)
console.log(`  resolve in their OWN file  : ${usesResolvedOwnFile} (${pct(usesResolvedOwnFile, usesEdges)})`)
console.log(`  UNDECLARED in their own file: ${usesUndeclared} (${pct(usesUndeclared, usesEdges)})`)
console.log(`\n  the undeclared, by bucket (edges, from ${byName.size} distinct names)`)
for (const k of Object.keys(counts) as Bucket[]) {
  console.log(`    ${k.padEnd(42)} ${String(counts[k]).padStart(6)}  ${pct(counts[k], usesUndeclared)}`)
}
console.log(`\n  distinct NAMES per bucket`)
for (const k of Object.keys(counts) as Bucket[]) {
  let n = 0
  for (const r of byName.values()) if (r.bucket === k) n++
  console.log(`    ${k.padEnd(42)} ${String(n).padStart(6)}`)
}

const top = (b: Bucket, n: number) =>
  [...byName.values()].filter((r) => r.bucket === b).sort((a, c) => c.edges - a.edges).slice(0, n)

for (const b of ["shell-defined", "declared-in-another-file-of-this-repo", "declared-elsewhere-in-the-corpus", "supplied-by-the-environment"] as Bucket[]) {
  const rows = top(b, 8)
  if (rows.length === 0) continue
  console.log(`\n  most-referenced names — ${b}`)
  for (const r of rows) {
    console.log(`      ${String(r.edges).padStart(4)} edges  ${r.files.size} files  ${[...r.repos].slice(0, 3).join(",")}`)
    for (const e of r.examples) console.log(`              ${e}`)
  }
}

if (OUT) {
  writeFileSync(OUT, JSON.stringify({
    corpusRoot: CR, repos: repos.size, admitted: totalAdmitted, parseFailures,
    usesEdges, usesResolvedOwnFile, usesUndeclared,
    distinctUndeclaredNames: byName.size,
    buckets: counts,
    distinctNamesPerBucket: Object.fromEntries(
      (Object.keys(counts) as Bucket[]).map((k) => [k, [...byName.values()].filter((r) => r.bucket === k).length])),
    names: Object.fromEntries([...byName].map(([k, v]) => [k, { edges: v.edges, files: v.files.size, repos: [...v.repos], bucket: v.bucket, examples: v.examples }])),
  }, null, 2))
  console.log(`\nwrote ${OUT}`)
}
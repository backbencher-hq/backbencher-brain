/**
 * BASH `imports` / `references` TARGET RESOLUTION — why the rate is 0%.
 *
 * ## The measurement that prompted this
 *
 * The whole-corpus census (`census-bash-ontology.ts --all`, 4,126 admitted files)
 * reports for `imports` and `references` identically:
 *
 *     both-ends 0 (0.0%)   src-only 679 (100.0%)   tgt-only 0   neither 0
 *
 * **Not one** of the 679 edges resolves at its target end. Every other emitted type
 * has a target that is at least sometimes a published symbol, so this is the lane's
 * worst rate and it deserved an instrument rather than a footnote.
 *
 * ## Why a count of 679 does not explain it
 *
 * The target of a `source`/`.` edge in bash is a PATH, and the store's module
 * symbols are named after each file. So the edge resolves only if the path it
 * carries is the same string as the module symbol name of the file it names. Four
 * shapes break that, and they are OPPOSITE findings:
 *
 *   literal-relative   `hack/lib/logging.sh` — a path that could be joined against
 *                      the sourcing file's directory and matched. If the analyzer
 *                      does not, that is a DEFECT and the lane owns it.
 *   unexpanded         `${KUBE_ROOT}/hack/lib/util.sh` — the script computes the
 *                      prefix at run time. The analyzer cannot know KUBE_ROOT, so
 *                      the target is a string no module symbol can carry. Not a
 *                      fabrication, but not a resolvable edge either.
 *   external-absolute  `/etc/profile`, `~/.bashrc` — a file outside the corpus. The
 *                      target is honestly external.
 *   not-a-path         anything that is not a path at all.
 *
 * ## Instrument
 *
 * `parseFile` on every admitted file; then the target string is resolved by
 * REALPATH ARITHMETIC against the filesystem — never by matching the string against
 * a module name, which would be the assumption under test. NO REGEX: the target is
 * decomposed by walking its characters, because a `/` test is the only part of this
 * that is not filesystem work.
 *
 * CLI: npx tsx validation/m14/fixtures/bash/probe-bash-import-targets.mts [--json out.json]
 */
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { parseFile } from "../../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const argv = process.argv.slice(2)
const flag = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined }
const OUT = flag("json")

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
const totalAdmitted = admitted.length
const repos = new Set(admitted.map((f) => f.repo))

/** Is `c` an ASCII letter or `_`? A char-code test, not `/[A-Za-z_]/` — the
 * workstream's rule is no regex in a census script, and this is the only place one
 * had crept in. */
const isNameStart = (c: string | undefined): boolean => {
  if (c === undefined) return false
  const k = c.charCodeAt(0)
  return (k >= 97 && k <= 122) || (k >= 65 && k <= 90) || k === 95 /* _ */
}

/** Does this target carry an unexpanded expansion? Character walk, no regex: a `$`
 * followed by `{` or a bare name is a value the script computes at run time. */
const hasUnexpandedExpansion = (t: string): boolean => {
  for (let i = 0; i < t.length; i++) {
    if (t.charCodeAt(i) !== 36 /* $ */) continue
    const next = t[i + 1]
    if (next === "{" || next === "(" || next === "'" || next === '"') return true
    if (isNameStart(next)) return true
  }
  return false
}
const startsWithTilde = (t: string): boolean => t.length > 0 && t.charCodeAt(0) === 126 /* ~ */
const isAbsolute = (t: string): boolean => t.length > 0 && t.charCodeAt(0) === 47 /* / */

type Shape = "unexpanded" | "external-absolute" | "tilde" | "resolves-to-a-file-outside-the-corpus" | "resolves-to-a-file-inside-the-corpus" | "does-not-resolve"
const counts: Record<Shape, number> = {
  unexpanded: 0,
  "external-absolute": 0,
  tilde: 0,
  "resolves-to-a-file-outside-the-corpus": 0,
  "resolves-to-a-file-inside-the-corpus": 0,
  "does-not-resolve": 0,
}
const examples: Record<Shape, string[]> = {
  unexpanded: [], "external-absolute": [], tilde: [],
  "resolves-to-a-file-outside-the-corpus": [], "resolves-to-a-file-inside-the-corpus": [],
  "does-not-resolve": [],
}
/** The half that matters most: the target names a real file inside the corpus, and
 * the corpus HAS a module symbol for it. That is a resolvable edge the analyzer is
 * not resolving. */
let resolvableNotResolved = 0
const resolvableNotResolvedExamples: string[] = []
let fileInCorpus = 0
let resolvesByName = 0
const resolvesByNameExamples: string[] = []

const moduleNames = new Set<string>()
const moduleByPath = new Map<string, string>()

// --------------------------------------------------------------- pass one
// Two passes for the same reason probe-bash-incoming.mts uses two: an index built
// while the edges are read makes the cross-file buckets order-dependent.
let idx = 0
let parseFailures = 0
type Pending = { label: string; dir: string; rel: string; abs: string; tgt: string; line: number }
const pending: Pending[] = []

async function worker() {
  while (true) {
    const i = idx++
    if (i >= admitted.length) return
    const f = admitted[i]
    const label = `${f.repo}/${f.rel}`
    let r: any
    try { r = await parseFile(f.abs, f.dir) } catch { parseFailures++; continue }
    if (!r || r.success === false) { parseFailures++; continue }
    // ONLY the module symbol. The first version of this loop recorded EVERY symbol
    // under the same key, so the LAST symbol in the file won and the probe
    // reported `module symbol=collections_path` for ansible's
    // targets/collection/setup.sh — a VARIABLE in that file, not its module. Read
    // as written that is an accusation against the analyzer's module naming, and it
    // would have been false: `scriptNameOf` is the file's basename, so the symbol
    // is `setup.sh`. An instrument that accuses the code under test of a defect it
    // did not have is worse than no instrument, so the fix is here and the number
    // below is the corrected one.
    for (const s of r.symbols ?? []) {
      if (String(s?.kind ?? "").toLowerCase() !== "module") continue
      const nm = String(s?.name ?? "")
      if (!nm) continue
      moduleNames.add(nm)
      moduleByPath.set(path.join(f.dir, f.rel), nm)
    }
    for (const x of r.relationships ?? []) {
      const t = String(x?.type ?? x?.relationshipType ?? "").toLowerCase()
      if (t !== "imports" && t !== "references") continue
      pending.push({ label, dir: f.dir, rel: f.rel, abs: f.abs, tgt: String(x?.target ?? ""), line: Number(x?.line_number ?? 0) })
    }
  }
}
await Promise.all(Array.from({ length: 6 }, () => worker()))

// --------------------------------------------------------------- pass two
// Every admitted file's absolute path, so "inside the corpus" is a SET MEMBERSHIP
// TEST and not a string prefix guess.
const corpusAbs = new Set(admitted.map((f) => f.abs))

for (const p of pending) {
  const t = p.tgt.trim()
  let shape: Shape
  let resolvedAbs = ""
  if (t.length === 0) shape = "does-not-resolve"
  else if (hasUnexpandedExpansion(t)) shape = "unexpanded"
  else if (startsWithTilde(t)) shape = "tilde"
  else {
    const candidates = isAbsolute(t) ? [t] : [path.resolve(path.dirname(p.abs), t), path.resolve(p.dir, t)]
    const hit = candidates.find((c) => existsSync(c))
    if (!hit) shape = "does-not-resolve"
    else {
      resolvedAbs = hit
      shape = corpusAbs.has(hit) ? "resolves-to-a-file-inside-the-corpus" : "resolves-to-a-file-outside-the-corpus"
    }
  }
  counts[shape]++
  if (examples[shape].length < 8) examples[shape].push(`${p.label}:${p.line} -> ${t}${resolvedAbs ? `   [${resolvedAbs}]` : ""}`)
  // The defect test: a REAL file inside the corpus whose module symbol exists.
  if (shape === "resolves-to-a-file-inside-the-corpus") {
    const modName = moduleByPath.get(resolvedAbs)
    if (modName !== undefined) {
      fileInCorpus++
      // The store's module symbol is the file's BASENAME (`scriptNameOf`), so the
      // edge resolves only when the target string IS that basename. A target
      // carrying any directory part cannot match, however real the file is.
      const base = t.slice(t.lastIndexOf("/") + 1)
      if (base === modName) {
        resolvesByName++
        if (resolvesByNameExamples.length < 10) resolvesByNameExamples.push(`${p.label}:${p.line} -[imports]-> ${t}   module symbol=${modName}`)
      } else {
        resolvableNotResolved++
        if (resolvableNotResolvedExamples.length < 12) {
          resolvableNotResolvedExamples.push(`${p.label}:${p.line} -[imports]-> ${t}   file=${resolvedAbs}  module symbol=${modName}  basename=${base}  basename===symbol? ${base === modName}`)
        }
      }
    }
  }
}

const pct = (n: number, d: number) => (d === 0 ? "n/a" : `${((100 * n) / d).toFixed(1)}%`)
const total = pending.length
console.log(`bash imports/references target resolution — instrument: parseFile + realpath arithmetic, no regex`)
console.log(`corpus    : ${CR}`)
console.log(`repos     : ${repos.size}`)
console.log(`admitted  : ${totalAdmitted} files (EVERY admitted file)`)
console.log(`parse fail: ${parseFailures}`)
console.log(`edges     : ${total} (imports and references, both)`)
console.log(`\ntarget shape`)
for (const k of Object.keys(counts) as Shape[]) {
  console.log(`  ${k.padEnd(40)} ${String(counts[k]).padStart(5)}  ${pct(counts[k], total)}`)
  for (const e of examples[k]) console.log(`      ${e}`)
}
console.log(`\nname resolution among targets that name a REAL file inside the corpus`)
console.log(`  file inside the corpus, module symbol exists : ${fileInCorpus}`)
console.log(`  … and the target string EQUALS that symbol   : ${resolvesByName}   <- these are the edges bb_graph can walk`)
for (const e of resolvesByNameExamples) console.log(`      RESOLVES  ${e}`)
console.log(`  … and the target carries a directory part     : ${resolvableNotResolved}  (the basename differs, so the name cannot match)`)
for (const e of resolvableNotResolvedExamples) console.log(`      no match  ${e}`)
console.log(`\n  the ceiling: even a perfect basename fix reaches ${resolvesByName + resolvableNotResolved} of ${total} (${pct(resolvesByName + resolvableNotResolved, total)}).`)
// The rest is honest and unreachable from the target string alone: a script
// computes the prefix at run time.
console.log(`  ${counts.unexpanded} (${pct(counts.unexpanded, total)}) carry a value the SCRIPT computes — no name fix reaches them.`)

if (OUT) {
  writeFileSync(OUT, JSON.stringify({
    corpusRoot: CR, repos: repos.size, admitted: totalAdmitted, parseFailures, edges: total,
    shapes: counts, examples, fileInCorpus, resolvesByName, resolvableNotResolved, resolvableNotResolvedExamples,
  }, null, 2))
  console.log(`\nwrote ${OUT}`)
}
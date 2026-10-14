/**
 * JAVASCRIPT lane — where the `overrides` POSITIVE SHAPE lives, measured over the whole
 * repository shelf rather than over this lane's pinned corpora.
 *
 * ## The question this answers
 *
 * An `overrides` row's positive case is a derived class whose BASE CLASS IS DECLARED IN
 * ANOTHER FILE and whose method is a method the base declares. JSD54 closed with that
 * case covered only by a two-file probe the probe itself writes, because the lane's six
 * corpora contain no such row (see the JSD54 entry in
 * `script/m14/spec/javascript-completeness.json`). A corpus hole is only a coverage
 * statement about the corpora named, so this census widens the denominator to every
 * repository in the shelf that carries JavaScript at all, and reports per repository:
 *
 *   `class X extends Y` sites · sites whose base is declared in ANOTHER file ·
 *   how many of THOSE share a member with the base, and WHICH member.
 *
 * ## Method, and what this is NOT
 *
 * Text, not a parse: a brace-matched class body, classes found by `class X extends Y`.
 * The method set is read from the body with a member-shaped pattern, which OVER-COUNTS —
 * `if (` and `for (` inside a body are matched as members by construction. That is
 * deliberately the safe direction for this census's question: a FALSE member can only
 * turn a real `constructor`-only site into an apparent method override, never hide one,
 * so a row reported here is re-read by hand before it is cited, and the count of rows
 * with a NON-`constructor` shared member is the load-bearing number.
 *
 * A class name is attributed to the FIRST file that declares it in the walk order, so a
 * name declared in several files can produce a candidate that a real resolver would
 * attribute differently. Again the error direction is candidate-inflating, which is why
 * every reported row is printed with both files and is meant to be read.
 *
 * The shelf is walked with a fixed skip list (dot-directories, `node_modules`, build
 * output); a repository whose JavaScript is vendored or generated is still walked,
 * because the question is whether the SHAPE occurs in JavaScript at all.
 *
 * ## Usage
 *
 *   bun run script/m14/js-ontology/js-cross-file-override-census.ts [repo ...]
 *
 * With no arguments: every directory under the corpus root. With arguments: those
 * repositories only (the argument form is what a narrower re-check uses).
 *
 * Exit code is 0 whether or not the shape occurs — this census measures, it does not
 * adjudicate. It prints `0 candidates` per repository rather than staying silent, so an
 * absent shape and a skipped repository are different lines.
 */
import * as fs from "node:fs"
import * as path from "node:path"

const CORPUS_ROOT = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const JS_EXT = /\.(js|mjs|cjs)$/
/** Directories a JavaScript project does not author: dependencies, build output, VCS. */
const SKIP = new Set(["node_modules", ".git", "dist", "build", "vendor", "coverage", ".next", ".svelte-kit", "out", ".cache"])

function walk(dir: string, out: string[]): void {
  let ents: fs.Dirent[]
  try { ents = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const e of ents) {
    if (e.isDirectory()) { if (!SKIP.has(e.name) && !e.name.startsWith(".")) walk(path.join(dir, e.name), out) }
    else if (JS_EXT.test(e.name)) out.push(path.join(dir, e.name))
  }
}

interface Cls { name: string; base: string; methods: Set<string>; line: number }

/** `class X extends Y` with the body brace-matched from the declaration's own `{`. */
function classesIn(src: string): Cls[] {
  const out: Cls[] = []
  const re = /\bclass\s+([A-Za-z_$][\w$]*)\s+extends\s+([A-Za-z_$][\w$]*)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) {
    const braceStart = src.indexOf("{", re.lastIndex)
    if (braceStart < 0) continue
    let depth = 0, i = braceStart
    for (; i < src.length; i++) {
      if (src[i] === "{") depth++
      else if (src[i] === "}") { depth--; if (depth === 0) break }
    }
    const body = src.slice(braceStart + 1, i)
    const methods = new Set<string>()
    // Member-shaped: `name(` / `static name(` / `get name(` — over-counts `if (`/`for (`.
    const mre = /(?:^|[{;}])[\s]*(?:static\s+)?(?:async\s+)?(?:get\s+|set\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/g
    let mm: RegExpExecArray | null
    while ((mm = mre.exec(body))) methods.add(mm[1])
    out.push({ name: m[1], base: m[2], methods, line: src.slice(0, m.index).split("\n").length })
  }
  return out
}

const argRepos = process.argv.slice(2).filter((a) => !a.startsWith("-"))
let repos: string[]
if (argRepos.length > 0) repos = argRepos
else {
  try {
    repos = fs.readdirSync(CORPUS_ROOT, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => e.name).sort()
  } catch {
    console.error(`cannot read corpus root ${CORPUS_ROOT}`)
    process.exit(1)
  }
}

console.log(`javascript cross-file override census — ${repos.length} repositories under ${CORPUS_ROOT}`)
console.log(`skip list: ${[...SKIP].join(" ")} (+ every dot-directory)`)
console.log(`"shared member" is the class body's member set ∩ the base's; the load-bearing column is NON-constructor\n`)

let jsFiles = 0
let extendsSites = 0
let crossFile = 0
let nonCtor = 0
const nonCtorRows: string[] = []
const zeroRepos: string[] = []

for (const repo of repos) {
  const root = path.join(CORPUS_ROOT, repo)
  const files: string[] = []
  walk(root, files)
  if (files.length === 0) continue
  jsFiles += files.length

  const byFile = new Map<string, Cls[]>()
  const declFile = new Map<string, string>()
  for (const f of files) {
    let src: string
    try { src = fs.readFileSync(f, "utf8") } catch { continue }
    const cs = classesIn(src)
    if (cs.length === 0) continue
    byFile.set(f, cs)
    for (const c of cs) if (!declFile.has(c.name)) declFile.set(c.name, f)
  }
  let sExt = 0, sCross = 0, sNonCtor = 0
  for (const [, cs] of byFile) sExt += cs.length
  for (const [f, cs] of byFile) {
    for (const c of cs) {
      const bf = declFile.get(c.base)
      if (!bf || bf === f) continue                      // base must live in ANOTHER file
      const base = (byFile.get(bf) ?? []).find((x) => x.name === c.base)
      if (!base) continue
      const shared = [...c.methods].filter((x) => base.methods.has(x))
      if (shared.length === 0) continue
      sCross++
      crossFile++
      const real = shared.filter((x) => x !== "constructor")
      if (real.length > 0) {
        sNonCtor++
        nonCtor++
        nonCtorRows.push(`  ${repo}: ${c.name} extends ${c.base} [${real.sort().join(", ")}]` +
          `\n     derived ${c.line} ${path.relative(root, f)}` +
          `\n     base    ${path.relative(root, bf)}`)
      }
    }
  }
  extendsSites += sExt
  const line = `${repo}: ${files.length} js files, ${sExt} extends sites, ${sCross} cross-file sharing a member, ${sNonCtor} with a NON-constructor member`
  console.log(line)
  if (sCross === 0) zeroRepos.push(repo)
}

console.log(`\nTOTAL: ${jsFiles} javascript files, ${extendsSites} \`class X extends Y\` sites, ` +
  `${crossFile} whose base is declared in another file AND which share a member with it, ` +
  `${nonCtor} of those sharing a NON-constructor member`)
console.log(`${zeroRepos.length} of ${repos.length} repositories have no cross-file candidate at all`)
if (nonCtorRows.length > 0) {
  console.log(`\nNON-constructor cross-file candidates (read every one of these before citing):`)
  for (const r of nonCtorRows) console.log(r)
} else {
  console.log(`\nNO cross-file method override exists anywhere on this shelf. Every candidate shares ` +
    `\`constructor\` alone, which this lane's J2 ruling never pairs — so the positive shape cannot be ` +
    `measured here and must come from a corpus acquired outside the shelf, or from the probe.`)
}
console.log(`\nLIMITS: one JavaScript parser is not used anywhere in this file, deliberately — a parse would ` +
  `answer "does it parse", not "does it occur". The member set over-counts control-flow keywords in a body ` +
  `(see the header), class attribution is first-declaration-wins, and a repository whose JS is vendored or ` +
  `generated counts toward the denominator. Every direction of error inflates CANDIDATES, so a reported row ` +
  `is a prompt to look and a zero is the stronger claim.`)

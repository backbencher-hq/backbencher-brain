/**
 * BASH BINDING-SITE PROBE — does the language create bindings the analyzer never reads?
 *
 * ## The question
 *
 * `uses` edges resolve against the file's OWN symbol set. A `uses` edge whose target
 * is never declared anywhere in the file is an edge a reader cannot follow. The lane
 * had one explanation for that — environment-supplied names — and this probe asks
 * whether it is the ONLY one, by counting the binding sites POSIX defines that carry
 * NO `variable_assignment` and NO `declaration_command`, and therefore reach no
 * declaration collector:
 *
 *   for NAME in …          POSIX 6.7.3: `for name [in words] ; do list; done` —
 *                          `name` is ASSIGNED each word. The pinned grammar puts it
 *                          as a bare `variable_name` child of `for_statement`
 *                          (verified: `for_statement [for variable_name in word…]`),
 *                          which is not an assignment node.
 *
 *   read NAME…             POSIX 6.2.5: `read [-r] var…` assigns stdin to `var`.
 *                          The pinned grammar gives `read -r line` as
 *                          `command [command_name[word] word word]` — the targets are
 *                          plain `word`s, indistinguishable by TYPE from a flag.
 *
 *   printf -v NAME …       bash 4.1 `printf -v NAME`: assigns the formatted output to
 *                          NAME. A `word` after `-v`.
 *
 *   mapfile/readarray NAME bash 4.0: fills the array NAME.
 *
 * INSTRUMENT: tree-sitter walk over the parse tree. No regex anywhere — a regex over
 * source text would match these names inside comments and string literals, which is
 * the failure the workstream's §"two instruments" section documents.
 *
 * ## What it reports
 *
 *   1. binding-site counts per construct, with examples
 *   2. how many `uses` targets are UNDECLARED in their file
 *   3. of those, how many are explained by a measured binding site
 *   4. the residue — the part the probe does NOT explain, which is the number a
 *      reader should not be promised is zero
 *
 * The instrument is bounded by --sample (default 400, hash order) and reports the
 * sample size, so a number is never read as a whole-corpus claim.
 *
 * CLI: npx tsx validation/m14/fixtures/bash/probe-bash-binding-sites.mts [--sample 400] [--json out.json]
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
const SAMPLE = Number(flag("sample") ?? "400")
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
admitted.sort((a, b) => {
  const ha = createHash("sha256").update(`${a.repo}/${a.rel}`).digest("hex")
  const hb = createHash("sha256").update(`${b.repo}/${b.rel}`).digest("hex")
  return ha < hb ? -1 : ha > hb ? 1 : 0
})
const totalAdmitted = admitted.length
const files = admitted.slice(0, SAMPLE)
const repos = new Set(files.map((f) => f.repo))

// ------------------------------------------------------------------- the tree
const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-bash.wasm"))))

/**
 * `read` / `mapfile` / `readarray` options, split into the two facts the scanner needs.
 *
 * This is a table of the bash manual, written out rather than derived, because the
 * FIRST VERSION OF THIS PROBE DID NOT HAVE IT and produced two fabrications from real
 * corpus lines. Both are recorded here, because an instrument that cannot be shown to
 * have been wrong is an instrument whose number means nothing:
 *
 *   `mapfile -tO "${#cvsroots[@]}" cvsroots <CVS/Root`
 *     bash-completion/completions-core/cvs.bash:46. `-tO` bundles `-t` with `-O`. The
 *     first version read the bundle's trailing letters as a target and declared a
 *     variable named `tO`, then again as `O`.
 *
 *   `printf -v "$2" %s "$REPLY"`
 *     bash-completion/startup-core/000_bash_completion_compat.bash:90. The name is
 *     `"$2"` — an EXPANSION, so the script computes it. The first version skipped the
 *     expansion (it is not a `word`) and then took the next `word`, declaring `%s`.
 *     `printf -v` now emits nothing unless the token after `-v` is itself a plain
 *     `word`, which is the same rule BD4 applies to a computed command: a name the
 *     script computes at run time is not a name.
 *
 * THE RULE THE SECOND VERSION GOT WRONG, and the correction, because it produced two
 * more fabrications from real lines:
 *
 *   `IFS='/:' read -ra args <<< "$1"`     ansible/.azure-pipelines/commands/generic.sh:6
 *     `-ra` is `-r` plus `-a`, and `-a` is a FLAG (mark the next name as an array), so
 *     the version that treated "letters after a non-consuming flag" as a target
 *     declared a variable named `a`.
 *
 * So: EVERY letter in a bundle is a flag, never a tail. A flag that takes a value
 * consumes the NEXT SIBLING NODE of the command, whatever its type — which is what
 * makes `read -p "Name: " name` declare `name` rather than losing it, because the
 * prompt is a `string` node and a token-level scanner had already dropped it.
 * A target is a `word` sibling that is a shell identifier.
 */
const READ_VALUE_OPTS = new Set(["-d", "-e", "-i", "-n", "-N", "-p", "-s", "-t", "-u", "-O"])
const READ_FLAG_LETTERS = new Set(["r", "a", "d", "e", "i", "n", "N", "p", "s", "t", "u", "O", "C", "c"])

/** `[A-Za-z_][A-Za-z0-9_]*` by character code. */
const isShellIdentifier = (text: string): boolean => {
  if (text.length === 0) return false
  const f = text.charCodeAt(0)
  if (!((f >= 97 && f <= 122) || (f >= 65 && f <= 90) || f === 95 /* _ */)) return false
  for (let i = 1; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if ((c >= 97 && c <= 122) || (c >= 65 && c <= 90) || (c >= 48 && c <= 57) || c === 95) continue
    return false
  }
  return true
}

type Site = { construct: string; name: string; line: number }

/**
 * Targets of `read` / `mapfile` / `readarray`, from the command's own named children
 * after the `command_name`. Declines rather than guesses: a dynamic name, an option
 * value, or a non-identifier token produces nothing.
 */
const readTargets = (children: any[], construct: string, line: number, out: Site[]) => {
  let skipNext = false
  for (const c of children) {
    // An env prefix (`IFS='/:' read …`) and a redirection target are not options
    // and not targets; they simply advance the scan.
    if (c.type === "variable_assignment" || c.type === "file_redirect") continue
    const isOption = c.type === "word" && c.text.length > 1 && c.text.charCodeAt(0) === 45 /* - */ && c.text.charCodeAt(1) !== 45
    if (isOption) {
      let sawValueFlag = false
      const letters = c.text.slice(1)
      for (let j = 0; j < letters.length; j++) {
        if (!READ_FLAG_LETTERS.has(letters[j])) continue
        if (READ_VALUE_OPTS.has(`-${letters[j]}`)) sawValueFlag = true
      }
      skipNext = sawValueFlag
      continue
    }
    if (skipNext) {
      skipNext = false
      continue
    }
    if (c.type === "word" && isShellIdentifier(c.text)) out.push({ construct, name: c.text, line })
  }
}

/** Every binding site the language defines that carries no `variable_assignment`. */
const bindingSites = (root: any): Site[] => {
  const out: Site[] = []
  const visit = (n: any) => {
    // `for NAME in words; do …; done` — POSIX 6.7.3 assigns each word to NAME. The
    // pinned grammar carries it as a bare `variable_name` child of `for_statement`
    // (verified: `for_statement [for variable_name in word …]`), which is not an
    // assignment node, so no declaration collector reaches it. The c-style form
    // `for ((i=0; …))` is a `c_style_for_statement` whose init is a real
    // `variable_assignment`, so it needs no entry here.
    if (n.type === "for_statement") {
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c && c.type === "variable_name") out.push({ construct: "for", name: c.text, line: c.startPosition.row + 1 })
      }
    }
    if (n.type === "command") {
      let cn: any = null
      for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c && c.type === "command_name") { cn = c; break } }
      if (cn) {
        const cmd = cn.namedChildCount === 1 && cn.namedChild(0)?.type === "word" ? cn.namedChild(0).text : cn.text
        const line = n.startPosition.row + 1
        const after = Array.from({ length: n.namedChildCount }, (_, i) => n.namedChild(i)).filter((c: any) => c && c !== cn)
        if (cmd === "read" || cmd === "readarray" || cmd === "mapfile") readTargets(after, cmd, line, out)
        // `printf -v NAME fmt …` (bash 4.1). `echo` has no `-v`, so it is not here.
        if (cmd === "printf") {
          for (let a = 0; a < after.length - 1; a++) {
            if (after[a].type === "word" && after[a].text === "-v") {
              const target = after[a + 1]
              if (target.type === "word" && isShellIdentifier(target.text)) out.push({ construct: "printf -v", name: target.text, line })
              break
            }
          }
        }
      }
    }
    for (let i = 0; i < n.childCount; i++) visit(n.child(i))
  }
  visit(root)
  return out
}

// ------------------------------------------------------------------ the run
let idx = 0
const sitesByConstruct = new Map<string, { count: number; files: Set<string>; examples: string[] }>()
const note = (construct: string, label: string, example: string) => {
  const r = sitesByConstruct.get(construct) ?? { count: 0, files: new Set<string>(), examples: [] }
  r.count++
  r.files.add(label)
  if (r.examples.length < 6) r.examples.push(example)
  sitesByConstruct.set(construct, r)
}
let usesEdges = 0
let usesUndeclared = 0
let usesUndeclaredExplained = 0
let usesUndeclaredResidue = 0
// DISTINCT files carrying at least one binding site. The per-construct file
// counts above cannot be summed into this: the same file carries a `for` binding
// and a `read` binding (helpers.bash carries both), so the sum overcounts. A
// previous revision of the analyzer's comment carried "112 files", which is
// neither the sum (113) nor a measured union — it was written before anything
// measured it. The set is what makes the number real.
const bindingSiteFiles = new Set<string>()
const undeclaredExamples: string[] = []
const residueExamples: string[] = []
const explainedExamples: string[] = []
let parseFailures = 0

async function worker() {
  while (true) {
    const i = idx++
    if (i >= files.length) return
    const f = files[i]
    const label = `${f.repo}/${f.rel}`
    let r: any
    try { r = await parseFile(f.abs, f.dir) } catch { parseFailures++; continue }
    if (!r || r.success === false) { parseFailures++; continue }

    const declared = new Set<string>()
    for (const s of r.symbols ?? []) { const nm = String(s?.name ?? ""); if (nm) declared.add(nm) }

    let sites: Site[] = []
    try {
      const t = parser.parse(f.text)
      if (t) { sites = bindingSites(t.rootNode); t.delete?.() }
    } catch { /* parseFile already recorded its own outcome */ }
    const siteNames = new Set<string>()
    for (const s of sites) {
      siteNames.add(s.name)
      bindingSiteFiles.add(label)
      note(s.construct, label, `${label}:${s.line} ${s.construct} -> ${s.name}`)
    }

    for (const x of r.relationships ?? []) {
      const t = String(x?.type ?? x?.relationshipType ?? "").toLowerCase()
      if (t !== "uses") continue
      usesEdges++
      const tgt = String(x?.target ?? "")
      if (tgt.length === 0 || declared.has(tgt)) continue
      usesUndeclared++
      if (siteNames.has(tgt)) {
        usesUndeclaredExplained++
        if (explainedExamples.length < 10) explainedExamples.push(`${label}: uses -> ${tgt}`)
      } else {
        usesUndeclaredResidue++
        if (residueExamples.length < 10) residueExamples.push(`${label}: uses -> ${tgt}`)
      }
    }
    void undeclaredExamples
  }
}
await Promise.all(Array.from({ length: 6 }, () => worker()))

// ------------------------------------------------------------------- report
const pct = (n: number, d: number) => (d === 0 ? "n/a" : `${((100 * n) / d).toFixed(1)}%`)
console.log(`bash binding-site probe — instrument: tree-sitter walk, no regex`)
console.log(`corpus   : ${CR}`)
console.log(`repos    : ${repos.size}`)
console.log(`admitted : ${totalAdmitted} files`)
console.log(`sampled  : ${files.length} files, hash order (sha256 of repo/rel, ascending)`)
console.log(`parse fail: ${parseFailures}`)
console.log(`\nbinding sites the declaration collectors cannot see`)
console.log(`  ${bindingSiteFiles.size} DISTINCT files carry at least one (the per-construct file counts below overlap and must not be summed)`)
for (const k of [...sitesByConstruct.keys()].sort()) {
  const r = sitesByConstruct.get(k)!
  console.log(`  ${k.padEnd(10)} ${String(r.count).padStart(6)} occurrences in ${r.files.size} files`)
  for (const e of r.examples) console.log(`      ${e}`)
}
console.log(`\nuses-edge resolution against the file's own symbol set`)
console.log(`  uses edges                        : ${usesEdges}`)
console.log(`  target NOT declared in the file  : ${usesUndeclared} (${pct(usesUndeclared, usesEdges)})`)
console.log(`  … explained by a binding site     : ${usesUndeclaredExplained} (${pct(usesUndeclaredExplained, usesUndeclared)} of the undeclared)`)
console.log(`  … UNEXPLAINED residue             : ${usesUndeclaredResidue} (${pct(usesUndeclaredResidue, usesUndeclared)} of the undeclared)`)
for (const e of explainedExamples) console.log(`      explained  ${e}`)
for (const e of residueExamples) console.log(`      residue    ${e}`)

if (OUT) {
  writeFileSync(OUT, JSON.stringify({
    corpusRoot: CR, repos: [...repos], admitted: totalAdmitted, sampled: files.length, parseFailures,
    bindingSiteFileCount: bindingSiteFiles.size,
    bindingSiteFiles: [...bindingSiteFiles].sort(),
    bindingSites: Object.fromEntries([...sitesByConstruct].map(([k, v]) => [k, { count: v.count, files: v.files.size, examples: v.examples }])),
    usesEdges, usesUndeclared, usesUndeclaredExplained, usesUndeclaredResidue,
  }, null, 2))
  console.log(`\nwrote ${OUT}`)
}

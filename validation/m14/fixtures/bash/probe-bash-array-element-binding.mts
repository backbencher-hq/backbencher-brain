/**
 * BASH ARRAY-ELEMENT ASSIGNMENT — sizing the implicit binding the analyzer does not read
 *
 * ## The construct
 *
 * `name[index]=value` is core bash and it BINDS `name`: if the array does not
 * exist, the assignment creates it. So it is a binding site in exactly the class
 * the analyzer already recognises — a `for` loop variable (125 sites), a `read`
 * target (48), a `printf -v` name — and it is read by none of them.
 *
 * The grammar hands it back as `variable_assignment > subscript > variable_name`,
 * so the name is one level deeper than the bare-LHS case the handler already
 * publishes, and the handler declines it. Measured on a three-line fixture:
 *
 *     echo "read before: ${NEVER_DECLARED[0]}"
 *     NEVER_DECLARED[0]="created by element assignment"
 *     echo "after: ${NEVER_DECLARED[0]}"
 *
 *   symbols            1 (the module) — the array is not published
 *   relationships      2, both `uses`, both from the two READS
 *   isAssignedInFile   absent on both, so BD11 classifies this file as not
 *                      assigning a name it assigns twice
 *
 * Two costs, and they are different findings: the binding publishes nothing, and
 * every read of that name in that file is classified as environment-supplied.
 *
 * ## WHAT THIS PROBE MEASURES, AND WHY IT RUNS BEFORE THE FIX
 *
 * The delta is derived from the grammar, not from a patched analyzer, so the
 * number the fix is then measured against is independent of the fix. Round 8's
 * rule: predict the delta from the tree first, then change the code, then compare.
 * A prediction that is fitted after the change is a description.
 *
 * Three populations, because "a site exists" and "a site is missing something"
 * are not the same question:
 *
 *   sites            every `variable_assignment` whose LHS names an array element
 *   NEW binding      sites whose base name the file publishes NO symbol for — the
 *                    sites that would add a symbol
 *   re-assignment    sites whose base name is already published — these add
 *                    nothing, exactly as a repeated `X=1` adds nothing
 *   misclassified    `uses` edges naming such a name that lack
 *                    `isAssignedInFile`, i.e. reads BD11 gets wrong today
 *
 * Every LHS SHAPE the grammar produces is enumerated, not just `subscript`, so the
 * probe cannot quietly measure one form and miss a sibling.
 *
 * ## INSTRUMENT
 *
 * Production `parseFile` for edges and symbols; this probe's OWN `web-tree-sitter`
 * handle over the same pinned `wasm/tree-sitter-bash.wasm` for tree shape. Two
 * handles, never shared. NO REGEX — LHS shapes are `node.type` and named children.
 *
 * CLI: npx tsx validation/m14/fixtures/bash/probe-bash-array-element-binding.mts
 *      [--sample 400 | --all] [--examples 20] [--base <commit>]
 *
 * `--base <commit>` adjudicates against that commit's analyzer instead of the
 * working tree's, which is what keeps the PREDICTION reproducible after the fix
 * lands: run it with and without and the two populations must differ by exactly
 * the fix's delta.
 */
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { parseFile } from "../../../../src/ast/pool-worker"


const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const argv = process.argv.slice(2)
const num = (n: string, d: number): number => {
  const i = argv.indexOf(`--${n}`)
  return i >= 0 ? Number(argv[i + 1]) : d
}
const ALL = argv.includes("--all")
const SAMPLE = ALL ? Number.MAX_SAFE_INTEGER : num("sample", 400)
const EXAMPLES = num("examples", 20)

/**
 * `--base <commit>` runs the ADJUDICATION against that commit's analyzer instead of
 * the working tree's, so the PREDICTION stays reproducible after the fix lands.
 *
 * Without it this probe can only be run once per analyzer, and a prediction is
 * only worth something while it can still disagree with the change. The old
 * analyzer is materialised as a SIBLING module and driven through the private
 * tree handle this probe already owns — never `git stash` (limitation 17), and
 * never `parseFile`, which can only reach the working tree's analyzer.
 *
 * `--base` and no `--base` must therefore PRINT DIFFERENT POPULATIONS: the
 * pre-fix side names the declarations it drops, the post-fix side names none.
 */
const BASE = (() => {
  const i = argv.indexOf("--base")
  return i >= 0 ? argv[i + 1] : null
})()

interface F {
  repo: string
  rel: string
  abs: string
  text: string
  hash: string
}
const files: F[] = []
let scanned = 0
const repoNames = new Set<string>()
for (const e of readdirSync(CR)) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
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
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text: string
    try {
      if (statSync(abs).size > 512 * 1024) continue
      text = readFileSync(abs, "utf8")
    } catch {
      continue
    }
    scanned++
    if (detectLanguageFromPath(abs, text) !== "bash") continue
    repoNames.add(e)
    files.push({ repo: e, rel, abs, text, hash: createHash("sha256").update(`${e}/${rel}`).digest("hex") })
  }
}
files.sort((a, b) => (a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0))
const sample = ALL ? files : files.slice(0, SAMPLE)

console.log(
  `bash array-element-assignment probe — production parseFile + private tree handle, ${sample.length} files${ALL ? " (--all)" : ""}`,
)
console.log(`admitted ${files.length} / scanned ${scanned} / repos ${repoNames.size}\n`)

const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({
  locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm"),
})
const parser = new WSP()
parser.setLanguage(
  await WSL.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-bash.wasm"))),
)

/** The analyzer under adjudication. Production `parseFile` when there is no
 *  `--base`; the base commit's own analyzer, imported as a sibling module, when
 *  there is. Both see the bytes this probe's private handle parsed. */
type Analyzed = { symbols?: any[]; relationships?: any[]; errors?: unknown[]; fallback?: boolean }
let analyzeFile: (abs: string, text: string) => Analyzed
let oldCopy: string | null = null
if (BASE) {
  oldCopy = path.join(process.cwd(), "src/ast/__ab_probe_old_bash_analyzer.mts")
  writeFileSync(oldCopy, execFileSync("git", ["show", `${BASE}:src/ast/real-bash-analyzer.ts`], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  }))
  const mod: any = await import("../../../../src/ast/__ab_probe_old_bash_analyzer.mts")
  const inst: any = new mod.RealBashAnalyzer()
  analyzeFile = (abs, text) => {
    const tree = parser.parse(text)
    try {
      return inst.analyze(tree.rootNode, text, abs)
    } finally {
      tree.delete?.()
    }
  }
  console.log(`adjudicating against the analyzer at ${BASE}, not the working tree\n`)
} else {
  analyzeFile = async (abs) => (await parseFile(abs)) as Analyzed
}

/**
 * `--verify` answers the question a PREDICTION raises once it has been checked
 * against a change: does the analyzer as it now stands actually publish what the
 * prediction said it would?
 *
 * Without it the two instruments disagree silently. Whole-corpus the prediction
 * read 58 unpublished (file, owner, name) pairs while the A/B measured 45 symbols
 * added, and the 13 in between were the whole of the disagreement — which of the
 * two was wrong, and about what, is not something to argue about. Each predicted
 * triple is therefore checked against the CURRENT analyzer's published
 * `(scope, name)` set in the SAME pass, and every one the current analyzer does
 * not publish is printed with its file, owner and name.
 *
 * The prediction and the verification are deliberately INDEPENDENT: the
 * prediction reads the BASE analyzer's symbol table, the verification reads the
 * WORKING TREE's, and both go through this probe's own tree handle. Two numbers
 * from one instrument is the failure mode; this is one instrument asked two
 * questions about two different analyzer versions.
 */
const VERIFY = argv.includes("--verify")
const publishedNow = VERIFY ? new Map<string, Set<string>>() : null
if (VERIFY && !BASE) {
  // No base needed: the prediction below is then read off the WORKING TREE, so
  // `--verify` without `--base` is vacuous and says so rather than printing zeros
  // that look like a closed defect.
  console.log("NO-OP: --verify needs --base, or it has no pre-change population to verify.")
  process.exit(0)
}

/** Every distinct LHS shape a `variable_assignment` can have, counted. Enumerating
 *  them is what makes "the fix covers `subscript`" a checked claim: a sibling shape
 *  with its own population shows up here as its own row. */
const shapes = new Map<string, number>()
const sites: { file: string; line: number; name: string; owner: string; src: string }[] = []
/** Per file: the published `(scope, name)` pairs and the `uses` edges, captured in
 *  the SAME parseFile pass as the tree walk. Two passes would double a 4m20s corpus
 *  run and buy nothing — the analyzer is deterministic on the same bytes.
 *
 *  The key is `scope \u0000 name`, NOT the bare name, and that detail is the whole
 *  reason this probe's first prediction was wrong. `extractAssignment` dedupes on
 *  `${owner}\u0000${name}`, so a `COMPREPLY[i]=…` inside a function is a new
 *  declaration even when the file already publishes `COMPREPLY` at module scope —
 *  bash scopes them apart and so does the analyzer. A name-only key called 3 of
 *  the sites new bindings; the measured A/B delta was 5, and the two extra were
 *  exactly this case (`_ZSH_AUTOSUGGEST_BIND_COUNTS`, declared `typeset -gA` at
 *  module scope on line 13 and bound by element on line 8 inside a function;
 *  `xcode_versions`, the same shape). Adjudicating a scope-sensitive key with a
 *  scope-blind one is the same error as adjudicating a file-level flag with a
 *  positional one, and this file has now made it twice. */
const publishedNames = new Map<string, Set<string>>()
const usesEdges = new Map<string, { target: string; line: number; assigned: boolean }[]>()
let degraded = 0
let parseErrFiles = 0

for (const f of sample) {
  const r: any = await analyzeFile(f.abs, f.text)
  if (r?.fallback) degraded++
  if ((r?.errors ?? []).length > 0) parseErrFiles++

  publishedNames.set(
    `${f.repo}/${f.rel}`,
    new Set(
      (r.symbols ?? []).map((s: any) => `${String(s?.scope ?? "")}\u0000${String(s?.name ?? "")}`),
    ),
  )
  usesEdges.set(
    `${f.repo}/${f.rel}`,
    (r.relationships ?? [])
      .filter((rel: any) => rel.type === "uses")
      .map((rel: any) => ({
        target: String(rel.target),
        line: rel.line_number,
        assigned: rel.metadata?.isAssignedInFile === true,
      })),
  )

  if (publishedNow) {
    const rNow: any = await parseFile(f.abs)
    publishedNow.set(
      `${f.repo}/${f.rel}`,
      new Set(
        (rNow.symbols ?? []).map((s: any) => `${String(s?.scope ?? "")}\u0000${String(s?.name ?? "")}`),
      ),
    )
  }

  const lines = f.text.split("\n")
  const tree = parser.parse(f.text)
  const cursor = tree.walk()
  /** The analyzer's owner for a declaration is the INNERMOST enclosing
   *  `function_definition`, or the script itself at top level (BD2: the script is
   *  the module, named for its own basename). Tracked here from the tree so the
   *  adjudication key is the analyzer's key rather than a guess at it. */
  const ownerStack: string[] = []

  const walk = (): void => {
    const node = cursor.currentNode
    if (node.type === "variable_assignment") {
      // The LHS is the named child that is not the value. Enumerate what it is
      // rather than assuming one shape.
      let lhsType = "(none)"
      let lhsName = ""
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i)
        if (!child) continue
        const t = child.type
        if (t === "subscript") {
          lhsType = "subscript"
          const base = child.namedChild(0)
          if (base && base.type === "variable_name") lhsName = base.text
          break
        }
        if (t === "variable_name" || t === "concatenation" || t === "subscript" || t === "word") {
          lhsType = t
          if (t === "variable_name") lhsName = child.text
          if (t === "word") lhsName = child.text
          break
        }
      }
      shapes.set(lhsType, (shapes.get(lhsType) ?? 0) + 1)
      if (lhsType === "subscript" && lhsName.length > 0) {
        const line = node.startPosition.row + 1
        sites.push({
          file: `${f.repo}/${f.rel}`,
          line,
          name: lhsName,
          owner:
            ownerStack.length > 0 ? ownerStack[ownerStack.length - 1]! : path.basename(f.abs),
          src: (lines[line - 1] ?? "").trim().slice(0, 110),
        })
      }
    }
    /** `function_definition`'s own name child, read off the tree. An ANONYMOUS
     *  function (`function () { … }`) pushes NOTHING rather than pushing an empty
     *  string, because that is what the analyzer does — `if (name) functionStack
     *  .push(name)` — and a declaration inside an anonymous function nested in a
     *  named one is owned by the OUTER function. */
    let pushedOwner = false
    if (node.type === "function_definition") {
      let fnName = ""
      for (let i = 0; i < node.namedChildCount; i++) {
        const c = node.namedChild(i)
        if (c && c.type === "word") {
          fnName = c.text
          break
        }
      }
      if (fnName.length > 0) {
        ownerStack.push(fnName)
        pushedOwner = true
      }
    }
    if (cursor.gotoFirstChild()) {
      do {
        walk()
      } while (cursor.gotoNextSibling())
      cursor.gotoParent()
    }
    // POP, or the stack is a list of every function seen so far rather than the
    // enclosing one. Without it the probe called 19 whole-corpus declarations
    // function-scoped that the tree puts at the ROOT — `types[$hash]=` in
    // ohmyzsh/tools/changelog.sh:145 sits under `program`, not under the
    // `commit:is-revert` function whose body ended at line 131 — and predicted 58
    // new declarations where the analyzer publishes 45. The tell was that the
    // prediction disagreed with the A/B by a number, and neither instrument was
    // adjusted until one of them was checked against the tree.
    if (pushedOwner) ownerStack.pop()
  }
  walk()
  tree.delete()
}

console.log("every LHS shape the grammar produces for `variable_assignment`:")
for (const [shape, n] of [...shapes.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${shape.padEnd(28)} ${String(n).padStart(7)}`)
}

/** Now adjudicate the `subscript` sites against what the analyzer published.
 *
 *  Adjudication is PER FILE, not per site. A file with three `COMPREPLY[…]=…`
 *  lines has three sites but one name, and walking the reads per site counted that
 *  name's six reads three times — the same shape as round 10's `files` column, a
 *  per-row count wearing a per-file header. Each (file, name) pair is therefore
 *  decided once, and the read tally is per (file, name, line).
 */
let newBinding = 0
let reAssignment = 0
let misclassified = 0
let correctRead = 0
/**
 * The split is REPORTED, not an excuse, and getting that backwards is the second
 * mistake this probe has made.
 *
 * BD11's published contract is FILE-LEVEL: `isAssignedInFile` is "set when the
 * file assigns the name under any owner". A read at line 7 in a file that binds
 * the name at line 8 is therefore classified WRONG, and "use-before-assign" does
 * not make it right — the field does not claim to answer "is the name bound yet
 * at this point", it answers "does this file bind it".
 *
 * An earlier revision of this file printed `use-before-assign: correct` beside
 * those rows. That is the finding that would have hidden a second, INDEPENDENT
 * defect: the flag is evaluated mid-walk, so the line it sits on decides the
 * answer (see `probe-bash-assigned-flag-order.mts`, and the two-line fixture
 * `bd11-assigned-flag-is-file-level.sh`). So these two counts are kept because
 * they name that mechanism, and the total above them is the defect count.
 */
let misclassifiedBeforeBinding = 0
let misclassifiedAtOrAfter = 0
const newBindingFiles = new Set<string>()
const examples: string[] = []

/** TWO keys for TWO questions, and conflating them is what made the first
 *  prediction wrong.
 *
 *  `byFileOwnerName` — "does this file already publish this DECLARATION". The
 *  analyzer's dedup key is `${owner}\u0000${name}`, so a function-scoped element
 *  binding is new even when the module publishes the same name.
 *
 *  `byFileName` — "does this file assign this NAME", which is BD11's own
 *  file-level question and deliberately owner-blind.
 */
const byFileOwnerName = new Map<string, typeof sites>()
const byFileName = new Map<string, Map<string, typeof sites>>()
for (const s of sites) {
  const ownKey = `${s.file}\u0000${s.owner}\u0000${s.name}`
  const ownList = byFileOwnerName.get(ownKey)
  if (ownList) ownList.push(s)
  else byFileOwnerName.set(ownKey, [s])

  let byName = byFileName.get(s.file)
  if (!byName) byFileName.set(s.file, (byName = new Map()))
  const list = byName.get(s.name)
  if (list) list.push(s)
  else byName.set(s.name, [s])
}

/** Every triple the PREDICTION named, kept whole so `--verify` can check each one
 *  against the current analyzer rather than only counting them. */
const predictedNew: { file: string; owner: string; name: string; line: number; src: string }[] = []
for (const [ownKey, list] of byFileOwnerName) {
  const sep = ownKey.indexOf("\u0000")
  const file = ownKey.slice(0, sep)
  const owner = ownKey.slice(sep + 1, ownKey.indexOf("\u0000", sep + 1))
  const name = ownKey.slice(ownKey.indexOf("\u0000", sep + 1) + 1)
  const published = publishedNames.get(file)
  if (!published) continue
  if (!published.has(`${owner}\u0000${name}`)) {
    newBinding++
    newBindingFiles.add(file)
    predictedNew.push({ file, owner, name, line: list[0]?.line ?? 0, src: list[0]?.src ?? "" })
    if (examples.filter((e) => e.includes("NEW BINDING")).length < EXAMPLES) {
      for (const s of list.slice(0, 2)) {
        examples.push(
          `  NEW BINDING  ${s.file}:${s.line}  ${s.name}  (owner ${owner || "(anon)"})\n      | ${s.src}`,
        )
      }
    }
  } else {
    reAssignment++
  }
}

for (const [file, byName] of byFileName) {
  const reads = usesEdges.get(file) ?? []
  if (!publishedNames.has(file)) continue
  for (const [name, list] of byName) {
    for (const rel of reads) {
      if (rel.target !== name) continue
      if (rel.assigned) correctRead++
      else {
        misclassified++
        const firstBind = Math.min(...list.map((s) => s.line))
        if (rel.line < firstBind) {
          misclassifiedBeforeBinding++
          if (examples.filter((e) => e.includes("BEFORE BINDING")).length < 3) {
            examples.push(
              `  BEFORE BINDING ${rel.target} @${rel.line} in ${file}; first ${name}[…]= at ${firstBind} — wrong under BD11 (file-level), and the line explains why`,
            )
          }
        } else {
          misclassifiedAtOrAfter++
          if (examples.filter((e) => e.includes("MISCLASSIFIED")).length < EXAMPLES) {
            examples.push(
              `  MISCLASSIFIED ${rel.target} @${rel.line} in ${file}; first ${name}[…]= at ${firstBind}`,
            )
          }
        }
      }
    }
  }
}

console.log(`\narray-element assignment sites (LHS is a subscript) : ${sites.length}`)
console.log(`  in ${new Set(sites.map((s) => s.file)).size} files`)
console.log(`  distinct (file,owner,name) pairs among the sites: ${byFileOwnerName.size}`)
console.log(`  would publish a NEW declaration                 : ${newBinding} (in ${newBindingFiles.size} files)`)
console.log(`  (file,owner,name) pairs already published       : ${reAssignment}`)
console.log(`  distinct (file,name) pairs among the sites      : ${[...byFileName.values()].reduce((a, m) => a + m.size, 0)}`)
console.log(`\n"uses" edges naming such a name:`)
console.log(`  already classified assigned-in-file              : ${correctRead}`)
console.log(`  MISCLASSIFIED as not-assigned-in-file            : ${misclassified}   (BD11 is file-level; all ${misclassified} are the same defect)`)
console.log(`    read BEFORE the file's first binding          : ${misclassifiedBeforeBinding}   (still wrong; the line is what the mid-walk evaluation keys on)`)
console.log(`    read AT/AFTER the binding                      : ${misclassifiedAtOrAfter}   (wrong with no order-dependence involved)`)
if (publishedNow) {
  let verified = 0
  const missing: string[] = []
  for (const p of predictedNew) {
    const now = publishedNow.get(p.file)
    if (now && now.has(`${p.owner}\u0000${p.name}`)) verified++
    else if (missing.length < 30) missing.push(`  NOT PUBLISHED  ${p.file}:${p.line}  ${p.name}  (owner ${p.owner || "(anon)"})\n      | ${p.src}`)
  }
  console.log(`\nVERIFICATION — every triple the base analyzer did not publish, checked against the WORKING TREE:`)
  console.log(`  predicted new declarations      : ${predictedNew.length}`)
  console.log(`  the working tree publishes them  : ${verified}`)
  console.log(`  the working tree does NOT        : ${predictedNew.length - verified}`)
  if (missing.length > 0) console.log(`\n${missing.join("\n")}`)
}
if (examples.length > 0) console.log(`\nexamples:\n${examples.join("\n")}`)
parser.delete()
if (oldCopy) {
  try {
    unlinkSync(oldCopy)
  } catch {
    /* already gone */
  }
}

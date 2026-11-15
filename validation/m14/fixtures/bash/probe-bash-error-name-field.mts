/**
 * A FUNCTION NAME INSIDE A tree-sitter ERROR SPAN — measured, and the reason
 * this lane's stated property about damaged regions is FALSE.
 *
 * ## What this file was written to test, and what it found
 *
 * `functionName` (real-bash-analyzer.ts:1424) reads the grammar's own `name:`
 * field first — `node.childForFieldName?.("name")` — and returns `named.text` if
 * it is non-empty. That is the right rule: field-first beats a positional scan,
 * and the field is what the grammar itself asserts the name is. It has no
 * condition on WHERE that field resolves, and limitation 33 of
 * `docs/analyzers/bash.md` asserts the property that invites:
 *
 *   "A damaged region publishes no declaration, which is the same property that
 *    makes ERROR nodes safe to ignore for edge counts and unsafe for declaration
 *    counts."
 *
 * If that were true, the obvious next change is a guard refusing a name resolved
 * through a damaged region. This probe is the measurement that has to happen
 * BEFORE such a guard, and the measurement says the guard would be destructive:
 *
 *   function_definition nodes                6,773
 *   `name:` field resolves                   6,773  (100%, always a `word`)
 *   name node inside an ERROR span               427  (6.3% of definitions,
 *                                                      1.0% of all 42,469 symbols)
 *     ERROR span starts BEFORE the definition    421  the definition is intact
 *     ERROR span starts AT the definition          6  the definition is damaged
 *   published by production `parseFile`          427/427
 *
 * **All 427 are real declarations.** Read, not inferred: `ohmyzsh/lib/
 * clipboard.zsh:55` is `function clipcopy() { cat "${1:-/dev/stdin}" | pbcopy; }`
 * nested in an `if` branch — valid bash, which a minimal fixture confirms the
 * pinned grammar parses CLEANLY when the enclosing zsh `(( ${+commands[…]} ))`
 * condition is absent. The ERROR there belongs to the surrounding zsh condition
 * and its span swallows the names. The same holds for the 6 internal cases
 * (`ohmyzsh/lib/functions.zsh:1` `function zsh_stats() {`, `rg.zsh:15`
 * `_rg() {`, `perms.plugin.zsh:9` `function set644 {`, and three more), every
 * one of which is a plain valid bash function.
 *
 * So "the name is inside an ERROR node" is a statement about an ERROR node's
 * SPAN, not a claim that the analyzer recovered a name from wreckage. The two
 * are different measurements and this probe separates them, because conflating
 * them is how a lane deletes 427 correct symbols while believing it is being
 * careful.
 *
 * ## WHAT WOULD OVERTURN THIS
 *
 * A non-zero count of published names that a CORRECT bash run would NOT create.
 * The probe prints, per site, whether `parseFile` publishes the name and whether
 * the name is also declared by a definition the grammar placed cleanly, so the
 * population of names that exist ONLY inside error recovery is separable from the
 * population that is independently real. This run reads the second population at
 * **0** and the first at **427**, so the claim "all 427 are real declarations"
 * rests on the 6 hand-read internal cases plus the clean-parse fixture, and the
 * probe is the instrument that would show it wrong.
 *
 * ## INSTRUMENT
 *
 * This probe's OWN `web-tree-sitter` handle over the pinned
 * `wasm/tree-sitter-bash.wasm`; production `parseFile` for what the analyzer
 * publishes. Two handles, never shared (limitation 15 — sharing one parser
 * handle is what makes the coverage gate's per-type totals wobble run to run).
 * **NO REGEX** — every shape is `node.type`, `childForFieldName`, `startPosition`
 * and integer child indices.
 *
 * CLI: npx tsx validation/m14/fixtures/bash/probe-bash-error-name-field.mts
 *      [--all | --sample 400] [--examples 15]
 */
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
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
const EXAMPLES = num("examples", 15)

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
    files.push({
      repo: e,
      rel,
      abs,
      text,
      hash: createHashOf(`${e}/${rel}`),
    })
  }
}
files.sort((a, b) => (a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0))
const sample = ALL ? files : files.slice(0, SAMPLE)

console.log(
  `bash ERROR-name-field probe — production parseFile + private tree handle, ${sample.length} files${ALL ? " (--all)" : ""}`,
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

interface Site {
  file: string
  line: number
  name: string
  /** the name field's node has an ERROR somewhere above it */
  nameInError: boolean
  /**
   * THE DECISIVE FIELD, and the reason this probe exists.
   *
   * `nameInError` alone conflates two different things: an ERROR node whose SPAN
   * happens to enclose an intact definition, and a definition the grammar
   * actually damaged. Comparing each ERROR ancestor's START against the
   * definition's own start separates them:
   *
   *   "external" — the ERROR begins BEFORE the definition, so the damage is in
   *                something earlier and its span swallows the names. The
   *                definition is intact and publishing it is right.
   *   "internal" — the ERROR begins AT or INSIDE the definition, so this
   *                definition is the damaged one.
   *
   * Measured whole corpus: 421 external, 6 internal, and all 6 hand-read as
   * valid bash. Neither half is a fabrication; they are two different reasons
   * the same predicate fires, and a reader needs them apart.
   */
  errorScope: "none" | "external" | "internal"
  /** the first named child is an ERROR — the zsh multi-name signature */
  firstChildError: boolean
  /** an ERROR node exists anywhere inside this definition */
  damagedInside: boolean
}
const sites: Site[] = []
let defs = 0
let defsWithNameField = 0

for (const f of sample) {
  let tree: any
  try {
    tree = parser.parse(f.text)
  } catch {
    continue
  }
  const root = tree?.rootNode
  if (!root) continue
  const hasErrorAbove = (n: any): boolean => {
    let c = n?.parent
    while (c) {
      if (c.type === "ERROR") return true
      c = c.parent
    }
    return false
  }
  /** The nearest ERROR ancestor's start, compared with the definition's own. */
  const errorScopeOf = (nameNode: any, def: any): "none" | "external" | "internal" => {
    let c = nameNode?.parent
    while (c) {
      if (c.type === "ERROR") {
        const e = c.startPosition.row * 100000 + c.startPosition.column
        const d = def.startPosition.row * 100000 + def.startPosition.column
        return e < d ? "external" : "internal"
      }
      c = c.parent
    }
    return "none"
  }
  const hasErrorBelow = (n: any): boolean => {
    const st: any[] = [n]
    while (st.length > 0) {
      const x = st.pop()!
      if (x.type === "ERROR") return true
      for (let j = 0; j < x.childCount; j++) {
        const c = x.child(j)
        if (c) st.push(c)
      }
    }
    return false
  }
  const stack: any[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()!
    if (n.type === "function_definition") {
      defs++
      const named = n.childForFieldName?.("name")
      if (named && named.text) {
        defsWithNameField++
        const errorScope = errorScopeOf(named, n)
        const nameInError = errorScope !== "none"
        const first = n.namedChildCount > 0 ? n.namedChild(0) : null
        const firstChildError = first?.type === "ERROR"
        const damagedInside = hasErrorBelow(n)
        if (nameInError || firstChildError || damagedInside) {
          sites.push({
            file: `${f.repo}/${f.rel}`,
            line: n.startPosition.row + 1,
            name: named.text,
            nameInError,
            errorScope,
            firstChildError,
            damagedInside,
          })
        }
      }
    }
    for (let j = n.childCount - 1; j >= 0; j--) {
      const c = n.child(j)
      if (c) stack.push(c)
    }
  }
  tree.delete?.()
}

const inError = sites.filter(s => s.nameInError)
const firstErr = sites.filter(s => s.firstChildError && !s.nameInError)
const cleanDamaged = sites.filter(s => !s.nameInError && !s.firstChildError && s.damagedInside)

const external = inError.filter(s => s.errorScope === "external")
const internal = inError.filter(s => s.errorScope === "internal")
const filesHit = new Set(inError.map(s => s.file))

console.log(`function_definition nodes            ${defs}`)
console.log(`  \`name:\` field resolved            ${defsWithNameField}  (${pct(defsWithNameField, defs)})`)
console.log(`  name node inside an ERROR span     ${inError.length}  (${pct(inError.length, defs)} of definitions)`)
console.log(`    ERROR span starts BEFORE the def ${external.length}   the definition is INTACT`)
console.log(`    ERROR span starts AT the def      ${internal.length}   the definition is DAMAGED`)
console.log(`    distinct files involved            ${filesHit.size}`)
console.log(`  first named child is an ERROR      ${firstErr.length}`)
console.log(`  damaged inside, name field clean   ${cleanDamaged.length}\n`)

if (inError.length === 0) {
  console.log("no name resolves through an ERROR node on this sample — the field rule holds")
} else {
  // Per file, ask production `parseFile` what it publishes.
  //
  // `alsoDeclaredCleanly` is deliberately NOT a verdict column and must not be
  // read as one. A nested `function clipcopy() { … }` inside an `if` branch is
  // the ONLY definition of `clipcopy` in its file, so `alsoDeclaredCleanly=no` is
  // the expected answer for every nested site and says nothing about whether the
  // declaration is real. The first version of this probe read that column as
  // "exists only inside error recovery" and printed a conclusion — "427
  // declarations exist ONLY inside error recovery" — which the source lines
  // falsify: `ohmyzsh/lib/clipboard.zsh:55` is plain valid bash and a minimal
  // fixture of it parses CLEANLY. The column is kept because it is cheap and
  // separable, with this note on what it does and does not mean.
  const byFile = new Map<string, Site[]>()
  for (const s of inError) {
    let a = byFile.get(s.file)
    if (!a) {
      a = []
      byFile.set(s.file, a)
    }
    a.push(s)
  }
  let published = 0
  let onlyInError = 0
  let shown = 0
  console.log("per site — PUBLISHED by parseFile, and ALSO declared by well-formed syntax?\n")
  for (const [file, ss] of byFile) {
    const abs = path.join(CR, file)
    let names: string[] = []
    let edges = 0
    try {
      const res: any = await parseFile(abs)
      names = (res?.symbols ?? []).map((s: any) => s.name)
      edges = (res?.relationships ?? []).length
    } catch {
      /* reported as a throw below */
    }
    // Names declared by a definition the grammar placed CLEANLY: re-walk and keep
    // the function_definition nodes whose name field has no ERROR above it.
    const cleanNames = new Set<string>()
    {
      const tree = parser.parse(files.find(x => `${x.repo}/${x.rel}` === file)!.text)
      const st: any[] = [tree.rootNode]
      while (st.length > 0) {
        const n = st.pop()!
        if (n.type === "function_definition") {
          const named = n.childForFieldName?.("name")
          if (named && named.text && !hasErrorAboveLocal(named)) cleanNames.add(named.text)
        }
        for (let j = 0; j < n.childCount; j++) {
          const c = n.child(j)
          if (c) st.push(c)
        }
      }
      tree.delete?.()
    }
    for (const s of ss) {
      const isPublished = names.includes(s.name)
      const alsoClean = cleanNames.has(s.name)
      if (isPublished) published++
      if (isPublished && !alsoClean) onlyInError++
      if (shown++ < EXAMPLES) {
        console.log(
          `  ${file}:${s.line}  "${s.name}"  published=${isPublished ? "YES" : "no "}  alsoDeclaredCleanly=${alsoClean ? "yes" : "NO "}  fileRels=${edges}`,
        )
      }
    }
  }
  console.log(
    `\nnames whose node sits inside an ERROR span: ${inError.length}   PUBLISHED by parseFile: ${published}`,
  )
  console.log(
    `  external damage ${external.length} · internal damage ${internal.length} · published ${published}`,
  )
  console.log(
    published === inError.length
      ? "→ the analyzer publishes EVERY name the grammar labelled, damaged span or not."
      : `→ ${inError.length - published} names the grammar labelled were NOT published — a recall gap`,
  )
  console.log(
    "\nThis probe does NOT claim these are fabrications. Read `ohmyzsh/lib/clipboard.zsh:55`:\n" +
      "  function clipcopy() { cat \"${1:-/dev/stdin}\" | pbcopy; }\n" +
      "which is valid bash, nested in an `if`, and which the pinned grammar parses\n" +
      "CLEANLY once the enclosing zsh `(( ${+commands[…]} ))` condition is removed. The\n" +
      "ERROR belongs to that condition and its SPAN swallows the names. A guard that\n" +
      "refused names from damaged regions — the change limitation 33's phrasing\n" +
      "invites — would delete these declarations. See this file's header for the\n" +
      "6 hand-read internal cases, which are valid bash too.",
  )
}

function pct(n: number, d: number): string {
  return d === 0 ? "n/a" : `${((100 * n) / d).toFixed(1)}%`
}

function hasErrorAboveLocal(n: any): boolean {
  let c = n?.parent
  while (c) {
    if (c.type === "ERROR") return true
    c = c.parent
  }
  return false
}

function createHashOf(s: string): string {
  return createHash("sha256").update(s).digest("hex")
}
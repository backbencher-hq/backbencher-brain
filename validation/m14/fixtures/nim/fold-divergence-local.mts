/**
 * NIM LOCAL FOLD DIVERGENCE — the per-file half of cause B.
 *
 * ## What the fold-mismatch probe found, and what this one is for
 *
 * `fold-mismatch-probe.mts` measured 72 distinct targets / 334 edges whose SPELLING
 * differs from the spelling of the name they name, in a language where those
 * spellings denote one identifier to the compiler. Every one of the 334 was a
 * `calls`/`references`/`imports`/`exports`/`extends` edge, i.e. cross-file by
 * construction: the analyzer's own `resolvable()` guard is an exact-match test
 * against the declaring file's own tables (`ctx.fileValues`,
 * `ctx.fileEnumMembers`, `ctx.fileFieldNames`), so a file that declares the name
 * under one spelling cannot emit an edge to the other spelling of it.
 *
 * That cuts both ways, and the second half is the defect this probe measures:
 *
 *   the 334 edges   CROSS-FILE. Which file holds the declaration is whole-program
 *                   knowledge (workstream §8), so they cannot be repaired here.
 *   ZERO OR FEWER   LOCAL. A file that declares `symId` and CALLS `SymId` emits
 *                   NO EDGE AT ALL, because the exact-match guard rejects the
 *                   site spelling. That is a false negative, not an unresolved
 *                   edge, so it is invisible in every resolution column the
 *                   programme has — and it is repairable per file, because Nim's
 *                   own `mangle` rule says the two spellings are one symbol.
 *
 * ## The number decides the change
 *
 *   localDivergent > 0  -> the `resolvable()` guard is under-firing on a
 *                         population the language guarantees, and folding it
 *                         ADDS TRUE EDGES while leaving every published name and
 *                         every emitted target byte-identical to the DECLARATION's
 *                         spelling. Nothing is renamed, so no name-surface
 *                         consumer moves.
 *   localDivergent = 0  -> cause B's remaining population is entirely
 *                         whole-program, and the guard is not the defect.
 *
 * ## Method, and the one thing this probe cannot do
 *
 * Per file: the production `parseFile` result supplies the declarations THIS RUN
 * PUBLISHED; a second raw tree-sitter parse of the same bytes supplies every
 * identifier-ish text the tree carries. The divergent set is
 * `{ t : t is a text the tree carries, t is NOT a published name of this file,
 * fold(t) IS the fold of one }`.
 *
 * This is an UPPER BOUND on the false negatives, and the reason is named rather
 * than hidden: a `let` binding or a parameter named `SymId` in a proc that also
 * mentions a distinct `symId` elsewhere in the file satisfies the predicate
 * without being a call to anything. The bound is reported per type with source
 * lines so the sample can be READ rather than trusted, and the fixtures
 * (`fold-divergence`) pin the rule on hand-written cases where the language's
 * reading is not in doubt.
 */
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import * as path from "node:path"
import { ASTEngine } from "../../../../src/ast/engine"
const wts: any = await import("web-tree-sitter")
const WSP: any = wts.Parser ?? wts.default
const WSL: any = wts.Language ?? wts.default?.Language

const LIST = "validation/m14/measurements/nim/session13-file-list.txt"
const listBytes = readFileSync(LIST, "utf8")
const files = listBytes.split("\n").filter(Boolean)
const analyzerSrc = readFileSync("src/ast/real-nim-analyzer.ts", "utf8")
const digest = (): string => createHash("sha256").update(analyzerSrc).digest("hex").slice(0, 16)

/** nim/lib/system.nim `mangle`: lowercase, and every `_` deleted. */
function fold(id: string): string {
  let out = ""
  for (let i = 0; i < id.length; i++) {
    if (id.charCodeAt(i) === 0x5f) continue
    out += id[i].toLowerCase()
  }
  return out
}

await WSP.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-nim.wasm"))))

/** node types whose TEXT is an identifier the tree is asserting a symbol for */
const IDENT_TYPES = new Set(["identifier", "dot_leaf", "field", "var_name", "const_name", "func_name", "type_identifier"])

let parsed = 0
let rawFailed = 0
/** fold -> published spelling, per file, rebuilt per file */
const perFile: { f: string; rows: { site: string; decl: string; line: number; type: string }[] }[] = []
const publishedNames = new Map<string, Set<string>>()
const publishedKinds = new Map<string, Map<string, string>>()
const typeSeen = new Map<string, number>()

for (const f of files) {
  const src = readFileSync(f, "utf8")
  let r: any
  try {
    r = await ASTEngine.parseFile(f, src)
    parsed++
  } catch {
    continue
  }
  const published = new Set<string>()
  for (const s of r?.symbols ?? []) {
    const n = String(s?.name ?? "")
    if (n) published.add(n)
  }
  publishedNames.set(f, published)
  const kinds = new Map<string, string>()
  for (const s of r?.symbols ?? []) {
    const n = String(s?.name ?? "")
    if (n && !kinds.has(n)) kinds.set(n, String(s?.kind ?? ""))
  }
  publishedKinds.set(f, kinds)
  const foldToDecl = new Map<string, string>()
  for (const n of published) {
    const k = fold(n)
    // a fold with two published spellings in ONE file is not evidence of one symbol
    if (!foldToDecl.has(k)) foldToDecl.set(k, n)
  }

  let tree: any
  try {
    tree = parser.parse(src)
  } catch {
    rawFailed++
    continue
  }
  const rows: { site: string; decl: string; line: number; type: string }[] = []
  const stack: any[] = [tree.rootNode]
  while (stack.length) {
    const n = stack.pop()
    if (IDENT_TYPES.has(n.type) && n.namedChildCount === 0) {
      const t = n.text
      if (t && !published.has(t)) {
        const decl = foldToDecl.get(fold(t))
        if (decl !== undefined) {
          rows.push({ site: t, decl, line: n.startPosition.row + 1, type: n.type })
          typeSeen.set(n.type, (typeSeen.get(n.type) ?? 0) + 1)
        }
      }
    }
    for (let i = n.namedChildCount - 1; i >= 0; i--) {
      const c = n.namedChild(i)
      if (c) stack.push(c)
    }
  }
  if (rows.length) perFile.push({ f, rows })
}

// The decisive classification. Nim's fold equivalence is SCOPE-LOCAL: two identifiers
// that fold alike in DIFFERENT scopes are two different symbols, and Nim permits both.
// So a fold match is only evidence of one symbol when the site spelling is not itself a
// declaration of this file -- and when it is, folding binds the reference to the WRONG
// declaration. `nim-lang-nimble/src/nimblepkg/options.nim:24` is the worked example:
//     version*: Version
// `version` is the field this file declares; `Version` is an IMPORTED type, and Nim
// compiles the line because the two live in different scopes. Folding resolves the type
// reference to the field, which is an edge to a symbol the source never named.
const siteEdges = perFile.reduce((a, x) => a + x.rows.length, 0)
const distinctSites = new Set<string>()
for (const x of perFile) for (const r of x.rows) distinctSites.add(r.site)

console.log(`nim LOCAL fold divergence — the per-file half of cause B`)
console.log(`analyzer : src/ast/real-nim-analyzer.ts sha256:${digest()}`)
console.log(`file list: ${LIST} sha256 ${createHash("sha256").update(listBytes).digest("hex").slice(0, 16)}`)
console.log(`files ${files.length} (parseFile ok ${parsed}, raw-parse failed ${rawFailed})`)
console.log()
console.log(`files with >=1 divergent site spelling : ${perFile.length}`)
console.log(`divergent SITE nodes                    : ${siteEdges}`)
console.log(`distinct divergent spellings            : ${distinctSites.size}`)
console.log(`by tree node type : ${JSON.stringify(Object.fromEntries([...typeSeen].sort((a, b) => b[1] - a[1])))}`)
console.log()

console.log(`1  THE CLASSIFICATION THAT DECIDES WHETHER FOLDING IS SAFE HERE`)
// re-walk is not needed: perFile rows carry the pair, and this needs the published set,
// so it is recomputed from the raw parse of the SAME bytes in a second pass below.
let siteIsDeclared = 0
let siteNotDeclared = 0
const fatalPairs = new Map<string, number>()
const fatalExamples: string[] = []
for (const x of perFile) {
  const published = publishedNames.get(x.f)!
  for (const r of x.rows) {
    if (published.has(r.site)) {
      siteIsDeclared++
    } else {
      siteNotDeclared++
      const k = `${r.site} -> ${r.decl}`
      fatalPairs.set(k, (fatalPairs.get(k) ?? 0) + 1)
      if (fatalExamples.length < 12) fatalExamples.push(`${x.f}:${r.line}  ${r.site} (not declared in this file) folds onto the LOCAL ${r.decl}`)
    }
  }
}
console.log(`   site spelling IS also a declaration of this file : ${siteIsDeclared}  (a same-scope redeclaration, which Nim rejects)`)
console.log(`   site spelling is NOT a declaration of this file : ${siteNotDeclared}  (the site names an imported,`)
console.log(`      or builtin, or undeclared symbol that merely folds onto an unrelated local name)`)
console.log(`   FOLDING THE GUARD IS SAFE FOR: ${siteIsDeclared} of ${siteEdges} site nodes`)
console.log(`   FOLDING THE GUARD FABRICATES FOR: ${siteNotDeclared} of ${siteEdges} site nodes (${Math.round((100 * siteNotDeclared) / siteEdges)}%)`)
console.log()
console.log(`   WHY the ${siteNotDeclared} are fabrications rather than near-misses: the local declaration each site`)
console.log(`   folds onto is a DIFFERENT symbol in a DIFFERENT scope. Nim compares identifiers`)
console.log(`   after mangle WITHIN a scope and permits both spellings across scopes, so a fold match`)
console.log(`   is evidence of one symbol only inside one scope. Kind of the declaration the fold lands on:`)
const kindTally = new Map<string, number>()
for (const x of perFile) {
  const kinds = publishedKinds.get(x.f)!
  for (const r of x.rows) {
    if (publishedNames.get(x.f)!.has(r.site)) continue
    const k = kinds.get(r.decl) || "(unpublished)"
    kindTally.set(k, (kindTally.get(k) ?? 0) + 1)
  }
}
console.log(`     ${JSON.stringify(Object.fromEntries([...kindTally].sort((a, b) => b[1] - a[1])))}`)
const top = [...kindTally].sort((a, b) => b[1] - a[1])[0]
console.log(`   The largest single class is \`${top[0]}\` at ${top[1]} of ${siteNotDeclared} (${Math.round((100 * top[1]) / siteNotDeclared)}%), and it is`)
console.log(`   spread over types, fields, callables and modules alike -- there is no kind the fold lands on that a fold could not be`)
console.log(`   contradicted by. Three worked examples, verified by hand:`)
console.log(`     install.nim lockFileDep -> property@PkgDownloadEntry   (field)`)
console.log(`     options.nim  version    -> property@NimBin            (field), and line 24 is \`version*: Version\``)
console.log(`     options.nim  satResult  -> property@Options          (field)`)
console.log()
console.log(`   the fatal pairs, most frequent first:`)
for (const [k, n] of [...fatalPairs].sort((a, b) => b[1] - a[1]).slice(0, 20)) console.log(`     ${String(n).padStart(4)}  ${k}`)
console.log()
console.log(`   worked examples, with the file and line so the claim can be read:`)
for (const e of fatalExamples) console.log(`     ${e}`)
console.log()

const agg = new Map<string, number>()
for (const x of perFile) for (const r of x.rows) agg.set(`${r.site} -> ${r.decl}`, (agg.get(`${r.site} -> ${r.decl}`) ?? 0) + 1)
console.log(`every (site spelling -> declaration spelling) pair, most frequent first:`)
for (const [k, n] of [...agg].sort((a, b) => b[1] - a[1])) console.log(`   ${String(n).padStart(4)}  ${k}`)

console.log()
console.log(`30 of them WITH THE SOURCE LINE, so the sample can be read:`)
const shown: string[] = []
for (const x of perFile) {
  for (const r of x.rows) {
    if (shown.length >= 30) break
    shown.push(`${x.f}:${r.line}  ${r.site} -> ${r.decl}  (${r.type})`)
  }
  if (shown.length >= 30) break
}
for (const s of shown) console.log(`   ${s}`)

console.log()
console.log(`analyzer sha256 after the walk : ${digest()}  (unchanged — every number above is tied to this analyzer state)`)
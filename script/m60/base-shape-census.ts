// script/m60/base-shape-census.ts — what each lane NAMES when a class's BASE is
// not a plain name (M60 OO wave; the callee census's twin, found by #902).
//
// WHY THIS EXISTS
// ---------------
// #902 was the CALL position: a python analyzer named the first named child of a
// callee whatever its shape, so `(f if c else g)()` published `calls -> f`. Fixing
// it made the differential's next disagreement visible immediately, and it is the
// SAME rule in the BASE position:
//
//     class T(namedtuple('Tbase', 'a')):      # cython:python, measured
//         ...
//
// The analyzer's `baseClassLeaf` falls through to `namedChild(0)` for any shape it
// does not list, so the base list of that class yields `extends T -> namedtuple` —
// naming the FACTORY FUNCTION as the parent class. `namedtuple` is not a class and
// `T` does not inherit from it; the base is the anonymous class the call RETURNS.
// The differential's oracle names a base only for `identifier`, `subscript`
// (`Base[T]` -> Base) and `attribute` (`mod.Base` -> Base), so it derives nothing
// here and the edge is the python lane's one UNEXPLAINED edge on the rotation slice
// that replaced #902's.
//
// Which side is wrong is a FAMILY question, not a python one — the same question
// #902 asked about callees: a base that is a CALL has no statically written name,
// and naming the called function is a category error (a function is not a class).
// Every lane with a heritage clause answers it somewhere in its class walk, and
// nothing measured whether they answer it the same way. This census feeds each lane
// the same BASE shapes and records what it actually names — the analyzer's
// behaviour, not its source, so a lane cannot pass by looking right.
//
// SHAPES (per lane; `K` is the class under test, and all referenced names exist, so
// a correct `extends` edge is reachable)
//   control    `class K(Base)`                    — must yield `extends K -> Base`
//   subscript  `class K(Base[T])`                 — `Base` (the generic head)
//   attribute  `class K(mod.Base)`                — `Base` (the dotted leaf)
//   call       `class K(factory('FB', 'a'))`      — NOT statically a name: the base
//                                                   is the anonymous class the call
//                                                   returns, so naming the FACTORY
//                                                   (or its first argument's string)
//                                                   is a fabrication
//   keyword    `class K(Base, total=False)`       — `total` is a KEYWORD, not a base
//                                                   (python PYD6 already ruled this;
//                                                   the cell makes it pinnable in
//                                                   every lane that has the form)
//
// A lane whose grammar cannot write a shape is recorded `n/a` WITH the reason, never
// silently omitted — a language whose heritage clause takes a TYPE REFERENCE cannot
// write a call base, and that is a grammar exemption, not a choice.
//
// BOUNDARIES, DISCLOSED
// ---------------------
//   * Snippets, not corpora, for the cross-lane table: it measures the CONTRACT, not
//     how often a corpus exercises it. The `--corpus` pass below measures the python
//     corpus frequency of the `call` shape, which is what the ruling needs.
//   * `extends` only, and only names: the question is which NAME a non-name base
//     produces. `contains`/`overrides` are downstream of it and out of scope.
//   * A cell reading `(none)` is not a defect by itself — refusing to name a base
//     that carries no static name is the rule this census is measuring compliance
//     with. Only a lane that NAMES a non-name base (the factory of a call base, a
//     keyword's name) is a finding.
//
// Run: bun script/m60/base-shape-census.ts            (probe; writes no artifact)
//      bun script/m60/base-shape-census.ts --corpus   (adds the python corpus pass)
// Exit: 0 always — this is a census, the ruling it informs is a separate round.
import { mkdirSync, writeFileSync, rmSync, readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const TMP = path.join(ROOT, "script/m14/tmp/.base-shapes")
const CORPUS_ROOT = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"

type Shape = "control" | "subscript" | "attribute" | "call" | "keyword"

/**
 * Per language: the extension ASTEngine routes on, the class name the shapes
 * declare, and one source per shape. `null` means the language's grammar cannot
 * write that shape (the reason is in SHAPE_NA).
 */
export const BASE_SNIPPETS: Record<string, { ext: string; owner: string; shapes: Record<Shape, string | null> }> = {
  python: {
    ext: ".py",
    owner: "K",
    shapes: {
      control: "class Base:\n    pass\n\nclass K(Base):\n    pass\n",
      subscript: "class T:\n    pass\n\nclass Base:\n    pass\n\nclass K(Base[T]):\n    pass\n",
      attribute: "class Base:\n    pass\n\nclass mod:\n    pass\n\nclass K(mod.Base):\n    pass\n",
      call: "class Base:\n    pass\n\ndef factory(name, fields):\n    return Base\n\nclass K(factory('FB', 'a')):\n    pass\n",
      keyword: "class Base:\n    pass\n\nclass K(Base, total=False):\n    pass\n",
    },
  },
  javascript: {
    ext: ".js",
    owner: "K",
    shapes: {
      control: "class Base {}\nclass K extends Base {}\n",
      subscript: null, // JS has no generics: `extends Base[T]` is a member expression, not a base
      attribute: "class Base {}\nclass mod {}\nclass K extends mod.Base {}\n",
      call: "class Base {}\nfunction factory(name, fields){ return Base }\nclass K extends factory('FB', 'a') {}\n",
      keyword: null, // no keyword arguments in a heritage clause
    },
  },
  typescript: {
    ext: ".ts",
    owner: "K",
    shapes: {
      control: "class Base {}\nclass K extends Base {}\n",
      subscript: "class Base<T> {}\nclass K extends Base<number> {}\n",
      attribute: "namespace mod { export class Base {} }\nclass K extends mod.Base {}\n",
      call: "class Base {}\nfunction factory(name: string, fields: string): any { return Base }\nclass K extends factory('FB', 'a') {}\n",
      keyword: null, // no keyword arguments in a heritage clause
    },
  },
  php: {
    ext: ".php",
    owner: "K",
    shapes: {
      control: "<?php\nclass Base {}\nclass K extends Base {}\n",
      subscript: null, // `extends` takes a name, never a subscript expression
      attribute: "<?php\nnamespace NS;\nclass Base {}\n\nclass K extends \\NS\\Base {}\n",
      call: null, // `extends` takes a name; a call is not a valid parent
      keyword: null, // no keyword arguments in a heritage clause
    },
  },
  ruby: {
    ext: ".rb",
    owner: "K",
    shapes: {
      control: "class Base\nend\n\nclass K < Base\nend\n",
      subscript: null, // `Base[T]` is an element-reference SEND (`Base.[](T)`), not a generic base
      attribute: "module Mod\n  class Base\n  end\nend\n\nclass K < Mod::Base\nend\n",
      call: "class Base\nend\n\ndef factory(name, fields)\n  Base\nend\n\nclass K < factory('FB', 'a')\nend\n",
      keyword: null, // no keyword arguments in a heritage clause
    },
  },
  java: {
    ext: ".java",
    owner: "K",
    shapes: {
      control: "class Base {}\nclass K extends Base {}\n",
      subscript: "class Base<T> {}\nclass K extends Base<String> {}\n",
      attribute: "class Outer { static class Base {} }\nclass K extends Outer.Base {}\n",
      call: null, // `extends` takes a type name; a call is not a type
      keyword: null, // no keyword arguments in a heritage clause
    },
  },
  csharp: {
    ext: ".cs",
    owner: "K",
    shapes: {
      control: "class Base {}\nclass K : Base {}\n",
      subscript: "class Base<T> {}\nclass K : Base<string> {}\n",
      attribute: "namespace NS { class Base {} }\nclass K : NS.Base {}\n",
      call: null, // a base list entry is a type; a call is not
      keyword: null, // no keyword arguments in a heritage clause
    },
  },
  dart: {
    ext: ".dart",
    owner: "K",
    shapes: {
      control: "class Base {}\nclass K extends Base {}\n",
      subscript: "class Base<T> {}\nclass K extends Base<int> {}\n",
      attribute: null, // dart heritage names a library-resolved type, not a dotted expression
      call: null, // `extends` takes a type; a call is not a type
      keyword: null, // no keyword arguments in a heritage clause
    },
  },
  swift: {
    ext: ".swift",
    owner: "K",
    shapes: {
      control: "class Base {}\nclass K: Base {}\n",
      subscript: "class Base<T> {}\nclass K: Base<Int> {}\n",
      attribute: null, // a superclass names a type, not a dotted expression
      call: null, // a superclass names a type; a call is not a type
      keyword: null, // no keyword arguments in a heritage clause
    },
  },
}

const SHAPE_NA: Record<string, string> = {
  "javascript:subscript": "JavaScript has no generics: `extends Base[T]` is a member expression, not a base",
  "javascript:keyword": "no keyword arguments in a heritage clause",
  "typescript:keyword": "no keyword arguments in a heritage clause",
  "php:subscript": "`extends` takes a name, never a subscript expression",
  "php:call": "`extends` takes a name; a call is not a valid parent",
  "php:keyword": "no keyword arguments in a heritage clause",
  "ruby:subscript": "`Base[T]` is an element-reference SEND (`Base.[](T)`), not a generic base",
  "ruby:keyword": "no keyword arguments in a heritage clause",
  "java:call": "`extends` takes a type name; a call is not a type",
  "java:keyword": "no keyword arguments in a heritage clause",
  "csharp:call": "a base list entry is a type; a call is not",
  "csharp:keyword": "no keyword arguments in a heritage clause",
  "dart:attribute": "dart heritage names a library-resolved type, not a dotted expression",
  "dart:call": "`extends` takes a type; a call is not a type",
  "dart:keyword": "no keyword arguments in a heritage clause",
  "swift:attribute": "a superclass names a type, not a dotted expression",
  "swift:call": "a superclass names a type; a call is not a type",
  "swift:keyword": "no keyword arguments in a heritage clause",
}

/** Every `.py` under a repo checkout (no regex; skips dot-directories). */
function pythonFiles(dir: string): string[] {
  const out: string[] = []
  const walk = (d: string) => {
    let names: string[]
    try { names = readdirSync(d) } catch { return }
    for (const name of names) {
      if (name.startsWith(".")) continue
      const p = path.join(d, name)
      let st: any
      try { st = statSync(p) } catch { continue }
      if (st.isDirectory()) walk(p)
      else if (name.endsWith(".py")) out.push(p)
    }
  }
  walk(dir)
  return out
}

/**
 * The corpus pass: how often the python corpus writes a class whose base is a CALL,
 * and which factories it names. This is the measurement the ruling rests on — the
 * cross-lane table above measures the contract, not the occurrence rate. Reports the
 * node type of EVERY base-list entry as a histogram so the frequency of the shapes
 * the analyzer lists (identifier/subscript/attribute) is visible beside the one it
 * does not (call).
 */
async function corpusPass(parse: (file: string, src: string) => any, parser: any) {
  const repos = ["cython", "requests"]
  const hist = new Map<string, number>()
  const sites: Array<{ repo: string; file: string; line: number; factory: string }> = []
  let files = 0
  let classBases = 0
  for (const repo of repos) {
    for (const file of pythonFiles(path.join(CORPUS_ROOT, repo))) {
      let src: string
      try { src = readFileSync(file, "utf8") } catch { continue }
      files++
      const tree = parser.parse(src)
      if (!tree?.rootNode) continue
      const stack: any[] = [tree.rootNode]
      while (stack.length > 0) {
        const n = stack.pop()!
        if (n.type === "class_definition") {
          const args = n.namedChildren.find((c: any) => c.type === "argument_list")
          if (args) {
            for (let i = 0; i < args.namedChildCount; i++) {
              const arg = args.namedChild(i)
              if (!arg) continue
              classBases++
              hist.set(arg.type, (hist.get(arg.type) ?? 0) + 1)
              if (arg.type === "call") {
                // The callee leaf of the base call — what the pre-fix analyzer names.
                let fn = arg.namedChild(0)
                while (fn && fn.type === "parenthesized_expression" && fn.namedChildCount >= 1) fn = fn.namedChild(0)
                const factory = fn?.type === "identifier" ? fn.text : fn?.type === "attribute" ? fn.namedChild(fn.namedChildCount - 1)?.text : "<computed>"
                sites.push({
                  repo, file: path.relative(path.join(CORPUS_ROOT, repo), file),
                  line: arg.startPosition.row + 1, factory: factory ?? "?",
                })
              }
            }
          }
        }
        for (let i = 0; i < n.namedChildCount; i++) stack.push(n.namedChild(i))
      }
    }
  }
  console.log(`\n[corpus] python base-list entries: ${classBases} across ${files} file(s) in ${repos.join("+")}`)
  for (const [type, n] of [...hist.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  base arg node type ${type.padEnd(22)} ${n}`)
  }
  console.log(`\n[corpus] CALL bases (the shape whose factory the analyzer names): ${sites.length}`)
  for (const s of sites.slice(0, 40)) console.log(`  ${s.repo}/${s.file}:${s.line}  factory=${s.factory}`)
  if (sites.length > 40) console.log(`  … +${sites.length - 40} more`)
  return { classBases, files, sites }
}

async function main() {
  rmSync(TMP, { recursive: true, force: true })
  mkdirSync(TMP, { recursive: true })
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))

  const rows: any[] = []
  for (const [lang, spec] of Object.entries(BASE_SNIPPETS)) {
    const cells: Record<string, string> = {}
    for (const shape of Object.keys(spec.shapes) as Shape[]) {
      const src = spec.shapes[shape]
      if (src === null) { cells[shape] = "n/a"; continue }
      const file = path.join(TMP, `snippet-${lang}-${shape}${spec.ext}`)
      writeFileSync(file, src)
      let rels: any[] = []
      try {
        const res: any = await ASTEngine.parseFile(file, src)
        rels = res?.relationships ?? []
      } catch (e: any) {
        cells[shape] = `error(${String(e?.message ?? e).slice(0, 40)})`
        continue
      }
      // The edge's SOURCE is the class being defined (`K`), so attribute by that —
      // not by line, which closes at different places per language (ruby's `end`).
      const owner = spec.owner
      const bases = rels
        .filter((r) => (r.type ?? r.relationshipType) === "extends")
        .filter((r) => {
          const from = String(r.fromSymbol ?? r.source ?? r.from ?? "")
          return from === owner || from.endsWith("." + owner) || from.toLowerCase() === owner.toLowerCase()
        })
        .map((r) => `${String(r.target)}@${r.line_number ?? r.line ?? 0}`)
        .sort()
      cells[shape] = bases.length ? bases.join("+") : "(none)"
    }
    rows.push({ lang, owner: spec.owner, cells })
    console.log(
      `${lang.padEnd(11)} control=${(cells.control ?? "?").padEnd(16)} subscript=${(cells.subscript ?? "?").padEnd(16)} `
      + `attribute=${(cells.attribute ?? "?").padEnd(16)} call=${(cells.call ?? "?").padEnd(20)} keyword=${cells.keyword}`,
    )
  }
  rmSync(TMP, { recursive: true, force: true })

  const targetsOf = (row: any, shape: Shape): string[] => {
    const cell = String(row.cells[shape] ?? "")
    // `n/a` is not a measurement: a shape a language cannot write is exempt by
    // grammar. Treating it as a target convicts lanes for the string "n/a".
    if (cell === "n/a" || cell === "(none)" || cell.startsWith("error(")) return []
    return cell.split("+").map((c) => c.slice(0, c.lastIndexOf("@")))
  }
  const lower = (row: any, shape: Shape) => targetsOf(row, shape).map((s) => s.toLowerCase())
  // Finding 1: a CALL base must name NOTHING (the #902 rule in the base position).
  // Naming the factory function is a category error — a function is not a class.
  //
  // The two ways a lane can name one are different defects and are reported
  // separately, because the repo has already ruled on one of them: a lane that
  // publishes a bare leaf (python `factory`) is naming a symbol the base is not,
  // while a lane that publishes the call's SOURCE TEXT (`factory('FB', 'a')`) is
  // publishing a target no symbol could ever carry — that is R10's recorded
  // `delimiter`/`literal` class (21-of-24-lane measured, javascript/typescript
  // already convicted there), so it is REPORTED here and not convicted twice.
  const R10_DELIMITERS = ["(", ")", "[", "]", "{", "}", ",", ";", "'", '"', "<", ">"]
  const hasDelimiter = (t: string) => R10_DELIMITERS.some((d) => t.includes(d))
  const callNamed: string[] = []
  const callNamedR10: string[] = []
  for (const row of rows) {
    const targets = targetsOf(row, "call")
    if (targets.length === 0) continue
    if (targets.some(hasDelimiter)) callNamedR10.push(`${row.lang}: publishes the call base's SOURCE TEXT (${targets.join("+")})`)
    else callNamed.push(`${row.lang}: names a CALL BASE's factory (${targets.join("+")})`)
  }
  // Finding 2: a KEYWORD argument is not a base (PYD6) — must never appear as a target.
  const kwNamed = rows.filter((r) => lower(r, "keyword").some((s) => s === "total" || s === "false"))
    .map((r) => `${r.lang}: names a KEYWORD as a base (${targetsOf(r, "keyword").join("+")})`)
  // `subscript`/`attribute` name the static leaf; NOT adjudicated as a target SPELLING here
  // (a lane that publishes `Base[T]` or `mod.Base` verbatim is the delimiter class R10
  // convicts, reported not convicted).
  const dottedOrBracketed = rows.filter((r) =>
    targetsOf(r, "subscript").some((s) => s.includes("[")) || targetsOf(r, "attribute").some((s) => s.includes(".")))
    .map((r) => r.lang)
  const controlMissing = rows.filter((r) => !lower(r, "control").includes("base")).map((r) => r.lang)

  console.log(`\nlanes measured: ${rows.length} | control missing (lane did not walk heritage): ${controlMissing.join(", ") || "none"}`)
  console.log(`names a CALL BASE's factory as a bare symbol (a finding — must name NOTHING): ${callNamed.length ? callNamed.join(" | ") : "none"}`)
  console.log(`names a CALL BASE by its source TEXT (R10's recorded delimiter class — reported, not convicted here): ${callNamedR10.length ? callNamedR10.join(" | ") : "none"}`)
  console.log(`names a KEYWORD as a base (PYD6): ${kwNamed.length ? kwNamed.join(" | ") : "none"}`)
  console.log(`publishes the generic/dotted base WITH its brackets (R10 delimiter class — reported, not convicted): ${dottedOrBracketed.join(", ") || "none"}`)
  console.log(`n/a shapes are recorded with their reason in SHAPE_NA (${Object.keys(SHAPE_NA).length} entries)`)

  if (process.argv.includes("--corpus")) {
    const wts: any = await import("web-tree-sitter")
    const ParserClass = wts.Parser ?? wts.default ?? wts
    const Language = wts.Language ?? wts.default?.Language
    await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
    const grammar = await Language.load(readFileSync(path.join(ROOT, "wasm", "tree-sitter-python.wasm")))
    const parser = new ParserClass()
    parser.setLanguage(grammar)
    await corpusPass(async (_f, s) => null, parser)
  }
}

if (import.meta.main) main()

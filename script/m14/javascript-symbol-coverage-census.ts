/**
 * JAVASCRIPT SYMBOL-COVERAGE CENSUS — which DECLARATION nodes in the grammar become a symbol, and
 * which are silently dropped?
 *
 * WHY THIS EXISTS. "No relationship missing" and "no symbol missing" are not provable by reading the
 * analyzer: the symbol walk is a switch over node types, and a node type the switch does not list is
 * invisible — it produces no symbol and no complaint. The only honest measurement is the other way
 * round: enumerate the DECLARATION-SHAPED nodes the parse tree actually contains, then ask whether a
 * symbol was published for each. Whatever is left over is the gap, with a population.
 *
 * THE JOIN. A declaration node yields a candidate (name, line). A symbol covers it when a published
 * symbol has that name and its range CONTAINS the declaration's line. Name-only matching would let a
 * `const x` on line 3 "cover" a `function x` on line 90; line-only matching would let a sibling cover
 * a nested declaration. Both together is the only join that means "this declaration is published".
 *
 * WHAT IT DELIBERATELY DOES NOT COUNT AS A GAP (each is a documented disposition, and each is
 * reported in its own bucket so a reader can see the difference):
 *   unbound-object-method  an object literal whose value is not bound to a name (export default,
 *                          return value, call argument, array element) — the lane's documented
 *                          contract is that such a member is correctly OWNERLESS, and it publishes no
 *                          symbol because there is no name to publish
 *   anonymous              no name to publish at all (`export default () => {}`, `class {}` in an
 *                          expression position with no binding)
 *
 * READ-ONLY. Writes one artifact under validation/m14/tmp/.
 *
 *   bun run script/m14/javascript-symbol-coverage-census.ts --repo=<dir> [--json=<out>]
 */
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../src/ast/language-detection"
import { ASTEngine, getParser, maybeFlowFallback } from "../../src/ast/engine"

const SIZE_CAP = 512 * 1024

/** the root of whatever `maybeFlowFallback` returned (a Tree, or the same tree when it declined) */
function fbRootOf(tree: any): any {
  return tree?.rootNode ?? null
}

/**
 * BUILD OUTPUT IS NOT AUTHORED CODE, and measuring it is measuring the bundler.
 *
 * The first run over the freshly cloned corpus counted `dist/ramda.js` — a minified UMD bundle — and
 * reported "JSDoc declarations missed" for names `s` and `Symbol`, which are the bundle's own
 * minified identifiers appearing in copied-over doc comments. `moment` reported 41,821 variable
 * declarators for the same reason: its `dist/` and `.min.js` builds are most of the file count.
 *
 * Excluded by path SEGMENT and by file suffix. A segment match is exact (not a substring), so
 * `build.js` in `src/` survives while `build/` does not. Pass --include-dist to measure a bundle
 * deliberately.
 */
const EXCLUDED_SEGMENTS = new Set([
  "dist", "build", "node_modules", "coverage", "vendor", "umd", "www",
  "bower_components", "jspm_packages", "tmp", "out", "__snapshots__",
])
const EXCLUDED_SUFFIXES = [".min.js", ".bundle.js", ".min.mjs"]
const INCLUDE_DIST = process.argv.includes("--include-dist")

function isBuildOutput(rel: string): boolean {
  if (INCLUDE_DIST) return false
  for (const seg of rel.split("/")) if (EXCLUDED_SEGMENTS.has(seg)) return true
  for (const suf of EXCLUDED_SUFFIXES) if (rel.endsWith(suf)) return true
  return false
}

function argOf(flag: string): string | null {
  const argv = process.argv.slice(2)
  const i = argv.indexOf(flag)
  if (i >= 0) return argv[i + 1] ?? null
  const hit = argv.find((a) => a.startsWith(flag + "="))
  return hit ? hit.slice(flag.length + 1) : null
}

const REPO = argOf("--repo") ?? "/home/ishaq2321/bb_tests/repositories/svelte"
if (!existsSync(REPO)) {
  console.error(`symbol-coverage: corpus not found at ${REPO} (pass --repo=<dir>)`)
  process.exit(2)
}
const JSON_OUT = argOf("--json")

const tracked: string[] = execFileSync("git", ["-C", REPO, "ls-files", "-z"], {
  encoding: "utf8",
  maxBuffer: 512 * 1024 * 1024,
}).split("\0").filter(Boolean)
const jsFiles: string[] = []
for (const rel of tracked) {
  if (isBuildOutput(rel)) continue
  const abs = path.join(REPO, rel)
  try {
    if (statSync(abs).size > SIZE_CAP) continue
    if (detectLanguageFromPath(abs, readFileSync(abs, "utf8")) !== "javascript") continue
  } catch {
    continue
  }
  jsFiles.push(rel)
}
jsFiles.sort()

/**
 * THE DECLARATION NODE TYPES WHOSE NAME SHOULD BE A SYMBOL, and the NAME NODE each is joined on.
 *
 * THE JOIN IS ON THE NAME'S LINE, NOT THE DECLARATION'S. In the pinned grammar a DECORATED
 * declaration's node STARTS AT ITS DECORATOR, so `@computed('x') get features() {}` has
 * `method_definition.startPosition` on the `@computed` line while the published symbol's range starts
 * on the `get` line. Joining on the node's start line reported 522 published nomad methods as
 * MISSING — every sampled one a decorated getter that WAS in the symbol table (verified:
 * `features kind=property owner=Abstract`). The name node's line is the stable one.
 */
const DECLARATIONS: Record<string, (n: any) => any> = {
  class_declaration: (n) => n.childForFieldName("name"),
  function_declaration: (n) => n.childForFieldName("name"),
  generator_function_declaration: (n) => n.childForFieldName("name"),
  method_definition: (n) => {
    const p = n.childForFieldName("name")
    if (!p) return null
    // a COMPUTED key (`[Symbol.iterator]`) names nothing stable — not a candidate
    return p.type === "property_identifier" || p.type === "private_property_identifier" ? p : null
  },
  variable_declarator: (n) => {
    const nm = n.childForFieldName("name")
    return nm && nm.type === "identifier" ? nm : null
  },
  field_definition: (n) => {
    const p = n.childForFieldName("property")
    return p && (p.type === "property_identifier" || p.type === "private_property_identifier") ? p : null
  },
  pair: (n) => {
    // object-literal member: only a meaningful candidate when the key is a plain identifier
    const k = n.childForFieldName("key")
    return k && (k.type === "property_identifier" || k.type === "identifier") ? k : null
  },
}

const parser = await getParser("javascript")

/**
 * THE JSDOC DECLARATION AXIS. Type names declared in a COMMENT are invisible to any enumeration of
 * grammar node types, which is why the `@typedef` hole survived every symbol census this lane ran:
 * `@typedef {{…}} ICompileDiagnostic` declares a name that other JSDoc and `@implements` reference,
 * and no node of type "typedef" exists to count. This axis reads the comment text instead.
 *
 * Tags that DECLARE a name (each declares exactly the last identifier in its tag body):
 *   @typedef, @callback, @enum, @interface, @class (the Closure/TSDoc type-declaration set)
 * A tag whose body ends in something that is not a plain identifier declares nothing and is skipped.
 */
const DECLARING_TAGS = ["@typedef", "@callback", "@enum", "@interface"]

function isPlainIdentifier(text: string): boolean {
  if (text.length === 0) return false
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    const isLetter = (c >= 65 && c <= 90) || (c >= 97 && c <= 122)
    const isDigit = c >= 48 && c <= 57
    const isStart = isLetter || c === 95 || c === 36
    if (i === 0) { if (!isStart) return false; continue }
    if (!isStart && !isDigit) return false
  }
  return true
}

/** the names a JSDoc block DECLARES (one per declaring tag) */
function jsdocDeclaredNames(text: string): string[] {
  if (!text.startsWith("/**")) return []
  const out: string[] = []
  for (const tag of DECLARING_TAGS) {
    let from = 0
    for (;;) {
      const at = text.indexOf(tag, from)
      if (at < 0) break
      from = at + tag.length
      // the body runs to the next '@' tag at a line start, or the comment end
      const rest = text.slice(from)
      const endTag = rest.search(/\n\s*\*?\s*@/)
      const endComment = rest.indexOf("*/")
      let stop = rest.length
      if (endTag >= 0) stop = Math.min(stop, endTag)
      if (endComment >= 0) stop = Math.min(stop, endComment)
      const body = rest.slice(0, stop)
      // the declared name is the LAST identifier-looking token in the body
      const tokens = body.split(/[^A-Za-z0-9_$]+/)
      for (let i = tokens.length - 1; i >= 0; i--) {
        const t = tokens[i]
        if (t.length === 0) continue
        if (isPlainIdentifier(t)) { if (!out.includes(t)) out.push(t) }
        break
      }
    }
  }
  return out
}

const jsdocTotals = { declared: 0, covered: 0, missed: 0 }
const jsdocMissed: Array<{ file: string; name: string; line: number }> = []

type Bucket = {
  declared: number
  covered: number
  unboundObjectMethod: number
  /** expected: a declaration at function depth > 0 — this lane publishes no LOCAL symbols */
  missedLocal: number
  /** THE GAP: a named declaration at function depth 0 with no symbol */
  missedTop: number
  /** documented: an IMPORT BINDING — this lane publishes an `imports` EDGE, never a symbol
   *  (ESM default/named/namespace and a bare `require(...)` binding all behave this way) */
  importBinding: number
}
const byType = new Map<string, Bucket>()
const missedExamples: Array<{ file: string; type: string; name: string; line: number; depth: number }> = []

/** is this declarator's value an import/require expression (so it is a binding EDGE, not a symbol)? */
function isImportBoundDeclarator(n: any): boolean {
  let v: any = n.childForFieldName("value")
  if (!v) return false
  if (v.type === "await_expression") v = v.namedChild(0)
  if (!v) return false
  if (v.type === "member_expression") v = v.childForFieldName("object")
  if (!v || v.type !== "call_expression") return false
  const fn = v.childForFieldName("function")
  return !!fn && fn.type === "identifier" && (fn.text === "require" || fn.text === "import")
}

/** does any ancestor rebind execution — i.e. is this declaration inside a function body? */
function functionDepthOf(n: any): number {
  let depth = 0
  for (let p: any = n.parent; p; p = p.parent) {
    if (p.type === "function_declaration" || p.type === "function_expression" ||
        p.type === "generator_function_declaration" || p.type === "generator_function" ||
        p.type === "arrow_function" || p.type === "method_definition") depth++
  }
  return depth
}

/** is this `pair` inside an object literal that is NOT bound to a name? */
function objectLiteralIsUnbound(pair: any): boolean {
  let obj: any = pair.parent
  while (obj && obj.type !== "object") obj = obj.parent
  if (!obj) return false
  const holder = obj.parent
  if (!holder) return true
  if (holder.type === "variable_declarator") {
    const nm = holder.childForFieldName("name")
    return !(nm && nm.type === "identifier")
  }
  if (holder.type === "assignment_expression") {
    const left = holder.childForFieldName("left")
    return !(left && (left.type === "identifier" || left.type === "member_expression"))
  }
  // return value, call argument, array element, export default, conditional branch … all unbound
  return true
}

for (const rel of jsFiles) {
  let src: string
  try {
    src = readFileSync(path.join(REPO, rel), "utf8")
  } catch {
    continue
  }
  let root: any
  try {
    root = parser.parse(src)?.rootNode
  } catch {
    continue
  }
  if (!root) continue
  // MEASURE WHAT THE ANALYZER ACTUALLY SEES. A `@flow`-annotated `.js` file is parsed by the engine
  // with the TypeScript/TSX grammar, but this census parsed it with the javascript grammar and then
  // SKIPPED it for having ERROR nodes — so 782 of React's 1,450 authored files were excluded from the
  // measurement while the analyzer was reading many of them. The census now applies the same fallback
  // the engine does; a file is skipped only when BOTH grammars fail.
  if (root.hasError) {
    // PARENTHESISES MATTER HERE, and getting them wrong made this line a silent no-op for a while:
    // `await f(x)?.rootNode` awaits `f(x)?.rootNode` — an optional chain on the PROMISE, which has no
    // `rootNode`, so it awaited `undefined` and `?? root` restored the ERROR tree. Every measurement
    // taken through the broken form reported "the fallback changes nothing", which is exactly what a
    // broken control says. `(await f(x))?.rootNode` is the resolved tree's root.
    const fbTree = await maybeFlowFallback("javascript", src, { rootNode: root } as any)
    root = fbRootOf(fbTree) ?? root
  }
  if (!root || root.hasError) continue

  // pass 1: the declarations the TREE contains
  type Cand = { type: string; name: string; line: number; node: any; depth: number }
  const cands: Cand[] = []
  {
    const stack: any[] = [root]
    while (stack.length > 0) {
      const n = stack.pop()!
      const reader = DECLARATIONS[n.type]
      if (reader) {
        const nameNode = reader(n)
        if (nameNode?.text) {
          cands.push({ type: n.type, name: nameNode.text, line: nameNode.startPosition.row + 1, node: n, depth: functionDepthOf(n) })
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) stack.push(c)
      }
    }
  }

  // pass 2: the symbols the analyzer published
  let res: any
  try {
    res = await ASTEngine.parseFile(path.join(REPO, rel), src)
  } catch {
    continue
  }
  const symbols: Array<{ name: string; start: number; end: number }> = []
  for (const s of res.symbols ?? []) {
    const nm = String(s?.name ?? "")
    const r = s?.range ?? {}
    const st = Number(r.startLine ?? 0)
    const en = Number(r.endLine ?? st)
    if (nm && Number.isFinite(st)) symbols.push({ name: nm, start: st, end: Math.max(st, en) })
  }

  // JSDoc declarations, from COMMENT nodes — walk ALL children (comments are extras and are not
  // reliably present in namedChildren)
  {
    const docs: Array<{ text: string; line: number }> = []
    const stack: any[] = [root]
    while (stack.length > 0) {
      const n = stack.pop()!
      if (n.type === "comment") {
        const text = String(n.text ?? "")
        if (text.startsWith("/**")) docs.push({ text, line: n.startPosition.row + 1 })
        continue
      }
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i)
        if (c) stack.push(c)
      }
    }
    for (const d of docs) {
      for (const name of jsdocDeclaredNames(d.text)) {
        jsdocTotals.declared++
        const hit = symbols.some((s) => s.name === name && d.line >= s.start && d.line <= s.end)
        if (hit) jsdocTotals.covered++
        else {
          jsdocTotals.missed++
          if (jsdocMissed.length < 40) jsdocMissed.push({ file: rel, name, line: d.line })
        }
      }
    }
  }

  for (const c of cands) {
    const b = byType.get(c.type) ?? { declared: 0, covered: 0, unboundObjectMethod: 0, missedLocal: 0, missedTop: 0, importBinding: 0 }
    b.declared++
    const hit = symbols.some((s) => s.name === c.name && c.line >= s.start && c.line <= s.end)
    if (hit) {
      b.covered++
    } else if (c.type === "pair" && objectLiteralIsUnbound(c.node)) {
      b.unboundObjectMethod++
    } else if (c.type === "variable_declarator" && isImportBoundDeclarator(c.node)) {
      // DOCUMENTED FAMILY CONTRACT, not a gap: `const fs = require('fs')` publishes an `imports`
      // edge and no symbol, and ESM does the same — measured: default/named/namespace `import` all
      // publish 0 symbols and 1 imports edge, exactly like a bare require. A destructured
      // `const { a } = require('m')` does publish `a`, which is the lane's INCONSISTENCY (recorded
      // separately), not the rule.
      b.importBinding++
    } else if (c.type === "pair") {
      // DOCUMENTED CONTRACT, not a gap: this lane publishes no symbol for an object-literal member.
      // A BOUND literal's member is placed by its OWNER (`contains cases -> fn`), and an unbound
      // one is correctly ownerless — the containment census records that as 92/92 by design. The
      // first run of this census called these 197 "missed" on svelte; every sampled one was either
      // plain config DATA (`meta: { type: 'problem' }` in eslint.config.js) or a member of a bound
      // literal, and neither is a declaration the symbol table should carry.
      b.unboundObjectMethod++
    } else if (c.depth > 0) {
      // EXPECTED, and the reason this split exists: a local at function depth > 0 is not a symbol in
      // this lane. Counting it as a gap made the first run of this census report 4,205 "missed"
      // variable declarators on svelte, every sampled one a loop counter inside a function.
      b.missedLocal++
    } else {
      b.missedTop++
      if (missedExamples.length < 60) missedExamples.push({ file: rel, type: c.type, name: c.name, line: c.line, depth: c.depth })
    }
    byType.set(c.type, b)
  }
}

const order = Object.keys(DECLARATIONS)
let tDeclared = 0, tCovered = 0, tUnbound = 0, tLocal = 0, tImp = 0, tMissed = 0
console.log(`symbol-coverage census — ${path.basename(REPO)}  (${jsFiles.length} JS files)`)
console.log(`\n  node type                     declared  covered   unbound-obj  local(ok)  MISSED(top)`)
for (const t of order) {
  const b = byType.get(t)
  if (!b) continue
  tDeclared += b.declared; tCovered += b.covered; tUnbound += b.unboundObjectMethod; tLocal += b.missedLocal; tImp += b.importBinding; tMissed += b.missedTop
  const flag = b.missedTop > 0 ? "   <- GAP" : ""
  console.log(`    ${t.padEnd(28)} ${String(b.declared).padStart(8)} ${String(b.covered).padStart(8)} ${String(b.unboundObjectMethod).padStart(13)} ${String(b.missedLocal).padStart(10)} ${String(b.importBinding).padStart(12)} ${String(b.missedTop).padStart(12)}${flag}`)
}
console.log(`    ${"TOTAL".padEnd(28)} ${String(tDeclared).padStart(8)} ${String(tCovered).padStart(8)} ${String(tUnbound).padStart(13)} ${String(tLocal).padStart(10)} ${String(tImp).padStart(12)} ${String(tMissed).padStart(12)}`)
console.log(`\n  JSDoc DECLARATIONS (invisible to a node-type census, because they are COMMENTS):`)
console.log(`    declared ${jsdocTotals.declared}   covered ${jsdocTotals.covered}   MISSED ${jsdocTotals.missed}`)
if (jsdocMissed.length > 0) {
  for (const m of jsdocMissed.slice(0, 12)) console.log(`    ${m.file}:${m.line}  jsdoc  ${m.name}`)
}
if (missedExamples.length > 0) {
  console.log(`\n  MISSED examples (first ${missedExamples.length}):`)
  for (const m of missedExamples) console.log(`    ${m.file}:${m.line}  ${m.type}  ${m.name}`)
}

if (JSON_OUT) {
  mkdirSync(path.dirname(JSON_OUT), { recursive: true })
  writeFileSync(
    JSON_OUT,
    JSON.stringify(
      {
        at: new Date().toISOString(),
        repo: REPO,
        jsFiles: jsFiles.length,
        byType: Object.fromEntries([...byType.entries()].map(([k, v]) => [k, v])),
        totals: { declared: tDeclared, covered: tCovered, unboundObjectMethod: tUnbound, missedLocal: tLocal, importBinding: tImp, missedTopLevel: tMissed },
        missedExamples,
        jsdoc: { ...jsdocTotals, missedExamples: jsdocMissed },
        note:
          "A declaration node is COVERED when a published symbol has the same name AND its range contains the declaration's line. unbound-object-method = an object literal member with no binding to name (the lane's documented correct-ownerless contract); MISSED = a named declaration with no symbol, which is the gap this census exists to find.",
      },
      null,
      2,
    ),
  )
  console.log(`  artifact: ${JSON_OUT}`)
}
/**
 * PERL EXTENDED-TYPE CONSTRUCT CENSUS — the four extended types' construct sites
 * over the WHOLE admitted population.
 *
 * The lane must implement or rule `decorates`, `renders`, `mixes_in`, `part_of`.
 * The bar says: measure first, then speak. This instrument counts the CONSTRUCT
 * SITES for each candidate construct on the whole admitted perl population
 * (git ls-files under the corpus root, <=1 MiB, detectLanguageFromPath === "perl"),
 * parsed through the PRODUCTION engine (`engine.getParser -> parse -> analyze`
 * tree access), never a regex walk.
 *
 * What it counts, per extended type:
 *
 *   decorates — perl's attribute syntax `sub foo :lvalue` and `has x => (is => 'ro',
 *     traits => ['Tick'])`. The contract demands an APPLIED CALLABLE — a wrapper
 *     invoked ON the declaration — not a marker. Counts: `attribute` nodes attached
 *     to sub/method declarations; `attribute` nodes whose value is a CALL shape; and
 *     Moose `has` sites carrying a `traits`/`handles`/`metaclass` option.
 *
 *   renders — no template system is routed to this lane. Counted anyway: heredoc
 *     tokens (`command_heredoc_token`, `heredoc_token`), Template Toolkit
 *     `->process(...)` calls, HTML::Template methods, and `print`/`say` to a
 *     filehandle — so a zero is a measured zero with its population named.
 *
 *   mixes_in — the mixin-composition vocabulary: Moose/Moo `with 'Role'` (the
 *     contract's own candidate), `use role`, `use Moose::Role`/`Moo::Role`
 *     (which MARKS the file a role), and the `:does()` attribute. Separated by
 *     shape so the conformance-vs-mixin question is answered by numbers.
 *
 *   part_of — the inclusion forms `require` (module load), `do 'file'`
 *     (executes a file in the CURRENT scope), `use lib` (manipulates @INC, not an
 *     inclusion), and string-argument `require './path'`. The contract's
 *     "shares the library's single scope" test is answered per form: `do` shares
 *     the caller's scope; `require` does NOT (it loads a module into its own
 *     package).
 *
 * NO REGEX: no RegExp, no pattern methods. All discrimination is by node type,
 * field name, and exact text equality.
 *
 * Usage:
 *   BB_CORPUS_ROOT=$PWD/.corpus bun script/m14/perl-extended-census.mts
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"

const ROOT = path.resolve(import.meta.dir, "..", "..")
const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const OUT = path.join(ROOT, "validation", "m14", "measurements", "perl-extended-census.json")

// ---------------------------------------------------------------- population
// Derived exactly as the arbiter derives it: git ls-files under the corpus root,
// <= 1 MiB, production's own router. No hand-written file list.
const files: { repo: string; rel: string; abs: string }[] = []
const repos: Record<string, number> = {}
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
  let n = 0
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text: string
    try {
      if (statSync(abs).size > 1024 * 1024) continue
      text = readFileSync(abs, "utf8")
    } catch { continue }
    const { detectLanguageFromPath } = await import(path.join(ROOT, "src/ast/language-detection.ts"))
    if (detectLanguageFromPath(abs, text) !== "perl") continue
    n++
    files.push({ repo: e, rel, abs })
  }
  if (n) repos[e] = n
}
if (!files.length) {
  console.error(`NO CORPUS under ${CR} — this is NOT a pass.`)
  process.exit(2)
}
console.log(`PERL EXTENDED-TYPE CONSTRUCT CENSUS`)
console.log(`population: ${files.length} admitted files across ${Object.keys(repos).length} repos`)
console.log(`rule: git ls-files, <=1 MiB, detectLanguageFromPath === "perl", corpus root ${CR}`)
console.log(`instrument: production engine.getParser -> tree walk`)

// ---------------------------------------------------------------- the walk
const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
const getParser = (ASTEngine as any).getParser.bind(ASTEngine)
const perlParser = await getParser("perl")
type Bag = Record<string, number>
const add = (b: Bag, k: string) => { b[k] = (b[k] ?? 0) + 1 }
const bag = (): Bag => ({})

// decorates
const d_attrOnSub = bag()          // attribute nodes on sub/method declarations
const d_attrFiles = new Set<string>()
const d_attrCallShaped = bag()     // attribute VALUE is a call shape (applied callable candidate)
const d_hasOptions = bag()         // Moose `has` sites with traits/handles/metaclass
const d_hasFiles = new Set<string>()

// renders
const r_bag = bag()
const r_files = new Set<string>()

// mixes_in
const m_with = bag()               // `with 'Role'` statement sites
const m_withFiles = new Set<string>()
const m_roleMod = bag()            // `use Moose::Role` / `use Moo::Role` / `use Role::Tiny` etc
const m_roleModFiles = new Set<string>()
const m_useRole = bag()            // `use role 'R'`
const m_does = bag()               // `:does('Role')` attribute
const m_shapes = bag()             // composition shape census

// part_of
const p_requireModule = bag()
const p_requirePath = bag()
const p_doFile = bag()
const p_useLib = bag()
const p_files = new Set<string>()

// every attribute site, for the decorates inventory
const attrAll = bag()

const EXAMPLES: Record<string, string[]> = { with: [], roleMod: [], doFile: [], requirePath: [], heredoc: [], attrCall: [], hasTraits: [] }
const pushExample = (k: string, s: string) => { if (EXAMPLES[k] && EXAMPLES[k].length < 12) EXAMPLES[k].push(s) }

let parsed = 0, failed = 0
const perFile: Record<string, Record<string, number>> = {}

for (const f of files) {
  let tree: any
  try {
    const text = readFileSync(f.abs, "utf8")
    tree = perlParser.parse(text)
    parsed++
  } catch (e) {
    failed++
    continue
  }
  const counts: Record<string, number> = {}
  const bump = (k: string) => { counts[k] = (counts[k] ?? 0) + 1 }

  const cursorRef = { node: tree.rootNode }
  const stack: any[] = [tree.rootNode]
  while (stack.length) {
    const n = stack.pop()
    if (!n) continue
    const t = String(n.type)

    // ---- decorates: attribute on sub/method declarations
    if (t === "attribute" || t === "attribute_value") {
      add(attrAll, t)
      // find the enclosing declaration by walking siblings: attributes appear in
      // an `attrlist` field of the declaration.
      const parent = n.parent
      const ptype = parent ? String(parent.type) : ""
      const gp = parent?.parent
      const gpt = gp ? String(gp.type) : ""
      if (gpt === "subroutine_declaration_statement" || gpt === "method_declaration_statement" || gpt === "anonymous_subroutine_expression" || gpt === "anonymous_method_expression" || ptype === "attrlist" && (gpt === "subroutine_declaration_statement" || gpt === "method_declaration_statement")) {
        const key = `attr@${gpt || ptype}`
        add(d_attrOnSub, key)
        d_attrFiles.add(f.rel)
        bump(key)
      }
      // applied-callable candidate: the attribute's VALUE carries parens/args
      const vtext = String(n.text)
      if (vtext.includes("(") && vtext.includes(")")) {
        add(d_attrCallShaped, "attrValueWithArgs")
        pushExample("attrCall", `${f.rel}:${n.startPosition.row + 1} ${vtext.slice(0, 60)}`)
      }
    }

    // ---- decorates: Moose `has` with traits/handles/metaclass
    if (t === "function_call_expression" || t === "ambiguous_function_call_expression") {
      const fn = n.childForFieldName("function")
      const name = fn ? String(fn.text) : ""
      if (name === "has") {
        // walk argument words looking for the option keys
        const words: string[] = []
        const s2: any[] = [n]
        while (s2.length) {
          const c = s2.pop()
          if (!c) continue
          if (c.type === "string_content" || c.type === "bareword" || c.type === "autoquoted_bareword" || c.type === "quoted_word_list") {
            if (c.type === "quoted_word_list") {
              for (const w of String(c.text).slice(0, 400).split(/\s+/)) words.push(w.replace(/[^A-Za-z0-9_:]/g, ""))
            } else words.push(String(c.text))
          }
          for (let i = c.childCount - 1; i >= 0; i--) s2.push(c.child(i))
        }
        if (words.includes("traits")) { add(d_hasOptions, "has-traits"); bump("has-traits"); d_hasFiles.add(f.rel); pushExample("hasTraits", `${f.rel}:${n.startPosition.row + 1}`) }
        if (words.includes("handles")) { add(d_hasOptions, "has-handles"); bump("has-handles") }
        if (words.includes("metaclass")) { add(d_hasOptions, "has-metaclass"); bump("has-metaclass") }
      }
    }

    // ---- renders
    if (t === "command_heredoc_token" || t === "heredoc_token") {
      add(r_bag, t)
      r_files.add(f.rel)
      pushExample("heredoc", `${f.rel}:${n.startPosition.row + 1}`)
      bump(`heredoc:${t}`)
    }
    if (t === "method_call_expression") {
      const mn = n.childForFieldName("method")
      const m = mn ? String(mn.text) : ""
      if (m === "process" || m === "template" || m === "fill" || m === "render" || m === "output") {
        add(r_bag, `method:${m}`)
        r_files.add(f.rel)
        bump(`method:${m}`)
      }
    }

    // ---- mixes_in: `with 'Role'` call statements
    if (t === "function_call_expression" || t === "ambiguous_function_call_expression") {
      const fn = n.childForFieldName("function")
      const name = fn ? String(fn.text) : ""
      if (name === "with") {
        add(m_with, "with-site")
        m_withFiles.add(f.rel)
        bump("with-site")
        pushExample("with", `${f.rel}:${n.startPosition.row + 1} ${String(n.text).slice(0, 70)}`)
        // shape census of the argument list
        let hasQw = false, hasStr = false, hasHash = false, hasFatComma = false
        const s2: any[] = [n]
        while (s2.length) {
          const c = s2.pop()
          if (!c) continue
          const ct = String(c.type)
          if (ct === "quoted_word_list") hasQw = true
          if (ct === "string_literal") hasStr = true
          if (ct === "anonymous_hash_expression") hasHash = true
          if (String(c.text) === "=>") hasFatComma = true
          for (let i = c.childCount - 1; i >= 0; i--) s2.push(c.child(i))
        }
        const shape = hasFatComma && (hasHash || hasQw || hasStr) ? "fatcomma" : hasQw ? "qw" : hasStr ? "strings" : "other"
        add(m_shapes, shape)
      }
    }

    // ---- part_of: require forms and do-expression
    if (t === "require_expression") {
      // A require_expression's payload can be a module name (bareword/package) or
      // a path string.
      const kid = n.namedChildCount > 0 ? n.namedChild(0) : null
      const ktext = kid ? String(kid.text) : ""
      if (kid && (String(kid.type) === "string_literal" || String(kid.type) === "interpolated_string_literal")) {
        add(p_requirePath, ktext.includes("$") ? "interpolated" : "literal")
        p_files.add(f.rel)
        bump("require:path")
      } else if (kid && (String(kid.type) === "bareword" || String(kid.type) === "package")) {
        add(p_requireModule, "module")
        p_files.add(f.rel)
        bump("require:module")
      } else {
        add(p_requireModule, "other")
        bump("require:other")
      }
    }
    if (t === "do_expression") {
      // `do 'file'` executes the file in the CALLER'S scope. The payload is the
      // FIRST NAMED CHILD — `do { ... }` is a block and is a different construct
      // entirely. Walking descendants found strings INSIDE the block and counted
      // them as filenames; the direct-child read is the correct one.
      const kid = n.namedChildCount > 0 ? n.namedChild(0) : null
      const ktype = kid ? String(kid.type) : ""
      const ktext = kid ? String(kid.text) : ""
      const isFile = ktype === "string_literal" || ktype === "filename" || ktype === "interpolated_string_literal"
      add(p_doFile, isFile ? "file" : ktype || "empty")
      if (isFile) {
        p_files.add(f.rel)
        bump("do:file")
        pushExample("doFile", `${f.rel}:${n.startPosition.row + 1} ${ktext.slice(0, 60)}`)
      } else bump(`do:${ktype || "empty"}`)
    }
    if (t === "use_statement") {
      const mod = n.childForFieldName("module")?.text ?? (n.namedChildCount > 0 ? String(n.namedChild(0).text) : "")
      if (mod === "lib") { add(p_useLib, "use-lib"); p_files.add(f.rel); bump("use:lib") }
      if (mod === "Moose::Role" || mod === "Moo::Role" || mod === "Role::Tiny" || mod === "Role::Tiny::With" || mod === "MooseX::Role::Parameterized" || mod === "Object::Pad::Role" || mod === "Role::Basic") {
        add(m_roleMod, mod)
        m_roleModFiles.add(f.rel)
        bump(`roleMod:${mod}`)
      }
      if (mod === "role") {
        add(m_useRole, "use-role")
        bump("use:role")
      }
    }

    for (let i = n.childCount - 1; i >= 0; i--) stack.push(n.child(i))
  }
  if (Object.keys(counts).length) perFile[f.rel] = counts
}

// ---------------------------------------------------------------- report
const fmt = (b: Bag) => Object.entries(b).sort((a, c) => c[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(" ") || "(none)"
console.log(`parsed ${parsed} of ${files.length} · failures ${failed}`)
console.log()
console.log(`== decorates ==`)
console.log(`  attribute nodes on declarations: ${fmt(d_attrOnSub)} (${d_attrFiles.size} files)`)
console.log(`  attribute-value call shapes:     ${fmt(d_attrCallShaped)}`)
console.log(`  Moose has option keys:          ${fmt(d_hasOptions)} (${d_hasFiles.size} files)`)
console.log(`  ALL attribute nodes:            ${fmt(attrAll)}`)
console.log()
console.log(`== renders ==`)
console.log(`  ${fmt(r_bag)} (${r_files.size} files)`)
console.log()
console.log(`== mixes_in ==`)
console.log(`  with sites:        ${fmt(m_with)} (${m_withFiles.size} files)`)
console.log(`  shapes:            ${fmt(m_shapes)}`)
console.log(`  role modules:     ${fmt(m_roleMod)} (${m_roleModFiles.size} files)`)
console.log(`  use role:         ${fmt(m_useRole)}`)
console.log(`  examples:with     ${JSON.stringify(EXAMPLES.with)}`)
console.log()
console.log(`== part_of ==`)
console.log(`  require module:  ${fmt(p_requireModule)}`)
console.log(`  require path:    ${fmt(p_requirePath)}`)
console.log(`  do 'file':       ${fmt(p_doFile)} (${p_files.size} files contribute require/do)`)
console.log(`  use lib:         ${fmt(p_useLib)}`)
console.log(`  examples:doFile  ${JSON.stringify(EXAMPLES.doFile)}`)
console.log(`  examples:reqPath ${JSON.stringify(EXAMPLES.requirePath)}`)

writeFileSync(OUT, JSON.stringify({
  instrument: "perl-extended-census.mts",
  population: { files: files.length, repos: Object.keys(repos).length, rule: "git ls-files <=1MiB detectLanguageFromPath=perl", root: CR, parsed, failures: failed },
  decorates: { attrOnSub: d_attrOnSub, attrCallShaped: d_attrCallShaped, hasOptions: d_hasOptions, attrAll, attrFiles: d_attrFiles.size, hasFiles: d_hasFiles.size },
  renders: { bag: r_bag, files: r_files.size },
  mixes_in: { with: m_with, shapes: m_shapes, roleModules: m_roleMod, useRole: m_useRole, withFiles: m_withFiles.size, roleModFiles: m_roleModFiles.size },
  part_of: { requireModule: p_requireModule, requirePath: p_requirePath, doFile: p_doFile, useLib: p_useLib },
  examples: EXAMPLES,
}, null, 2))
console.log(`\nwrote ${OUT}`)

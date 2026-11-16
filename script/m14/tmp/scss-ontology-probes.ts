/**
 * SCSS ONTOLOGY — the instrument-B probes the verdict table leans on.
 *
 * Separate from `scss-ontology-harness.ts` so a probe can be re-run and cited on its
 * own. Read-only. Every number here is a COUNT ON THE PARSE TREE, never on the file
 * text: a string literal, a comment and a URL cannot produce any of these nodes.
 *
 * The three SCSS-shaped questions this answers, each with the count that would
 * overturn the answer printed beside it:
 *
 *   1. `overrides`      a re-declaration that REPLACES a prior one. Probe: the same
 *                       name declared twice by a construct that redefines rather than
 *                       assigns — a second `@mixin` / `@function`. Separately: a
 *                       `$var` assigned twice with NO intervening scope (Sass: an
 *                       assignment inside a rule/mixin/control-flow makes a LOCAL
 *                       variable that shadows, so it is not an override), and an
 *                       assignment carrying `!global` of a name already assigned
 *                       (Sass: `!global` is exactly the flag that reaches past the
 *                       scope and reassigns the outer binding).
 *   2. `exports`       the module system. Probe: a `@forward` (the one statement that
 *                       re-exports another module's members) and the top-level
 *                       declaration census with Sass's PRIVATE-MEMBER rule — a name
 *                       beginning `-` or `_` is private to its module and `@use` does
 *                       not expose it.
 *   3. `extends`       `@extend` — Sass's inheritance. Probe: every `extend_statement`,
 *                       and WHICH node type carries its target, because a target that
 *                       is not a `class_selector`/`id_selector`/`plain_value` is an
 *                       `@extend` the lane cannot currently read.
 *
 * Plus the two instrument-A companions, stated as exact node-type names rather than a
 * shape regex: a shape regex matched `class_selector` 53,540 times and taught nothing.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../src/ast/language-detection"

const CR = process.env.BB_CORPUS_ROOT ?? "<corpus-root>/bb_tests/repositories"
const FOCUS = (process.env.SCSS_FOCUS ?? "").split(",").filter(Boolean)

const files: { repo: string; dir: string; rel: string; abs: string; text: string }[] = []
for (const e of readdirSync(CR)) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch { continue }
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text: string
    try { if (statSync(abs).size > 512 * 1024) continue; text = readFileSync(abs, "utf8") } catch { continue }
    if (detectLanguageFromPath(abs, text) !== "scss") continue
    files.push({ repo: e, dir, rel, abs, text })
  }
}
files.sort((a, b) => `${a.repo}/${a.rel}`.localeCompare(`${b.repo}/${b.rel}`))

const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-scss.wasm"))))

const kids = (n: any): any[] => { const o: any[] = []; for (let i = 0; i < n.childCount; i++) o.push(n.child(i)); return o }
const named = (n: any): any[] => kids(n).filter((c) => c.isNamed)
const kidOf = (n: any, t: string): any | null => named(n).find((c) => c.type === t) ?? null
const collapse = (t: string): string => t.replace(/\s+/g, " ").trim()

/** a SCOPE-introducing ancestor: inside one of these an assignment is a LOCAL variable */
const SCOPE_NODES = new Set(["rule_set", "mixin_statement", "function_statement", "if_statement", "each_statement", "for_statement", "while_statement"])
const insideScope = (n: any): boolean => {
  for (let p = n.parent; p; p = p.parent) if (SCOPE_NODES.has(p.type)) return true
  return false
}
/** `!global` is TWO ANONYMOUS NODES — `!` and `global` — so no single node's text is `!global` */
const hasGlobalFlag = (n: any): boolean => {
  const stack = [n]
  while (stack.length) {
    const c = stack.pop()
    if (!c) continue
    if (!c.isNamed && c.type === "global") return true
    for (const k of kids(c)) stack.push(k)
  }
  return false
}
const declNames = new Map<string, { total: number; top: number; scoped: number; globalFlag: number; privateTop: number }>()
const extendTargets = new Map<string, number>()
const extendExamples: string[] = []
const forwardKinds = new Map<string, number>()
const importKinds = new Map<string, number>()
const nodeTypes = new Set<string>()
const nodeTypeHits = new Map<string, number>()

const A_NAMES = [
  "class_declaration", "class", "interface_declaration", "trait_declaration", "struct_declaration",
  "implements_clause", "extends_clause", "superclass", "base_class", "interface_implementation",
  "inheritance_specifier", "class_body", "class_name",
  "new_expression", "object_creation_expression", "constructor_invocation", "new",
  "module_definition", "import_statement", "export_statement",
]

let mixinDecls = 0, funcDecls = 0, varDecls = 0
const perRepo = new Map<string, Record<string, number>>()
const bump = (repo: string, k: string, n = 1) => {
  const row = perRepo.get(repo) ?? {}
  row[k] = (row[k] ?? 0) + n
  perRepo.set(repo, row)
}

for (const f of files) {
  const label = `${f.repo}/${f.rel}`
  const t = parser.parse(f.text)
  if (!t) continue
  const root = t.rootNode
  const v = (n: any) => {
    nodeTypes.add(n.type)
    nodeTypeHits.set(n.type, (nodeTypeHits.get(n.type) ?? 0) + 1)
    for (const c of kids(n)) v(c)
  }
  v(root)

  const seen = new Set<string>()
  const scan = (n: any) => {
    if (n.type === "mixin_statement") {
      mixinDecls++; bump(f.repo, "mixin")
      const nm = n.childForFieldName?.("name") ?? kidOf(n, "identifier")
      const name = nm ? collapse(nm.text) : ""
      if (name && seen.has(`mixin:${name}`)) bump(f.repo, "second-mixin")
      else if (name) seen.add(`mixin:${name}`)
    } else if (n.type === "function_statement") {
      funcDecls++; bump(f.repo, "fn")
      const nm = n.childForFieldName?.("name") ?? kidOf(n, "identifier")
      const name = nm ? collapse(nm.text) : ""
      if (name && seen.has(`fn:${name}`)) bump(f.repo, "second-fn")
      else if (name) seen.add(`fn:${name}`)
    } else if (n.type === "declaration") {
      const p = kidOf(n, "property_name")
      const name = p ? p.text : ""
      if (name.startsWith("$")) {
        varDecls++
        const scoped = insideScope(n)
        const gflag = hasGlobalFlag(n)
        const row = declNames.get(name) ?? { total: 0, top: 0, scoped: 0, globalFlag: 0, privateTop: 0 }
        row.total++
        if (scoped) row.scoped++
        else {
          row.top++
          if (gflag) row.globalFlag++
          if (/^[-_]/.test(name.slice(1))) row.privateTop++
        }
        declNames.set(name, row)
        if (!scoped) {
          if (seen.has(`var:${name}`)) bump(f.repo, "same-scope-reassign")
          else seen.add(`var:${name}`)
        }
        // `!global` on a name already assigned ANYWHERE above is an override of the outer binding
        if (gflag && hasPriorAssignment(n, name)) bump(f.repo, "global-reassign")
        bump(f.repo, "var")
      }
    } else if (n.type === "extend_statement") {
      bump(f.repo, "extend")
      const cls = kidOf(n, "class_selector")
      const id = kidOf(n, "id_selector")
      const plain = kidOf(n, "plain_value")
      const ph = kidOf(n, "placeholder")
      const which = cls ? "class_selector" : id ? "id_selector" : ph ? "placeholder" : plain ? "plain_value" : "(none)"
      extendTargets.set(which, (extendTargets.get(which) ?? 0) + 1)
      const readable = cls || id || plain
      if (readable) bump(f.repo, "extend-readable")
      else if (extendExamples.length < 12) extendExamples.push(`${label}: ${collapse(n.text).slice(0, 70)} -> ${which}`)
    } else if (n.type === "forward_statement") {
      bump(f.repo, "forward")
      const m = kidOf(n, "string_value")
      const key = m ? (m.text.startsWith(`"`) || m.text.startsWith(`'`) ? "quoted" : "unquoted") : "(no module)"
      forwardKinds.set(key, (forwardKinds.get(key) ?? 0) + 1)
    } else if (n.type === "use_statement") {
      bump(f.repo, "use")
    } else if (n.type === "import_statement") {
      bump(f.repo, "css-import")
      const m = kidOf(n, "string_value")
      const key = m ? (m.text.startsWith(`"`) || m.text.startsWith(`'`) ? "quoted" : "unquoted") : "(no target)"
      importKinds.set(key, (importKinds.get(key) ?? 0) + 1)
    } else if (n.type === "call_expression") {
      const fn = kidOf(n, "function_name")
      if (fn) {
        const name = collapse(fn.text)
        if (name.includes(".")) bump(f.repo, "call-namespaced")
        else bump(f.repo, "call-plain")
      }
    }
    for (const c of kids(n)) scan(c)
  }
  scan(root)
  t.delete?.()
}

/** an assignment of `name` that appears EARLIER in the file, at any scope */
function hasPriorAssignment(node: any, name: string): boolean {
  // walk the preceding siblings of every ancestor, looking for a `$name:` declaration
  for (let p = node.parent; p; p = p.parent) {
    for (let i = 0; i < p.namedChildCount; i++) {
      const sib = p.namedChild(i)
      if (!sib) continue
      if (sib.startIndex >= node.startIndex) break
      const stack = [sib]
      while (stack.length) {
        const c = stack.pop()
        if (c && c.type === "property_name" && c.text === name) {
          const d = c.parent
          if (d && d.type === "declaration") return true
        }
        for (const k of kids(c)) stack.push(k)
      }
    }
  }
  return false
}

console.log(`SCSS ONTOLOGY PROBES — ${files.length} files across ${new Set(files.map((f) => f.repo)).size} repos`)
console.log(`declarations: mixin ${mixinDecls}, function ${funcDecls}, $var ${varDecls}`)
console.log("")
console.log("── instrument A: node types that would MEAN a supertype clause / a constructor ──")
for (const n of A_NAMES) {
  const hits = nodeTypeHits.get(n) ?? 0
  console.log(`  ${n.padEnd(30)} ${hits === 0 ? "0  (absent)" : `${hits}  PRESENT`}`)
}
console.log(`  distinct node types produced by the wired grammar across the corpus: ${nodeTypes.size}`)
console.log("")
console.log("── instrument B: redefinition events (`overrides` candidates) ──")
const agg = new Map<string, number>()
for (const row of perRepo.values()) for (const [k, v] of Object.entries(row)) agg.set(k, (agg.get(k) ?? 0) + v)
for (const k of ["second-mixin", "second-fn", "same-scope-reassign", "global-reassign", "var", "mixin", "fn"]) {
  console.log(`  ${k.padEnd(24)} ${String(agg.get(k) ?? 0).padStart(6)}`)
}
const globalNames = [...declNames].filter(([, r]) => r.globalFlag > 0).length
console.log(`  $names carrying !global anywhere: ${globalNames}`)
console.log(`  $names with >1 top-level assignment: ${[...declNames].filter(([, r]) => r.top > 1).length}`)
console.log("")
console.log("── instrument B: `@extend` target node types (the `extends` candidate) ──")
for (const [k, v] of [...extendTargets].sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(20)} ${v}`)
for (const ex of extendExamples) console.log(`    unreadable: ${ex}`)
console.log("")
console.log("── instrument B: module-system statements ──")
console.log(`  @forward ${agg.get("forward") ?? 0}  kinds: ${[...forwardKinds].map(([k, v]) => `${k}=${v}`).join(", ")}`)
console.log(`  @use    ${agg.get("use") ?? 0}`)
console.log(`  @import ${agg.get("css-import") ?? 0}  kinds: ${[...importKinds].map(([k, v]) => `${k}=${v}`).join(", ")}`)
console.log(`  call_expression: plain ${agg.get("call-plain") ?? 0}, namespaced ${agg.get("call-namespaced") ?? 0}`)
console.log("")
console.log("── instrument B: top-level `$var` census (the `exports` sizing) ──")
let topTotal = 0, topPrivate = 0, scopedTotal = 0
for (const [, r] of declNames) { topTotal += r.top; topPrivate += r.privateTop; scopedTotal += r.scoped }
console.log(`  distinct $names: ${declNames.size}; top-level assignments: ${topTotal}; of those private (-/_): ${topPrivate}; scoped assignments: ${scopedTotal}`)
console.log("")
if (FOCUS.length) {
  console.log(`── per repo, focus = ${FOCUS.join(", ")} ──`)
  for (const r of FOCUS) {
    const row = perRepo.get(r)
    console.log(`  ${r}: ${row ? JSON.stringify(row) : "(no scss files)"}`)
  }
  console.log("")
}
console.log("── per repo (all) ──")
for (const [r, row] of [...perRepo].sort((a, b) => (b[1].extend ?? 0) - (a[1].extend ?? 0))) console.log(`  ${r.padEnd(18)} ${JSON.stringify(row)}`)

// ── the finer probes, appended so the sections above keep their order ──────────
//
// `overrides` has three candidate classes and they are not the same claim, so each
// is counted separately. What OVERTAKES a wrong ruling is treating one as another:
// a `$x: $x + 1` accumulator is a MUTATION of one binding, not the replacement of a
// declaration, and reporting it as an override would be the fabricated edge this
// workstream prices highest.
const cls = {
  sameScopeSelfReading: 0,
  sameScopeOtherReading: 0,
  globalReassign: 0,
  globalReassignOuter: 0,
  placeholderDeclaredFiles: new Set<string>(),
  placeholderExample: [] as string[],
  placeholderInError: 0,
  placeholderDistinct: new Set<string>(),
  defaultAfterAssign: 0,
  mixinRedefined: 0,
  fnRedefined: 0,
  globalReassignExamples: [] as string[],
  sameScopeOtherExamples: [] as string[],
  defaultAfterExamples: [] as string[],
  placeholderDeclared: 0,
  extendPlaceholder: 0,
  extendOtherUnreadable: 0,
  moduleLevelDeclarations: 0,
  moduleLevelPrivate: 0,
  moduleLevelDistinct: new Set<string>(),
  topLevelNoOwnerReads: 0,
  topLevelNoOwnerIncludes: 0,
  topLevelNoOwnerExtends: 0,
}
const hasDefaultFlag = (n: any): boolean => {
  const stack = [n]
  while (stack.length) {
    const c = stack.pop()
    if (!c) continue
    if (!c.isNamed && c.type === "default") return true
    for (const k of kids(c)) stack.push(k)
  }
  return false
}
const readsVariable = (n: any, name: string): boolean => {
  const stack = [n]
  while (stack.length) {
    const c = stack.pop()
    if (!c) continue
    if (c.type === "variable" && c.text === name) return true
    for (const k of named(c)) stack.push(k)
  }
  return false
}
for (const f of files) {
  const label = `${f.repo}/${f.rel}`
  const t = parser.parse(f.text)
  if (!t) continue
  const root = t.rootNode
  // PER FILE: a redefinition is only a redefinition inside ONE file, which is the whole
  // claim. These sets are declared here rather than at module scope because a set that
  // outlives the file turns "two `@mixin x` in one file" into "two `@mixin x` anywhere in
  // the corpus", which is a different and wrong number.
  const mixinSeen = new Set<string>()
  const fnSeen = new Set<string>()
  const assignedAbove = new Set<string>()
  const assignedAboveTop = new Set<string>()
  const topNames = new Set<string>()
  const scan = (n: any) => {
    if (n.type === "declaration") {
      const p = kidOf(n, "property_name")
      const name = p ? p.text : ""
      if (name.startsWith("$")) {
        const scoped = insideScope(n)
        if (!scoped) {
          cls.moduleLevelDeclarations++
          topNames.add(name)
          cls.moduleLevelDistinct.add(name)
          if (/^[-_]/.test(name.slice(1))) cls.moduleLevelPrivate++
          if (assignedAbove.has(name)) {
            // TIGHTENED: `!global` overrides an assignment that is IN SCOPE, which for a
            // global binding means one made at the file's top level. A prior assignment
            // buried inside another mixin is that mixin's LOCAL variable, and `!global`
            // beside it CREATES a global rather than replacing one.
            if (hasGlobalFlag(n)) {
              cls.globalReassign++
              if (assignedAboveTop.has(name)) cls.globalReassignOuter++
              if (cls.globalReassignExamples.length < 8) cls.globalReassignExamples.push(`${label}:${n.startPosition.row + 1} ${name} !global`)
            } else if (hasDefaultFlag(n)) {
              cls.defaultAfterAssign++
              if (cls.defaultAfterExamples.length < 8) cls.defaultAfterExamples.push(`${label}:${n.startPosition.row + 1} ${name} !default`)
            } else if (readsVariable(n, name)) {
              cls.sameScopeSelfReading++
            } else {
              cls.sameScopeOtherReading++
              if (cls.sameScopeOtherExamples.length < 8) cls.sameScopeOtherExamples.push(`${label}:${n.startPosition.row + 1} ${name}`)
            }
          }
          assignedAbove.add(name)
          assignedAboveTop.add(name)
        }
      } else {
        // a top-level CSS declaration that reads a `$var`: an edge the lane currently
        // emits with NO source, because nothing published encloses it
        if (!insideScope(n)) {
          let reads = false
          const stack = [n]
          while (stack.length) { const c = stack.pop(); if (!c) continue; if (c.type === "variable") reads = true; for (const k of named(c)) stack.push(k) }
          if (reads) cls.topLevelNoOwnerReads++
        }
      }
    } else if (n.type === "include_statement" && !insideScope(n)) cls.topLevelNoOwnerIncludes++
    else if (n.type === "extend_statement") {
      if (!insideScope(n)) cls.topLevelNoOwnerExtends++
      const ph = findDeep(n, "placeholder")
      if (ph) cls.extendPlaceholder++
      else if (!(kidOf(n, "class_selector") || kidOf(n, "id_selector") || kidOf(n, "plain_value"))) cls.extendOtherUnreadable++
    } else if (n.type === "placeholder") {
      // counted by NODE TYPE, which is what the workstream asks for: the regex version
      // of this probe was tried first and read 1,881, which is not what the tree says
      const parentType = n.parent?.type ?? "(none)"
      // A placeholder node is only a PLACEHOLDER SELECTOR when it sits in a `selectors`
      // node. Under `ERROR` it is the `%name-#{$x}` half of an interpolated selector,
      // which the grammar could not read and which names nothing.
      if (parentType === "selectors") {
        cls.placeholderDeclared++
        cls.placeholderDeclaredFiles.add(label)
        cls.placeholderDistinct.add(collapse(n.text))
        if (cls.placeholderExample.length < 8) cls.placeholderExample.push(`${label}:${n.startPosition.row + 1} ${collapse(n.text).slice(0, 40)}`)
      } else cls.placeholderInError++
    } else if (n.type === "mixin_statement") {
      const nm = n.childForFieldName?.("name") ?? kidOf(n, "identifier")
      const k = `mixin:${nm ? collapse(nm.text) : ""}`
      if (mixinSeen.has(k)) cls.mixinRedefined++
      else mixinSeen.add(k)
    } else if (n.type === "function_statement") {
      const nm = n.childForFieldName?.("name") ?? kidOf(n, "identifier")
      const k = `fn:${nm ? collapse(nm.text) : ""}`
      if (fnSeen.has(k)) cls.fnRedefined++
      else fnSeen.add(k)
    }
    for (const c of kids(n)) scan(c)
  }
  scan(root)
  t.delete?.()
}
function findDeep(n: any, type: string): any | null {
  const stack = [n]
  while (stack.length) { const c = stack.pop(); if (!c) continue; if (c.type === type) return c; for (const k of named(c)) stack.push(k) }
  return null
}
console.log("")
console.log("── the `overrides` classes, counted apart (they are not the same claim) ──")
console.log(`  !global on a name assigned earlier ANYWHERE in the file : ${cls.globalReassign}`)
console.log(`  !global on a name assigned earlier at the FILE'S TOP LEVEL : ${cls.globalReassignOuter}  <- the override class`)
for (const e of cls.globalReassignExamples) console.log(`      ${e}`)
console.log(`  !default on an already-assigned name             : ${cls.defaultAfterAssign}`)
for (const e of cls.defaultAfterExamples) console.log(`      ${e}`)
console.log(`  same-scope reassignment READING ITSELF (accumulator/mutation, NOT an override): ${cls.sameScopeSelfReading}`)
console.log(`  same-scope reassignment not reading itself       : ${cls.sameScopeOtherReading}`)
for (const e of cls.sameScopeOtherExamples) console.log(`      ${e}`)
console.log(`  second @mixin declaration                        : ${cls.mixinRedefined}`)
console.log(`  second @function declaration                     : ${cls.fnRedefined}`)
console.log("")
console.log("── `%placeholder` selectors (a construct the lane does not publish) ──")
console.log(`  \`placeholder\` nodes in a \`selectors\` node (real placeholder selectors): ${cls.placeholderDeclared} occurrences, ${cls.placeholderDistinct.size} distinct names, in ${cls.placeholderDeclaredFiles.size} files`)
console.log(`  \`placeholder\` nodes elsewhere (interpolated, under ERROR): ${cls.placeholderInError}`)
for (const ex of cls.placeholderExample.slice(0, 8)) console.log(`      ${ex}`)
console.log(`  @extend targeting a placeholder: ${cls.extendPlaceholder}`)
console.log(`  @extend targeting something the lane cannot read: ${cls.extendOtherUnreadable}`)
console.log("")
console.log("── the `exports` census (a file IS a Sass module) ──")
console.log(`  top-level declarations: ${cls.moduleLevelDeclarations}, distinct names: ${cls.moduleLevelDistinct.size}, private (-/_): ${cls.moduleLevelPrivate}`)
console.log(`  ⇒ exports edges = distinct non-private top-level members ≈ ${cls.moduleLevelDistinct.size - cls.moduleLevelPrivate} variables + mixins(${mixinDecls}) + functions(${funcDecls})`)
console.log("")
console.log("── top-level statements the lane currently emits NO edge for (no enclosing published symbol) ──")
console.log(`  $var reads in a top-level CSS declaration: ${cls.topLevelNoOwnerReads}`)
console.log(`  @include at top level: ${cls.topLevelNoOwnerIncludes}`)
console.log(`  @extend at top level: ${cls.topLevelNoOwnerExtends}`)

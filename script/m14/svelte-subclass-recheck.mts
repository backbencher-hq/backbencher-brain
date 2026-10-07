// SVELTE SUBCLASS RECHECK — an independent count of every subclass in the corpus,
// written because the construct probe and a text grep DISAGREED and the disagreement
// had to be attributed before `overrides` could be ruled on a number.
//
// THE DISAGREEMENT. script/m14/svelte-construct-probe.mts reports:
//     extends_clause nodes 3, classes carrying a SUPERCLASS 3, distinct superclasses 3
// A plain grep for `class X extends` / `class extends` over the same corpus returns
// 19 sites in 17 files. One of those two numbers is wrong, or the two are counting
// different things. The `overrides` ruling rests on the smaller one, so the smaller
// one is the one that had to be checked.
//
// THE HYPOTHESIS, and it is the boring one. Most Svelte web components are written as
// a class EXPRESSION passed straight to customElements.define:
//
//     customElements.define('my-el', class extends HTMLElement { ... })
//
// which tree-sitter reports as a `class` node, not a `class_declaration`, and whose
// heritage the probe may or may not have counted. The probe's calibration row does
// list `class 10`, so it saw the node type. Whether it walked heritage INSIDE those
// expressions is the question this file answers from scratch.
//
// WHAT THIS FILE IS. A second, independently written walker. It does not import
// svelte-construct-probe.mts, it does not share its helpers, and it counts a
// different thing: not node types but CLASSES THAT HAVE A SUPERCLASS, wherever the
// superclass clause is written, plus for each one the superclass NAME and its
// members. That is the population an `overrides` edge is drawn from.
//
// NO REGEX (master rule 1). Node types, field names, child cursors, Set membership
// and explicit char comparisons only. The single place a text test appears is a
// comparison of two strings for equality.
//
//   bun script/m14/svelte-subclass-recheck.mts
//   ONLY_REPO=svelte bun script/m14/svelte-subclass-recheck.mts
//
// POPULATION is derived by readdir over the corpus root.

import { readFileSync, readdirSync, statSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { createHash } from "node:crypto"
import { join } from "node:path"

const REPO = process.env.BB_REPO || fileURLToPath(new URL("../..", import.meta.url))
const CORPUS = process.env.BB_CORPUS || "$HOME/fixtures/repositories"
const ONLY = process.env.ONLY_REPO || ""
const MAXBYTES = 512 * 1024

function declaredName(n: any): string {
  const f = n.childForFieldName ? n.childForFieldName("name") : null
  if (f) return f.text
  for (let i = 0; i < n.namedChildCount; i++) {
    const c = n.namedChild(i)
    if (c && (c.type === "identifier" || c.type === "type_identifier")) return c.text
  }
  return ""
}
function firstChildOfType(n: any, type: string): any {
  for (let i = 0; i < n.namedChildCount; i++) {
    const c = n.namedChild(i)
    if (c && c.type === type) return c
  }
  return null
}
/** Walk the heritage chain of a class-shaped node, whatever it is called. */
function heritageOf(classNode: any): any {
  // `class_declaration` / `class` put heritage directly on the node; the probe
  // header records that it is a `class_heritage` CHILD, not a field, so both are tried.
  const viaField = classNode.childForFieldName ? classNode.childForFieldName("superclass") : null
  if (viaField) return viaField
  return firstChildOfType(classNode, "class_heritage")
}
function extendsTarget(heritage: any): string {
  if (!heritage) return ""
  const clause = firstChildOfType(heritage, "extends_clause")
  if (!clause) return ""
  // extends_clause -> identifier | type_identifier, possibly after type_arguments.
  for (let i = 0; i < clause.namedChildCount; i++) {
    const c = clause.namedChild(i)
    if (!c) continue
    if (c.type === "type_identifier" || c.type === "identifier") return c.text
  }
  return ""
}
/** Members declared in a class body, as `name` strings. */
function membersOf(classNode: any): string[] {
  const body = firstChildOfType(classNode, "class_body")
  if (!body) return []
  const out: string[] = []
  const stack: any[] = [body]
  while (stack.length) {
    const n = stack.pop()!
    // Only DIRECT children of the class body count as that class's members.
    if (n !== body) {
      const t = n.type
      if (t === "method_definition" || t === "public_field_definition" ||
          t === "abstract_method_signature" || t === "property_signature") {
        const nm = declaredName(n)
        if (nm) out.push(nm)
        continue
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) stack.push(c)
    }
  }
  return out
}
function svelteFiles(dir: string, out: string[], depth = 0): void {
  if (depth > 20) return
  let ents: any[]
  try {
    ents = readdirSync(dir, { withFileTypes: true }) as any[]
  } catch {
    return
  }
  for (const e of ents) {
    const p = join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === ".git") continue
      svelteFiles(p, out, depth + 1)
    } else if (e.name.endsWith(".svelte")) out.push(p)
  }
}

const engine: any = await import(`${REPO}/src/ast/engine.ts`)
const svelteParser: any = await engine.getParser("svelte")
const jsParser: any = await engine.getParser("javascript")
const tsParser: any = await engine.getParser("typescript")

const files: string[] = []
for (const e of readdirSync(CORPUS).sort()) {
  if (ONLY && !e.includes(ONLY)) continue
  const d = join(CORPUS, e)
  try {
    if (statSync(d).isDirectory()) svelteFiles(d, files)
  } catch {
    continue
  }
}
files.sort()

// Corpus-wide map: class name -> member names, so a base declared in ANOTHER SFC is
// still found. The construct probe notes a single-file resolver reports 0 for a
// construct that is present whenever base and subclass are separate files; this map
// is what makes that case countable here.
const corpusMembers = new Map<string, Set<string>>()
const corpusFilesOf = new Map<string, Set<string>>()
const subclasses: {
  file: string; cls: string; superName: string; members: string[]
  nodeType: string; lang: string
}[] = []
const declCount = { class_declaration: 0, abstract_class_declaration: 0, class: 0 }
let scriptBlocks = 0
let tsBlocks = 0
let subFail = 0

for (const abs of files) {
  let content: string
  try {
    if (statSync(abs).size > MAXBYTES) continue
    content = readFileSync(abs, "utf8")
  } catch {
    continue
  }
  if (content.length === 0) continue
  let tree: any
  try {
    tree = svelteParser.parse(content)
  } catch {
    continue
  }
  const stack: any[] = [tree.rootNode]
  while (stack.length) {
    const n = stack.pop()!
    if (n.type === "script_element") {
      scriptBlocks++
      // BUG FOUND AND FIXED HERE, and it is why this file exists. First version of this
      // walker read `lang` off the script_element's OWN attribute children and found
      // 0 lang="ts" blocks on a corpus with 2,031 of them -- printing SUBCLASSES 0 on a
      // corpus the construct probe counts 3 on. Both zeros were my bug, not the corpus's.
      // The attribute is a child of `start_tag`:
      //     script_element > start_tag > attribute > attribute_name
      // Dumped from the pinned grammar to confirm, not assumed.
      const isTs = (() => {
        const startTag = firstChildOfType(n, "start_tag")
        if (!startTag) return false
        for (let i = 0; i < startTag.namedChildCount; i++) {
          const c = startTag.namedChild(i)
          if (!c || c.type !== "attribute") continue
          const nm = firstChildOfType(c, "attribute_name")
          if (!nm || nm.text !== "lang") continue
          const q = firstChildOfType(c, "quoted_attribute_value")
          const inner = q ? firstChildOfType(q, "attribute_value") : null
          return inner ? inner.text === "ts" || inner.text === "tsx" : false
        }
        return false
      })()
      if (isTs) tsBlocks++
      const raw = firstChildOfType(n, "raw_text")
      if (!raw) continue
      let sub: any
      try {
        sub = (isTs ? tsParser : jsParser).parse(raw.text)
      } catch {
        subFail++
        continue
      }
      const rel = abs.slice(CORPUS.length + 1)
      const s2: any[] = [sub.rootNode]
      while (s2.length) {
        const m = s2.pop()!
        if (m.type === "class_declaration" || m.type === "abstract_class_declaration" || m.type === "class") {
          declCount[m.type] = (declCount[m.type] ?? 0) + 1
          const cls = declaredName(m)
          const mem = membersOf(m)
          if (cls) {
            let set = corpusMembers.get(cls)
            if (!set) {
              set = new Set()
              corpusMembers.set(cls, set)
            }
            for (const mm of mem) set.add(mm)
            let fs = corpusFilesOf.get(cls)
            if (!fs) {
              fs = new Set()
              corpusFilesOf.set(cls, fs)
            }
            fs.add(rel)
          }
          const sup = extendsTarget(heritageOf(m))
          if (sup) {
            subclasses.push({ file: rel, cls, superName: sup, members: mem, nodeType: m.type, lang: isTs ? "ts" : "js" })
          }
        }
        for (let i = 0; i < m.namedChildCount; i++) {
          const c = m.namedChild(i)
          if (c) s2.push(c)
        }
      }
      continue
    }
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) stack.push(c)
    }
  }
}

console.log(`svelte-subclass-recheck  repo=${REPO}`)
console.log(`POPULATION (derived by readdir): ${files.length} .svelte files${ONLY ? " in " + ONLY : ""}`)
console.log(`  <script> blocks ${scriptBlocks} (lang ts/tsx ${tsBlocks})  sub-parse failures ${subFail}`)
console.log(`  class-shaped declarations: class_declaration ${declCount.class_declaration}, abstract_class_declaration ${declCount.abstract_class_declaration}, class (expression) ${declCount.class}`)
console.log("")
console.log(`SUBCLASSES (a class-shaped node carrying an extends_clause): ${subclasses.length}`)
console.log("  by node type: " + JSON.stringify(
  subclasses.reduce((a: any, s) => ((a[s.nodeType] = (a[s.nodeType] ?? 0) + 1), a), {} as any),
))
console.log("")
console.log("  file                                                       node           class    superclass        members")
console.log("  " + "-".repeat(112))
for (const s of subclasses.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0))) {
  console.log(`  ${s.file.slice(0, 58).padEnd(58)}  ${s.nodeType.padEnd(13)}  ${(s.cls || "(anon)").padEnd(8)} ${s.superName.padEnd(16)} ${s.members.join(",") || "-"}`)
}
console.log("")

// The ruling's own condition, counted here independently.
let resolved = 0
let unresolved = 0
const overrideRows: string[] = []
const collisionRows: string[] = []
for (const s of subclasses) {
  const baseSet = corpusMembers.get(s.superName)
  const baseFiles = corpusFilesOf.get(s.superName)
  if (baseSet && baseFiles) {
    resolved++
    // A base declared in several SFCs makes the target ambiguous, so record it.
    if (baseFiles.size > 1) {
      collisionRows.push(`  ${s.cls} extends ${s.superName} -- base declared in ${baseFiles.size} corpus files, so the target is AMBIGUOUS`)
    }
    for (const m of s.members) {
      // ECMAScript does not inherit a constructor; counting it would invent an edge.
      if (m === "constructor") continue
      if (baseSet.has(m)) overrideRows.push(`  ${s.file} :: ${s.cls}.${m} -> ${s.superName}.${m}`)
    }
  } else {
    unresolved++
    console.log(`  UNRESOLVED base: ${s.cls} extends ${s.superName} (${s.file}) -- declared by no corpus file, so an edge to it would be fabricated`)
  }
}
console.log("")
console.log("THE RULING'S CONDITION, counted by this walker")
console.log(`  subclasses                                  ${subclasses.length}`)
console.log(`  ... superclass RESOLVED to a corpus class    ${resolved}`)
console.log(`  ... superclass NOT declared in the corpus    ${unresolved}`)
console.log(`  NAME COLLISIONS (ambiguous base)             ${collisionRows.length}`)
for (const r of collisionRows) console.log(r)
console.log(`  RESOLVED OVERRIDES                           ${overrideRows.length}`)
for (const r of overrideRows) console.log(r)
console.log("")
console.log("CALIBRATION — rows that must be non-zero for the zeros above to be absences:")
console.log(`  class-shaped declarations seen              ${Object.values(declCount).reduce((a, b) => a + b, 0)}`)
console.log(`  distinct class names in the corpus          ${corpusMembers.size}`)
console.log(`  corpus names carrying at least one member   ${[...corpusMembers.values()].filter((v) => v.size > 0).length}`)
console.log(`  analyzer digest                             ${createHash("sha256").update(readFileSync(join(REPO, "src/ast/real-svelte-analyzer.ts"), "utf8")).digest("hex").slice(0, 16)}`)
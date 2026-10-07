// SVELTE CONSTRUCT PROBE — the falsifiable half of this lane's `overrides`
// ruling, and the measurement behind `extends`/`implements` besides.
//
// WHY A PROBE AND NOT A REASONING. `overrides` is the type the ontology gate
// exists because of: bash omitted it for a whole wave behind a prose
// justification and the differential stayed green (the analyzer omitted it and
// the oracle was written after the ruling — nothing agrees with nothing). So the
// question is not "is `overrides` meaningful for Svelte" but "does the construct
// occur", and only a count over a corpus answers that.
//
// WHAT THE CONSTRUCT IS, in the terms the probe measures. An override is a
// member declared in a SUBCLASS with a name a member of its SUPERCLASS already
// has. Every clause is load-bearing:
//   - the declaring type must have a SUPERCLASS, so the member re-declares
//     something rather than declaring it for the first time;
//   - a member of a class with no superclass can never override anything;
//   - the superclass need not be in the same FILE. A single-file probe reports 0
//     for a construct that is present whenever the subclass and its base are
//     separate SFCs — which in a component library is the normal case. So the
//     corpus-wide member-name sets are built first and every subclass member is
//     then tested against them.
//
// THE GRAMMAR SHAPES THIS PROBE READS, and where they came from. Every one was
// dumped from the pinned wasm before being coded against; two of my first
// assumptions were WRONG and the calibration row below is what said so:
//
//   WRONG 1: heritage is not `extends_clause` on the class. It is a `class_heritage`
//           child wrapping the clause, and the JS grammar has no `superclass` field
//           at all. Probing for a `superclass` field reported 0 classes with a
//           superclass on a corpus that plainly contains
//           `class Tracking extends HTMLElement`.
//   WRONG 2: an attribute's value is not a direct `attribute_value` child. It is
//           `attribute > attribute_name = quoted_attribute_value > attribute_value`.
//           Probing the direct child read every `lang="ts"` as absent, so 149
//           TypeScript script blocks were parsed with the JAVASCRIPT grammar — and
//           tree-sitter-javascript has no `interface_declaration` and no
//           `implements_clause`, so the probe reported 0 interfaces and 0
//           implements on the one corpus file that has both. The calibration row
//           (100 class-shaped declarations found, 0 interfaces) is what exposed it;
//           a probe that returns 0 for everything is indistinguishable from a
//           working one, which is why the row is printed rather than assumed.
//
//   class_declaration          -> class_heritage? -> extends_clause  -> identifier | type_identifier (+ type_arguments)
//                                            \-> implements_clause -> type_identifier
//   abstract_class_declaration -> class_body
//   interface_declaration      -> interface_body -> property_signature | method_signature
//   class_body                 -> method_definition | public_field_definition | abstract_method_signature
//
// NO REGEX ANYWHERE (master rule 1). Node types, field names, Set membership and
// explicit char walks only.
//
//   bun script/m14/svelte-construct-probe.mts
//   ONLY_REPO=svelte bun script/m14/svelte-construct-probe.mts
//
// The population is DERIVED by readdir over the corpus root, never a hand-written
// list (M14 honesty contract §"an instrument must declare the population it
// covered"): a hard-coded list rots silently and keeps reporting 0 with total
// confidence.

import { readFileSync, readdirSync, statSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { join } from "node:path"

const REPO = process.env.BB_REPO || fileURLToPath(new URL("../..", import.meta.url))
const CORPUS = process.env.BB_CORPUS || "$HOME/fixtures/repositories"
const ONLY = process.env.ONLY_REPO || ""
const MAXBYTES = 512 * 1024

// ------------------------------------------------------------------ AST utils
function namedChildren(n: any): any[] {
  const out: any[] = []
  for (let i = 0; i < n.namedChildCount; i++) {
    const c = n.namedChild(i)
    if (c) out.push(c)
  }
  return out
}
function fieldOf(n: any, name: string): any {
  try {
    return n.childForFieldName ? n.childForFieldName(name) : null
  } catch {
    return null
  }
}
function findChildByType(n: any, type: string): any {
  for (const c of namedChildren(n)) if (c.type === type) return c
  return null
}
/** The attribute's value, through `quoted_attribute_value` — see WRONG 2 above. */
function attributeValue(a: any): string {
  const direct = findChildByType(a, "attribute_value")
  if (direct) return direct.text
  const quoted = findChildByType(a, "quoted_attribute_value")
  if (!quoted) return ""
  const inner = findChildByType(quoted, "attribute_value")
  return inner ? inner.text : ""
}
function attributeName(a: any): string {
  const nm = findChildByType(a, "attribute_name")
  return nm ? nm.text : ""
}
function* walk(n: any): Generator<any> {
  const stack: any[] = [n]
  while (stack.length > 0) {
    const m = stack.pop()!
    yield m
    for (let i = m.namedChildCount - 1; i >= 0; i--) {
      const c = m.namedChild(i)
      if (c) stack.push(c)
    }
  }
}

// --------------------------------------------------------- file population
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
      if (e.name === "node_modules" || e.name === ".git" || e.name === "dist" || e.name === "build") continue
      svelteFiles(p, out, depth + 1)
    } else if (e.name.endsWith(".svelte")) out.push(p)
  }
}
const repoDirs: string[] = []
for (const e of readdirSync(CORPUS).sort()) {
  if (ONLY && !e.includes(ONLY)) continue
  const dir = join(CORPUS, e)
  try {
    if (statSync(dir).isDirectory()) repoDirs.push(dir)
  } catch {
    continue
  }
}
const files: string[] = []
for (const r of repoDirs) svelteFiles(r, files)
files.sort()

const eng: any = await import(`${REPO}/src/ast/engine.ts`)

// ------------------------------------------------------- grammar vocabulary
const CLASS_NODES = new Set(["class_declaration", "abstract_class_declaration", "class"])
const INTERFACE_NODES = new Set(["interface_declaration"])
const METHOD_NODES = new Set(["method_definition", "method_signature", "abstract_method_signature"])
const FIELD_NODES = new Set(["public_field_definition", "property_signature", "field_definition"])

/** Members of a class or interface body. */
function membersOf(decl: any): Array<{ name: string; isMethod: boolean }> {
  const body =
    fieldOf(decl, "body") ??
    findChildByType(decl, "class_body") ??
    findChildByType(decl, "interface_body")
  const out: Array<{ name: string; isMethod: boolean }> = []
  if (!body) return out
  for (const m of namedChildren(body)) {
    if (METHOD_NODES.has(m.type)) {
      const nm = fieldOf(m, "name") ?? findChildByType(m, "property_identifier")
      if (nm) out.push({ name: nm.text, isMethod: true })
    } else if (FIELD_NODES.has(m.type)) {
      const nm = fieldOf(m, "name") ?? fieldOf(m, "property") ?? findChildByType(m, "property_identifier")
      if (nm) out.push({ name: nm.text, isMethod: false })
    }
  }
  return out
}

/** The `extends` side of a class's heritage, or null. */
function superclassOf(n: any): any {
  const heritage = findChildByType(n, "class_heritage")
  if (!heritage) return null
  return findChildByType(heritage, "extends_clause")
}
/** The `implements` side of a class's heritage, or null. */
function implementsOf(n: any): any {
  const heritage = findChildByType(n, "class_heritage")
  if (!heritage) return null
  return findChildByType(heritage, "implements_clause")
}
/** The single type a clause names (the first type node under it). */
function clauseTarget(clause: any): string {
  if (!clause) return ""
  for (const c of namedChildren(clause)) {
    if (c.type === "type_identifier" || c.type === "identifier" || c.type === "nested_type_identifier") return c.text
  }
  return ""
}
/** `{ name, params }` per SFC — `<script>` blocks of one file. */
function scriptBlocksOf(tree: any, content: string): Array<{ body: string; lang: string }> {
  const out: Array<{ body: string; lang: string }> = []
  for (const n of walk(tree.rootNode)) {
    if (n.type !== "script_element") continue
    let raw: any = null
    let lang = "js"
    const st = findChildByType(n, "start_tag")
    if (st) {
      for (const a of namedChildren(st)) {
        if (a.type !== "attribute") continue
        if (attributeName(a) === "lang") {
          const v = attributeValue(a)
          if (v === "ts" || v === "tsx") lang = v
        }
      }
    }
    for (const c of namedChildren(n)) if (c.type === "raw_text") raw = c
    if (!raw) continue
    const body = content.substring(raw.startIndex, raw.endIndex)
    if (body.trim().length > 0) out.push({ body, lang })
  }
  return out
}

// ------------------------------------------------------------------- counters
const C = {
  filesRead: 0,
  filesOverBytes: 0,
  filesEmpty: 0,
  svelteParseFail: 0,
  scriptBlocks: 0,
  scriptBlocksTs: 0,
  subParseFail: 0,
  nodeTypeCounts: new Map<string, number>(),
  classesTotal: 0,
  classesWithSuperclass: 0,
  classesWithImplements: 0,
  classesWithBoth: 0,
  abstractClasses: 0,
  classesNoBody: 0,
  interfacesTotal: 0,
  interfacesWithExtendsClause: 0,
  extendsClauseNodes: 0,
  implementsClauseNodes: 0,
  methodsInSubclass: 0,
  fieldsInSubclass: 0,
  methodsInRootClass: 0,
  fieldsInRootClass: 0,
  methodsInInterface: 0,
  fieldsInInterface: 0,
  superclassNames: new Set<string>(),
  overrideCandidates: 0,
  resolvedOverrides: 0,
  nameCollisions: 0,
  methodOverMethod: 0,
  methodOverField: 0,
  fieldOverMethod: 0,
  fieldOverField: 0,
  overrideFiles: new Set<string>(),
  overrideSamples: [] as string[],
  /** The member names every class carries that JS does not treat as an override. */
  constructorOverConstructor: 0,
  duplicateClassNames: 0,
  /** Subclasses whose superclass IS declared somewhere in the corpus — the ones a
   *  resolver can actually close. The rest extend a host type (HTMLElement,
   *  HTMLButtonElement) and no corpus file can say what that type declares. */
  superclassResolved: 0,
  superclassUnresolved: 0,
  unresolvedSamples: [] as string[],
}
const bump = (m: Map<string, number>, k: string): void => m.set(k, (m.get(m?.get ? k : k) ?? 0) + 1)

type Member = { name: string; isMethod: boolean }
/** Declared name -> the members of that declaration, corpus-wide. Resolution
 *  across FILES is deliberate: a base class in one SFC and its subclass in
 *  another is ordinary in a component library, and a single-file resolver would
 *  report 0 for a construct that is present. */
const declaredClasses = new Map<string, Member[]>()
const globalMethodNames = new Set<string>()
const globalFieldNames = new Set<string>()
const subclassDeclarations: Array<{ rel: string; superclass: string; name: string; members: Member[] }> = []

const pSvelte = async (): Promise<any> => await eng.getParser("svelte")
const pJs = async (): Promise<any> => await eng.getParser("javascript")
const pTs = async (): Promise<any> => await eng.getParser("typescript")

for (const f of files) {
  let content: string
  try {
    if (statSync(f).size > MAXBYTES) {
      C.filesOverBytes++
      continue
    }
    content = readFileSync(f, "utf8")
  } catch {
    continue
  }
  if (content.length === 0) {
    C.filesEmpty++
    continue
  }
  C.filesRead++
  const rel = f.startsWith(CORPUS) ? f.slice(CORPUS.length + 1) : f

  let tree: any
  try {
    tree = (await pSvelte()).parse(content, f)
  } catch {
    C.svelteParseFail++
    continue
  }
  const blocks = scriptBlocksOf(tree, content)
  C.scriptBlocks += blocks.length

  for (const b of blocks) {
    if (b.lang !== "js") C.scriptBlocksTs++
    let sub: any
    try {
      // The lang attribute decides the GRAMMAR, not the analyzer. Getting this
      // wrong is what produced the first version of this probe's 0.
      sub = (b.lang === "ts" || b.lang === "tsx" ? await pTs() : await pJs()).parse(b.body)
    } catch {
      C.subParseFail++
      continue
    }
    for (const n of walk(sub.rootNode)) {
      // A full type/heritage vocabulary, so the CALIBRATION row can print what the
      // grammar actually produced rather than what this file expected to find.
      if (
        n.type === "class_declaration" ||
        n.type === "abstract_class_declaration" ||
        n.type === "class" ||
        n.type === "interface_declaration" ||
        n.type === "extends_clause" ||
        n.type === "implements_clause" ||
        n.type === "class_heritage" ||
        n.type === "method_definition" ||
        n.type === "public_field_definition" ||
        n.type === "property_signature" ||
        n.type === "abstract_method_signature"
      ) {
        bump(C.nodeTypeCounts, n.type)
      }
      if (n.type === "extends_clause") C.extendsClauseNodes++
      if (n.type === "implements_clause") C.implementsClauseNodes++

      if (CLASS_NODES.has(n.type)) {
        C.classesTotal++
        if (n.type === "abstract_class_declaration") C.abstractClasses++
        const hasBody = !!(fieldOf(n, "body") ?? findChildByType(n, "class_body"))
        if (!hasBody) C.classesNoBody++
        const sup = superclassOf(n)
        const impl = implementsOf(n)
        const members = membersOf(n)
        if (sup) {
          C.classesWithSuperclass++
          C.superclassNames.add(clauseTarget(sup))
          for (const m of members) {
            if (m.isMethod) C.methodsInSubclass++
            else C.fieldsInSubclass++
          }
          const selfName = clauseTarget(fieldOf(n, "name") ?? {}) || (fieldOf(n, "name")?.text ?? "")
          subclassDeclarations.push({
            rel,
            superclass: clauseTarget(sup) || "(unnamed)",
            name: selfName,
            members,
          })
        } else {
          for (const m of members) {
            if (m.isMethod) C.methodsInRootClass++
            else C.fieldsInRootClass++
          }
        }
        if (impl) C.classesWithImplements++
        if (sup && impl) C.classesWithBoth++
        // A class is registered by its DECLARED name, so a subclass can be resolved
        // to it. Registering a second declaration of the same name would make
        // resolution ambiguous, so the count of such collisions is reported rather
        // than silently resolved to whichever was seen last.
        const declName = fieldOf(n, "name")?.text ?? ""
        if (declName) {
          if (declaredClasses.has(declName)) C.duplicateClassNames++
          else declaredClasses.set(declName, members)
        }
        for (const m of members) {
          if (m.isMethod) globalMethodNames.add(m.name)
          else globalFieldNames.add(m.name)
        }
      }
      if (INTERFACE_NODES.has(n.type)) {
        C.interfacesTotal++
        const ext = findChildByType(n, "extends_type_clause") ?? findChildByType(n, "extends_clause")
        if (ext) C.interfacesWithExtendsClause++
        for (const m of membersOf(n)) {
          if (m.isMethod) C.methodsInInterface++
          else C.fieldsInInterface++
        }
      }
    }
  }
  try {
    tree?.delete?.()
  } catch {
    /* ignore */
  }
}

// --- the decisive override test --------------------------------------------
// TWO counts, and the difference between them is the whole ruling.
//
//   (1) NAME COLLISION — a subclass member whose name any class member in the
//       corpus already has. Cheap, resolvable without knowing anything about
//       inheritance, and NOT an override: two unrelated classes both having
//       `render()` says nothing about either overriding the other.
//
//   (2) RESOLVED OVERRIDE — the same collision, with the superclass resolved to a
//       DECLARATION and the member found in THAT class's own body. This is what a
//       correct implementation needs in order to name a `from`, a `to` and a line,
//       and it is the only one of the two that is evidence.
//
// A member named `constructor` is counted separately and NOT as an override:
// ECMAScript does not inherit a constructor — `new Sub()` invokes `Sub`'s own —
// so counting it would report an override the language has not got.
const CTOR = "constructor"
for (const sc of subclassDeclarations) {
  const base = declaredClasses.get(sc.superclass)
  if (!base) {
    C.superclassUnresolved++
    if (C.unresolvedSamples.length < 12) {
      C.unresolvedSamples.push(`${sc.rel} :: ${sc.name || "(anon)"} extends ${sc.superclass} — not declared in the corpus`)
    }
    continue
  }
  C.superclassResolved++
  for (const m of sc.members) {
    const baseMember = base.find((b) => b.name === m.name)
    const nameCollision = m.isMethod
      ? globalMethodNames.has(m.name) || globalFieldNames.has(m.name)
      : globalFieldNames.has(m.name) || globalMethodNames.has(m.name)
    if (nameCollision && !(m.name === CTOR)) {
      // collision only — recorded, not an override
    }
    if (m.name === CTOR && baseMember) {
      C.constructorOverConstructor++
      continue
    }
    if (baseMember) {
      C.resolvedOverrides++
      C.overrideFiles.add(sc.rel)
      if (C.overrideSamples.length < 12) {
        C.overrideSamples.push(
          `${sc.rel} :: ${m.isMethod ? "method" : "field"} ${m.name} in ${sc.name} over ${sc.superclass}` +
            ` (${baseMember.isMethod ? "method" : "field"} there)`,
        )
      }
      if (m.isMethod && baseMember.isMethod) C.methodOverMethod++
      else if (!m.isMethod && !baseMember.isMethod) C.fieldOverField++
      else if (m.isMethod && !baseMember.isMethod) C.methodOverField++
      else C.fieldOverMethod++
    }
  }
}
// The name-collision count, for contrast, restricted to the RESOLVABLE subclasses so
// the two numbers describe the same population.
for (const sc of subclassDeclarations) {
  const base = declaredClasses.get(sc.superclass)
  if (!base) continue
  for (const m of sc.members) {
    if (m.name === CTOR) continue
    const hit =
      globalMethodNames.has(m.name) || globalFieldNames.has(m.name)
    if (hit) C.nameCollisions++
  }
}

// ------------------------------------------------------------------- report
console.log(`svelte-construct-probe  corpus=${CORPUS}${ONLY ? "  only=" + ONLY : ""}`)
console.log(`POPULATION (derived by readdir, not hand-listed): ${files.length} .svelte files across ${repoDirs.length} repos`)
console.log(`  read ${C.filesRead}  over ${MAXBYTES}B ${C.filesOverBytes}  empty ${C.filesEmpty}  svelte parse fail ${C.svelteParseFail}`)
console.log(`  <script> blocks ${C.scriptBlocks} (lang ts/tsx ${C.scriptBlocksTs})  sub-parsed ${C.scriptBlocks - C.subParseFail}  sub-parse fail ${C.subParseFail}`)
console.log("")
console.log("CALIBRATION — the type/heritage vocabulary the grammar ACTUALLY produced.")
console.log("  A zero elsewhere in this report is an absence, not a broken probe, because these are non-zero.")
for (const [k, v] of [...C.nodeTypeCounts.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`      ${k.padEnd(28)} ${v}`)
}
console.log("")
console.log("HERITAGE")
console.log(`  class-shaped declarations                     ${C.classesTotal}   (abstract ${C.abstractClasses}, no body ${C.classesNoBody})`)
console.log(`  ... with a SUPERCLASS (extends_clause)        ${C.classesWithSuperclass}   distinct superclasses: ${C.superclassNames.size}`)
console.log(`      ${[...C.superclassNames].filter(Boolean).join(" ") || "(none)"}`)
console.log(`  ... with an IMPLEMENTS clause                 ${C.classesWithImplements}`)
console.log(`  ... with both                                 ${C.classesWithBoth}`)
console.log(`  interface declarations                        ${C.interfacesTotal}   with an extends clause ${C.interfacesWithExtendsClause}`)
console.log(`  extends_clause nodes ${C.extendsClauseNodes}   implements_clause nodes ${C.implementsClauseNodes}`)
console.log("")
console.log("MEMBERS")
console.log(`  methods in a SUBCLASS                         ${C.methodsInSubclass}`)
console.log(`  fields  in a SUBCLASS                         ${C.fieldsInSubclass}`)
console.log(`  methods in a class with NO superclass         ${C.methodsInRootClass}`)
console.log(`  fields  in a class with NO superclass         ${C.fieldsInRootClass}`)
console.log(`  methods in an interface                       ${C.methodsInInterface}`)
console.log(`  fields  in an interface                       ${C.fieldsInInterface}`)
console.log(`  distinct class/interface member names         ${globalMethodNames.size} methods, ${globalFieldNames.size} fields`)
console.log("")
console.log("THE OVERRIDE TEST — two counts, and the gap between them is the whole ruling")
console.log(`  classes carrying a superclass                ${C.classesWithSuperclass}`)
console.log(`  ... superclass RESOLVED to a corpus declaration ${C.superclassResolved}`)
console.log(`  ... superclass NOT declared in the corpus      ${C.superclassUnresolved}`)
for (const s of C.unresolvedSamples) console.log(`      ${s}`)
console.log(`  subclass member rows examined                ${subclassDeclarations.reduce((n, s) => n + s.members.length, 0)}`)
console.log(`  (1) NAME COLLISIONS (same population)          ${C.nameCollisions}`)
console.log(`      a name two classes happen to share. NOT an override: nothing here says either`)
console.log(`      one re-declares the other.`)
console.log(`  (2) RESOLVED OVERRIDES                         ${C.resolvedOverrides} in ${C.overrideFiles.size} files`)
console.log(`      method over method  ${C.methodOverMethod}`)
console.log(`      field  over field   ${C.fieldOverField}`)
console.log(`      method over FIELD   ${C.methodOverField}    (JS: the field wins on the instance, the base method survives on the prototype)`)
console.log(`      field  over METHOD  ${C.fieldOverMethod}   (same reason, other direction)`)
console.log(`  constructors excluded from the count          ${C.constructorOverConstructor}   (ECMAScript does not inherit a constructor)`)
console.log(`  duplicate class declarations (ambiguous base)  ${C.duplicateClassNames}`)
for (const s of C.overrideSamples) console.log(`      RESOLVED e.g. ${s}`)
console.log("")
console.log("OVERRIDE VERDICT INPUT: an `overrides` edge needs a subclass member that re-declares a member")
console.log(`  of its RESOLVED superclass. resolvable subclasses ${C.superclassResolved}, ` +
  `override candidates ${C.resolvedOverrides}.`)

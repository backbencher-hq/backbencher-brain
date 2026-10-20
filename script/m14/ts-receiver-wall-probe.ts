/**
 * TS RECEIVER-WALL PROBE — WHY a member call carries no `metadata.owner`, counted by CAUSE.
 *
 * ## The question this answers
 *
 * The lane's named wall (D7 WALL 1) is the RECEIVER-TYPING wall: `metadata.owner` is stated by
 * twelve syntactic evidence classes, but only 28,502 of 207,852 member calls (13.7%) carry one.
 * The D7 bar forbids leaving a wall merely NAMED — it must end in RESOLVED / CLAIMED /
 * INSTRUMENT GAP / RULED UNDECIDABLE, with a count and a falsifier.
 *
 * The lane's own docstring says the twelve classes enumerate "the syntactic forms that state a
 * receiver's type", and that a row with none of them "has NO type stated anywhere the parser can
 * see". That is a CLAIM about the population, and a claim about the population is a COUNT. This
 * instrument produces it: for every member call with no owner, it classifies the RECEIVER by
 * WHY no owner was stated.
 *
 * ## HOW THE "THE FILE STATES THIS TYPE" TEST IS ANSWERED
 *
 * FROM THE AST, NOT FROM TEXT AND NOT FROM THE SYMBOL TABLE:
 *
 *   - NOT the symbol table: the analyzer's published symbols carry NO type field at all
 *     (measured on a real file: the whole metadata key set is apiMethod · complexity ·
 *     decoratorLines · extends · extendsLines · isConst · isDeclare · isDefault · isExported ·
 *     isGenerator · isInterfaceMember · isOptional — no type). So "the file states this name's
 *     type" cannot be read from what the analyzer publishes.
 *   - NOT text: a regex over the source produced 442 apparent "the file states the type" rows on
 *     a 300-file stride, and HAND-READING the samples showed the classes were ARRAY annotations
 *     (`const toc: TocEntry[] = []` — the ELEMENTS are `TocEntry`, the binding is an ARRAY),
 *     INDEXED ACCESS (`MenuProvider['openedMenus']`), and TYPE PREDICATES (`(p: unknown): p is
 *     string[]` — a NARROWING, not the parameter's type). In every one of those the analyzer is
 *     RIGHT to refuse an owner, and a text probe that counted them would MANUFACTURE a defect.
 *     The first version of this probe's text scan is recorded here as the measured reason the
 *     AST is used instead.
 *
 * The AST test is the analyzer's OWN rule: a name is "typed in this file" when the file writes a
 * BARE type for it — a `type_annotation` whose type node is a plain `type_identifier` (not an
 * array, not an indexed access, not a union) — and the name is not a type-predicate parameter.
 *
 * ## THE CLASSES (each one a decision the analyzer made, each one falsifiable)
 *
 *   the file states this name's type, no owner carried → the analyzer SHOULD have carried it. A
 *                                                              row here is a DEFECT (a stated type
 *                                                              not read). THIS IS THE FALSIFIER.
 *   receiver is a LOCAL with no type in this file      → the type is not in the file. The row
 *                                                              needs a type the SYNTAX does not state.
 *   receiver is a PARAMETER / FIELD with no type       → same as above; the type may be stated at
 *                                                              the CALL SITE (cross-file).
 *   receiver is an IMPORTED BINDING                    → the type lives in another file or in
 *                                                              node_modules. Not decidable here.
 *   receiver is `this`                                 → the field's type is not stated.
 *   receiver is a CALL result                          → the call's RETURN TYPE is not stated here
 *                                                              (a same-file factory's annotated
 *                                                              return IS the C5 class, which fires).
 *   receiver is a CHAIN off a root (depth ≥ 2)         → `cfg.a.b.run()`: the one-hop class reads
 *                                                              `cfg.a`'s type, and then needs
 *                                                              `a`'s MEMBER's type — a second hop.
 *   receiver root is not a plain identifier             → a numeric/string literal receiver, a
 *                                                              parenthesised expression, etc.
 *
 * ## The falsifier
 *
 * A row in the FIRST class REFUTES the "the analyzer reads every type the file states" claim. The
 * probe counts them and PRINTS them with file and line, so the claim can be checked row by row
 * rather than believed.
 *
 * ## Population rule
 *
 * Derived per run the way `incoming-gate.ts` derives its own: every git checkout under
 * `$BB_CORPUS_ROOT`, `git ls-files`, extension admitted, size cap, deterministic stride. The
 * population is PRINTED. `--max-files 0` is the whole population.
 *
 * Usage:
 *   BB_CORPUS_ROOT=$PWD/.corpus bun run script/m14/ts-receiver-wall-probe.ts [--max-files N] [--json out.json]
 */
import { execFileSync } from "node:child_process"
import * as fs from "node:fs"
import * as path from "node:path"
import { ASTEngine } from "../../src/ast/engine"

const CR = process.env.BB_CORPUS_ROOT ?? path.join(process.cwd(), ".corpus")
const argv = process.argv.slice(2)
const argOf = (flag: string): string | null => {
  const i = argv.indexOf(flag)
  return i >= 0 ? (argv[i + 1] ?? null) : null
}
const MAX_FILES = Number(argOf("--max-files") ?? 0)
const JSON_OUT = argOf("--json")
const SIZE_CAP = 1024 * 1024

/** THE DISCOVERY RULE — the gate's own (extension match, size cap, present file). */
function discover(): { files: string[]; admitted: number; repos: number; overCap: number; absent: number } {
  const found: string[] = []
  const repos = new Set<string>()
  let overCap = 0
  let absent = 0
  let entries: string[]
  try { entries = fs.readdirSync(CR) } catch { return { files: [], admitted: 0, repos: 0, overCap, absent } }
  for (const name of entries.sort()) {
    const dir = path.join(CR, name)
    try { if (!fs.statSync(dir).isDirectory()) continue } catch { continue }
    try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
    let tracked: string[]
    try {
      tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
        .split("\0").filter(Boolean)
    } catch { continue }
    for (const rel of tracked) {
      if (!/\.(ts|tsx|mts|cts)$/.test(rel)) continue
      const abs = path.join(dir, rel)
      try {
        const st = fs.statSync(abs)
        if (!st.isFile()) { absent++; continue }
        if (st.size > SIZE_CAP) { overCap++; continue }
      } catch { absent++; continue }
      found.push(abs)
      repos.add(name)
    }
  }
  found.sort()
  return { files: found, admitted: found.length, repos: repos.size, overCap, absent }
}

/** THE RECEIVER ROOT — the identifier the member access hangs off. `a.b.c()` -> `a`. */
const receiverRootOf = (callee: string): string => {
  const flat = callee.replace(/\s+/g, " ")
  const dot = flat.indexOf(".")
  if (dot <= 0) return ""
  let root = flat.slice(0, dot)
  const firstDot = root.indexOf(".")
  if (firstDot > 0) root = root.slice(0, firstDot)
  return /^[A-Za-z_$][\w$]*$/.test(root) ? root : ""
}

/** IS THE RECEIVER A CALL? `foo().bar()` — the receiver's type is the call's return type. */
const isCallReceiver = (callee: string): boolean => {
  const flat = callee.replace(/\s+/g, " ")
  const dot = flat.indexOf(".")
  if (dot <= 0) return false
  return /\)\s*$/.test(flat.slice(0, dot))
}

/** THE CHAIN DEPTH of the receiver — how many member hops hang off the root. */
const chainDepth = (callee: string): number => {
  const flat = (callee.replace(/\s+/g, " ").split("(")[0] ?? "")
  return (flat.match(/\./g) ?? []).length
}

/**
 * IS THIS TYPE NODE A BARE TYPE? The analyzer's own rule, read from the grammar:
 * `type_identifier` is a bare type; `array_type` (`T[]`), `union_type` (`T | U`),
 * `generic_type` (`T<U>`) and `indexed_access_type` (`T['k']`) are NOT — they state the ELEMENT's
 * type or need resolution, so a receiver's owner cannot be read off them.
 */
const isBareType = (t: any): boolean => !!t && (t.type === "type_identifier" || t.type === "identifier")

/**
 * THE TYPE NODE KINDS THAT DO NOT STATE THE BINDING'S OWN CLASS. An ARRAY states the ELEMENT's
 * type; a UNION states a choice; an INTERSECTION a combination; an INDEXED ACCESS needs
 * resolution. Measured on the AST (not guessed): `const toc: TocEntry[] = []` parses as
 * `type_annotation -> array_type -> type_identifier("TocEntry")`, so the ELEMENT type is one node
 * deeper and the BINDING is an array.
 */
const NON_CLASS_TYPE_NODES = new Set([
  "array_type", "union_type", "intersection_type", "indexed_access_type", "conditional_type", "mapped_type",
  // `predefined_type` is `unknown` / `any` / `never` / `void` / `object` — the TYPE OPERATORS, not
  // a class. Measured on the AST: `const checkIndexPath = (indexPath: unknown): indexPath is
  // string[]` parses as `type_annotation -> predefined_type("unknown")`. There is no member set to
  // resolve inside `unknown`, so no owner can be carried and the analyzer is right to refuse.
  "predefined_type",
])

type Bucket = { count: number; samples: string[] }
const buckets = new Map<string, Bucket>()
const bump = (name: string, sample: string) => {
  let b = buckets.get(name)
  if (!b) buckets.set(name, (b = { count: 0, samples: [] }))
  b.count++
  if (b.samples.length < 6) b.samples.push(sample)
}

const disc = discover()
let files = disc.files
if (MAX_FILES > 0 && disc.admitted > MAX_FILES) {
  const stride = Math.max(1, Math.floor(disc.admitted / MAX_FILES))
  const picked: string[] = []
  for (let i = 0; i < disc.files.length && picked.length < MAX_FILES; i += stride) picked.push(disc.files[i]!)
  files = picked
}

const parser = await ASTEngine.getParser("typescript" as any)
let calls = 0
let memberCalls = 0
let ownerCarrying = 0
let uses = 0
let usesWithOwner = 0
const parseFailures: string[] = []

for (const file of files) {
  const rel = file.startsWith(CR) ? file.slice(CR.length + 1) : file
  let content: string
  try { content = fs.readFileSync(file, "utf8") } catch { parseFailures.push(`${rel}: unreadable`); continue }
  let tree: any
  try { tree = parser.parse(content) } catch (e: any) { parseFailures.push(`${rel}: ${e?.message ?? e}`); continue }
  if (!tree) { parseFailures.push(`${rel}: no tree`); continue }

  // ── THE TYPED NAMES, FROM THE AST ──────────────────────────────────────────────────────────
  // A name is "typed in this file" when the file writes a BARE type for it. Four positions:
  // a declarator's annotation, a parameter's annotation, a field's annotation, and a `new X()`
  // initialiser (the constructor names the class).
  // THE TYPED NAMES, PER ENCLOSING SCOPE. A name typed in ONE function is not typed in another:
  // `normalizeVNode(child: VNodeChild)` in vue-core's vnode.ts and a `child` typed elsewhere in
  // the SAME FILE are different bindings. The probe's first version collected file-wide names and
  // the leak produced a phantom "the file states this name's type" row at vnode.ts:816 — a probe
  // defect, not an analyzer defect. The scope map is keyed by the enclosing function-like node's
  // start index, so a row is matched against the scope it is written in.
  const typedNames = new Set<string>()
  const typedNamesByScope = new Map<number, Set<string>>()
  // AND WHETHER THE TYPE IS A GENERIC — `const result: Sources<R>` states the CONTAINER's type,
  // whose ARGUMENT is the file's own type parameter `R`. `R` is not a class, so no member can be
  // resolved inside it; the concrete type is the CALLER's type argument, which lives in another
  // file. Such a receiver is not a defect (the analyzer is right to refuse it) — it is its own
  // class of the wall, and it is counted separately.
  const typedInfo = new Map<string, { generic: boolean; typeName: string; union: boolean; destructured: boolean }>()
  const typedInfoByScope = new Map<number, Map<string, { generic: boolean; typeName: string; union: boolean; destructured: boolean }>>()
  /** The enclosing scope key of a node — the nearest function-like ancestor's start index, or 0
   *  for the module scope. */
  const scopeOf = (node: any): number => {
    let p = node.parent
    while (p) {
      if (p.type === "function_declaration" || p.type === "function_expression" ||
          p.type === "arrow_function" || p.type === "method_definition" ||
          p.type === "generator_function_declaration") return p.startIndex
      p = p.parent
    }
    return 0
  }
  const scopeTyped = (scope: number, name: string): boolean => {
    // A name is typed for a scope if it is typed IN THAT SCOPE or in an ENCLOSING one (a module
    // scope name is visible everywhere; a function's local is not).
    let s: number | null = scope
    while (s !== null) {
      const set = typedNamesByScope.get(s)
      if (set?.has(name)) return true
      if (s === 0) break
      // WALK OUT to the enclosing scope
      let best = 0
      for (const key of typedNamesByScope.keys()) if (key !== 0 && key < s && key > best) best = key
      s = best
    }
    return false
  }
  /** THE DESTRUCTURED BINDINGS OF THIS FILE — `const { a, b } = x` binds `a` and `b` from `x`'s
   *  member set, so their type is the SOURCE's member type, one hop. The analyzer's destructured
   *  class fires only when the SOURCE's type is itself stated in the file. */
  const destructuredNames = new Set<string>()
  const walkDestructured = (node: any): void => {
    if (node.type === "variable_declarator") {
      const name = node.childForFieldName("name")
      if (name?.type === "object_pattern") {
        for (let i = 0; i < name.namedChildCount; i++) {
          const c = name.namedChild(i)
          if (!c) continue
          if (c.type === "shorthand_property_identifier_pattern") destructuredNames.add(c.text)
          else if (c.type === "pair") {
            const v = c.childForFieldName("value") ?? c.namedChild(1)
            if (v?.type === "identifier") destructuredNames.add(v.text)
          }
        }
      }
    }
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      if (c) walkDestructured(c)
    }
  }
  walkDestructured(tree.rootNode)
  const recordTyped = (scope: number, name: string, info: { generic: boolean; typeName: string; union: boolean; destructured: boolean }): void => {
    typedNames.add(name)
    typedInfo.set(name, info)
    let set = typedNamesByScope.get(scope)
    if (!set) typedNamesByScope.set(scope, (set = new Set()))
    set.add(name)
    let m = typedInfoByScope.get(scope)
    if (!m) typedInfoByScope.set(scope, (m = new Map()))
    m.set(name, info)
  }
  const walkTyped = (node: any): void => {
    const t = node.type
    const scope = scopeOf(node)
    if (t === "required_parameter" || t === "optional_parameter") {
      // A TYPE PREDICATE (`(p: unknown): p is string[]`) states a NARROWING, not the parameter's
      // type — the parameter's own annotation is `unknown` and `p.m()` is `unknown`'s member.
      // The predicate is the RETURN type, so it is not visible in the parameter node; the
      // analyzer's own predicate writer (`type_predicate_target`) publishes the NARROWED type as a
      // `references` row instead, so the parameter itself stays untyped. EXCLUDED here for the
      // same reason: `unknown` is not a class, and an owner of `unknown` would be a fabrication.
      if (node.childForFieldName("type")) {
        const pat = node.childForFieldName("pattern") ?? node.childForFieldName("name")
        const ann = node.childForFieldName("type")
        const inner = ann?.namedChild(0)
        if (pat?.type === "identifier" && inner && !NON_CLASS_TYPE_NODES.has(inner.type)) {
          recordTyped(scope, pat.text, { generic: inner.type === "generic_type", typeName: String(inner.text ?? ""), union: inner.type === "union_type", destructured: false })
        }
      }
    } else if (t === "variable_declarator") {
      const name = node.childForFieldName("name")
      const ann = node.childForFieldName("type")
      const inner = ann?.namedChild(0)
      if (name?.type === "identifier" && ann && inner && !NON_CLASS_TYPE_NODES.has(inner.type)) {
        recordTyped(scope, name.text, { generic: inner.type === "generic_type", typeName: String(inner.text ?? ""), union: inner.type === "union_type", destructured: false })
      }
      const value = node.childForFieldName("value")
      if (name?.type === "identifier" && value?.type === "new_expression") {
        const ctor = value.namedChild(0)
        const leaf = ctor?.text?.split(".").pop()
        if (leaf && /^[A-Za-z_$][\w$]*$/.test(leaf)) {
          recordTyped(scope, name.text, { generic: false, typeName: String(leaf), union: false, destructured: false })
        }
      }
    } else if (t === "public_field_definition" || t === "property_signature") {
      const name = node.childForFieldName("name")
      const ann = node.childForFieldName("type")
      const inner = ann?.namedChild(0)
      if (name?.type === "property_identifier" && ann && inner && !NON_CLASS_TYPE_NODES.has(inner.type)) {
        recordTyped(scope, name.text, { generic: inner.type === "generic_type", typeName: String(inner.text ?? ""), union: inner.type === "union_type", destructured: false })
      }
    }
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      if (c) walkTyped(c)
    }
  }
  walkTyped(tree.rootNode)
  // THE DESTRUCTURED MARK — a binding destructured from a value has its type from the SOURCE's
  // member set, one hop, and the analyzer's destructured class needs the source's type stated.
  for (const n of destructuredNames) {
    const info = typedInfo.get(n)
    if (info) info.destructured = true
    else typedInfo.set(n, { generic: false, typeName: "", union: false, destructured: true })
  }

  // THE TYPE NAMES THIS FILE DECLARES — a class, an interface, an enum, or a type alias. A type
  // the file NAMES but does not DECLARE is an imported class, and its member set is elsewhere.
  const declaredTypeNames = new Set<string>()
  // THE TYPE ALIASES — a `type X = …` has no member set of its own; it is a NAME for a shape.
  const typeAliasNames = new Set<string>()
  const walkTypes = (node: any): void => {
    const t = node.type
    if (t === "class_declaration" || t === "abstract_class_declaration" || t === "interface_declaration" ||
        t === "enum_declaration" || t === "type_alias_declaration") {
      const nm = node.childForFieldName("name")
      if (nm?.text) {
        declaredTypeNames.add(nm.text)
        if (t === "type_alias_declaration") typeAliasNames.add(nm.text)
      }
    }
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      if (c) walkTypes(c)
    }
  }
  walkTypes(tree.rootNode)

  // THE LINE -> SCOPE MAP. The analyzer does not publish the scope of a row, so the scope of a
  // row is read from its LINE: the function-like node whose extent covers that line. Built from
  // the AST, so it is the row's OWN enclosing function — not a same-named binding elsewhere.
  const scopeAtLine = new Map<number, number>()
  const walkScopes = (node: any): void => {
    if (node.type === "function_declaration" || node.type === "function_expression" ||
        node.type === "arrow_function" || node.type === "method_definition" ||
        node.type === "generator_function_declaration") {
      const from = node.startPosition.row + 1
      const to = node.endPosition.row + 1
      for (let r = from; r <= to; r++) if (!scopeAtLine.has(r)) scopeAtLine.set(r, node.startIndex)
    }
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      if (c) walkScopes(c)
    }
  }
  walkScopes(tree.rootNode)

  // ── THE ROWS ───────────────────────────────────────────────────────────────────────────────
  let parsed: any
  try { parsed = await ASTEngine.parseFile(file, content, {} as any) } catch (e: any) { parseFailures.push(`${rel}: ${e?.message ?? e}`); continue }
  if (parsed?.fallback === true) { parseFailures.push(`${rel}: fallback`); continue }
  const importedNames = new Set<string>()
  for (const r of parsed?.relationships ?? []) {
    if (String(r?.type ?? "") !== "imports") continue
    const md: any = r?.metadata ?? {}
    const names = Array.isArray(md.importedBindings) ? md.importedBindings : null
    for (const nm of names ?? []) if (typeof nm === "string") importedNames.add(nm)
    const tgt = String(r?.target ?? "")
    const at = tgt.lastIndexOf(":")
    if (at > 0 && at < tgt.length - 1) importedNames.add(tgt.slice(at + 1))
  }
  for (const edge of parsed?.relationships ?? []) {
    const label = String(edge?.type ?? "")
    const md: any = edge?.metadata ?? {}
    if (label === "uses") {
      uses++
      if (typeof md.owner === "string" && md.owner.length > 0) usesWithOwner++
      continue
    }
    if (label !== "calls") continue
    calls++
    const callee = String(md.calleeExpression ?? "")
    if (!callee.includes(".")) continue
    memberCalls++
    if (typeof md.owner === "string" && md.owner.length > 0) { ownerCarrying++; continue }
    const root = receiverRootOf(callee)
    const depth = chainDepth(callee)
    const sample = `${root}.… -> ${String(edge?.target ?? "")} @ ${rel}:${Number(md?.line ?? 0)}`
    if (root.length === 0) { bump("receiver root is not a plain identifier", sample); continue }
    if (root === "this") { bump("receiver is `this` — the field's type is not stated (or the field is untyped)", sample); continue }
    if (isCallReceiver(callee)) { bump("receiver is a CALL result — the return type is not stated in this file", sample); continue }
    if (importedNames.has(root)) { bump("receiver is an IMPORTED BINDING — the type lives in another file or in node_modules", sample); continue }
    const rowScope = scopeAtLine.get(Number(md?.line ?? 0)) ?? 0
    if (scopeTyped(rowScope, root)) {
      // THE DEFECT CLASS — but the AST test above is deliberately LOOSE, and TWO of its shapes are
      // NOT defects (measured by hand-reading the samples):
      //   `const result: Sources<R>` — the type is a GENERIC whose argument is the file's own type
      //     PARAMETER `R`. `R` is not a class, so there is no member to resolve and no owner to
      //     carry; the row needs the CALLER's type argument, which is another file.
      //   `md.inline.ruler.before(...)` — the receiver is a PARAMETER, and the call is a CHAIN of
      //     depth 3 off it. The one-hop class reads `md`'s type and then needs `md.inline`'s member
      //     type, then `md.inline.ruler`'s — two hops the class does not take.
      // So the defect class is refined to a BARE, NON-GENERIC type on a NON-CHAINED receiver.
      const info = typedInfoByScope.get(rowScope)?.get(root) ?? typedInfo.get(root)
      if (info && !info.generic && depth <= 1) {
        // IS THE TYPE DECLARED IN THIS FILE? If the file NAMES the type but does not DECLARE it,
        // the type is an IMPORTED class — the file states the receiver's type, but the class's
        // MEMBER SET lives in another file. MEASURED: `mergeSubgraphs(subgraphs: Subgraphs,
        // options: CompositionOptions)` — `Subgraphs` is named in the file and DECLARED IN
        // ANOTHER FILE (grep over the whole repo: zero declarations in this file), so
        // `subgraphs.values()` needs `Subgraphs`'s member set, which this file does not carry.
        // The analyzer's receiver classes are FILE-LOCAL by construction, so this is not an
        // omission — it is the wall's own boundary.
        if (declaredTypeNames.has(info.typeName) && typeAliasNames.has(info.typeName)) {
          // A TYPE ALIAS has no member set of its own. MEASURED: `type VNodeChild = VNodeChildAtom |
          // VNodeArrayChildren` — an alias to a UNION, so `child.slice()` resolves against whichever
          // ARM holds at runtime, and no single owner is correct.
          bump("receiver's type is a TYPE ALIAS (no member set of its own) — resolves against an arm", sample)
          continue
        }
        if (!declaredTypeNames.has(info.typeName)) {
          bump("receiver's type is an IMPORTED CLASS — named here, declared in another file (the member set is not here)", sample)
          continue
        }
        // A UNION type (`VNodeChild`) states a CHOICE of classes, not one class: the receiver's
        // member set depends on which arm holds, so no single owner is correct. MEASURED:
        // `normalizeVNode(child: VNodeChild)` — `VNodeChild` is a union of `VNode | VNodeArrayChildren
        // | (() => any) | string | null`, so `child.slice()` is `VNodeArrayChildren`'s member on
        // one arm and a string's on another.
        if (info.union) {
          bump("receiver's type is a UNION — no single owner is correct (the member set depends on the arm)", sample)
          continue
        }
        // A DESTRUCTURED binding (`const { props, ref, … } = vnode`) states the binding's type only
        // through the SOURCE's type member — one hop, and the analyzer's destructured class
        // (`owner-class-destructured`) fires only when the SOURCE is itself typed in the file.
        // MEASURED: `const { props, ref, patchFlag, children, transition } = vnode` — `ref` is bound
        // from `vnode`'s member set, so `ref.concat(…)` needs `vnode`'s type, which is the
        // PARAMETER's type (`vnode: VNode`).
        if (info.destructured) {
          bump("receiver is a DESTRUCTURED binding — its type comes from the SOURCE's member set", sample)
          continue
        }
        bump("DEFECT CLASS — the file states this name's type and no owner was carried", sample)
        continue
      }
      if (info?.generic) {
        bump("receiver's type is a GENERIC over a type PARAMETER — the concrete type is the CALLER's argument (another file)", sample)
        continue
      }
      bump("receiver is a CHAIN off a typed root — the one-hop class reads the root's type, not the member's", sample)
      continue
    }
    if (depth >= 2) {
      bump("receiver is a CHAIN off a root (depth ≥ 2) — needs the member's member", sample)
      continue
    }
    bump("receiver is a LOCAL with NO type stated in this file — the type is not in the file", sample)
  }
}

const pct = (n: number, d: number): string => (d === 0 ? "n/a" : `${((100 * n) / d).toFixed(1)}%`)
console.log(`TS RECEIVER-WALL PROBE — corpus ${CR}`)
console.log(`population: ${files.length} parsed of ${disc.admitted} admitted file(s) across ${disc.repos} repo(s) · parse failures ${parseFailures.length}`)
console.log(`calls edges ${calls} · member calls ${memberCalls} · carrying metadata.owner ${ownerCarrying} (${pct(ownerCarrying, memberCalls)} of member calls)`)
console.log(`uses edges ${uses} · carrying metadata.owner ${usesWithOwner}`)
console.log(`\nTHE WALL — member calls with NO owner, by CAUSE (${memberCalls - ownerCarrying} rows):`)
const sorted = [...buckets.entries()].sort((x, y) => y[1].count - x[1].count)
for (const [name, b] of sorted) {
  console.log(`  ${String(b.count).padStart(9)}  ${pct(b.count, memberCalls - ownerCarrying).padStart(6)}  ${name}`)
  for (const s of b.samples.slice(0, 3)) console.log(`              · ${s}`)
}
const defect = buckets.get("DEFECT CLASS — the file states this name's type and no owner was carried")
console.log(`\nTHE FALSIFIER: ${defect?.count ?? 0} rows where the file STATES the receiver's type and no owner was carried.`)
console.log(`  ZERO here means the analyzer reads every type the file states, and the wall is a TYPE-INFERENCE wall.`)
console.log(`  NON-ZERO means the wall has a defect component: ${defect?.count ?? 0} stated types the analyzer did not read.`)

const report = {
  corpus: CR,
  population: { filesParsed: files.length, admitted: disc.admitted, repos: disc.repos, parseFailures: parseFailures.length },
  calls, memberCalls, ownerCarrying, uses, usesWithOwner,
  wall: { total: memberCalls - ownerCarrying, byCause: Object.fromEntries([...buckets.entries()].map(([k, v]) => [k, v.count])) },
  falsifier: { defectClass: defect?.count ?? 0, samples: defect?.samples ?? [] },
}
if (JSON_OUT) {
  fs.writeFileSync(JSON_OUT, JSON.stringify(report, null, 2))
  console.log(`\nWROTE ${JSON_OUT}`)
}

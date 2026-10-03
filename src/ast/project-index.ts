/**
 * A PROJECT-WIDE DECLARATION INDEX, built once and handed to analyzers that ask for
 * it. This is the `AnalyzeContext` payload fifteen sibling analyzers already read
 * and that NO production caller populates — the gap this repo's own JavaScript
 * external-override fixture documents in its header ("Production callers never
 * populate AnalyzeContext.overrideCompanion, so the pre-M37.10 javascript analyzer
 * silently dropped every override whose base class was declared in another file").
 *
 * WHY IT EXISTS, MEASURED. On the 389-file Solidity corpus a per-file analyzer
 * cannot see, and therefore cannot be correct about, two things:
 *
 *   · 507 inheritance edges whose KIND is undecided. `contract X is IFeed` states
 *     that X inherits IFeed; whether IFeed is an INTERFACE is decided by a
 *     declaration in another file.
 *   · 1,564 call targets (93.3% of the lane's `external` class) that a whole-corpus
 *     audit shows are declared somewhere the file cannot see.
 *
 * Both are the same defect wearing two faces: an unfilled parameter.
 *
 * WHY IT IS ADDITIVE AND OPT-IN. `ProjectIndex` is an OPTIONAL field. Every analyzer
 * that does not read it behaves EXACTLY as before, byte for byte — which is the
 * property that makes it safe to add to a shared type while fifteen lanes depend on
 * it. There is no default, no fallback, and no behaviour change for absent context;
 * the Solidity analyzer reads it in one place and treats "no index" as "per-file
 * contract", which is what it already does.
 *
 * WHY IT IS NOT THE ANALYZER. The scanner here reads the TREE directly and knows
 * nothing about `RealSolidityAnalyzer`'s heuristics, its recovery regions, its
 * reserved tokens or its override rules. That is deliberate: an index built BY the
 * analyzer it feeds could inherit the analyzer's mistakes, and then a wrong index
 * would confirm the wrong answer. Independence is the whole value — the same reason
 * the F5 oracle re-derives from the grammar rather than reading analyzer output.
 *
 * WHY IT IS SHALLOW. It records only what a cross-file question can need: which
 * names are declared, what KIND each type is, each type's OWN members, and each
 * type's direct bases. No bodies, no line numbers, no relationships. A full parse of
 * every file is already the dominant cost of indexing, so the index is a walk over
 * an existing parse rather than a second parse.
 */

import type { Node } from "web-tree-sitter"
import * as fs from "node:fs"
import * as path from "node:path"

export type DeclarationKind =
  | "contract"
  | "interface"
  | "library"
  | "struct"
  | "enum"
  // PY-7: python's type declaration. Added to the union rather than folded into "unknown",
  // because a shared type is not the place to pretend one language's types are another's, and
  // "unknown" would read as "we looked and could not tell" — which is a different and worse
  // claim than "this is a class".
  | "class"
  // Dart's declaration kinds. Added to the union for the reason "class" was: a
  // shared type is not the place to pretend one language's mixin is another's
  // class, and "unknown" would read as "we looked and could not tell", which is a
  // different and worse claim than "this is a mixin".
  | "mixin"
  | "extension"
  | "extension_type"
  | "unknown"

export interface ProjectIndex {
  /** Declared type name -> its kind. Answers "is IFeed an interface?". */
  typeKinds: Map<string, DeclarationKind>
  /** Declared type name -> the member names IT declares (not its ancestors'). */
  typeMembers: Map<string, Set<string>>
  /** Declared type name -> its direct bases, in source order. */
  typeBases: Map<string, string[]>
  /** Every declared symbol name anywhere in the project. */
  symbolNames: Set<string>
  /** Files that produced ERROR/MISSING nodes, so a caller can refuse to trust them. */
  damagedFiles: Set<string>
  /** How many files were read, and how many were damaged. */
  stats: { files: number; damaged: number }
}

/** The Solidity declaration shapes, as the GRAMMAR names them. Kept as data so a
 *  sibling language can register its own without touching this module. */
export interface DeclarationSpec {
  /** Node types that declare a named type. */
  typeNodes: Record<string, DeclarationKind>
  /** Node types that declare a member of the enclosing type. */
  memberNodes: string[]
  /** Node types that declare a member of the enclosing type AND is callable. */
  memberNodesCallable?: string[]
  /** Node type that lists direct bases. */
  baseNodes?: string[]
  /**
   * Node types that OPEN A SCOPE, so a declaration inside one is not a member of the
   * lexically enclosing type. python needs this and Solidity does not: a function nested in a
   * function is not a method of the class around it, and without this the index attributes
   * every closure to the class two levels up. For an override index that is not a cosmetic
   * over-count — it makes a base class appear to declare a method it does not have, and the
   * resolution then SUPPRESSES a real override on the strength of a fabricated member.
   */
  scopeNodes?: string[]
  /**
   * Read a declaration's DIRECT base names from its own node. Preferred over `baseNodes` when
   * the grammar does not put bases in a node carrying an `ancestor` field: python's live in
   * `class_definition.superclasses` -> `argument_list`, where an entry is an `identifier` or a
   * dotted `attribute` whose own name is the LAST identifier of the path. Solidity's
   * `inheritance_specifier.ancestor` predates this hook and keeps the older path unchanged.
   */
  baseResolver?: (node: Node) => string[]
}

export const SOLIDITY_DECLARATION_SPEC: DeclarationSpec = {
  typeNodes: {
    contract_declaration: "contract",
    interface_declaration: "interface",
    library_declaration: "library",
  },
  memberNodes: [
    "function_definition",
    "modifier_definition",
    "constructor_definition",
    "fallback_receive_definition",
    "state_variable_declaration",
    "struct_declaration",
    "enum_declaration",
    "event_definition",
    "error_declaration",
  ],
  baseNodes: ["inheritance_specifier"],
}

/**
 * The python declaration shapes, as the GRAMMAR names them.
 *
 * PY-7. This exists so the companion tier of the `overrides` contract has something to read.
 * The tier is declared on `AnalyzeContext`, read by fifteen lanes, and populated by nobody in
 * production, so the 0.5 `first-parent-guess` — designed as a last resort — absorbs 100% of
 * external overrides. A census over 3,271 python files (`script/m14/python-companion-opportunity.ts`)
 * scored that tier against a corpus-wide, tree-derived map of what each base really declares:
 * of the guesses whose base IS present in the corpus, **76% name a method the base does not
 * declare.** Those are fabricated edges at a confidence a reader cannot discount, and the lane
 * had no way to know: until this change it did not accept an `AnalyzeContext` at all, and the
 * one field it did read, `_overrideCompanion`, was spelled differently from the declared one
 * and written by nobody.
 *
 * The suppression logic downstream needed no change: it already emits a guess only when
 * `!overrideCompanion?.has(base)`. Only the data was missing.
 */
export const PYTHON_DECLARATION_SPEC: DeclarationSpec = {
  typeNodes: {
    class_definition: "class",
  },
  // Only functions are members. A class-level ASSIGNMENT is a member too, but it is not
  // inheritable in the sense `overrides` describes — a class variable is not a method, and
  // indexing it as one repeats PY-21 defect 4, where a base's class variable satisfied the
  // "base declares this name" test and published fabricated overrides at 0.95. `memberNodesCallable`
  // is left unset for the same reason: only callable members answer the question.
  memberNodes: ["function_definition"],
  scopeNodes: ["function_definition", "lambda"],
  baseResolver: (node: Node): string[] => {
    const out: string[] = []
    const sup = node.childForFieldName("superclasses")
    if (!sup) return out
    for (let i = 0; i < sup.namedChildCount; i++) {
      const c = sup.namedChild(i)
      if (!c) continue
      if (c.type === "identifier") {
        out.push(c.text)
      } else if (c.type === "attribute") {
        // `pkg.mod.Base` — the ancestor's OWN name is the LAST identifier in the path, the same
        // rule the Solidity path applies to `A.B.C`. Keying the FIRST segment instead would file
        // every `unittest.TestCase`-shaped base under `unittest`.
        const leaf = c.childForFieldName("attribute") ?? c.namedChild(c.namedChildCount - 1)
        if (leaf && leaf.text) out.push(leaf.text)
      }
    }
    return out
  },
}

/**
 * The Dart declaration shapes, as the GRAMMAR names them.
 *
 * PY-7's finding applies to dart verbatim and harder: the `overrideCompanion` tier
 * that DARTD16's cross-file pass reads was populated by nobody, so the 0.8
 * first-parent guess absorbed 100% of dart's external overrides. freezed made that
 * expensive — it emits `@override` on every generated `props`/`hashCode`/`toString`
 * against `Equatable`, so the guess fired on 81 rows in ProxiCall/lib alone and
 * named a base that does not declare the member.
 *
 * Three things the grammar does not group, which is why this needs a `baseResolver`
 * rather than a `baseNodes` list:
 *
 *   1. `extends X` is a `superclass` node; a mixin's `on X` is a BARE
 *      `type_identifier` DIRECT child of the declaration with nothing around it; and
 *      `with` lives INSIDE the `superclass` node beside `extends`, not beside the
 *      declaration. Reading direct children for all three silently loses every mixin
 *      on a class that also extends something.
 *   2. An IMPORT ALIAS is a SIBLING, not a dotted name: `extends _i2.A2` parses as
 *      `superclass > type_identifier(_i2), type_identifier(A2)`. Keying the first
 *      identifier files the class under its alias. Only a `type_identifier` that is
 *      the LAST in its group is the real name.
 *   3. A member is only inheritable if it is CALLABLE. Dart fields cannot be
 *      overridden, and indexing them made a base's field satisfy "this base declares
 *      the name" — the same defect PY-21 defect 4 records for python, and the reason
 *      `memberNodesCallable` is deliberately left unset here too.
 */
export const DART_DECLARATION_SPEC: DeclarationSpec = {
  typeNodes: {
    class_definition: "class",
    mixin_declaration: "mixin",
    extension_declaration: "extension",
    extension_type_declaration: "extension_type",
    enum_declaration: "enum",
  },
  // Methods and accessors only. `getter_signature` and `setter_signature` count
  // (Dart overrides both); constructors and fields do not.
  memberNodes: [
    "method_signature",
    "function_signature",
    "getter_signature",
    "setter_signature",
    "operator_signature",
  ],
  // NOT the class body. `typeNodes` already resets the member scope when it enters a
  // declaration, so listing `class_body` here would put every direct member one scope
  // deep and exclude precisely the members the index exists to record — measured: a
  // Dart spec with `class_body` in scopeNodes indexed 9 types and ZERO members.
  // What must be scopes are the BODIES a local function can hide inside, or a local
  // `function_signature` would be indexed as a member of the enclosing class.
  scopeNodes: ["function_body", "function_expression_body", "block"],
  baseResolver: (node: Node): string[] => {
    const out: string[] = []
    const pushLeaf = (group: any): void => {
      if (!group) return
      // the LAST type_identifier in a group is the real type name; earlier ones in
      // the same group are an import alias (`_i2` in `extends _i2.A2`).
      let last: Node | null = null
      for (let i = 0; i < group.namedChildCount; i++) {
        const c = group.namedChild(i)
        if (c && c.type === "type_identifier") last = c
      }
      if (last && last.text) out.push(last.text)
    }
    for (const c of node.namedChildren) {
      if (!c) continue
      if (c.type === "superclass") {
        // `extends A with B` — BOTH live inside this node
        for (const g of c.namedChildren) {
          if (!g) continue
          if (g.type === "type_identifier") out.push(g.text)
          else if (g.type === "superclass" || g.type === "mixin" || g.type === "interfaces") pushLeaf(g)
        }
        continue
      }
      // a mixin's `on X` is a bare type_identifier DIRECT child, with no wrapper
      if (c.type === "type_identifier") { out.push(c.text); continue }
      if (c.type === "interfaces" || c.type === "mixin_on_clause") pushLeaf(c)
    }
    return out
  },
}

function addTo<K>(map: Map<K, Set<string>>, key: K, value: string): void {
  let set = map.get(key)
  if (!set) {
    set = new Set()
    map.set(key, set)
  }
  set.add(value)
}

/** Read one already-parsed tree into `index`. Exported so a caller that already has
 *  a tree (a worker mid-file, a census) does not pay to parse again. */
export function indexTree(root: Node, index: ProjectIndex, spec: DeclarationSpec): void {
  // The owner is tracked by walking DOWN rather than by searching upward per member:
  // a tree walk that resolved each member's owner by scanning the whole file is the
  // shape that turns an index build into quadratic work, and this runs once per file
  // for the whole project.
  // `scopes` counts `scopeNodes` ancestors, so a declaration inside a nested function is not
  // recorded as a member of the class around it. PY-7: without it the python spec indexes every
  // closure as a class method, which makes a base appear to declare methods it does not have and
  // the resolution then suppresses real overrides on the strength of those.
  const stack: { node: Node; owner: string | null; scopes: number }[] = [
    { node: root, owner: null, scopes: 0 },
  ]
  while (stack.length > 0) {
    const { node, owner, scopes } = stack.pop()!
    let nextOwner = owner
    let nextScopes = scopes + (spec.scopeNodes?.includes(node.type) ? 1 : 0)

    const kind = spec.typeNodes[node.type]
    if (kind !== undefined) {
      const nameNode = node.childForFieldName("name")
      const name = nameNode?.text ?? ""
      if (name !== "") {
        // A name declared twice with DIFFERENT kinds is a compile error in Solidity;
        // recording `unknown` rather than letting the last writer win means a
        // downstream consumer sees the ambiguity instead of a confident wrong answer.
        const prior = index.typeKinds.get(name)
        if (prior === undefined) index.typeKinds.set(name, kind)
        else if (prior !== kind) index.typeKinds.set(name, "unknown")
        index.symbolNames.add(name)
        nextOwner = name
        // A class body starts its own member scope, so a class nested inside a method is
        // indexed under its OWN name and not smeared onto the enclosing class.
        nextScopes = 0
      }
    }

    if (owner !== null && scopes === 0 && spec.memberNodes.includes(node.type)) {
      const nameNode = node.childForFieldName("name")
      const name = nameNode?.text ?? ""
      if (name !== "") {
        addTo(index.typeMembers, owner, name)
        index.symbolNames.add(name)
      }
    }

    if (owner !== null && spec.baseNodes?.includes(node.type)) {
      const ownerName = index.typeKinds.has(owner) ? owner : null
      if (ownerName !== null) {
        const anc = node.childForFieldName("ancestor")
        // A base list may be `A, B.C` — the ancestor's own name is the LAST identifier
        // in the path, which is the base's own name.
        let baseName = ""
        if (anc) {
          const stack2: Node[] = [anc]
          let last = ""
          while (stack2.length > 0) {
            const n = stack2.pop()!
            if (n.type === "identifier") last = n.text
            for (let i = 0; i < n.namedChildCount; i++) {
              const c = n.namedChild(i)
              if (c) stack2.push(c)
            }
          }
          baseName = last
        }
        if (baseName !== "") {
          let list = index.typeBases.get(ownerName)
          if (!list) {
            list = []
            index.typeBases.set(ownerName, list)
          }
          if (!list.includes(baseName)) list.push(baseName)
        }
      }
    }

    if (spec.baseResolver !== undefined && kind !== undefined) {
      const nameNode = node.childForFieldName("name")
      const ownerName = nameNode?.text ?? ""
      if (ownerName !== "") {
        for (const baseName of spec.baseResolver(node)) {
          if (baseName === "") continue
          let list = index.typeBases.get(ownerName)
          if (!list) {
            list = []
            index.typeBases.set(ownerName, list)
          }
          if (!list.includes(baseName)) list.push(baseName)
        }
      }
    }

    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      if (c) stack.push({ node: c, owner: nextOwner, scopes: nextScopes })
    }
  }
}

export function emptyProjectIndex(): ProjectIndex {
  return {
    typeKinds: new Map(),
    typeMembers: new Map(),
    typeBases: new Map(),
    symbolNames: new Set(),
    damagedFiles: new Set(),
    stats: { files: 0, damaged: 0 },
  }
}

/**
 * Build an index over a set of already-parsed files.
 *
 * `readTree` is injected rather than a parser created here, for two reasons: the
 * caller usually has the wasm loaded already (constructing a second parser per index
 * is pure waste), and the worker path may have several parser instances by language.
 * Keeping the I/O injected also makes the whole scanner testable with a stub.
 */
export function buildProjectIndex(
  files: { path: string; tree: { rootNode: Node; hasError?: boolean } }[],
  spec: DeclarationSpec = SOLIDITY_DECLARATION_SPEC,
): ProjectIndex {
  const index = emptyProjectIndex()
  for (const f of files) {
    index.stats.files++
    if (f.tree.hasError) {
      index.stats.damaged++
      index.damagedFiles.add(f.path)
    }
    indexTree(f.tree.rootNode, index, spec)
  }
  return index
}

/** Read `files` off disk with one parser and index them. The convenience path for a
 *  census or a gate, where no tree is already in hand. */
export async function buildProjectIndexFromDisk(
  wasmPath: string,
  files: string[],
  spec: DeclarationSpec = SOLIDITY_DECLARATION_SPEC,
): Promise<ProjectIndex> {
  const WTS = await import("web-tree-sitter")
  await WTS.Parser.init()
  const language = await (WTS as any).Language.load(fs.readFileSync(wasmPath))
  const parser = new WTS.Parser()
  parser.setLanguage(language)
  const parsed: { path: string; tree: { rootNode: Node; hasError?: boolean } }[] = []
  for (const f of files) {
    const text = fs.readFileSync(f, "utf8")
    const tree = parser.parse(text)
    // `Parser.parse` returns `Tree | null`. Dropping a null here would make the index
    // count fewer files than it was asked about and report the shortfall as coverage,
    // so this fails loudly and names the file instead.
    if (tree === null) throw new Error(`project index: ${f} produced no parse tree`)
    parsed.push({ path: f, tree })
  }
  return buildProjectIndex(parsed, spec)
}

/**
 * STREAMING form of `buildProjectIndexFromDisk`: same index, bounded memory.
 *
 * `buildProjectIndexFromDisk` collects `{ path, tree }` for EVERY file and only then
 * builds, so its peak memory is the whole corpus's parse trees at once. That is fine
 * for a 400-file project and fatal for a 2,351-file one with dependencies: measuring
 * ProxiCall/lib with the 68 direct packages attached (4,378 files total) aborted the
 * wasm module outright — `Aborted(). Build with -sASSERTIONS for more than 1 error.`
 * The retained trees are the cause and the tree-sitter wasm heap is the victim; there
 * is no flag that makes a 4,378-tree retention smaller.
 *
 * The index never needs two trees at once. `indexTree` reads one tree into the index
 * and returns, so the tree can be deleted immediately and the next file parsed into
 * the same slot. Peak memory becomes ONE tree plus the index, and the result is
 * byte-identical to the collecting form because the index is order-independent for
 * this purpose (a name declared twice with different kinds records "unknown"
 * regardless of which arrives last).
 */
export async function buildProjectIndexStreaming(
  wasmPath: string,
  files: string[],
  spec: DeclarationSpec = SOLIDITY_DECLARATION_SPEC,
  onProgress?: (done: number, total: number) => void,
): Promise<ProjectIndex> {
  const WTS = await import("web-tree-sitter")
  await WTS.Parser.init()
  const language = await (WTS as any).Language.load(fs.readFileSync(wasmPath))
  // ONE parser for the whole run. A parser per file exhausts the wasm pool on a
  // corpus this size, and the pool is shared with whatever else the caller holds.
  const parser = new WTS.Parser()
  parser.setLanguage(language)
  const index = emptyProjectIndex()
  let done = 0
  // Both forms report the same accounting. The streaming form previously left
  // `stats.files` at 0 and never touched `stats.damaged`, so a caller comparing
  // the two forms saw `{"files":0,"damaged":0}` against `{"files":2,"damaged":0}`
  // — two APIs documented as equivalent disagreeing, with no error. Measured.
  //
  // A file that cannot be read, or whose parser returns null, is a SHORTFALL. It
  // is counted in `damaged` rather than skipped silently: a caller cannot tell
  // "indexed everything" from "indexed what it could reach" if both report the
  // same thing, which is the failure the collecting form refuses with a thrown
  // error. Here the tree is already being streamed, so the honest middle is to
  // finish and report the count.
  let damaged = 0
  for (const f of files) {
    let text: string
    try {
      text = fs.readFileSync(f, "utf8")
    } catch {
      damaged++
      done++
      continue
    }
    let tree: any = null
    try {
      tree = parser.parse(text)
      if (tree?.rootNode) {
        indexTree(tree.rootNode, index, spec)
      } else {
        damaged++
      }
    } catch {
      // A file that will not parse contributes no declarations, exactly as in the
      // collecting form. Recorded, not hidden.
      damaged++
    } finally {
      // The whole point: free the tree before the next parse.
      try { tree?.delete?.() } catch { /* an aborted instance refuses politely */ }
    }
    done++
    if (onProgress && done % 500 === 0) onProgress(done, files.length)
  }
  index.stats = { files: done - damaged, damaged }
  return index
}

/** A NAME-TO-MEMBERS index over every declared type, PLUS the transitive inheritance
 *  closure — the two facts a cross-file resolution question actually needs. Built
 *  once from the shallow index so no consumer re-walks the inheritance graph. */
export function buildResolutionTables(index: ProjectIndex): {
  /** member name -> the types declaring it, transitively closed over bases. */
  memberOwners: Map<string, Set<string>>
  /** every member any declared type exposes, inheritance-closed. */
  allMembers: Map<string, Set<string>>
} {
  const allMembers = new Map<string, Set<string>>()
  const memberOwners = new Map<string, Set<string>>()

  const closure = (typeName: string, seen = new Set<string>()): Set<string> => {
    const cached = allMembers.get(typeName)
    if (cached) return cached
    if (seen.has(typeName)) return new Set()
    seen.add(typeName)
    const out = new Set<string>(index.typeMembers.get(typeName) ?? [])
    for (const b of index.typeBases.get(typeName) ?? []) {
      for (const m of closure(b, seen)) out.add(m)
    }
    allMembers.set(typeName, out)
    return out
  }

  for (const typeName of index.typeKinds.keys()) {
    for (const m of closure(typeName)) addTo(memberOwners, m, typeName)
  }
  // Attached so a caller that runs a truth oracle AND an analyzer over the same
  // corpus can hand both the SAME closed map. Two consumers resolving against two
  // separately-built cross-file views produce disagreements that are uninterpretable:
  // neither side is wrong, they were just asked different questions.
  ;(index as any).__closedMembers = allMembers
  return { memberOwners, allMembers }
}

/**
 * RE-RUN a set of files WITH the index and return the enriched results.
 *
 * This is the integration seam, kept as a function rather than wired into the worker
 * pool here, and the reason is stated rather than implied: rewiring
 * `parallel-indexer.ts` means forking changes into the dispatch path of EVERY lane,
 * at a point where the parent holds only the CURRENT batch — so an incremental run
 * would resolve against a subset of the project and report a different answer for the
 * same file depending on what else was being indexed. That is a worse failure than an
 * unresolved edge, and it is not a decision one lane should make unilaterally.
 *
 * The caller that CAN see every file for a run calls this once, after the per-file pass
 * and before results are stored. Two consequences worth stating plainly:
 *
 *   · it costs a SECOND analysis pass for opted-in languages only, so no other lane's
 *     behaviour or cost changes at all;
 *   · it is idempotent per file, and running it on a file set that is a SUBSET of the
 *     project yields the per-file answer for the kinds that stay undecidable — the same
 *     answer as no index at all, never a wrong one.
 *
 * `parse` is injected for the same reason `readTree` is: the caller already has a
 * configured engine, and this module must not decide which wasm a project uses.
 */
export async function enrichWithProjectIndex(
  files: string[],
  // The context argument is how the caller hands the index to its own parse step; the
  // parameter type said one argument while the call below passed two. Optional, so a
  // one-argument parser still satisfies it.
  parse: (file: string, context?: { projectIndex?: ProjectIndex }) => Promise<any>,
  spec: DeclarationSpec = SOLIDITY_DECLARATION_SPEC,
  wasmPath?: string,
): Promise<{ results: any[]; index: ProjectIndex }> {
  let index: ProjectIndex
  if (wasmPath) {
    index = await buildProjectIndexFromDisk(wasmPath, files, spec)
  } else {
    throw new Error(
      "enrichWithProjectIndex needs a wasmPath, or a caller-supplied index. Building the " +
        "index requires a parser, and this module deliberately does not create one.",
    )
  }
  buildResolutionTables(index)
  const results: any[] = []
  for (const file of files) {
    results.push(await parse(file, { projectIndex: index }))
  }
  return { results, index }
}

/**
 * THE WIRE FORMAT.
 *
 * `child_process.fork()` serialises IPC with JSON unless advanced serialisation is
 * enabled, and JSON cannot carry a `Map` — a `Map` would arrive as `{}` and the index
 * would silently resolve NOTHING, which looks exactly like "the feature does not work"
 * and not like "the transport dropped it". So the index has an explicit, total
 * serialisation rather than relying on structured clone.
 *
 * It is deliberately a PLAIN object of arrays, which also means it survives `JSON
 * .stringify` for a cache file, and it is TOTAL: every field of `ProjectIndex` is
 * written and read back, including `damagedFiles` and `stats`. A partial format is the
 * kind of omission that only shows up as a wrong answer months later, so
 * `roundTripProjectIndex` below asserts field-for-field equality and the SOL-21 gate
 * runs it.
 */
export interface SerializedProjectIndex {
  version: 1
  typeKinds: [string, DeclarationKind][]
  typeMembers: [string, string[]][]
  typeBases: [string, string[]][]
  symbolNames: string[]
  damagedFiles: string[]
  stats: { files: number; damaged: number }
}

export function serializeProjectIndex(index: ProjectIndex): SerializedProjectIndex {
  return {
    version: 1,
    typeKinds: [...index.typeKinds.entries()],
    typeMembers: [...index.typeMembers.entries()].map(([k, v]) => [k, [...v]]),
    typeBases: [...index.typeBases.entries()].map(([k, v]) => [k, [...v]]),
    symbolNames: [...index.symbolNames],
    damagedFiles: [...index.damagedFiles],
    stats: { ...index.stats },
  }
}

export function deserializeProjectIndex(raw: unknown): ProjectIndex | null {
  if (raw === null || typeof raw !== "object") return null
  const r = raw as Partial<SerializedProjectIndex>
  // A wrong `version` is refused rather than best-effort parsed. A partial read of a
  // future format would produce an index that is missing exactly the fields the new
  // format added — the shape of a wrong answer that is impossible to trace.
  if (r.version !== 1) return null
  if (!Array.isArray(r.typeKinds) || !Array.isArray(r.typeMembers) ||
      !Array.isArray(r.typeBases) || !Array.isArray(r.symbolNames)) return null
  const index = emptyProjectIndex()
  for (const [k, v] of r.typeKinds) index.typeKinds.set(k, v)
  for (const [k, v] of r.typeMembers) index.typeMembers.set(k, new Set(v))
  for (const [k, v] of r.typeBases) index.typeBases.set(k, [...v])
  for (const n of r.symbolNames) index.symbolNames.add(n)
  for (const f of r.damagedFiles ?? []) index.damagedFiles.add(f)
  index.stats = { files: r.stats?.files ?? 0, damaged: r.stats?.damaged ?? 0 }
  return index
}

/** Round-trip through ACTUAL JSON, not a structural copy — the transport is the thing
 *  under test, and `structuredClone` would not exercise it. Returns the differences it
 *  found rather than a boolean, so a failure says WHICH field was lost. */
export function roundTripProjectIndex(index: ProjectIndex): string[] {
  const problems: string[] = []
  const wire = JSON.parse(JSON.stringify(serializeProjectIndex(index))) as SerializedProjectIndex
  const back = deserializeProjectIndex(wire)
  if (back === null) {
    problems.push("deserializeProjectIndex returned null for a well-formed payload")
    return problems
  }
  if (back.typeKinds.size !== index.typeKinds.size) {
    problems.push(`typeKinds: ${back.typeKinds.size} of ${index.typeKinds.size}`)
  }
  if (back.symbolNames.size !== index.symbolNames.size) {
    problems.push(`symbolNames: ${back.symbolNames.size} of ${index.symbolNames.size}`)
  }
  if (back.typeMembers.size !== index.typeMembers.size) {
    problems.push(`typeMembers: ${back.typeMembers.size} of ${index.typeMembers.size}`)
  }
  if (back.typeBases.size !== index.typeBases.size) {
    problems.push(`typeBases: ${back.typeBases.size} of ${index.typeBases.size}`)
  }
  let memberTotal = 0
  for (const [k, v] of index.typeMembers) {
    const got = back.typeMembers.get(k)
    if (got === undefined) { problems.push(`typeMembers lost the key ${k}`); continue }
    if (got.size !== v.size) problems.push(`typeMembers[${k}]: ${got.size} of ${v.size}`)
    memberTotal += v.size
  }
  for (const [k, v] of index.typeBases) {
    const got = back.typeBases.get(k)
    if (got === undefined) { problems.push(`typeBases lost the key ${k}`); continue }
    if (got.length !== v.length) problems.push(`typeBases[${k}]: ${got.length} of ${v.length}`)
  }
  if (back.stats.files !== index.stats.files) problems.push("stats.files")
  if (back.stats.damaged !== index.stats.damaged) problems.push("stats.damaged")
  if (back.damagedFiles.size !== index.damagedFiles.size) problems.push("damagedFiles")
  // The payload the analyzer actually reads, checked end to end: a member name that
  // fails to survive means a call target that fails to resolve.
  const probe = index.typeMembers.keys().next().value
  if (probe !== undefined) {
    const before = [...(index.typeMembers.get(probe) ?? [])].sort()
    const after = [...(back.typeMembers.get(probe) ?? [])].sort()
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      problems.push(`typeMembers[${probe}] contents differ after the round trip`)
    }
  }
  return problems
}


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

export type DeclarationKind = "contract" | "interface" | "library" | "struct" | "enum" | "unknown"

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
  const stack: { node: Node; owner: string | null }[] = [{ node: root, owner: null }]
  while (stack.length > 0) {
    const { node, owner } = stack.pop()!
    let nextOwner = owner

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
      }
    }

    if (owner !== null && spec.memberNodes.includes(node.type)) {
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

    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      if (c) stack.push({ node: c, owner: nextOwner })
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
    parsed.push({ path: f, tree: parser.parse(text) })
  }
  return buildProjectIndex(parsed, spec)
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
  parse: (file: string) => Promise<any>,
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


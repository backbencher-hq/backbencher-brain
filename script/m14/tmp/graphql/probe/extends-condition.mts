/**
 * THE DECIDING MEASUREMENT FOR `extends` — the analyzer's own condition, counted.
 *
 * ## Why this probe exists
 *
 * `script/m14/tmp/graphql/out/ontology-census.json` reports
 * `B:implements_an_unambiguously_object_type_in_the_same_document: 0`. On its own
 * that reads as "the construct does not occur", which is what a RULED verdict needs.
 * It is not that, and shipping a ruling on it would be the exact failure the Round
 * N+1 brief names: a ruling whose overturn condition no correct implementation could
 * ever satisfy.
 *
 * The census probe UNDERCOUNTS the analyzer's condition in two ways, both readable
 * in its own source (ontology-census.mts:694-712):
 *
 *   1. it recognises a supertype as inheritance-shaped only when the corpus declares
 *      it `ObjectTypeDefinition` or `InputObjectTypeDefinition` (line 699). The
 *      analyzer's `supertypeKindOf` also returns `Type` — `UnionTypeDefinition` and
 *      `ScalarTypeDefinition` — and `emitHeritage` sends BOTH `Class` and `Type` down
 *      the `extends` branch (real-graphql-analyzer.ts:314-344). So every
 *      `type A implements SomeUnion` and every `type A implements SomeScalar` declared
 *      in the same document is an `extends` edge the probe cannot see.
 *
 *   2. the whole second pass opens with `if (!hereFields) continue` (line 696)
 *      because it reuses `hereFields` for the member check below it. A type that
 *      implements an object type and declares NO field of its own is therefore never
 *      counted — and `extends` is a fact about the CLAUSE, not about the members.
 *
 * A probe that counts a NARROWER thing than the branch it is used to rule on cannot
 * falsify that branch. This probe counts the branch's own condition instead.
 *
 * ## What it replicates
 *
 * `real-graphql-analyzer.ts`, verbatim:
 *
 *   kindOfNameHere   <- topLevelDeclarations(): one entry per top-level DEFINITION
 *                       (extensions excluded — line 1114 `an extension never declares`),
 *                       keyed by the BARE name, valued with the SymbolKind that
 *                       definitionKindOf() assigns.
 *   supertypeKindOf  <- requires the name to map to exactly ONE kind
 *                       (`if (!kinds || kinds.size !== 1) return undefined`), and that
 *                       kind to be Interface, Class or Type.
 *   emitHeritage     <- Extends when the kind is Class or Type, else Implements.
 *
 * So an `extends` edge requires ALL of:
 *   - an `implements` clause naming N (GraphQL has no `extends` clause at all);
 *   - N declared as a top-level DEFINITION in the SAME document — never an extension;
 *   - N carrying exactly one kind across this document's declarations;
 *   - that one kind being Class (object/input object) or Type (union/scalar).
 *
 * Every `implements` clause is counted too, so the ratio is on the table rather than
 * asserted, and each bucket is reported with the files it came from.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../../src/ast/language-detection"

const CR = process.env.BB_CORPUS_ROOT ?? "<corpus-root>/bb_tests/repositories"
const LANG = "graphql"

// The SymbolKind VALUES the analyzer assigns, copied from definitionKindOf() —
// a string here rather than the enum so this probe has no import of shared
// machinery, and so a drift in the enum shows up as a changed bucket name.
const KIND_OF: Record<string, string> = {
  ObjectTypeDefinition: "Class",
  InputObjectTypeDefinition: "Class",
  InterfaceTypeDefinition: "Interface",
  UnionTypeDefinition: "Type",
  ScalarTypeDefinition: "Type",
  EnumTypeDefinition: "Enum",
}
const EXT_TO_DEF: Record<string, string> = {
  ObjectTypeExtension: "ObjectTypeDefinition",
  InputObjectTypeExtension: "InputObjectTypeDefinition",
  InterfaceTypeExtension: "InterfaceTypeDefinition",
  UnionTypeExtension: "UnionTypeDefinition",
  ScalarTypeExtension: "ScalarTypeDefinition",
  EnumTypeExtension: "EnumTypeDefinition",
}

// ---------------------------------------------------------------- corpus
const files: { label: string; abs: string; text: string }[] = []
for (const e of readdirSync(CR)) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch {
    continue
  }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
      .split("\0")
      .filter(Boolean)
  } catch {
    continue
  }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text: string
    try {
      if (statSync(abs).size > 512 * 1024) continue
      text = readFileSync(abs, "utf8")
    } catch {
      continue
    }
    if (detectLanguageFromPath(abs, text) !== LANG) continue
    files.push({ label: `${e}/${rel}`, abs, text })
  }
}

const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-graphql.wasm"))))

// ---------------------------------------------------------------- helpers
const nameOf = (n: any): string | undefined => {
  for (const c of n.namedChildren ?? []) {
    if (c && c.type === "Name") return c.text
  }
  return undefined
}
const walkAll = (n: any, fn: (x: any) => void) => {
  fn(n)
  for (const c of n.namedChildren ?? []) if (c) walkAll(c, fn)
}
/**
 * Top-level definitions, unwrapped through the grammar's pass-through rules.
 *
 * These three helpers are copied VERBATIM from ontology-census.mts:459-478. The first
 * version of this probe walked `root.namedChildren` looking for `Definition` directly
 * and found NONE, because the tree is `source_file -> Document -> Definition` and the
 * grammar passes through seven wrapper node types on the way. That version reported 0
 * for every bucket including `all_implements_clauses`, which the census independently
 * measures at 1,712 `ImplementsInterfaces` nodes — so the zeros were the probe's shape
 * and not a fact about the corpus. A probe that cannot see a known-positive population
 * is not evidence of absence, and had this been the census probe it would have shipped
 * a false "0" as a ruling.
 */
const WRAPPERS = new Set(["Document", "Definition", "ExecutableDefinition", "TypeSystemDefinition", "TypeSystemExtension", "TypeDefinition", "TypeExtension"])
const unwrap = (n: any): any => {
  let cur = n
  for (;;) {
    if (!WRAPPERS.has(cur.type)) return cur
    const kids = (cur.namedChildren ?? []).filter((c: any) => c)
    if (kids.length !== 1) return cur
    cur = kids[0]
  }
}
const topDefs = (root: any): any[] => {
  const doc = root.type === "Document" ? root : (root.namedChildren ?? []).find((c: any) => c && c.type === "Document")
  if (!doc) return []
  return (doc.namedChildren ?? []).filter((c: any) => c && c.type === "Definition").map(unwrap)
}
/** `innermostNamed` — a Definition wraps exactly one node, and that node is the type. */
const inner = (def: any): any => unwrap(def)
const namedTypesIn = (n: any): string[] => {
  const out: string[] = []
  walkAll(n, (x) => {
    if (x.type === "NamedType") {
      const nm = nameOf(x)
      if (nm) out.push(nm)
    }
  })
  return out
}

// ---------------------------------------------------------------- buckets
type Bucket = { occurrences: number; files: number; examples: string[] }
const mk = (): Bucket => ({ occurrences: 0, files: 0, examples: [] })
const buckets: Record<string, Bucket> = {
  /** every `implements` clause in the corpus — the denominator. */
  "all_implements_clauses": mk(),
  /** the analyzer's EXTENDS condition, met exactly. */
  "extends_condition_met": mk(),
  /** ...of those, supertype declared an object/input object (what the census probe counted). */
  "extends_supertype_object": mk(),
  /** ...of those, supertype declared a union or a scalar (the census probe could not see these). */
  "extends_supertype_union_or_scalar": mk(),
  /** the implementing type declares no field of its own (the `!hereFields` skip). */
  "extends_owner_declares_no_field": mk(),
  /** the supertype is declared ONLY as an extension here — never a definition. */
  "extends_supertype_declared_only_as_an_extension": mk(),
  /** the supertype name maps to MORE THAN ONE kind here, so supertypeKindOf returns undefined. */
  "extends_supertype_ambiguous_kind_here": mk(),
  /** the supertype is declared in this document as an INTERFACE — the `implements` case. */
  "implements_supertype_is_interface_here": mk(),
  /** `extend type N` where THIS document also declares `type N` — the extension's own shape. */
  "extend_type_of_a_type_declared_in_this_document": mk(),
  /** `extend type N` where this document declares no `N` (the split-schema shape). */
  "extend_type_of_a_type_declared_elsewhere": mk(),
}
const hit = (k: string, label: string, what: string) => {
  const b = buckets[k]
  b.occurrences++
  if (b.examples.length < 8) b.examples.push(`${label}: ${what}`)
}
const hitFiles = new Map<string, Set<string>>()
const noteFile = (k: string, label: string) => {
  const s = hitFiles.get(k) ?? new Set<string>()
  s.add(label)
  hitFiles.set(k, s)
}

// ---------------------------------------------------------------- walk
let dirtyDocs = 0
for (const f of files) {
  const t = parser.parse(f.text)
  if (!t) continue
  const before = new Map(Object.entries(buckets).map(([k, v]) => [k, v.occurrences]))

  // ---- kindOfNameHere: one entry per top-level DEFINITION, extensions excluded.
  const kindOfNameHere = new Map<string, Set<string>>()
  const declaredNames = new Set<string>() // `${kind}|${name}` for definitions only
  const extendedNames = new Set<string>() // `${kind}|${name}` for extensions only
  const ownerHasField = new Set<string>()
  const decls: any[] = []
  for (const def of topDefs(t.rootNode)) {
    const node = inner(def)
    if (!node) continue
    if (node.type === "SchemaDefinition" || node.type === "SchemaExtension") continue
    if (node.type === "DirectiveDefinition") continue // named `@x`, never a supertype
    const isExt = node.type.endsWith("Extension")
    const typeNode = isExt ? EXT_TO_DEF[node.type] : node.type
    if (!typeNode || !KIND_OF[typeNode]) continue
    const nm = nameOf(node)
    if (!nm) continue
    const kind = KIND_OF[typeNode]
    decls.push({ node, name: nm, kind, isExt })
    if (isExt) {
      extendedNames.add(`${kind}|${nm}`)
      continue // an extension never declares — analyzer line 1114
    }
    declaredNames.add(`${kind}|${nm}`)
    const kinds = kindOfNameHere.get(nm) ?? new Set<string>()
    kinds.add(kind)
    kindOfNameHere.set(nm, kinds)
    let hasField = false
    walkAll(node, (x) => {
      if (x.type === "FieldDefinition") hasField = true
    })
    if (hasField) ownerHasField.add(nm)
  }

  // ---- every `implements` clause, on definitions AND extensions.
  for (const d of decls) {
    const impls: any[] = []
    walkAll(d.node, (x) => {
      if (x.type === "ImplementsInterfaces") impls.push(x)
    })
    for (const impl of impls) {
      const names = namedTypesIn(impl)
      if (names.length === 0) continue
      const line = impl.startPosition.row + 1
      for (const n of names) {
        const at = d.isExt ? " (inside an extend block)" : ""
        hit("all_implements_clauses", f.label, `${d.name} implements ${n} line ${line}${at}`)
        // supertypeKindOf(): exactly one kind, and it must be Interface/Class/Type
        const kinds = kindOfNameHere.get(n)
        if (!kinds) {
          if (extendedNames.has(`${d.kind}|${n}`)) {
            hit("extends_supertype_declared_only_as_an_extension", f.label, `${d.name} implements ${n} — ${n} appears only as an extension here`)
          }
          continue
        }
        if (kinds.size !== 1) {
          hit("extends_supertype_ambiguous_kind_here", f.label, `${d.name} implements ${n} — kinds here: ${[...kinds].join("/")}`)
          continue
        }
        const only = [...kinds][0]
        if (only === "Interface") {
          hit("implements_supertype_is_interface_here", f.label, `${d.name} implements ${n} line ${line}${at}`)
          continue
        }
        if (only !== "Class" && only !== "Type") continue // Enum: neither branch
        // >>> the analyzer's EXTENDS condition, met exactly.
        hit("extends_condition_met", f.label, `${d.name} implements ${n} (${only}) line ${line}${at}`)
        if (only === "Class") hit("extends_supertype_object", f.label, `${d.name} implements ${n} line ${line}`)
        else hit("extends_supertype_union_or_scalar", f.label, `${d.name} implements ${n} (${only}) line ${line}`)
        if (!ownerHasField.has(d.name)) {
          hit("extends_owner_declares_no_field", f.label, `${d.name} implements ${n} — ${d.name} declares no FieldDefinition`)
        }
      }
    }
  }

  // ---- `extend type N`: declared here, or only here as an extension
  for (const d of decls) {
    if (!d.isExt) continue
    if (declaredNames.has(`${d.kind}|${d.name}`)) {
      hit("extend_type_of_a_type_declared_in_this_document", f.label, `extend ${d.kind} ${d.name}`)
    } else {
      hit("extend_type_of_a_type_declared_elsewhere", f.label, `extend ${d.kind} ${d.name}`)
    }
  }

  let dirty = 0
  walkAll(t.rootNode, (x) => {
    if (x.type === "ERROR" || x.isMissing) dirty++
  })
  if (dirty > 0) dirtyDocs++
  for (const [k, v] of Object.entries(buckets)) {
    if (v.occurrences > (before.get(k) ?? 0)) noteFile(k, f.label)
  }
  t.delete?.()
}
for (const k of Object.keys(buckets)) buckets[k].files = hitFiles.get(k)?.size ?? 0

const out = {
  kind: "m60-extends-condition-probe",
  producedBy: "script/m14/tmp/graphql/probe/extends-condition.mts",
  entryPoint: "grammar walk replicating real-graphql-analyzer.ts:314-344 exactly",
  corpusRoot: CR,
  admittedFiles: files.length,
  documentsWithParseErrorsOrMissingNodes: dirtyDocs,
  buckets,
}
console.log(JSON.stringify(out, null, 1))
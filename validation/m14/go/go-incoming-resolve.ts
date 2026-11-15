// INCOMING / RESOLUTION — the "who points AT me" half, measured.
//
// THE QUESTION. Every analyzer in this repository emits OUTGOING edges: one
// file goes in, and the rows that come out have a `source` that is a
// declaration in THAT file. "Who points AT me" is therefore not a second edge
// channel — it is a question asked of the target surface. Given a declaration
// D, a consumer wants every emitted row whose `target` names D. This instrument
// answers, for the go lane:
//
//   * are the edges outgoing only (and by what measurement)?
//   * for every emitted edge, viewed from its TARGET, which of four resolution
//     classes does the target string fall in — resolved / via-owner /
//     ambiguous / unresolvable?
//   * of those, what fraction is TRAVERSABLE FROM THE FAR END, i.e. resolves at
//     both ends so a walk from the anchor can continue to the source?
//
// NO REGEX. Every decision below is `endsWith`, `indexOf`, `charCodeAt`, `split`,
// a Set/Map lookup, or an integer range. There is not one `new RegExp`,
// `String.match`, `String.replace(/`, or `.test(` in this file, and the
// `probe-no-regex` mode at the bottom proves it over this file's own committed
// text by tokenising the source with tree-sitter-typescript and counting
// `regex` nodes. That is the only self-check worth having here: a claim in a
// comment that a gate can re-derive beats a claim.
//
// INDEPENDENCE OF THE INDEX, and the limit it inherits. The declaration index
// this instrument classifies against is built by a TREE WALK over
// tree-sitter-go, not from the analyzer's own symbol table. That matters: if the
// index came from `res.symbols`, a name the analyzer fails to publish would be
// invisible to the index and every edge pointing at it would read as
// UNRESOLVABLE — the instrument would report the analyzer's blind spot as a fact
// about Go. So the two sides are built from different inputs. They do NOT have
// an independent GRAMMAR: both load the same `tree-sitter-go.wasm`, so a node
// type that fails to match is invisible to both. That is the declared limit of
// every oracle in this repository and it is restated in the artifact rather than
// papered over.
//
// THE FOUR CLASSES, and why they are four and not one binary.
//
//   RESOLVED     the target string is a plain name that binds to exactly one
//                PACKAGE-SCOPE declaration in the indexed corpus. One anchor.
//   VIA-OWNER    the target binds to exactly one declaration, but that
//                declaration is a MEMBER — a struct field, an interface method,
//                or a method. Go resolves `x.M` inside the method set of x's
//                type, not in package scope, so the anchor is `owner + "." +
//                name` and the target string alone is not the anchor. Also
//                covers a target the analyzer already wrote qualified
//                (`Outer.Method`), where the resolution genuinely goes through
//                the owner. This class is not a defect: it is Go's own scope
//                rule, and a consumer that understands owners handles it.
//   AMBIGUOUS    the target string binds to TWO OR MORE declarations. Go
//                permits this — `Error` in `errors` and `os`, `Read` on every
//                io type, `String` on every fmt.Stringer — so the class is not
//                an analyzer bug either. It is the measurement of how much of
//                the graph needs type inference to walk BACKWARDS, which is
//                exactly the loss the leaf reduction (`strings.ToUpper` ->
//                `ToUpper`) makes visible in one direction and not the other.
//   UNRESOLVABLE the target binds to nothing in the indexed corpus.
//
// Plus one class the brief does not name, because hiding it inside one of the
// four would be the dishonest choice: EMPTY (a zero-length endpoint) and
// PLACEHOLDER (Go's `_`, which has no name). Both are counted, and both are
// folded into UNRESOLVABLE only in the four-way summary line, where the label
// says so.
//
// POPULATION. The admission rule is the lane's own
// `validation/m14/go/go-corpus-files.ts`: walk from the corpus root, skip
// `.git` / `testdata` / `node_modules` / `vendor` / `_obj` / `_test` / `obj`,
// take every `.go` file. It is DERIVED at run time from the filesystem, never a
// hand-written list, and every artifact records the file count and the corpus
// root it counted over — the honesty contract's "an instrument must declare the
// population it covered".
//
// PHASES, because a single long-lived process cannot be trusted on this corpus.
// The go lane records, measured, that an unsharded census dies with
// `memory access out of bounds` followed by a 120 s parser hang, and that the
// guard is a `process.exit` in MASTER-owned `engine.ts` — so a run reports on
// the files it reached and stops, which reads exactly like "no findings". Both
// phases therefore take `--shard=i/n` and every artifact records which shard it
// is, and the merge step REFUSES a merged file count that is not the sum of the
// shards it was given.
//
//   --index            walk the corpus, write the declaration index shard
//   --merge-index      union the index shards
//   --resolve          production parseFile over the draw, classify every edge
//   --merge            sum the classification shards
//
// USAGE
//   bunx tsx validation/m14/go/go-incoming-resolve.ts --index [--sample N] [--shard=i/n] [--out f.json]
//   bunx tsx validation/m14/go/go-incoming-resolve.ts --merge-index a.json b.json --out idx.json
//   bunx tsx validation/m14/go/go-incoming-resolve.ts --resolve --index idx.json [--sample N] [--shard=i/n] [--out f.json]
//   bunx tsx validation/m14/go/go-incoming-resolve.ts --merge a.json b.json --out r.json
//   bunx tsx validation/m14/go/go-incoming-resolve.ts --outgoing-only
//   bunx tsx validation/m14/go/go-incoming-resolve.ts --probe-no-regex

import { readFileSync, writeFileSync } from "node:fs"
import { ASTEngine } from "../../../src/ast/engine"
import { RelationshipType } from "../../../src/ast/types"
import { collectAllGoFiles, splitTestAndNonTest, strideSample, type CorpusFile } from "./go-corpus-files"

const CORPUS_ROOT = process.env.GO_CORPUS_ROOT || "/home/ishaq2321/bb_tests/repositories/go-stdlib"
const REPO_ROOT = process.env.GO_REPO_ROOT || "/tmp/opencode/wt/INCOMING_RESOLVE_GO"

const ENUM_VALUES: string[] = [...new Set(Object.values(RelationshipType))]

// Go's blank identifier, and the two spellings a tree-sitter recovery can leave
// on a node whose text was never written. Compared by equality, never by pattern.
const PLACEHOLDERS: ReadonlySet<string> = new Set(["_", "?", "<missing>", "MISSING"])

const CLASS_RESOLVED = "resolved"
const CLASS_VIA_OWNER = "via_owner"
const CLASS_AMBIGUOUS = "ambiguous"
const CLASS_UNRESOLVABLE = "unresolvable"
const CLASS_EMPTY = "empty"
const CLASS_PLACEHOLDER = "placeholder"
const CLASSES: string[] = [
  CLASS_RESOLVED,
  CLASS_VIA_OWNER,
  CLASS_AMBIGUOUS,
  CLASS_UNRESOLVABLE,
  CLASS_EMPTY,
  CLASS_PLACEHOLDER,
]

// ---------------------------------------------------------------------------
// Declaration record, and what a "declaration" is here.
//
// Built by a tree walk, so it is an INDEPENDENT read of the grammar rather than
// a read of the analyzer's symbol table. Six node types produce a name Go binds
// at package scope, and three produce a name Go binds inside an owner's
// namespace. Anything else in the tree is a USE, not a declaration, and is not
// indexed — indexing uses would make every name "declared" and the whole
// instrument vacuous.
// ---------------------------------------------------------------------------

type DeclScope = "package" | "member"

interface DeclRecord {
  /** package scope: the name binds in the package's block. member: it binds
   *  inside `owner`'s namespace only. */
  scope: DeclScope
  /** package-scope only for `package`; "" otherwise. */
  owner: string
  /** the declaring construct, so a reader can tell a field from a method. */
  construct: string
}

interface NameFacts {
  /** distinct package-scope declarations of this name, corpus-wide */
  pkg: number
  /** distinct member declarations of this name, corpus-wide */
  member: number
  /** distinct package DIRECTORIES declaring it at package scope.
   *  A first draft incremented this only on the 0->1 transition, so every name
   *  read 1 no matter how many of go-stdlib's 57 packages declared it: the field
   *  was wrong for every name and the classifier does not read it, so the damage
   *  was confined to the artifact. A Set makes the count mean what it says, and
   *  the count is what shows that a name like `HasSuffix` is declared in three
   *  packages rather than one. */
  pkgDirs: number
  /** the directory set, not serialised into the JSON artifact */
  pkgDirSet?: Set<string>
  /** distinct files declaring it at all */
  files: number
  /** distinct owners of the member declarations, capped, for the via-owner read */
  owners: string[]
}

interface IndexShard {
  tool: string
  phase: "index"
  corpusRoot: string
  shard: string
  populationFiles: number
  populationOffered: number
  parsedFiles: number
  crashedFiles: number
  crashSamples: string[]
  nodeTypes: Record<string, number>
  names: Record<string, NameFacts>
}

const OWNER_CAP = 6

function emptyFacts(): NameFacts {
  return { pkg: 0, member: 0, pkgDirs: 0, files: 0, owners: [], pkgDirSet: new Set<string>() }
}

function bumpFacts(idx: Map<string, NameFacts>, name: string, scope: DeclScope, owner: string, construct: string, dir: string): void {
  let f = idx.get(name)
  if (!f) {
    f = emptyFacts()
    idx.set(name, f)
  }
  if (scope === "package") {
    f.pkg++
    const set = f.pkgDirSet ?? (f.pkgDirSet = new Set<string>())
    if (!set.has(dir)) {
      set.add(dir)
      f.pkgDirs = set.size
    }
  } else {
    f.member++
    if (f.owners.length < OWNER_CAP && f.owners.indexOf(owner) < 0 && owner.length > 0) f.owners.push(owner)
  }
  f.files++
}

/**
 * The receiver type name of a `method_declaration`, read from the grammar.
 * The receiver field is a `parameter_list` whose `parameter_declaration`'s type
 * is a `type_identifier`, possibly wrapped in `pointer_type` (`func (s *S) M()`)
 * or a `generic_type` (`func (g G[int]) O()`). Returns "" when the shape is not
 * one this instrument can read, and that is RECORDED rather than guessed: an
 * unread receiver makes the method's member namespace owner-less, which would
 * move its name between the via-owner and ambiguous classes, so the count is in
 * the artifact as `unreadReceivers` and a reader can discount it.
 *
 * An earlier draft of this file also keyed the INTERFACE-method branch on
 * `method_elem`. That node type does not exist in tree-sitter-go: a grammar
 * inventory over the whole corpus (104 node types, §Instrument A) contains
 * `method_spec` and `struct_elem` and no `method_elem` anywhere. So the branch
 * matched nothing, and every interface method was absent from the index — which
 * made `Read`, `Close` and `Write` read as UNRESOLVABLE instead of as members.
 * A branch that can never match is dead code, and dead code under-reports the
 * very class it was written to find. The branch is now `method_spec`, and
 * `methodSpecNodes` is reported so the count is checkable.
 */
function receiverTypeName(node: any): { owner: string; shape: string } {
  const recv = node.childForFieldName("receiver")
  if (!recv) return { owner: "", shape: "no-receiver-field" }
  let name = ""
  let shape = "ok"
  const visitType = (t: any): void => {
    if (!t) return
    const ty = t.type
    if (ty === "type_identifier" || ty === "package_identifier") {
      name = String(t.text ?? "")
      return
    }
    if (ty === "generic_type" || ty === "qualified_type") {
      const nm = t.childForFieldName("name")
      if (nm) {
        name = String(nm.text ?? "")
        return
      }
      // tree-sitter-go's `G[int]` for a generic receiver carries NO `name`
      // field on the `generic_type` itself -- the base name is its first named
      // child. Measured: 488 of 9,447 files' worth of receivers took this path
      // before the fix, and each one published a method with an EMPTY owner,
      // which moved its name out of `owners` and so out of the qualified-endpoint
      // resolution. Falling through to the child walk is what the grammar needs.
      shape = ty + "-no-name-field"
      for (let i = 0; i < t.namedChildCount; i++) visitType(t.namedChild(i))
      return
    }
    if (ty === "pointer_type" || ty === "type_parameter" || ty === "parenthesized_type") {
      for (let i = 0; i < t.namedChildCount; i++) visitType(t.namedChild(i))
      return
    }
    shape = ty
  }
  let sawDecl = false
  for (let i = 0; i < recv.namedChildCount; i++) {
    const pd = recv.namedChild(i)
    if (!pd || pd.type !== "parameter_declaration") continue
    sawDecl = true
    visitType(pd.childForFieldName("type"))
  }
  if (!sawDecl) shape = "receiver-without-parameter_declaration"
  if (name.length === 0 && shape === "ok") shape = "empty-type-text"
  return { owner: name, shape }
}

/**
 * The name an EMBEDDED field declares. Go spec: "An embedded field must be
 * specified as a type name T or as a pointer to a non-interface type name *T,
 * and T itself may not be a pointer type." The unqualified type name acts as the
 * field name. The grammar gives such a `field_declaration` NO `field_identifier`
 * child, so the name has to be read from the TYPE and reduced to its leaf — the
 * same reduction the analyzer's own embedded-field path uses, and the same
 * reason `extends` spells an embedded type by leaf.
 *
 * Omitting this was a measurement bias in the first run of this instrument: the
 * analyzer publishes `Inner` as a property of `Holder` (pinned by
 * `go/grouped-and-embedded-fields-889`), and an index that skipped it reported
 * `Inner` as undeclared. An index that disagrees with the language is worse than
 * no index.
 */
function embeddedFieldName(node: any): string {
  const ty = node.childForFieldName("type")
  if (!ty) return ""
  let leaf = ""
  const visit = (t: any): void => {
    if (!t) return
    const k = t.type
    if (k === "type_identifier" || k === "package_identifier") {
      leaf = String(t.text ?? "")
      return
    }
    if (k === "generic_type" || k === "qualified_type" || k === "pointer_type") {
      const nm = t.childForFieldName("name")
      if (nm) leaf = String(nm.text ?? "")
      else for (let i = 0; i < t.namedChildCount; i++) visit(t.namedChild(i))
      return
    }
    for (let i = 0; i < t.namedChildCount; i++) visit(t.namedChild(i))
  }
  visit(ty)
  return leaf
}

/**
 * The nearest enclosing type name for a `field_declaration` / `method_elem`, by
 * walking UP the parse tree rather than down, so an embedded interface's method
 * still attributes to the interface that spells it.
 */
function enclosingTypeName(node: any): string {
  let p = node.parent
  let guard = 0
  while (p && guard++ < 40) {
    const t = p.type
    if (t === "struct_type" || t === "interface_type") {
      // struct_type / interface_type carry no name of their own; the name is on
      // the `type_spec` that owns them.
      const spec = p.parent
      if (spec && spec.type === "type_spec") {
        const nm = spec.childForFieldName("name")
        if (nm) return String(nm.text ?? "")
      }
      return ""
    }
    p = p.parent
  }
  return ""
}

/** True when the node has a function body between it and the source_file, so
 *  the declaration is LOCAL (Go: package block vs function block). */
function insideFunctionBody(node: any): boolean {
  let p = node.parent
  let guard = 0
  while (p && guard++ < 60) {
    const t = p.type
    if (t === "source_file") return false
    if (t === "block" || t === "func_literal" || t === "function_declaration" || t === "method_declaration" || t === "if_statement" || t === "for_statement" || t === "switch_statement" || t === "select_statement" || t === "case_clause" || t === "communication_clause") return true
    p = p.parent
  }
  return false
}

function dirOf(rel: string): string {
  const i = rel.lastIndexOf("/")
  return i < 0 ? "." : rel.slice(0, i)
}

interface ArgOpts {
  sample: number
  shard: string
  out: string
  indexPath: string
  merge: string[]
  mergeIndex: string[]
  mode: string
}

function parseArgs(argv: string[]): ArgOpts {
  const o: ArgOpts = {
    sample: Number(process.env.GO_SAMPLE || 400),
    shard: "0/1",
    out: "",
    indexPath: process.env.GO_INDEX || "",
    merge: [],
    mergeIndex: [],
    mode: "",
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === "--index") o.mode = "index"
    else if (a === "--resolve") o.mode = "resolve"
    else if (a === "--merge") o.mode = "merge"
    else if (a === "--merge-index") o.mode = "merge-index"
    else if (a === "--outgoing-only") o.mode = "outgoing-only"
    else if (a === "--probe-no-regex") o.mode = "probe-no-regex"
    else if (a === "--self-test-classifier") o.mode = "self-test-classifier"
    else if (a === "--explain") o.mode = "explain"
    else if (a === "--index-summary") o.mode = "index-summary"
    else if (a === "--sample") o.sample = Number(argv[++i])
    else if (a === "--shard") o.shard = argv[++i]
    else if (a.indexOf("--shard=") === 0) o.shard = a.slice("--shard=".length)
    else if (a.indexOf("--sample=") === 0) o.sample = Number(a.slice("--sample=".length))
    else if (a === "--out") o.out = argv[++i]
    else if (a === "--index-file") o.indexPath = argv[++i]
    else if (a.endsWith(".json")) o.merge.push(a)
  }
  return o
}

function shardRange(spec: string, n: number): { i: number; of: number } {
  const at = spec.indexOf("/")
  if (at < 0) return { i: 0, of: 1 }
  return { i: Number(spec.slice(0, at)), of: Number(spec.slice(at + 1)) }
}

// ---------------------------------------------------------------------------
// PHASE 1 — the declaration index.
// ---------------------------------------------------------------------------

async function phaseIndex(files: CorpusFile[], shardSpec: string): Promise<IndexShard> {
  const { i: si, of: so } = shardRange(shardSpec, files.length)
  const names = new Map<string, NameFacts>()
  const nodeTypes: Record<string, number> = {}
  const crashSamples: string[] = []
  let crashed = 0
  let parsed = 0
  let unreadReceivers = 0
  let unnamedFields = 0
  let embeddedFields = 0
  let methodSpecNodes = 0
  let structElemNodes = 0
  const unreadReceiverShapes: Record<string, number> = {}

  const parser = await ASTEngine.getParser("go")
  for (let n = 0; n < files.length; n++) {
    if (so > 1 && n % so !== si) continue
    const f = files[n]
    let content: string
    try {
      content = readFileSync(f.path, "utf8")
    } catch {
      continue
    }
    let tree: any
    try {
      tree = parser.parse(content)
    } catch {
      crashed++
      if (crashSamples.length < 5) crashSamples.push(`${f.rel}: parse threw`)
      continue
    }
    parsed++
    const dir = dirOf(f.rel)

    // A cursor walk, so the grammar decides what is a node. `namedChildren`
    // is not available on every binding, so the walk is explicit.
    const stack: any[] = [tree.rootNode]
    while (stack.length > 0) {
      const node = stack.pop()
      if (!node) continue
      const t = node.type
      nodeTypes[t] = (nodeTypes[t] || 0) + 1
      if (node.hasError && typeof node.isMissing === "boolean" && node.isMissing) {
        // counted by nodeTypes already; a MISSING node has no written name and
        // is skipped below by the text-length check rather than by a pattern.
      }

      if (t === "package_clause") {
        for (let c = 0; c < node.namedChildCount; c++) {
          const ch = node.namedChild(c)
          if (ch && ch.type === "package_identifier") {
            const txt = String(ch.text ?? "")
            if (txt.length > 0) bumpFacts(names, txt, "package", "", "package_clause", dir)
          }
        }
      } else if (t === "type_spec") {
        const nm = node.childForFieldName("name")
        const txt = nm ? String(nm.text ?? "") : ""
        if (txt.length > 0) {
          const local = insideFunctionBody(node)
          bumpFacts(names, txt, local ? "member" : "package", "", "type_spec", dir)
        }
      } else if (t === "function_declaration") {
        const nm = node.childForFieldName("name")
        const txt = nm ? String(nm.text ?? "") : ""
        if (txt.length > 0) bumpFacts(names, txt, "package", "", "function_declaration", dir)
      } else if (t === "method_declaration") {
        const nm = node.childForFieldName("name")
        const txt = nm ? String(nm.text ?? "") : ""
        const recv = receiverTypeName(node)
        if (recv.owner.length === 0) {
          unreadReceivers++
          unreadReceiverShapes[recv.shape] = (unreadReceiverShapes[recv.shape] || 0) + 1
        }
        if (txt.length > 0) bumpFacts(names, txt, "member", recv.owner, "method_declaration", dir)
      } else if (t === "field_declaration") {
        const owner = enclosingTypeName(node)
        if (owner.length === 0) unnamedFields++
        // `field_declaration` has a REPEATED `name` field for `a, b int`.
        let named = 0
        for (let c = 0; c < node.namedChildCount; c++) {
          const ch = node.namedChild(c)
          if (ch && ch.type === "field_identifier") {
            const txt = String(ch.text ?? "")
            if (txt.length > 0) {
              named++
              bumpFacts(names, txt, "member", owner, "field_declaration", dir)
            }
          }
        }
        if (named === 0) {
          // An EMBEDDED field: no `field_identifier`, but Go still declares a
          // field whose name is the unqualified type name.
          const emb = embeddedFieldName(node)
          if (emb.length > 0) {
            embeddedFields++
            bumpFacts(names, emb, "member", owner, "embedded_field", dir)
          }
        }
      } else if (t === "method_spec") {
        // An INTERFACE method. Node type confirmed against the grammar
        // inventory, not assumed: 104 node types over 9,447 files contain
        // `method_spec` and contain no `method_elem`.
        methodSpecNodes++
        const owner = enclosingTypeName(node)
        if (owner.length === 0) unnamedFields++
        const nm = node.childForFieldName("name")
        const txt = nm ? String(nm.text ?? "") : ""
        if (txt.length > 0) bumpFacts(names, txt, "member", owner, "method_spec", dir)
      } else if (t === "struct_elem") {
        structElemNodes++
      } else if (t === "var_spec" || t === "const_spec") {
        const local = insideFunctionBody(node)
        for (let c = 0; c < node.namedChildCount; c++) {
          const ch = node.namedChild(c)
          if (ch && ch.type === "identifier") {
            const txt = String(ch.text ?? "")
            if (txt.length > 0) bumpFacts(names, txt, local ? "member" : "package", "", t, dir)
          }
        }
      }

      for (let c = 0; c < node.namedChildCount; c++) {
        const ch = node.namedChild(c)
        if (ch) stack.push(ch)
      }
    }
  }

  return {
    tool: "validation/m14/go/go-incoming-resolve.ts",
    phase: "index",
    corpusRoot: CORPUS_ROOT,
    shard: `${si}/${so}`,
    populationOffered: files.length,
    populationFiles: Math.ceil(files.length / so),
    parsedFiles: parsed,
    crashedFiles: crashed,
    crashSamples,
    nodeTypeCount: Object.keys(nodeTypes).length,
    nodeTypes,
    unreadReceivers,
    unreadReceiverShapes,
    unnamedFields,
    embeddedFields,
    methodSpecNodes,
    structElemNodes,
    distinctNames: names.size,
    names: Object.fromEntries([...names.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))),
  }
}

// ---------------------------------------------------------------------------
// The classifier.
// ---------------------------------------------------------------------------

interface Index {
  names: Map<string, NameFacts>
  meta: Record<string, unknown>
}

interface Verdict {
  klass: string
  /** how many declarations the string binds to, corpus-wide */
  candidates: number
  /** for a qualified endpoint, did the OWNER half resolve */
  ownerResolved: boolean
  /** RESOLVED/VIA_OWNER but the name also names >= 1 member somewhere */
  collidesWithMember: boolean
  /** the OWNER half resolved and the tail is a member of a DIFFERENT type, so
   *  the endpoint as written names a declaration that does not exist */
  wrongOwner?: boolean
}

/**
 * The four classes, as ONE decision table over Go's own scope rules.
 *
 * Go spec, Declarations and scope: "The scope of an identifier denoting a
 * constant, type, variable, or function declared at top level ... is the package
 * block"; a bare identifier therefore binds to a package-scope declaration if one
 * exists, and only inside a member's namespace otherwise. That is the whole rule,
 * and it is total, so the classifier below is too.
 *
 *   pkg >= 2                     AMBIGUOUS      two package-scope anchors
 *   pkg == 1, mem == 0           RESOLVED       one anchor, nothing to confuse it with
 *   pkg == 1, mem >= 1           RESOLVED       one PACKAGE-SCOPE anchor; the members are
 *                                               counted separately as `collidesWithMember`,
 *                                               because Go's rule picks the package block
 *   pkg == 0, mem == 1           VIA_OWNER      the anchor is `owner.name`
 *   pkg == 0, mem >= 2           AMBIGUOUS      one anchor per owner
 *   pkg == 0, mem == 0           UNRESOLVABLE   the name is declared nowhere
 *
 * A first draft carried the `pkg >= 2` case inside a helper that returned only a
 * COUNT, and the plain-name branch then fell through every row to
 * UNRESOLVABLE. Measured consequence: `exports` read 66.5% unresolvable when the
 * truth is that most of those names are declared in two or three of go-stdlib's
 * 57 packages -- `HasSuffix` is package-scope in three of them. A classifier with
 * a wrong fall-through reports a confident wrong number and nothing downstream can
 * see it, which is why `--self-test-classifier` below drives every row of this
 * table from a synthetic index and fails if any row is unreachable.
 *
 * QUALIFIED endpoints (`Outer.Member`) are resolved THROUGH the owner, which is
 * Go's own rule, so they are VIA-OWNER -- and only when the OWNER half resolves.
 * An owner that does not resolve makes the endpoint unresolvable as written: the
 * tail alone is a different name in a different namespace. When the owner
 * resolves but the tail is a member of some OTHER type, the endpoint names a
 * method that does not exist and is counted UNRESOLVABLE with `wrongOwner` set,
 * so any occurrence is loud rather than folded into a percentage.
 */
function classifyEndpoint(raw: string, idx: Index): Verdict {
  if (raw.length === 0) return { klass: CLASS_EMPTY, candidates: 0, ownerResolved: false, collidesWithMember: false }
  if (PLACEHOLDERS.has(raw)) return { klass: CLASS_PLACEHOLDER, candidates: 0, ownerResolved: false, collidesWithMember: false }

  const dot = raw.lastIndexOf(".")
  if (dot > 0 && dot < raw.length - 1) {
    const head = raw.slice(0, dot)
    const tail = raw.slice(dot + 1)
    const hf = idx.names.get(head)
    const tf = idx.names.get(tail)
    const headDeclared = hf !== undefined && (hf.pkg > 0 || hf.member > 0)
    if (!headDeclared) return { klass: CLASS_UNRESOLVABLE, candidates: 0, ownerResolved: false, collidesWithMember: false }
    if (hf!.pkg >= 2) return { klass: CLASS_AMBIGUOUS, candidates: hf!.pkg, ownerResolved: false, collidesWithMember: false }
    if (tf === undefined) return { klass: CLASS_UNRESOLVABLE, candidates: 0, ownerResolved: true, collidesWithMember: false }
    const memberOfThisOwner = tf.owners.indexOf(head) >= 0
    if (memberOfThisOwner && tf.pkg === 0) return { klass: CLASS_VIA_OWNER, candidates: 1, ownerResolved: true, collidesWithMember: false }
    if (memberOfThisOwner && tf.pkg >= 1) {
      // `Outer.M` where M is BOTH a member of Outer and a package-scope name:
      // two anchors for one string.
      return { klass: CLASS_AMBIGUOUS, candidates: tf.pkg + tf.member, ownerResolved: true, collidesWithMember: false }
    }
    if (!memberOfThisOwner) {
      // The tail names a member of SOME OTHER type. The endpoint as written does
      // not exist; counted as unresolvable and flagged.
      return { klass: CLASS_UNRESOLVABLE, candidates: tf.pkg + tf.member, ownerResolved: true, collidesWithMember: false, wrongOwner: true }
    }
    return { klass: CLASS_VIA_OWNER, candidates: 1, ownerResolved: true, collidesWithMember: false }
  }

  const f = idx.names.get(raw)
  if (f === undefined) return { klass: CLASS_UNRESOLVABLE, candidates: 0, ownerResolved: false, collidesWithMember: false }
  const pkg = f.pkg
  const mem = f.member
  if (pkg >= 2) return { klass: CLASS_AMBIGUOUS, candidates: pkg + mem, ownerResolved: false, collidesWithMember: mem >= 1 }
  if (pkg === 1) return { klass: CLASS_RESOLVED, candidates: 1, ownerResolved: false, collidesWithMember: mem >= 1 }
  // pkg === 0, and `f` existing means mem >= 1.
  if (mem === 1) return { klass: CLASS_VIA_OWNER, candidates: 1, ownerResolved: true, collidesWithMember: false }
  return { klass: CLASS_AMBIGUOUS, candidates: mem, ownerResolved: false, collidesWithMember: false }
}

/**
 * Drives every row of the table above from a synthetic index, and fails if any
 * expected class is not produced. A census whose classifier cannot be shown to
 * produce a class is a census that reports 0 for that class because the branch is
 * dead, which is the failure this lane's own `method_elem` branch had.
 */
function selfTestClassifier(): { rows: Array<{ endpoint: string; facts: string; expected: string; got: string; ok: boolean }>; ok: boolean } {
  const names = new Map<string, NameFacts>()
  const put = (name: string, pkg: number, member: number, owners: string[]): void => {
    names.set(name, { pkg, member, pkgDirs: pkg, files: pkg + member, owners })
  }
  put("OnlyPackage", 1, 0, [])                       // pkg == 1, mem == 0
  put("PkgAndMembers", 1, 3, ["A", "B", "C"])        // pkg == 1, mem >= 1
  put("TwoPackages", 2, 0, [])                       // pkg >= 2
  put("MemberOnly", 0, 1, ["Owner"])                 // pkg == 0, mem == 1
  put("MembersMany", 0, 4, ["Owner", "Other", "X", "Y"]) // pkg == 0, mem >= 2
  put("Owner", 1, 0, [])                             // the owner of MemberOnly / MembersMany
  put("BothMemberAndPkg", 1, 1, ["Owner"])         // pkg == 1 AND a member of Owner
  const idx: Index = { names, meta: {} }
  // A name with zero declarations must not sit in the index as a zero-record, or
  // it would resolve to itself. It is simply never inserted: "not declared" is
  // the absence of a record, not a record of zero.

  const cases: Array<{ endpoint: string; facts: string; expected: string }> = [
    { endpoint: "OnlyPackage", facts: "pkg=1 mem=0", expected: CLASS_RESOLVED },
    { endpoint: "PkgAndMembers", facts: "pkg=1 mem=3", expected: CLASS_RESOLVED },
    { endpoint: "TwoPackages", facts: "pkg=2 mem=0", expected: CLASS_AMBIGUOUS },
    { endpoint: "MemberOnly", facts: "pkg=0 mem=1", expected: CLASS_VIA_OWNER },
    { endpoint: "MembersMany", facts: "pkg=0 mem=4", expected: CLASS_AMBIGUOUS },
    { endpoint: "Absent", facts: "not in the index", expected: CLASS_UNRESOLVABLE },
    { endpoint: "", facts: "zero length", expected: CLASS_EMPTY },
    { endpoint: "_", facts: "Go's blank identifier", expected: CLASS_PLACEHOLDER },
    { endpoint: "Owner.MemberOnly", facts: "member of Owner", expected: CLASS_VIA_OWNER },
    { endpoint: "Owner.BothMemberAndPkg", facts: "member of Owner AND package-scope", expected: CLASS_AMBIGUOUS },
    { endpoint: "NoSuchOwner.MemberOnly", facts: "owner undeclared", expected: CLASS_UNRESOLVABLE },
    { endpoint: "OnlyPackage.MemberOnly", facts: "MemberOnly belongs to Owner, not OnlyPackage", expected: CLASS_UNRESOLVABLE },
    { endpoint: "github.com/x/y", facts: "a module path: no head, no tail", expected: CLASS_UNRESOLVABLE },
    { endpoint: "path/filepath", facts: "a module path with no dot", expected: CLASS_UNRESOLVABLE },
  ]
  const rows = cases.map((c) => {
    const got = classifyEndpoint(c.endpoint, idx).klass
    return { endpoint: c.endpoint, facts: c.facts, expected: c.expected, got, ok: got === c.expected }
  })
  // Every one of the four named classes must be produced by at least one row, so
  // a table that silently stopped emitting a class fails here rather than
  // reporting 0% for it on the corpus.
  const produced = new Set(rows.map((r) => r.got))
  const mustProduce = [CLASS_RESOLVED, CLASS_VIA_OWNER, CLASS_AMBIGUOUS, CLASS_UNRESOLVABLE, CLASS_EMPTY, CLASS_PLACEHOLDER]
  for (const k of mustProduce) {
    if (!produced.has(k)) rows.push({ endpoint: "(class not produced by any row)", facts: k, expected: k, got: "NOTHING", ok: false })
  }
  const ok = rows.every((r) => r.ok)
  return { rows, ok }
}

// ---------------------------------------------------------------------------

interface Bucket {
  edges: number
  /** class of the TARGET — the incoming view */
  tgt: Record<string, number>
  /** class of the SOURCE — the outgoing view */
  src: Record<string, number>
  /** both ends resolved: a walk from the anchor can continue to the source */
  traversable: number
  /** RESOLVED targets whose name also names >= 1 member somewhere in the corpus */
  collidesWithMember: number
  /** distinct target strings seen, and how many of them bind to > 1 declaration */
  distinctTargets: Set<string>
  ambiguousTargets: Set<string>
  unresolvableTargets: Set<string>
  files: Set<string>
  /** edges whose SOURCE names no declaration in the ANALYSED FILE */
  foreignSource: number
  /** edges whose (type|source|target) has ALREADY been emitted in this file --
   *  i.e. a duplicate, which is the shape an inbound twin would take if it were
   *  emitted under the SAME label. A reverse edge under a DIFFERENT label would
   *  not land here, so this is a lower bound and is labelled one. */
  duplicateRows: number
  /** the reverse twin already present in the file, whatever its label */
  reverseTwinRows: number
}

function emptyBucket(): Bucket {
  const tgt: Record<string, number> = {}
  const src: Record<string, number> = {}
  for (const c of CLASSES) {
    tgt[c] = 0
    src[c] = 0
  }
  return {
    edges: 0,
    tgt,
    src,
    traversable: 0,
    collidesWithMember: 0,
    distinctTargets: new Set(),
    ambiguousTargets: new Set(),
    unresolvableTargets: new Set(),
    files: new Set(),
    foreignSource: 0,
  }
}

interface ResolveShard {
  tool: string
  phase: "resolve"
  corpusRoot: string
  shard: string
  indexFile: string
  indexDistinctNames: number
  indexFilesCovered: number
  populationOffered: number
  populationFiles: number
  parsedFiles: number
  crashedFiles: number
  crashSamples: string[]
  totalSymbols: number
  totalRelationships: number
  totalImportsChannel: number
  enumValues: string[]
  fired: string[]
  silent: string[]
  buckets: Record<string, {
    edges: number
    tgt: Record<string, number>
    src: Record<string, number>
    traversable: number
    collidesWithMember: number
    distinctTargets: number
    ambiguousTargets: number
    unresolvableTargets: number
    files: number
    foreignSource: number
    duplicateRows: number
    reverseTwinRows: number
  }>
  /** top (tgtClass,srcClass) pairs among the NOT-traversable edges */
  blockReasons: Array<{ pair: string; n: number }>
  samples: {
    resolved: string[]
    viaOwner: string[]
    ambiguous: string[]
    unresolvable: string[]
    empty: string[]
    placeholder: string[]
  }
}

async function phaseResolve(files: CorpusFile[], shardSpec: string, indexPath: string): Promise<ResolveShard> {
  const { i: si, of: so } = shardRange(shardSpec, files.length)
  const idx = loadIndex(indexPath)
  const buckets = new Map<string, Bucket>()
  const samples: ResolveShard["samples"] = { resolved: [], viaOwner: [], ambiguous: [], unresolvable: [], empty: [], placeholder: [] }
  const blockReasons = new Map<string, number>()
  const crashSamples: string[] = []
  let crashed = 0
  let parsed = 0
  let totalSymbols = 0
  let totalRels = 0
  let totalImports = 0
  let wrongOwnerEndpoints = 0

  for (let n = 0; n < files.length; n++) {
    if (so > 1 && n % so !== si) continue
    const f = files[n]
    let content: string
    try {
      content = readFileSync(f.path, "utf8")
    } catch {
      continue
    }
    let res: any
    try {
      res = await ASTEngine.parseFile(f.path, content)
    } catch (e) {
      crashed++
      if (crashSamples.length < 5) crashSamples.push(`${f.rel}: ${String(e).slice(0, 100)}`)
      continue
    }
    parsed++
    const symbols = (res.symbols || []) as any[]
    const rels = (res.relationships || []) as any[]
    totalSymbols += symbols.length
    totalRels += rels.length
    totalImports += (res.imports || []).length

    // The analysed file's OWN symbol names, so "does this edge point at
    // something outside the file it came from" is measurable rather than assumed.
    const fileNames = new Set<string>()
    for (const s of symbols) {
      const nm = typeof s.name === "string" ? s.name : ""
      if (nm.length > 0) fileNames.add(nm)
    }

    // Reverse twins, counted PER FILE so a pair emitted by one file is
    // distinguishable from the same pair emitted by two. A reverse twin is the
    // shape an inbound edge would take: the file already contains BOTH
    // `s -> d` and `d -> s`, whatever label each carries. Counting it answers
    // "has the incoming half already been emitted?" without assuming which
    // label would carry it.
    const reversePairs = new Set<string>()
    for (const r of rels) {
      const s0 = typeof r.source === "string" ? r.source : typeof r.from === "string" ? r.from : ""
      const d0 = typeof r.target === "string" ? r.target : typeof r.to === "string" ? r.to : ""
      if (s0.length > 0 && d0.length > 0 && s0 !== d0) reversePairs.add(`${d0}|${s0}`)
    }
    const seenPairs = new Set<string>()

    for (const r of rels) {
      const ty = typeof r.type === "string" && r.type.length > 0 ? r.type : typeof r.relationshipType === "string" ? r.relationshipType : ""
      if (ty.length === 0) continue
      let b = buckets.get(ty)
      if (!b) {
        b = emptyBucket()
        buckets.set(ty, b)
      }
      const s = typeof r.source === "string" ? r.source : typeof r.from === "string" ? r.from : ""
      const d = typeof r.target === "string" ? r.target : typeof r.to === "string" ? r.to : ""
      b.edges++
      if (reversePairs.has(`${d}|${s}`)) b.reverseTwinRows++
      const fwdKey = `${ty}|${s}|${d}`
      if (seenPairs.has(fwdKey)) b.duplicateRows++
      seenPairs.add(fwdKey)
      b.files.add(f.rel)
      b.distinctTargets.add(d)
      if (d.length > 0 && !fileNames.has(d)) {
        // The target is not a symbol of the file that emitted the edge, which is
        // the NORMAL shape for a leaf call target. Counted separately so the
        // outgoing-only claim is not read as "every edge is file-local".
        b.foreignSource++
      }

      const tv = classifyEndpoint(d, idx)
      const sv = classifyEndpoint(s, idx)
      b.tgt[tv.klass] = (b.tgt[tv.klass] || 0) + 1
      b.src[sv.klass] = (b.src[sv.klass] || 0) + 1
      if (tv.collidesWithMember && (tv.klass === CLASS_RESOLVED || tv.klass === CLASS_VIA_OWNER)) b.collidesWithMember++
      if (tv.wrongOwner) wrongOwnerEndpoints++
      if (tv.klass === CLASS_AMBIGUOUS) b.ambiguousTargets.add(d)
      if (tv.klass === CLASS_UNRESOLVABLE || tv.klass === CLASS_EMPTY) b.unresolvableTargets.add(d)

      const tOk = tv.klass === CLASS_RESOLVED || tv.klass === CLASS_VIA_OWNER
      const sOk = sv.klass === CLASS_RESOLVED || sv.klass === CLASS_VIA_OWNER
      if (tOk && sOk) {
        b.traversable++
      } else {
        const pair = `${tv.klass}->${sv.klass}`
        blockReasons.set(pair, (blockReasons.get(pair) || 0) + 1)
      }

      const bucketForClass =
        tv.klass === CLASS_RESOLVED ? samples.resolved :
        tv.klass === CLASS_VIA_OWNER ? samples.viaOwner :
        tv.klass === CLASS_AMBIGUOUS ? samples.ambiguous :
        tv.klass === CLASS_UNRESOLVABLE ? samples.unresolvable :
        tv.klass === CLASS_EMPTY ? samples.empty : samples.placeholder
      if (bucketForClass.length < 12) bucketForClass.push(`${f.rel}: ${s} -> ${d}`)
    }
  }

  const outBuckets: ResolveShard["buckets"] = {}
  const fired: string[] = []
  const silent: string[] = []
  for (const v of ENUM_VALUES) {
    const b = buckets.get(v)
    if (b && b.edges > 0) {
      fired.push(v)
      outBuckets[v] = {
        edges: b.edges,
        tgt: b.tgt,
        src: b.src,
        traversable: b.traversable,
        collidesWithMember: b.collidesWithMember,
        distinctTargets: b.distinctTargets.size,
        ambiguousTargets: b.ambiguousTargets.size,
        unresolvableTargets: b.unresolvableTargets.size,
        files: b.files.size,
        foreignSource: b.foreignSource,
        duplicateRows: b.duplicateRows,
        reverseTwinRows: b.reverseTwinRows,
      }
    } else {
      silent.push(v)
    }
  }
  // Any type outside the enum is reported rather than dropped: a lane must not
  // be able to look complete by inventing a spelling.
  for (const [k, b] of buckets) {
    if (ENUM_VALUES.indexOf(k) >= 0) continue
    outBuckets[k] = {
      edges: b.edges,
      tgt: b.tgt,
      src: b.src,
      traversable: b.traversable,
      collidesWithMember: b.collidesWithMember,
      distinctTargets: b.distinctTargets.size,
      ambiguousTargets: b.ambiguousTargets.size,
      unresolvableTargets: b.unresolvableTargets.size,
      files: b.files.size,
      foreignSource: b.foreignSource,
      duplicateRows: b.duplicateRows,
      reverseTwinRows: b.reverseTwinRows,
    }
  }

  return {
    tool: "validation/m14/go/go-incoming-resolve.ts",
    phase: "resolve",
    corpusRoot: CORPUS_ROOT,
    shard: `${si}/${so}`,
    indexFile: indexPath,
    indexDistinctNames: idx.meta.distinctNames as number,
    indexFilesCovered: idx.meta.parsedFiles as number,
    populationOffered: files.length,
    populationFiles: Math.ceil(files.length / so),
    parsedFiles: parsed,
    crashedFiles: crashed,
    crashSamples,
    totalSymbols,
    totalRelationships: totalRels,
    totalImportsChannel: totalImports,
    wrongOwnerEndpoints,
    enumValues: ENUM_VALUES,
    fired,
    silent,
    buckets: outBuckets,
    blockReasons: [...blockReasons.entries()].map(([pair, n]) => ({ pair, n })).sort((a, b) => b.n - a.n).slice(0, 40),
    samples,
  }
}

function loadIndex(path: string): Index {
  const raw = JSON.parse(readFileSync(path, "utf8"))
  const names = new Map<string, NameFacts>()
  const merged = raw.merged && raw.merged.names ? raw.merged.names : raw.names
  for (const k of Object.keys(merged || {})) names.set(k, merged[k])
  const meta = raw.merged || raw
  return { names, meta }
}

// ---------------------------------------------------------------------------
// Merges. Each REFUSES a population that is not the sum of its inputs, because
// a merged count that silently dropped a shard reads exactly like a smaller
// real number.
// ---------------------------------------------------------------------------

function mergeIndex(paths: string[], out: string): void {
  const names = new Map<string, NameFacts>()
  let parsedFiles = 0
  let crashedFiles = 0
  let offered = 0
  const nodeTypes: Record<string, number> = {}
  const shards: string[] = []
  for (const p of paths) {
    const a = JSON.parse(readFileSync(p, "utf8"))
    shards.push(a.shard)
    parsedFiles += a.parsedFiles || 0
    crashedFiles += a.crashedFiles || 0
    offered += a.populationFiles || 0
    for (const k of Object.keys(a.nodeTypes || {})) nodeTypes[k] = (nodeTypes[k] || 0) + (a.nodeTypes[k] || 0)
    const src = a.names || {}
    for (const name of Object.keys(src)) {
      const f = src[name]
      let acc = names.get(name)
      if (!acc) {
        acc = emptyFacts()
        names.set(name, acc)
      }
      acc.pkg = Math.max(acc.pkg, f.pkg)
      acc.member = Math.max(acc.member, f.member)
      acc.pkgDirs = Math.max(acc.pkgDirs, f.pkgDirs)
      acc.files = Math.max(acc.files, f.files)
      for (const o of f.owners || []) if (acc.owners.length < OWNER_CAP && acc.owners.indexOf(o) < 0) acc.owners.push(o)
    }
  }
  const artifact = {
    tool: "validation/m14/go/go-incoming-resolve.ts",
    phase: "index",
    corpusRoot: CORPUS_ROOT,
    shard: shards.join("+"),
    populationFiles: offered,
    populationOffered: offered,
    parsedFiles,
    crashedFiles,
    distinctNames: names.size,
    nodeTypeCount: Object.keys(nodeTypes).length,
    nodeTypes,
    names: Object.fromEntries([...names.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))),
  }
  writeFileSync(out, JSON.stringify(artifact))
  process.stderr.write(`merged index: ${paths.length} shards, ${offered} files, ${parsedFiles} parsed, ${names.size} distinct declared names\n`)
}

function addCounts(dst: Record<string, number>, src: Record<string, number>): void {
  for (const k of Object.keys(src || {})) dst[k] = (dst[k] || 0) + src[k]
}

function mergeResolve(paths: string[], out: string): void {
  const perType = new Map<string, {
    edges: number
    tgt: Record<string, number>
    src: Record<string, number>
    traversable: number
    collidesWithMember: number
    ambiguousTargets: number
    unresolvableTargets: number
    files: number
    foreignSource: number
    distinctTargets: number
    duplicateRows: number
    reverseTwinRows: number
  }>()
  const blockReasons = new Map<string, number>()
  let parsedFiles = 0
  let crashedFiles = 0
  let offered = 0
  let totalSymbols = 0
  let totalRels = 0
  let totalImports = 0
  const shards: string[] = []
  const firedUnion = new Set<string>()
  const silentUnion = new Set<string>()
  let indexDistinctNames = 0
  let indexFilesCovered = 0
  let wrongOwnerEndpoints = 0

  for (const p of paths) {
    const a = JSON.parse(readFileSync(p, "utf8"))
    shards.push(a.shard)
    parsedFiles += a.parsedFiles
    crashedFiles += a.crashedFiles
    offered += a.populationFiles
    totalSymbols += a.totalSymbols
    totalRels += a.totalRelationships
    totalImports += a.totalImportsChannel
    wrongOwnerEndpoints += a.wrongOwnerEndpoints || 0
    indexDistinctNames = Math.max(indexDistinctNames, a.indexDistinctNames || 0)
    indexFilesCovered = Math.max(indexFilesCovered, a.indexFilesCovered || 0)
    for (const f of a.fired || []) firedUnion.add(f)
    for (const s of a.silent || []) silentUnion.add(s)
    for (const br of a.blockReasons || []) blockReasons.set(br.pair, (blockReasons.get(br.pair) || 0) + br.n)
    for (const ty of Object.keys(a.buckets || {})) {
      const b = a.buckets[ty]
      let acc = perType.get(ty)
      if (!acc) {
        acc = {
          edges: 0, tgt: {}, src: {}, traversable: 0, collidesWithMember: 0,
          ambiguousTargets: 0, unresolvableTargets: 0, files: 0, foreignSource: 0, distinctTargets: 0,
          duplicateRows: 0, reverseTwinRows: 0,
        }
        perType.set(ty, acc)
      }
      acc.edges += b.edges
      addCounts(acc.tgt, b.tgt)
      addCounts(acc.src, b.src)
      acc.traversable += b.traversable
      acc.collidesWithMember += b.collidesWithMember
      // distinct-file and distinct-target counts do NOT sum across shards
      // without the sets, so the merge takes the MAX and records that it did.
      // Overlapping shard file lists would make the true union smaller, so the
      // figure is a LOWER BOUND on distinct files and an UPPER BOUND on
      // distinct targets; it is labelled that way rather than quietly summed.
      acc.files = Math.max(acc.files, b.files)
      acc.ambiguousTargets = Math.max(acc.ambiguousTargets, b.ambiguousTargets)
      acc.unresolvableTargets = Math.max(acc.unresolvableTargets, b.unresolvableTargets)
      acc.distinctTargets = Math.max(acc.distinctTargets, b.distinctTargets)
      acc.foreignSource += b.foreignSource
      acc.duplicateRows += b.duplicateRows
      acc.reverseTwinRows += b.reverseTwinRows
    }
  }

  const artifact = {
    tool: "validation/m14/go/go-incoming-resolve.ts",
    phase: "resolve",
    corpusRoot: CORPUS_ROOT,
    shard: shards.join("+"),
    mergeNote: "distinct files / distinct targets are the MAX over shards, not the sum: a shard file list can overlap, so files is a LOWER BOUND and targets an UPPER BOUND. edges, tgt, src, traversable and collidesWithMember ARE summed.",
    indexDistinctNames,
    indexFilesCovered,
    populationOffered: offered,
    populationFiles: offered,
    parsedFiles,
    crashedFiles,
    totalSymbols,
    totalRelationships: totalRels,
    totalImportsChannel: totalImports,
    wrongOwnerEndpoints,
    enumValues: ENUM_VALUES,
    fired: [...firedUnion],
    silent: [...silentUnion],
    buckets: Object.fromEntries(perType),
    blockReasons: [...blockReasons.entries()].map(([pair, n]) => ({ pair, n })).sort((a, b) => b.n - a.n).slice(0, 40),
  }
  writeFileSync(out, JSON.stringify(artifact, null, 2))
  reportResolve(artifact)
}

// ---------------------------------------------------------------------------
// Reporting.
// ---------------------------------------------------------------------------

function pct(n: number, d: number): string {
  if (d === 0) return "-"
  return ((100 * n) / d).toFixed(1) + "%"
}

function reportResolve(a: any): void {
  const L = (s: string) => process.stderr.write(s + "\n")
  L("")
  L("=".repeat(118))
  L("INCOMING / RESOLUTION — every emitted edge, viewed from its TARGET")
  L("=".repeat(118))
  L(`corpus ${a.corpusRoot}`)
  L(`draw ${a.parsedFiles}/${a.populationFiles} files parsed, ${a.crashedFiles} crashed  (shards: ${a.shard})`)
  L(`declaration index: ${a.indexDistinctNames} distinct declared names over ${a.indexFilesCovered} files`)
  L(`${a.totalRelationships} relationships, ${a.totalSymbols} symbols, imports[] channel ${a.totalImportsChannel}`)
  L(`fired ${a.fired.length}/${a.enumValues.length}: ${a.fired.join(" ")}`)
  if (a.silent.length) L(`SILENT: ${a.silent.join(" ")}`)
  L("")
  L("class of the TARGET (the incoming view). EMPTY and PLACEHOLDER are shown and are folded")
  L("into UNRESOLVABLE only in the four-way column, which says so.")
  L("")
  const head = ["type", "edges", "files", "targets", "resolved", "via-owner", "ambiguous", "unresolv", "empty", "placehldr", "4-way % res", "%via", "%amb", "%unres"]
  L(head.map((h, i) => (i === 0 ? h.padEnd(13) : h.padStart(11))).join(""))
  L("-".repeat(118))
  let T = { edges: 0, resolved: 0, via: 0, amb: 0, unres: 0, empty: 0, ph: 0, trav: 0, coll: 0 }
  for (const ty of Object.keys(a.buckets).sort()) {
    const b = a.buckets[ty]
    const t = b.tgt
    const four = t[CLASS_RESOLVED] + t[CLASS_VIA_OWNER] + t[CLASS_AMBIGUOUS] + t[CLASS_UNRESOLVABLE] + t[CLASS_EMPTY] + t[CLASS_PLACEHOLDER]
    L(
      ty.padEnd(13) +
      String(b.edges).padStart(11) +
      String(b.files).padStart(11) +
      String(b.distinctTargets).padStart(11) +
      String(t[CLASS_RESOLVED] || 0).padStart(11) +
      String(t[CLASS_VIA_OWNER] || 0).padStart(11) +
      String(t[CLASS_AMBIGUOUS] || 0).padStart(11) +
      String(t[CLASS_UNRESOLVABLE] || 0).padStart(11) +
      String(t[CLASS_EMPTY] || 0).padStart(11) +
      String(t[CLASS_PLACEHOLDER] || 0).padStart(11) +
      pct(t[CLASS_RESOLVED] || 0, four).padStart(11) +
      pct(t[CLASS_VIA_OWNER] || 0, four).padStart(7) +
      pct(t[CLASS_AMBIGUOUS] || 0, four).padStart(6) +
      pct(t[CLASS_UNRESOLVABLE] || 0, four).padStart(8),
    )
    T.edges += b.edges
    T.resolved += t[CLASS_RESOLVED] || 0
    T.via += t[CLASS_VIA_OWNER] || 0
    T.amb += t[CLASS_AMBIGUOUS] || 0
    T.unres += t[CLASS_UNRESOLVABLE] || 0
    T.empty += t[CLASS_EMPTY] || 0
    T.ph += t[CLASS_PLACEHOLDER] || 0
    T.trav += b.traversable
    T.coll += b.collidesWithMember
  }
  L("-".repeat(118))
  L(
    "TOTAL".padEnd(13) +
    String(T.edges).padStart(11) +
    "".padStart(33) +
    String(T.resolved).padStart(11) +
    String(T.via).padStart(11) +
    String(T.amb).padStart(11) +
    String(T.unres).padStart(11) +
    String(T.empty).padStart(11) +
    String(T.ph).padStart(11) +
    pct(T.resolved, T.edges).padStart(11) +
    pct(T.via, T.edges).padStart(7) +
    pct(T.amb, T.edges).padStart(6) +
    pct(T.unres, T.edges).padStart(8),
  )
  L("")
  L("TRAVERSABLE FROM THE FAR END — both ends resolve, so a walk from the anchor reaches a")
  L("source it can then walk out of. Ambiguous is NOT traversable: a consumer cannot pick an")
  L("anchor without type inference, and picking one silently is the fabrication rule's failure.")
  L("")
  L("type".padEnd(13) + "edges".padStart(11) + "traversable".padStart(13) + "rate".padStart(9) + "blocked by (target->source)".padStart(40))
  for (const ty of Object.keys(a.buckets).sort()) {
    const b = a.buckets[ty]
    L(ty.padEnd(13) + String(b.edges).padStart(11) + String(b.traversable).padStart(13) + pct(b.traversable, b.edges).padStart(9) + String(b.edges - b.traversable).padStart(40))
  }
  L("TOTAL".padEnd(13) + String(T.edges).padStart(11) + String(T.trav).padStart(13) + pct(T.trav, T.edges).padStart(9))
  L("")
  L("WHERE THE BLOCKS ARE (target->source), over every type:")
  for (const br of a.blockReasons || []) L(`  ${br.pair.padEnd(40)} ${String(br.n).padStart(9)}  ${pct(br.n, T.edges - T.trav)} of blocked`)
  L("")
  L(`RESOLVED/VIA-OWNER targets whose name ALSO names >=1 member somewhere in the corpus: ${T.coll} of ${T.resolved + T.via} anchored targets (${pct(T.coll, T.resolved + T.via)}).`)
  L(`  Go's scope rule picks the package block for a bare identifier, so these stay RESOLVED -- but`)
  L(`  a target produced from a SELECTOR (x.Label -> uses Label) is a member reference, so this is`)
  L(`  the surface where the reverse direction could pick the package-scope anchor instead.`)
  L(`  Qualified endpoints whose OWNER resolves but whose tail is a member of a DIFFERENT type:`)
  L(`  ${a.wrongOwnerEndpoints || 0} -- these name a declaration that does not exist, and are counted UNRESOLVABLE.`)
  let dup = 0
  let twin = 0
  for (const ty of Object.keys(a.buckets)) {
    dup += a.buckets[ty].duplicateRows || 0
    twin += a.buckets[ty].reverseTwinRows || 0
  }
  L("")
  L("IS THE INCOMING HALF ALREADY EMITTED, under any label?")
  L(`  same-label duplicate rows (type|source|target emitted twice in one file): ${dup}`)
  L(`  reverse twins (the same file already carries BOTH s->d and d->s):         ${twin}`)
  L(`  A reverse twin is not automatically a fabricated incoming edge -- a struct that contains a`)
  L(`  field of its own type legitimately yields both. It is the COUNT that matters: if the`)
  L(`  incoming half were emitted, the twin count would be at or near the edge count.`)
}

// ---------------------------------------------------------------------------
// --outgoing-only. Four measurements, none of them prose.
// ---------------------------------------------------------------------------

/** Read the module specifiers of a TypeScript file by scanning for `from "…"`
 *  and `import "…"`, using charCodeAt to find the quote. No pattern. */
function moduleSpecifiers(src: string): string[] {
  const out: string[] = []
  const lines = src.split("\n")
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.indexOf("import ") !== 0 && trimmed.indexOf("export ") !== 0) continue
    // find the LAST quote-delimited span on the line
    let q = -1
    let span = ""
    for (let i = 0; i < line.length; i++) {
      const c = line.charCodeAt(i)
      if (c === 34 || c === 39 || c === 96) {
        if (q < 0) q = i
        else {
          span = line.slice(q + 1, i)
          q = -1
        }
      }
    }
    if (span.length > 0) out.push(span)
  }
  return out
}

/** Field names of a top-level `export interface X { … }` block, read by brace
 *  depth and by the first token of each member line. No pattern. */
function interfaceFields(src: string, name: string): string[] {
  const at = src.indexOf(`interface ${name}`)
  if (at < 0) return []
  let i = src.indexOf("{", at)
  if (i < 0) return []
  let depth = 0
  let started = false
  const body: string[] = []
  for (; i < src.length; i++) {
    const ch = src.charAt(i)
    if (ch === "{") {
      depth++
      started = true
      continue
    }
    if (ch === "}") {
      depth--
      if (started && depth === 0) break
      continue
    }
    if (started) body.push(ch)
  }
  const fields: string[] = []
  let buf = ""
  for (const ch of body) {
    if (ch === "\n" || ch === ";" || ch === ",") {
      const t = buf.trim()
      if (t.length > 0) fields.push(t.split("\n")[0].trim().split(" ")[0].split(":")[0].split("?")[0])
      buf = ""
      continue
    }
    if (ch === "}" || ch === "(" || ch === ")") {
      buf += ch
      continue
    }
    buf += ch
  }
  const t = buf.trim()
  if (t.length > 0) fields.push(t.split("\n")[0].trim().split(" ")[0].split(":")[0].split("?")[0])
  return fields.filter((f) => f.length > 0 && f.indexOf("/") < 0 && f.indexOf("*") < 0)
}

function containsWord(hay: string, needle: string): boolean {
  let at = 0
  for (;;) {
    const found = hay.indexOf(needle, at)
    if (found < 0) return false
    const before = found === 0 ? " " : hay.charAt(found - 1)
    const after = hay.charAt(found + needle.length)
    const okBefore = before === " " || before === "\t" || before === "," || before === "?" || before === ":" || before === "("
    const okAfter = after === " " || after === "\t" || after === "," || after === "?" || after === ":" || after === "("
    if (okBefore && okAfter) return true
    at = found + needle.length
  }
}

/**
 * A SUMMARY of the declaration index, with no identifier in it.
 *
 * WHY NOT COMMIT THE INDEX ITSELF. It is 12 MB of 141,417 Go identifiers, and
 * `script/m14/verify-honesty.ts` lints every `.json` under `validation/m14/`
 * for contract section 1's banned vocabulary -- including `complete`. go-stdlib
 * contains `Complete`, `mustHaveCompleteRequirements` and `markComplete` as real
 * declaration names, so committing the index fails the honesty gate on the
 * language's own vocabulary. The previous generation of this lane recorded the
 * same encounter and the same answer: record the figure the analysis turns on,
 * not the raw identifiers, because "a gate that cannot tell an identifier from a
 * claim is a gate that gets satisfied by deleting evidence, and deleting evidence
 * is the worse outcome."
 *
 * So what is recorded is the DISTRIBUTION the classifier reads: how many names
 * sit in each row of the decision table, and how many are declared in more than
 * one package directory. Those are counts, and every class in the census is a
 * function of them.
 */
function phaseIndexSummary(indexPath: string): void {
  const L = (s: string) => process.stderr.write(s + "\n")
  const raw = JSON.parse(readFileSync(indexPath, "utf8"))
  const names = raw.names || {}
  const rows: Record<string, number> = {
    "pkg>=2 (AMBIGUOUS)": 0,
    "pkg==1 member==0 (RESOLVED, unique)": 0,
    "pkg==1 member>=1 (RESOLVED, member collides)": 0,
    "pkg==0 member==1 (VIA_OWNER, unique)": 0,
    "pkg==0 member>=2 (AMBIGUOUS, one per owner)": 0,
    "declared in >1 package directory": 0,
    "declared in >1 FILE": 0,
  }
  let pkgTotal = 0
  let memberTotal = 0
  let maxPkg = 0
  for (const k of Object.keys(names)) {
    const f = names[k]
    pkgTotal += f.pkg
    memberTotal += f.member
    if (f.pkg > maxPkg) maxPkg = f.pkg
    if (f.pkg >= 2) rows["pkg>=2 (AMBIGUOUS)"]++
    else if (f.pkg === 1 && f.member === 0) rows["pkg==1 member==0 (RESOLVED, unique)"]++
    else if (f.pkg === 1 && f.member >= 1) rows["pkg==1 member>=1 (RESOLVED, member collides)"]++
    else if (f.pkg === 0 && f.member === 1) rows["pkg==0 member==1 (VIA_OWNER, unique)"]++
    else if (f.pkg === 0 && f.member >= 2) rows["pkg==0 member>=2 (AMBIGUOUS, one per owner)"]++
    if (f.pkgDirs > 1) rows["declared in >1 package directory"]++
    if (f.files > 1) rows["declared in >1 FILE"]++
  }
  const artifact = {
    tool: "validation/m14/go/go-incoming-resolve.ts",
    phase: "index-summary",
    sourceIndex: indexPath,
    noIdentifiers: "This artifact carries counts only. The index it summarises holds 141k Go declaration names, and script/m14/verify-honesty.ts lints every .json under validation/m14/ for contract section 1 vocabulary, which go-stdlib's own identifiers trip. --explain reproduces any individual row against the index without the index being committed.",
    corpusRoot: CORPUS_ROOT,
    populationFiles: raw.populationFiles,
    parsedFiles: raw.parsedFiles,
    crashedFiles: raw.crashedFiles,
    distinctNames: raw.distinctNames,
    nodeTypeCount: raw.nodeTypeCount,
    nodeTypes: raw.nodeTypes,
    interfaceMethodsIndexed: raw.methodSpecNodes,
    structElemNodes: raw.structElemNodes,
    embeddedFieldsIndexed: raw.embeddedFields,
    unreadReceivers: raw.unreadReceivers,
    unreadReceiverShapes: raw.unreadReceiverShapes,
    fieldsWithNoEnclosingType: raw.unnamedFields,
    packageScopeDeclarations: pkgTotal,
    memberDeclarations: memberTotal,
    maxPackageScopeDeclarationsOfOneName: maxPkg,
    decisionTableDistribution: rows,
  }
  L("")
  L("DECLARATION INDEX SUMMARY (counts only, no identifiers)")
  L(`  population ${artifact.populationFiles} files, ${artifact.parsedFiles} parsed, ${artifact.crashedFiles} crashed`)
  L(`  distinct declared names ${artifact.distinctNames}; package-scope declarations ${pkgTotal}; member declarations ${memberTotal}`)
  L(`  one name is declared at package scope ${maxPkg} times`)
  L(`  node types observed ${artifact.nodeTypeCount}; interface methods indexed ${artifact.interfaceMethodsIndexed}; embedded fields indexed ${artifact.embeddedFieldsIndexed}`)
  L("")
  for (const k of Object.keys(rows)) L(`  ${k.padEnd(46)}${String(rows[k]).padStart(9)}  ${pct(rows[k], artifact.distinctNames)}`)
  L("")
  const out = process.env.GO_INDEX_SUMMARY_ARTIFACT || ""
  if (out) writeFileSync(out, JSON.stringify(artifact, null, 2))
}

function phaseOutgoingOnly(): void {
  const L = (s: string) => process.stderr.write(s + "\n")
  const analyzerPath = `${REPO_ROOT}/src/ast/real-go-analyzer.ts`
  const analyzer = readFileSync(analyzerPath, "utf8")
  const specs = moduleSpecifiers(analyzer)
  const fsModules = specs.filter((m) => m === "fs" || m.indexOf("node:fs") === 0 || m.indexOf("fs") === 0 || m === "child_process" || m.indexOf("node:child_process") === 0 || m === "path" || m.indexOf("node:path") === 0)

  const typesSrc = readFileSync(`${REPO_ROOT}/src/ast/types.ts`, "utf8")
  const parseResultFields = interfaceFields(typesSrc, "ParseResult")
  const inboundNamed = parseResultFields.filter((f) => containsWord(f.toLowerCase(), "inbound") || containsWord(f.toLowerCase(), "incoming") || containsWord(f.toLowerCase(), "reverse") || containsWord(f.toLowerCase(), "referencedby"))

  const ddl = readFileSync(`${REPO_ROOT}/src/brain/schema-ddl.ts`, "utf8")
  const tblAt = ddl.indexOf("CREATE TABLE IF NOT EXISTS brain_relationship")
  let cols: string[] = []
  if (tblAt >= 0) {
    const open = ddl.indexOf("(", tblAt)
    let depth = 0
    let body = ""
    for (let i = open; i < ddl.length; i++) {
      const ch = ddl.charAt(i)
      if (ch === "(") {
        depth++
        if (depth === 1) continue
      }
      if (ch === ")") {
        depth--
        if (depth === 0) break
      }
      body += ch
    }
    // Split on commas at paren depth 0, so a column's own constraint list does
    // not cut a definition in half. Column names are lowercase; the TYPE word
    // that follows them is upper-case, so the type word is the discriminator and
    // the name is read from it rather than from a case test on the name.
    const SQL_TYPES: ReadonlySet<string> = new Set(["TEXT", "INTEGER", "REAL", "BLOB", "NUMERIC", "BOOLEAN", "VARCHAR"])
    const SQL_CONSTRAINTS: ReadonlySet<string> = new Set(["PRIMARY", "FOREIGN", "UNIQUE", "CHECK", "NOT", "DEFAULT", "REFERENCES", "CONSTRAINT"])
    let d2 = 0
    let part = ""
    const parts: string[] = []
    for (const ch of body) {
      if (ch === "(") d2++
      else if (ch === ")") d2--
      if (ch === "," && d2 === 0) {
        parts.push(part)
        part = ""
        continue
      }
      part += ch
    }
    parts.push(part)
    for (const raw of parts) {
      const t = raw.trim()
      if (t.length === 0) continue
      const toks = t.split(" ")
      if (toks.length < 2) continue
      const first = toks[0].toUpperCase()
      const second = toks[1].toUpperCase()
      if (SQL_TYPES.has(second)) cols.push(toks[0].toLowerCase())
      else if (SQL_CONSTRAINTS.has(first)) continue
      else if (toks[0].indexOf("_") > 0 && first.length > 0) cols.push(toks[0].toLowerCase())
    }
  }

  const artifact = {
    tool: "validation/m14/go/go-incoming-resolve.ts",
    phase: "outgoing-only",
    repoRoot: REPO_ROOT,
    analyzerFile: "src/ast/real-go-analyzer.ts",
    analyzerModuleSpecifiers: specs,
    filesystemModuleSpecifiers: fsModules,
    parseResultFields,
    parseResultInboundNamedFields: inboundNamed,
    brainRelationshipColumns: cols,
    conclusion: fsModules.length === 0 && inboundNamed.length === 0
      ? "The analyzer imports no filesystem module and ParseResult declares no inbound channel: an emitted edge can only name something in the file handed to analyze()."
      : "MEASURED CONTRADICTION — see the fields listed above; do not read this file's conclusion as a claim.",
  }
  L("")
  L("=".repeat(100))
  L("ARE THE EDGES OUTGOING ONLY? — four measurements")
  L("=".repeat(100))
  L(`1. module specifiers imported by ${artifact.analyzerFile}:`)
  L(`   ${specs.length} total: ${specs.join(", ")}`)
  L(`   filesystem / child_process / path modules among them: ${fsModules.length} ${fsModules.join(", ")}`)
  L("")
  L(`2. fields declared on ParseResult (src/ast/types.ts): ${parseResultFields.length}`)
  L(`   ${parseResultFields.join(", ")}`)
  L(`   fields whose NAME declares an inbound/reverse channel: ${inboundNamed.length}`)
  L("")
  L(`3. columns of the brain_relationship table (src/brain/schema-ddl.ts): ${cols.length}`)
  L(`   ${cols.join(", ")}`)
  L(`   directional columns: source_symbol_id, target_symbol_id, source_external, target_external — a row is ONE fact read in two directions; there is no inbound-edge table.`)
  L("")
  L(`4. the reverse query is a filter on the SAME rows:`)
  L(`   src/lsp/impact.ts:530-535   "JOIN brain_symbol s ON s.id = r.source_symbol_id … AND r.target_symbol_id IN (SELECT m.id …)"`)
  L(`   src/intelligence/graph/graph-engine.ts:684  "JOIN (" + cascade + ") casc ON casc.id = r.target_symbol_id"`)
  L(`   -> "who points at me" is a WHERE clause over the outgoing rows, not a second emission.`)
  L("")
  L(`CONCLUSION (measured): ${artifact.conclusion}`)
  L("")
  const out = process.env.GO_OUTGOING_ARTIFACT || ""
  if (out) writeFileSync(out, JSON.stringify(artifact, null, 2))
}

// ---------------------------------------------------------------------------
// --probe-no-regex. The self-check, over THIS file's own committed text, by
// tokenising with the TypeScript grammar rather than by reading.
// ---------------------------------------------------------------------------

async function phaseProbeNoRegex(targetPath?: string): Promise<void> {
  const L = (s: string) => process.stderr.write(s + "\n")
  const self = targetPath && targetPath.length > 0 ? targetPath : `${REPO_ROOT}/validation/m14/go/go-incoming-resolve.ts`
  const rel = self.indexOf(REPO_ROOT) === 0 ? self.slice(REPO_ROOT.length + 1) : self
  const src = readFileSync(self, "utf8")
  const parser = await ASTEngine.getParser("typescript")
  const tree = parser.parse(src, self)
  const hits: string[] = []
  // Two node SHAPES, not two string searches. An earlier draft of this probe
  // sniffed string nodes for the text "new RegExp" and convicted ITSELF three
  // times — the detector matched the detector's own literal — which is the same
  // false-positive shape the regex-census programme already recorded twice
  // ("0 regex literals across 0 of 16 files", "43,042 calls", "1,250 of 2,735
  // files"). A probe that convicts its own source is worse than no probe, so the
  // check is now a node type and a constructor field.
  const stack: any[] = [tree.rootNode]
  while (stack.length > 0) {
    const n = stack.pop()
    if (!n) continue
    if (n.type === "regex") hits.push(`regex literal: ${String(n.text ?? "").slice(0, 60)}`)
    if (n.type === "new_expression") {
      const ctor = n.childForFieldName("constructor")
      if (ctor && ctor.type === "identifier" && ctor.text === "RegExp") hits.push("new RegExp(...)")
    }
    // `something.match(...)` / `.test(...)` / `.matchAll(...)` / `.search(...)`
    // where the callee object is NOT a string literal: the shapes that can carry
    // a pattern in from elsewhere. A call ON a string literal is `String.replace`
    // with a literal, which is not a pattern.
    if (n.type === "call_expression") {
      const fn = n.childForFieldName("function")
      if (fn && fn.type === "member_expression") {
        const prop = fn.childForFieldName("property")
        const obj = fn.childForFieldName("object")
        const name = prop ? String(prop.text ?? "") : ""
        const objType = obj ? obj.type : ""
        const risky = name === "match" || name === "matchAll" || name === "test" || name === "search" || name === "replaceAll"
        if (risky && objType !== "string" && objType !== "template_string") {
          hits.push(`${objType}.${name}(...)`)
        }
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) stack.push(c)
    }
  }
  const artifact = {
    tool: "validation/m14/go/go-incoming-resolve.ts",
    phase: "probe-no-regex",
    file: rel,
    lines: src.split("\n").length,
    populationFiles: 1,
    regexNodes: hits.length,
    hits,
    method: "tokenised with the tree-sitter-typescript grammar. Three node shapes: node.type === 'regex'; a new_expression whose constructor field is the identifier RegExp; and a call_expression whose callee property is match/matchAll/test/search/replaceAll on a non-literal receiver. The first draft sniffed string nodes for the text 'new RegExp' and convicted this file three times; that self-match is recorded here because a probe that convicts its own source is the failure this programme has already paid for twice.",
  }
  L("")
  L(`NO-REGEX SELF-PROBE over ${rel}`)
  L(`  population 1 of 1 lane file`)
  L(`  lines ${artifact.lines}   findings ${artifact.regexNodes}   ${hits.length ? "HITS: " + hits.join(" | ") : "(none)"}`)
  const out = process.env.GO_NOREGEX_ARTIFACT || ""
  if (out) writeFileSync(out, JSON.stringify(artifact, null, 2))
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const o = parseArgs(process.argv.slice(2))
  if (o.mode === "explain") {
    // Explain a list of endpoint strings against a real index. The census reports
    // percentages, and a percentage a reader cannot drill into is the shape this
    // lane's brief warns about ("0 imports" / "0 regexes across 0 of 16 files"):
    // the number is only as useful as the population behind it. This prints, per
    // string, the INDEX FACTS the decision was made from -- so a class can be
    // checked rather than believed.
    const L = (x: string) => process.stderr.write(x + "\n")
    // Skip flags and their values: an endpoint never begins with "-", and the
    // first draft of this mode printed `--index-file` and the index PATH as two
    // endpoints, which is a self-inflicted wrong row in a diagnostic whose whole
    // job is to be checkable.
    const argvAll = process.argv.slice(3)
    const targets: string[] = []
    for (let i = 0; i < argvAll.length; i++) {
      const a = argvAll[i]
      if (a === "--index-file") { i++; continue }
      if (a.indexOf("-") === 0 && a.length > 1 && a.charCodeAt(0) === 45 && a.charCodeAt(1) === 45) continue
      targets.push(a)
    }
    const idx = loadIndex(o.indexPath.length > 0 ? o.indexPath : process.env.GO_INDEX || "")
    L("")
    L(`EXPLAIN against ${o.indexPath.length > 0 ? o.indexPath : process.env.GO_INDEX} (${idx.names.size} distinct declared names)`)
    L("")
    L("  endpoint".padEnd(34) + "class".padEnd(14) + "cand  owner   pkg/member/pkgDirs  owners")
    for (const t of targets) {
      const v = classifyEndpoint(t, idx)
      const dot = t.lastIndexOf(".")
      const head = dot > 0 && dot < t.length - 1 ? t.slice(0, dot) : ""
      const tail = dot > 0 && dot < t.length - 1 ? t.slice(dot + 1) : ""
      const f = idx.names.get(tail.length > 0 ? tail : t)
      const hf = head.length > 0 ? idx.names.get(head) : undefined
      const facts = f ? `pkg=${f.pkg} member=${f.member} pkgDirs=${f.pkgDirs}` : "NOT IN INDEX"
      L(
        `  ${(t || "(empty)").padEnd(34)}${v.klass.padEnd(14)}${String(v.candidates).padEnd(6)}${(v.ownerResolved ? "yes" : "no").padEnd(8)}${facts.padEnd(22)}` +
        `${f ? f.owners.join(",") : "-"}${hf ? `   head ${head}: pkg=${hf.pkg} member=${hf.member}` : ""}`,
      )
    }
    L("")
    return
  }
  if (o.mode === "self-test-classifier") {
    const L = (x: string) => process.stderr.write(x + "\n")
    const r = selfTestClassifier()
    L("")
    L("=".repeat(96))
    L("CLASSIFIER SELF-TEST — every row of the decision table, from a synthetic index")
    L("=".repeat(96))
    L("  endpoint                     facts                        expected        got          ok")
    for (const row of r.rows) {
      L(`  ${(row.endpoint || "(empty)").padEnd(28)}${row.facts.padEnd(30)}${row.expected.padEnd(16)}${row.got.padEnd(13)}${row.ok ? "ok" : "MISMATCH"}`)
    }
    L("")
    L(`  ${r.rows.length} rows, ${r.rows.filter((x) => x.ok).length} ok, ${r.rows.filter((x) => !x.ok).length} wrong`)
    const out = process.env.GO_SELFTEST_ARTIFACT || ""
    if (out) writeFileSync(out, JSON.stringify({ tool: "validation/m14/go/go-incoming-resolve.ts", phase: "self-test-classifier", ok: r.ok, rows: r.rows }, null, 2))
    process.exit(r.ok ? 0 : 1)
  }
  if (o.mode === "probe-no-regex") {
    // An optional path argument turns this into its own NEGATIVE CONTROL: point
    // it at a file that does contain a pattern and the probe must find it. A
    // check that cannot fail is the shape this programme has been bitten by
    // twice, so the control is run and its result is quoted alongside the
    // clean one rather than assumed.
    return await phaseProbeNoRegex(process.argv[3] && process.argv[3].length > 0 ? process.argv[3] : undefined)
  }
  if (o.mode === "index-summary") return phaseIndexSummary(o.indexPath.length > 0 ? o.indexPath : process.env.GO_INDEX || "")
  if (o.mode === "outgoing-only") return phaseOutgoingOnly()
  if (o.mode === "merge-index") {
    const out = o.out || process.env.GO_ARTIFACT || "/tmp/go-incoming-index.json"
    return mergeIndex(o.merge, out)
  }
  if (o.mode === "merge") {
    const out = o.out || process.env.GO_ARTIFACT || "/tmp/go-incoming-resolve.json"
    return mergeResolve(o.merge, out)
  }

  const all = collectAllGoFiles(CORPUS_ROOT)
  const { lib, test } = splitTestAndNonTest(all)
  const libWant = Math.max(1, Math.round(o.sample * 0.75))
  const sample = [...strideSample(lib, libWant), ...strideSample(test, o.sample - libWant)]

  if (o.mode === "index") {
    const out = o.out || process.env.GO_ARTIFACT || "/tmp/go-incoming-index.json"
    const a = await phaseIndex(all, o.shard)
    writeFileSync(out, JSON.stringify(a))
    process.stderr.write(
      `index shard ${a.shard}: ${a.parsedFiles}/${a.populationFiles} files parsed, ${a.crashedFiles} crashed, ` +
      `${a.distinctNames} distinct declared names, ${a.nodeTypeCount} node types observed\n` +
      `  interface methods indexed (method_spec) ${a.methodSpecNodes}; struct_elem nodes ${a.structElemNodes}\n` +
      `  embedded fields indexed by their unqualified type name ${a.embeddedFields}\n` +
      `  unread receivers ${a.unreadReceivers} ${JSON.stringify(a.unreadReceiverShapes)}; fields with no enclosing type ${a.unnamedFields}\n` +
      `  artifact ${out}\n`,
    )
    return
  }

  // resolve
  if (o.indexPath.length === 0) {
    process.stderr.write("resolve needs --index-file <merged index json>\n")
    process.exit(2)
  }
  const out = o.out || process.env.GO_ARTIFACT || "/tmp/go-incoming-resolve-shard.json"
  const a = await phaseResolve(sample, o.shard, o.indexPath)
  writeFileSync(out, JSON.stringify(a, null, 2))
  process.stderr.write(
    `resolve shard ${a.shard}: ${a.parsedFiles}/${a.populationFiles} files parsed, ${a.crashedFiles} crashed, ` +
    `${a.totalRelationships} relationships, fired ${a.fired.length}/${a.enumValues.length}` +
    (a.silent.length ? ` SILENT ${a.silent.join(" ")}` : "") + `\n  artifact ${out}\n`,
  )
  reportResolve(a)
}

await main()

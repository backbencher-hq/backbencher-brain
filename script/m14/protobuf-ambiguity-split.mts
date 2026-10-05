/**
 * PROTOBUF LANE — THE AMBIGUITY SPLIT, and whether any of it is the analyzer's.
 *
 * ## Why this file exists
 *
 * The round brief asks each lane to split its ambiguous-target count into three classes
 * that have different fixes, and to say plainly which of them the lane controls:
 *
 *   A  N declarations share a name in DIFFERENT SCOPES — a real scoping failure, and
 *      the analyzer's to repair.
 *   B  a name is declared in more than one file/module and the analyzer does not model
 *      which one is in scope — also the analyzer's, in principle.
 *   C  two DIFFERENT symbols legitimately share a published name, so the published name
 *      is not a unique identifier — a fact about the published-name contract, and not
 *      repairable inside one analyzer.
 *
 * The shared instrument `script/m14/incoming-check.ts` cannot answer this, and the way it
 * cannot is worth recording because it is silent. It builds `published` as
 * `name -> kinds[]` and only appends a kind `if (!arr.includes(kind))`, so a target is
 * counted ambiguous only when one NAME is published under two or more different KINDS.
 * Two messages that share a fully-qualified name across two files are both of kind
 * `class`, so `arr.length === 1` and the edge is scored resolved-and-unique. On this
 * lane that suppresses the entire population the brief is asking about.
 *
 * So this file measures ambiguity at the id the edge actually carries — `qualifiedName` —
 * and counts a target ambiguous when MORE THAN ONE FILE publishes that id, which is the
 * condition under which `src/lsp/impact.ts`'s target-matching picks a winner nobody chose.
 * Both definitions are reported side by side so the difference is visible rather than
 * asserted.
 *
 * ## The discriminator between B/C is the DECLARATION's bytes, not the file's
 *
 * `range.startIndex` is the first non-comment child's start, so
 * `content.slice(startIndex, endIndex)` is the declaration without its license header or
 * its doc comment. That is the whole difference between the four `helloworld.proto`
 * copies in the corpus: classifying by whole-file bytes calls 947 of them collisions when
 * they are one declaration under four license headers, and the number this file reports
 * for class C would be wrong by that much.
 *
 * ## Unresolved is partitioned, because four different findings all read as 0
 *
 *   U1 target is a module path naming a corpus file   — the sample window, not a defect
 *   U2 target is a module path naming no corpus file   — an external dependency by design
 *   U3 target is a bare name that EXISTS under a different id — a binding defect, and OURS
 *   U4 target names nothing anywhere                      — a `.proto` outside this corpus
 *
 * Only U3 is a defect this lane can repair, and it is counted separately for that reason.
 *
 * ## No regex
 *
 * The corpus walk is `readdirSync`/`statSync`; the language filter is `endsWith(".proto")`;
 * path-suffix keys are built with `slice(i + 1)` at each `/` boundary; the "is it a path"
 * test is `includes("/")`, a character search rather than a pattern. No pattern literal
 * appears in this file and none is needed to express any of the above.
 *
 * ## Usage
 *
 *   npx tsx script/m14/protobuf-ambiguity-split.mts [--out /tmp/pb-ambiguity.json] [--json]
 */
import { lstatSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const argv = process.argv.slice(2)
const OUT = argv.includes("--out") ? argv[argv.indexOf("--out") + 1] : "/tmp/opencode/pb/ambiguity-split.json"
const JSON_ONLY = argv.includes("--json")

const ALL_TYPES = [
  "calls", "uses", "contains", "imports", "references",
  "exports", "extends", "implements", "overrides", "instantiates",
] as const
type Type = (typeof ALL_TYPES)[number]

/** Store label -> ontology name. `imports` is stored as `brain_import` in the store. */
const LABEL_ALIASES: Record<string, string> = {
  calls: "calls", call: "calls", uses: "uses",
  contains: "contains", composition: "contains", part_of: "contains",
  imports: "imports", brain_import: "imports",
  references: "references", depends_on: "references", related: "references",
  exports: "exports", provides: "exports",
  extends: "extends", inheritance: "extends",
  implements: "implements", implementation: "implements",
  overrides: "overrides", override: "overrides",
  instantiates: "instantiates",
}
const ontologyName = (raw: string): string | null => LABEL_ALIASES[raw] ?? null

/** Repo root -> repo name, so "same repository" is decidable. */
const repoOf = (f: string): string => {
  const rel = path.relative(CR, f)
  const i = rel.indexOf("/")
  return i === -1 ? rel : rel.slice(0, i)
}

function collectFiles(root: string): { files: string[]; symlinksSkipped: number } {
  const out: string[] = []
  const stack: string[] = [root]
  let symlinksSkipped = 0
  while (stack.length > 0) {
    const dir = stack.pop() as string
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      continue
    }
    for (const e of entries) {
      // Only `.git` is excluded, and the reason is that it is not source. An earlier
      // version of this walk also skipped `node_modules`, `vendor`, `dist` and `build`,
      // on the grounds that they are build output — and that quietly dropped 130 of the
      // corpus's 842 on-disk `.proto` files, because `nomad/vendor` and
      // `terraform/.terraform` carry real protobuf sources. A walk that does not know
      // which of its exclusions cost it a tenth of the population is a walk whose
      // denominator is a guess, so the exclusion list is one entry long.
      if (e === ".git") continue
      const full = path.join(dir, e)
      let st
      try {
        // lstat, not stat: `statSync` FOLLOWS a symlink, so a repository holding a
        // symlinked directory had every file under it walked twice. Measured, not
        // argued — the `stat` version of this walk reported 1,692 `.proto` files where
        // `find -name '*.proto' -type f` reports 842, and every corpus number in this
        // file was inflated by the duplicate. A walk that cannot state its denominator
        // has no number to publish.
        st = lstatSync(full)
      } catch {
        continue
      }
      if (st.isSymbolicLink()) {
        symlinksSkipped++
        continue
      }
      if (st.isDirectory()) stack.push(full)
      else if (st.isFile() && full.endsWith(".proto")) out.push(full)
    }
  }
  return { files: out.sort(), symlinksSkipped }
}

/**
 * Is a target a MODULE PATH rather than a declaration name?
 *
 * Two versions of this test were wrong in this lane's own history and both inflated
 * the repairable population, so both corrections are in the predicate rather than in a
 * note:
 *
 *   - `target.includes("/")` alone classifies `import "movie.proto"` as a bare name,
 *     because that path has no slash. 13 of the corpus's import paths are written that
 *     way, and every one of them landed in the "names nothing, therefore repairable"
 *     bucket. An `imports`/`exports` target IS a module path by construction, and a
 *     target ending in `.proto` is one whatever edge type carries it.
 *   - testing the WHOLE dotted target against the bare-name index can never fire: the
 *     index holds leaf names, so `common.EnterpriseMeta` is looked up as itself and is
 *     found only if some declaration is literally named that. The signature of a
 *     scope-resolution failure is that the LEAF exists under a DIFFERENT id, so the
 *     test is on the leaf.
 */
const isModulePath = (type: Type, target: string): boolean =>
  type === "imports" || type === "exports" || target.endsWith(".proto")

const leafOf = (target: string): string => {
  const i = target.lastIndexOf(".")
  return i <= 0 ? target : target.slice(i + 1)
}

type Decl = { file: string; kind: string; name: string; text: string; pkg: string }

/** id -> the distinct declarations published under it. */
const byId = new Map<string, Decl[]>()
/**
 * file -> that file's `package`, derived as the LONGEST id the file publishes that is a
 * dotted prefix of its own declarations' ids.
 *
 * `metadata.isProtoPackage` does not survive pool-worker's symbol projection, but
 * `kind` does, and the analyzer publishes the package as `SymbolKind.Namespace`. So
 * this reads the kind rather than re-deriving the name.
 *
 * The first version of this derivation took the LONGEST self-published dotted prefix,
 * which is wrong and was caught by its own output: it reported the package of
 * `consul/proto/private/pbconfigentry/config_entry.proto` as
 * `hashicorp.consul.internal.configentry.ServiceResolverPrioritizeByLocality`, a nested
 * MESSAGE, because that message's id is a longer prefix of its own nested declarations
 * than the package's is. A longest-prefix rule cannot tell a package from a message;
 * only the declaration KIND can, and it was there the whole time.
 */
const pkgByFile = new Map<string, string>()
/** file -> the ids that file published, used to derive its package. */
const fileIds = new Map<string, Set<string>>()
/** file -> ids that file published under `SymbolKind.Namespace`, which is the package. */
const nsIdsByFile = new Map<string, string[]>()
/** bare name -> the ids carrying it. A collision here is the SCOPE question (class A). */
const byBareName = new Map<string, Set<string>>()
/** every path-suffix of every corpus file, so `import "google/protobuf/any.proto"` is decidable. */
const corpusPathSuffixes = new Set<string>()
/** path-suffix -> the corpus files carrying it. A suffix naming 2+ files is ambiguous. */
const filesBySuffix = new Map<string, string[]>()
/** basename -> the corpus files carrying it, for the published-name-contract question. */
const filesByBasename = new Map<string, string[]>()

type Rel = { type: Type; src: string; tgt: string; file: string }
const rels: Rel[] = []

let files = 0
let degraded = 0
let failures = 0
let symbols = 0
let emptyNames = 0
let unknownEndpoints = 0

async function main(): Promise<void> {
  const { files: list, symlinksSkipped } = collectFiles(CR)
  const note = (m: Map<string, string[]>, k: string, f: string): void => {
    const a = m.get(k)
    if (a) a.push(f)
    else m.set(k, [f])
  }
  for (const f of list) {
    for (let i = f.indexOf("/"); i !== -1; i = f.indexOf("/", i + 1)) {
      corpusPathSuffixes.add(f.slice(i + 1))
      note(filesBySuffix, f.slice(i + 1), f)
    }
    corpusPathSuffixes.add(f)
    note(filesBySuffix, f, f)
    const b = f.slice(f.lastIndexOf("/") + 1)
    note(filesByBasename, b, f)
  }

  for (const f of list) {
    let r: any
    try {
      r = await parseFile(f, CR)
    } catch {
      failures++
      continue
    }
    if (!r) {
      failures++
      continue
    }
    if (r.fallback === true) degraded++
    files++
    fileIds.set(f, new Set<string>())
    nsIdsByFile.set(f, [])
    let content = ""
    try {
      content = readFileSync(f, "utf8")
    } catch {
      content = ""
    }
    for (const s of Array.isArray(r.symbols) ? r.symbols : []) {
      const name = String(s?.name ?? "")
      if (name.length === 0) {
        emptyNames++
        continue
      }
      symbols++
      const id = String(s?.qualifiedName ?? "") || name
      const start = typeof s?.startIndex === "number" ? s.startIndex : 0
      const end = typeof s?.endIndex === "number" ? s.endIndex : 0
      const text = content.slice(start, end)
      const arr = byId.get(id)
      if (arr) arr.push({ file: f, kind: String(s?.kind ?? ""), name, text, pkg: "" })
      else byId.set(id, [{ file: f, kind: String(s?.kind ?? ""), name, text, pkg: "" }])
      fileIds.get(f)!.add(id)
      if (String(s?.kind ?? "") === "namespace") nsIdsByFile.get(f)!.push(id)
      let ids = byBareName.get(name)
      if (!ids) {
        ids = new Set<string>()
        byBareName.set(name, ids)
      }
      ids.add(id)
    }
    for (const rel of Array.isArray(r.relationships) ? r.relationships : []) {
      const label = ontologyName(String(rel?.type ?? rel?.relationshipType ?? ""))
      if (!label) continue
      const src = String(rel?.source ?? rel?.from ?? rel?.fromSymbol ?? "")
      const tgt = String(rel?.target ?? rel?.to ?? rel?.toSymbol ?? "")
      if (src === "unknown" || tgt === "unknown") unknownEndpoints++
      rels.push({ type: label as Type, src, tgt, file: f })
    }
  }

  // The package of each file, from its own published ids, then stamped onto every
  // declaration that file published so a target's declaring package is available.
  for (const [f, ids] of fileIds) {
    const ns = nsIdsByFile.get(f) ?? []
    if (ns.length === 1) {
      pkgByFile.set(f, ns[0])
      continue
    }
    if (ns.length > 1) {
      // A file may declare a nested `package` only by declaring an outer one too, so
      // several Namespace ids in one file are the outer and inner packages. The
      // OUTERMOST is the shortest; the innermost is the one protoc resolves relative
      // names against.
      const sorted = [...ns].sort((a, b) => b.length - a.length)
      pkgByFile.set(f, sorted[0])
      continue
    }
    // No Namespace symbol: the file declares no package, and the package-relative
    // assumption in the analyzer means the root. Recorded rather than guessed.
    let best = ""
    for (const id of ids) {
      if (!id.includes(".")) continue
      let isPrefixOfSomeDecl = false
      for (const other of ids) {
        if (other !== id && other.length > id.length && other.startsWith(`${id}.`)) {
          isPrefixOfSomeDecl = true
          break
        }
      }
      if (isPrefixOfSomeDecl && id.length > best.length) best = id
    }
    pkgByFile.set(f, best)
  }
  for (const decls of byId.values()) for (const d of decls) d.pkg = pkgByFile.get(d.file) ?? ""

  // ---- the ambiguity classification, once per id ----
  type AmbClass = "unique" | "C_sameText" | "B_sameRepo_diffText" | "B_otherRepo_diffText"
  const ambClass = new Map<string, AmbClass>()
  for (const [id, decls] of byId) {
    const files_ = new Set(decls.map((d) => d.file))
    if (files_.size <= 1) {
      ambClass.set(id, "unique")
      continue
    }
    const texts = new Set(decls.map((d) => d.text))
    if (texts.size === 1) {
      ambClass.set(id, "C_sameText")
      continue
    }
    const repos = new Set(decls.map((d) => repoOf(d.file)))
    ambClass.set(id, repos.size === 1 ? "B_sameRepo_diffText" : "B_otherRepo_diffText")
  }

  const declaredIds = [...byId.keys()]
  const multiFileIds = declaredIds.filter((id) => ambClass.get(id) !== "unique")
  const classes: Record<AmbClass, number> = {
    unique: 0, C_sameText: 0, B_sameRepo_diffText: 0, B_otherRepo_diffText: 0,
  }
  for (const id of declaredIds) classes[ambClass.get(id) as AmbClass]++

  /** Class A on its own: one bare NAME carrying more than one fully-qualified id. */
  const bareNameCollisions: { name: string; ids: string[] }[] = []
  for (const [name, ids] of byBareName) if (ids.size > 1) bareNameCollisions.push({ name, ids: [...ids] })
  bareNameCollisions.sort((a, b) => b.ids.length - a.ids.length)

  type UnresClass = "resolved" | "U1_modulePath_namesCorpusFile" | "U2_modulePath_noCorpusFile" | "U3_bareNameExistsUnderOtherId" | "U4_namesNothing"
  type TypeRow = {
    fired: boolean
    edges: number
    selfLoops: number
    distinctTargets: number
    resolvedEdges: number
    resolvedBothEnds: number
    /** incoming-check's definition: one NAME published under >1 KIND. */
    ambCrossKindEdges: number
    /** this lane's definition: the id is published by >1 FILE. */
    ambMultiFileEdges: number
    ambEdges: Record<AmbClass, number>
    unresEdges: Record<UnresClass, number>
  }
  const perType = {} as Record<Type, TypeRow>
  for (const t of ALL_TYPES) {
    perType[t] = {
      fired: false, edges: 0, selfLoops: 0, distinctTargets: 0, resolvedEdges: 0, resolvedBothEnds: 0,
      ambCrossKindEdges: 0, ambMultiFileEdges: 0,
      ambEdges: { unique: 0, C_sameText: 0, B_sameRepo_diffText: 0, B_otherRepo_diffText: 0 },
      unresEdges: { resolved: 0, U1_modulePath_namesCorpusFile: 0, U2_modulePath_noCorpusFile: 0, U3_bareNameExistsUnderOtherId: 0, U4_namesNothing: 0 },
    }
  }
  // incoming-check's `published` map, rebuilt so the two definitions can be reported together.
  const nameKinds = new Map<string, Set<string>>()
  for (const [id, decls] of byId) {
    for (const d of decls) {
      let ks = nameKinds.get(d.name)
      if (!ks) {
        ks = new Set<string>()
        nameKinds.set(d.name, ks)
      }
      ks.add(d.kind)
    }
  }

  const unresolvedTargetsByType: Record<string, Record<string, number>> = {}
  for (const t of ALL_TYPES) unresolvedTargetsByType[t] = {}
  /** target -> the files that emitted an edge naming it, per unresolved class. */
  const unresDetail = new Map<string, { type: Type; cls: UnresClass; target: string; edges: number; files: Set<string> }>()

  for (const r of rels) {
    const row = perType[r.type]
    row.edges++
    if (r.src === r.tgt) {
      row.selfLoops++
      continue
    }
    const decls = byId.get(r.tgt)
    const srcOk = byId.has(r.src)
    if (!decls) {
      const leaf = leafOf(r.tgt)
      const leafIds = byBareName.get(leaf)
      const leafUnderOtherId = !!leafIds && !leafIds.has(r.tgt)
      const cls: UnresClass = isModulePath(r.type, r.tgt)
        ? (corpusPathSuffixes.has(r.tgt) ? "U1_modulePath_namesCorpusFile" : "U2_modulePath_noCorpusFile")
        : (leafUnderOtherId ? "U3_bareNameExistsUnderOtherId" : "U4_namesNothing")
      row.unresEdges[cls]++
      const b = unresolvedTargetsByType[r.type]
      b[cls] = (b[cls] ?? 0) + 1
      const key = `${r.type}\u0000${cls}\u0000${r.tgt}`
      const d = unresDetail.get(key)
      if (d) {
        d.edges++
        d.files.add(r.file)
      } else {
        unresDetail.set(key, { type: r.type, cls, target: r.tgt, edges: 1, files: new Set([r.file]) })
      }
      continue
    }
    row.resolvedEdges++
    if (srcOk) row.resolvedBothEnds++
    const kinds = nameKinds.get(decls[0].name)
    if (kinds && kinds.size > 1) row.ambCrossKindEdges++
    const cls = ambClass.get(r.tgt) as AmbClass
    if (cls !== "unique") row.ambMultiFileEdges++
    row.ambEdges[cls]++
  }
  for (const t of ALL_TYPES) {
    perType[t].distinctTargets = new Set(rels.filter((r) => r.type === t).map((r) => r.tgt)).size
    perType[t].fired = perType[t].edges > 0
  }

  // ---- the three classes ----
  //
  // Class A is measured as U3, not as the count of bare names that collide. Every
  // protobuf field named `id` collides, and that is CORRECT: `a.Msg.id` and `b.Msg.id`
  // are two declarations in two scopes, the analyzer publishes both under their own
  // qualified id, and an edge naming either binds to exactly one. A bare-name collision
  // only becomes a defect when the ANALYZER emits the bare name on an edge instead of a
  // qualified id — which is exactly what U3 counts, because a bare name is by
  // construction not in `byId` and may or may not be in `byBareName`.
  const classA = perType.uses.unresEdges.U3_bareNameExistsUnderOtherId +
    perType.contains.unresEdges.U3_bareNameExistsUnderOtherId +
    perType.imports.unresEdges.U3_bareNameExistsUnderOtherId +
    perType.exports.unresEdges.U3_bareNameExistsUnderOtherId +
    perType.overrides.unresEdges.U3_bareNameExistsUnderOtherId
  const classB = classes.B_sameRepo_diffText + classes.B_otherRepo_diffText
  const classC = classes.C_sameText

  /**
   * Is a published id a NAMESPACE rather than a declaration?
   *
   * Protobuf packages and declarations share one namespace: `google.protobuf.Any` is a
   * message and `google.protobuf` is a package, and a `.proto` file may declare both.
   * The test is therefore prefix closure over the published id set — an id `P` is a
   * namespace when some OTHER published id begins with `P` followed by `.` — which is
   * decidable without `metadata.isProtoPackage`, and `metadata` does not survive
   * pool-worker's symbol projection, so this is the only channel available through the
   * production path.
   *
   * It is an over-approximation in one direction: a message `a.b` in a file that also
   * declares a package `a` is reported as a namespace. The count is declared as
   * "ids that are a prefix of another published id", not as "packages", because the
   * second claim is not what this measures.
   */
  const idList = [...byId.keys()]
  const isNamespaceId = (id: string): boolean => {
    const withDot = `${id}.`
    for (const other of idList) if (other.length > withDot.length && other.startsWith(withDot)) return true
    return false
  }
  const ambTargetsByType: Record<string, { edges: number; namespaceEdges: number; ids: number }> = {}
  for (const t of ALL_TYPES) ambTargetsByType[t] = { edges: 0, namespaceEdges: 0, ids: 0 }
  const ambIdSeen = new Map<string, Set<string>>()
  for (const r of rels) {
    const cls = ambClass.get(r.tgt)
    if (cls === undefined || cls === "unique") continue
    const a = ambTargetsByType[r.type]
    a.edges++
    let seen = ambIdSeen.get(r.type)
    if (!seen) {
      seen = new Set<string>()
      ambIdSeen.set(r.type, seen)
    }
    if (!seen.has(r.tgt)) {
      seen.add(r.tgt)
      if (isNamespaceId(r.tgt)) a.namespaceEdges++
    }
    if (r.type === "uses" || r.type === "contains") a.ids++
  }
  for (const t of ALL_TYPES) {
    const seen = new Set(rels.filter((r) => r.type === t && ambClass.get(r.tgt) !== "unique").map((r) => r.tgt))
    ambTargetsByType[t].ids = seen.size
  }

  /**
   * Why each U3 target is unresolved — the one question that decides whether the repair
   * is inside this lane.
   *
   * protobuf resolves a relative type name by C++ scope lookup: try the innermost
   * enclosing scope, then each enclosing scope outward, and stop at the first that holds
   * a declaration. So when a file in `package hashicorp.consul.internal.configentry`
   * writes `common.EnterpriseMeta` and the declaration lives in
   * `package hashicorp.consul.internal.common`, protoc resolves it by walking up ONE
   * segment. A per-file analyzer cannot: it has never parsed the file that declares
   * `package hashicorp.consul.internal.common`, so it cannot know that
   * `private/pbcommon/common.proto` holds that package. The name it emits is the name
   * as written, which is legal protobuf and unresolvable here — and the fix is a
   * companion index `import path -> declaring package`, which the shared pipeline would
   * have to supply.
   *
   * So each U3 target is split by WHERE the declaration actually is:
   *
   *   ancestorPackage  some id with this leaf sits in a STRICT ANCESTOR package of the
   *                   referencing file's own package. protoc's scope walk lands here, so
   *                   the edge is correct-in-intent and the binding needs cross-file
   *                   information the analyzer is not given.
   *   descendant/unrelated  the declaration is somewhere else entirely. That is a
   *                   different finding and is counted separately rather than folded in.
   */
  type ScopeClass = "ownSubpackage" | "walkedUpScopes" | "rootOnly" | "noScopeInChain" | "noPackageOnFile"
  const scopeDetail = new Map<string, {
    type: Type; target: string; leaf: string; edges: number
    refPkg: string; cls: ScopeClass; scopeLevel: number; protocWouldResolveTo: string | null; candidates: string[]
  }>()
  for (const d of unresDetail.values()) {
    if (d.cls !== "U3_bareNameExistsUnderOtherId") continue
    const file = [...d.files][0]
    const refPkg = pkgByFile.get(file) ?? ""
    const leaf = leafOf(d.target)
    const leafIds = [...(byBareName.get(leaf) ?? [])]
    if (refPkg.length === 0) {
      scopeDetail.set(`${d.type}\u0000${d.target}`, {
        type: d.type, target: d.target, leaf, edges: d.edges, refPkg, cls: "noPackageOnFile",
        scopeLevel: -1, protocWouldResolveTo: null, candidates: leafIds,
      })
      continue
    }
    // protoc's C++ scope lookup: try `T` at the innermost enclosing scope, then each
    // enclosing scope outward, stop at the first published id. The scope chain is the
    // package's own dotted prefixes, innermost first, then the root.
    const segs = refPkg.split(".")
    const chain: string[] = []
    for (let i = segs.length; i > 0; i--) chain.push(segs.slice(0, i).join("."))
    chain.push("")
    let hit: string | null = null
    let level = -1
    for (let i = 0; i < chain.length; i++) {
      const cand = chain[i].length === 0 ? d.target : `${chain[i]}.${d.target}`
      if (byId.has(cand)) {
        hit = cand
        level = i
        break
      }
    }
    // Falsification of the walk above, using protoc's ACTUAL rule rather than a
    // shorthand for it: protoc resolves the FIRST SEGMENT of a written name against
    // each enclosing scope and then requires the remainder underneath it. Prepending a
    // scope to the whole written name is not the same algorithm, and the two can
    // disagree — so both are run and any row where they do is reported rather than
    // resolved in favour of the one that produced a hit.
    const firstDot = d.target.indexOf(".")
    let protocHit: string | null = null
    let protocLevel = -1
    if (firstDot > 0) {
      const head = d.target.slice(0, firstDot)
      const tail = d.target.slice(firstDot + 1)
      for (let i = 0; i < chain.length; i++) {
        const headPkg = chain[i].length === 0 ? head : `${chain[i]}.${head}`
        if (!byId.has(headPkg)) continue
        const full = `${headPkg}.${tail}`
        if (byId.has(full)) {
          protocHit = full
          protocLevel = i
          break
        }
      }
    } else if (byId.has(d.target)) {
      protocHit = d.target
      protocLevel = -2
    }
    if (protocHit !== hit) {
      walkDisagreements.push({ target: d.target, refPkg, prependWalk: hit, protocFirstSegment: protocHit })
    }
    const cls: ScopeClass =
      hit === null ? "noScopeInChain"
      : level === 0 ? "ownSubpackage"
      : chain[level].length === 0 ? "rootOnly"
      : "walkedUpScopes"
    scopeDetail.set(`${d.type}\u0000${d.target}`, {
      type: d.type, target: d.target, leaf, edges: d.edges, refPkg, cls,
      scopeLevel: level, protocWouldResolveTo: hit, candidates: leafIds,
    })
  }
  /** rows where the shorthand walk and protoc's own first-segment rule disagree. */
  const walkDisagreements: { target: string; refPkg: string; prependWalk: string | null; protocFirstSegment: string | null }[] = []
  const scopeList = [...scopeDetail.values()].sort((a, b) => b.edges - a.edges)
  const scopeTotals: Record<ScopeClass, { distinct: number; edges: number }> = {
    ownSubpackage: { distinct: 0, edges: 0 },
    walkedUpScopes: { distinct: 0, edges: 0 },
    rootOnly: { distinct: 0, edges: 0 },
    noScopeInChain: { distinct: 0, edges: 0 },
    noPackageOnFile: { distinct: 0, edges: 0 },
  }
  for (const s2 of scopeList) {
    scopeTotals[s2.cls].distinct++
    scopeTotals[s2.cls].edges += s2.edges
  }

  /**
   * MODULE-PATH AMBIGUITY — the population an id-keyed ambiguity measure cannot see.
   *
   * Every ambiguity number above is keyed on a PUBLISHED ID, so `imports` and `exports`
   * contribute nothing to it: their targets are file paths, no corpus file publishes a
   * symbol named `google/protobuf/any.proto`, and a row that misses the id set is
   * counted unresolved and skipped by every ambiguity test. The shared instrument scores
   * them unambiguous for the same reason. That is a real blind spot with a real size:
   * an `import` names a FILE, and the analyzer is given a path relative to an include
   * root it is never told, so `any.proto` names 41 different files in this corpus and
   * the edge cannot say which.
   */
  const modulePathAmb: Record<string, { edges: number; targets: number; targetsNamingOneFile: number; targetsNamingManyFiles: number; targetsNamingNoFile: number }> = {}
  const modulePathTargetFiles = new Map<string, string[]>()
  for (const r of rels) {
    if (r.type !== "imports" && r.type !== "exports") continue
    const m = (modulePathAmb[r.type] ??= { edges: 0, targets: 0, targetsNamingOneFile: 0, targetsNamingManyFiles: 0, targetsNamingNoFile: 0 })
    m.edges++
    if (modulePathTargetFiles.has(r.tgt)) continue
    modulePathTargetFiles.set(r.tgt, filesBySuffix.get(r.tgt) ?? [])
  }
  const basenameShared: string[] = []
  for (const [b, fs] of filesByBasename) if (fs.length > 1) basenameShared.push(b)
  basenameShared.sort((a, b) => (filesByBasename.get(b)!.length - filesByBasename.get(a)!.length))
  for (const r of rels) {
    if (r.type !== "imports" && r.type !== "exports") continue
    const m = modulePathAmb[r.type]
    const fs = modulePathTargetFiles.get(r.tgt)!
    if (fs.length === 1) m.targetsNamingOneFile++
    else if (fs.length === 0) m.targetsNamingNoFile++
    else m.targetsNamingManyFiles++
    m.targets++
  }
  for (const t of ALL_TYPES) if (!modulePathAmb[t]) modulePathAmb[t] = { edges: 0, targets: 0, targetsNamingOneFile: 0, targetsNamingManyFiles: 0, targetsNamingNoFile: 0 }
  const modulePathsDistinct = new Set(rels.filter((r) => r.type === "imports" || r.type === "exports").map((r) => r.tgt))

  const unresList = [...unresDetail.values()]
    .map((d) => ({ type: d.type, class: d.cls, target: d.target, edges: d.edges, fileCount: d.files.size, files: [...d.files].slice(0, 4) }))
    .sort((a, b) => (a.class === b.class ? b.edges - a.edges : a.class < b.class ? -1 : 1))

  const report = {
    corpusRoot: CR,
    population: {
      filesOnDisk: list.length, filesParsed: files, parseFailures: failures, degradedParses: degraded,
      symlinksSkipped,
      symbols, emptyNames, unknownEndpoints, relationships: rels.length,
    },
    ambiguity: {
      definitionUsed: "an edge target resolving to an id published by MORE THAN ONE FILE",
      sharedInstrumentDefinition: "an edge target whose BARE NAME is published under more than one KIND",
      distinctIds: declaredIds.length,
      idsPublishedByMoreThanOneFile: multiFileIds.length,
      classA_edgesNamingABareNameInsteadOfAnId: classA,
      classB_divergentDeclarationsOneId: classB,
      classB_withinOneRepository: classes.B_sameRepo_diffText,
      classB_acrossRepositories: classes.B_otherRepo_diffText,
      classC_sameDeclarationManyFiles: classC,
      classCounts: classes,
      bareNamesSpanningSeveralQualifiedIds: classA === 0 ? bareNameCollisions.length : bareNameCollisions.length,
      widestBareNameCollisions: bareNameCollisions.slice(0, 12),
    },
    perType,
    ambiguousByType: ambTargetsByType,
    modulePathAmbiguity: {
      note: "keyed on a file path, not a published id, so no id-keyed ambiguity measure can see it",
      perType: modulePathAmb,
      distinctModulePathTargets: modulePathsDistinct.size,
      basenamesSharedByMoreThanOneFile: basenameShared.length,
      widestSharedBasenames: basenameShared.slice(0, 15).map((b) => ({ basename: b, files: filesByBasename.get(b)!.length })),
      pathsNamingMoreThanOneFile: [...modulePathTargetFiles.values()].filter((v) => v.length > 1).length,
    },
    unresolvedScopeDetail: { totals: scopeTotals, rows: scopeList, walkDisagreements },
    unresolvedDetail: unresList,
    unresolvedTargetsByType,
  }

  writeFileSync(OUT, JSON.stringify(report, null, 2))
  if (JSON_ONLY) {
    console.log(JSON.stringify(report, null, 2))
    return
  }

  const pad = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)
  console.log(`protobuf ambiguity split — ${files} of ${list.length} on-disk .proto files parsed`)
  console.log(`symlinks skipped ${symlinksSkipped}  degraded ${degraded}  failures ${failures}  symbols ${symbols}  rels ${rels.length}  emptyNames ${emptyNames}  unknownEndpoints ${unknownEndpoints}`)
  console.log("")
  console.log("CLASSIFICATION OF DISTINCT PUBLISHED IDS (the reverse walk's competition)")
  console.log(`  distinct ids published                    ${declaredIds.length}`)
  console.log(`  ids published by >1 file                  ${multiFileIds.length}`)
  console.log(`  A  edges naming a bare name, not an id     ${classA}   (the analyzer's to fix)`)
  console.log(`  B  >1 declaration text under one id       ${classB}  (${classes.B_sameRepo_diffText} within one repo, ${classes.B_otherRepo_diffText} across repos)`)
  console.log(`  C  ONE declaration text, many files        ${classC}   (published-name contract)`)
  console.log("")
  console.log("PER TYPE")
  console.log(pad("type", 13) + pad("edges", 8) + pad("both", 8) + pad("res%both", 10) + pad("ambKC", 7) + pad("ambMF", 7) + "unresolved")
  console.log("-".repeat(96))
  for (const t of ALL_TYPES) {
    const r = perType[t]
    const u = r.unresEdges
    const unres =
      u.U1_modulePath_namesCorpusFile + u.U2_modulePath_noCorpusFile +
      u.U3_bareNameExistsUnderOtherId + u.U4_namesNothing
    const bothPct = r.resolvedBothEnds === 0 ? "—" : `${((100 * r.resolvedBothEnds) / r.edges).toFixed(2)}%`
    console.log(
      pad(t, 13) + pad(r.edges, 8) + pad(r.resolvedBothEnds, 8) + pad(bothPct, 10) +
      pad(r.ambCrossKindEdges, 7) + pad(r.ambMultiFileEdges, 7) + String(unres),
    )
  }
  console.log("-".repeat(96))
  console.log("")
  console.log("UNRESOLVED, PARTITIONED (only U3 is a binding defect this lane can repair)")
  for (const t of ALL_TYPES) {
    const u = perType[t].unresEdges
    const tot = u.U1_modulePath_namesCorpusFile + u.U2_modulePath_noCorpusFile + u.U3_bareNameExistsUnderOtherId + u.U4_namesNothing
    if (tot === 0) continue
    console.log(
      `  ${pad(t, 13)} U1 ${pad(u.U1_modulePath_namesCorpusFile, 7)} U2 ${pad(u.U2_modulePath_noCorpusFile, 7)}` +
      ` U3 ${pad(u.U3_bareNameExistsUnderOtherId, 6)} U4 ${pad(u.U4_namesNothing, 7)}   of ${tot}`,
    )
  }
  console.log("")
  console.log(`AMBIGUOUS EDGES, BY CLASS AND TYPE`)
  for (const t of ALL_TYPES) {
    const a = perType[t].ambEdges
    if (a.unique + a.C_sameText + a.B_sameRepo_diffText + a.B_otherRepo_diffText === 0) continue
    console.log(
      `  ${pad(t, 13)} unique ${pad(a.unique, 7)} C ${pad(a.C_sameText, 7)}` +
      ` B/same-repo ${pad(a.B_sameRepo_diffText, 6)} B/cross-repo ${a.B_otherRepo_diffText}`,
    )
  }
  console.log("")
  console.log("HOW MANY AMBIGUOUS TARGETS ARE NAMESPACES (an id some other published id sits under)")
  for (const t of ALL_TYPES) {
    const a = ambTargetsByType[t]
    if (a.edges === 0) continue
    console.log(`  ${pad(t, 13)} distinct ambiguous ids ${pad(a.ids, 7)} of which a namespace ${a.namespaceEdges}`)
  }
  console.log("")
  console.log("MODULE-PATH AMBIGUITY — invisible to every id-keyed measure above, including the shared one")
  console.log(`  distinct module-path targets                       ${modulePathsDistinct.size}`)
  console.log(`  of those, naming >1 corpus file                    ${[...modulePathTargetFiles.values()].filter((v) => v.length > 1).length}`)
  console.log(`  basenames shared by >1 corpus file                 ${basenameShared.length}`)
  for (const t of ["imports", "exports"] as Type[]) {
    const m = modulePathAmb[t]
    if (m.edges === 0) continue
    console.log(`  ${pad(t, 13)} ${pad(m.edges, 7)} edges, ${m.targets} targets: ${m.targetsNamingOneFile} name exactly 1 file, ${m.targetsNamingManyFiles} name >1, ${m.targetsNamingNoFile} name none`)
  }
  for (const b of basenameShared.slice(0, 8)) console.log(`    ${b} -> ${filesByBasename.get(b)!.length} files`)
  console.log("")
  const repairable = unresList.filter((d) => d.class === "U3_bareNameExistsUnderOtherId")
  const hopeless = unresList.filter((d) => d.class === "U4_namesNothing")
  console.log(`U4 TARGETS THAT NAME NOTHING (${hopeless.reduce((a, b) => a + b.edges, 0)} edges, ${hopeless.length} distinct) — these are the whole repairable population`)
  for (const d of hopeless.slice(0, 60)) {
    console.log(`  ${pad(d.target, 46)} ${pad(d.edges, 5)} edges, ${d.fileCount} file(s): ${d.files[0]}`)
  }
  if (hopeless.length > 60) console.log(`  … and ${hoppless.length - 60} more`)
  console.log("")
  console.log(`U2 module paths naming no corpus file: ${unresList.filter((d) => d.class === "U2_modulePath_noCorpusFile").length} distinct`)
  console.log(`U3 targets whose leaf exists under another id: ${repairable.length} distinct`)
  for (const k of ["ownSubpackage", "walkedUpScopes", "rootOnly", "noScopeInChain", "noPackageOnFile"] as ScopeClass[]) {
    if (scopeTotals[k].distinct === 0) continue
    console.log(`  ${pad(k, 20)} ${pad(scopeTotals[k].distinct, 5)} distinct  ${scopeTotals[k].edges} edges`)
  }
  console.log("")
  console.log(`scope-walk formulations that DISAGREE (shorthand vs protoc first-segment): ${walkDisagreements.length}`)
  for (const w of walkDisagreements) console.log(`  ${w.target} from ${w.refPkg}: shorthand=${w.prependWalk} protoc=${w.protocFirstSegment}`)
  console.log("")
  console.log("U3 ROWS — every one, with what protoc's scope walk would resolve it to")
  for (const s2 of scopeList) {
    console.log(
      `  ${pad(s2.target, 42)} ${pad(s2.edges, 4)} edges  ${pad(s2.cls, 16)} level ${s2.scopeLevel}  refPkg=${s2.refPkg || "(none)"}`,
    )
    console.log(`      protoc resolves to: ${s2.protocWouldResolveTo ?? "(no scope in the chain holds it)"}`)
    for (const id of s2.candidates.slice(0, 2)) console.log(`      leaf also declared as: ${id}`)
  }
  console.log("")
  console.log(`bare names spanning several qualified ids: ${bareNameCollisions.length} (top 12 by id count)`)
  for (const c of bareNameCollisions.slice(0, 12)) console.log(`  ${c.name} -> ${c.ids.length} ids: ${c.ids.slice(0, 3).join(", ")}`)
  console.log("")
  console.log(`wrote ${OUT}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

/**
 * NIM RESOLUTION AUDIT — what each unresolved edge target actually IS.
 *
 * ## Why a resolution RATE is not enough
 *
 * The census reports `calls` resolving at both ends on 38.0% of its edges and
 * `references` on 46.3%. A rate that low reads as a broken analyzer, and the
 * workstream's own finding is that the two causes look identical in a count and
 * are opposite findings:
 *
 *   - a HOPELESS STRING — `add`, `doAssert`, `defined`: a builtin or a stdlib proc
 *     declared in another module. The edge is TRUE and no indexing of this file
 *     can resolve it locally. Publishing a symbol named `add` in the calling file
 *     would be a fabrication.
 *   - a NEVER-INDEXED DECLARATION — a `proc` or `type` that exists in the corpus,
 *     in some file, and that this analyzer failed to publish. The edge is true
 *     AND the far end is missing, which is a defect this lane owns.
 *
 * So every unresolved target is classified here, and the classification is built
 * from MEASURED SETS rather than from a list of names someone judged to be
 * builtins:
 *
 *   builtin           the name is in the analyzer's own builtin tables, which are
 *                     exported (`REAL_NIM_BUILTINS`) and therefore checkable
 *   declared-in-corpus the name IS published by some OTHER nim file in the corpus
 *                     — a cross-file target. The edge is fine; the walk needs the
 *                     cross-file index, which is Laptop C's layer, not a gap here.
 *   tree-declared-only the name is DECLARED on some corpus parse tree but the
 *                     analyzer published NO symbol with that name anywhere. This
 *                     is the defect bucket, and the tree walk is what makes it a
 *                     measurement rather than a suspicion.
 *   nowhere           declared on no corpus tree and published nowhere: a
 *                     third-party package outside the corpus, or a name the
 *                     grammar reads differently. Reported as its own bucket and
 *                     NOT called a defect, because the corpus is a sample.
 *
 * ## The recall measurement
 *
 * `declaration-recall` compares, per kind, the declarations the PARSE TREE
 * carries against the symbols the production run published. That is the
 * precondition for every edge resolving: an edge cannot bind to a symbol that was
 * never published, so symbol recall bounds edge resolution from above, and a
 * recall gap names exactly which declaration to go and publish.
 *
 * ## Method
 *
 * Production `parseFile` for the symbols and the edges; a second raw
 * tree-sitter parse per file for the declarations. Node `type` and named children
 * only — no text pattern, because a string literal can fake a declaration and a
 * comment can fake a keyword.
 *
 * READ-ONLY except an optional JSON path in argv[2].
 */
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { parseFile } from "../../../../src/ast/pool-worker"
import { REAL_NIM_BUILTINS } from "../../../../src/ast/real-nim-analyzer"
import { resumableWalk, resetCheckpoint } from "../../../../script/m14/resumable-walk"

/** Corpus fan-out, and the reason it is a knob rather than a constant.
 *
 * The production path is non-deterministic under concurrency (the doc's
 * Limitations 8 / 11): the WASM parser exhausts its fixed heap on a
 * load-dependent set of files, and a file lost that way publishes symbols with
 * an EMPTY `kind` — a degraded walk whose counts are wrong and whose artifact is
 * otherwise indistinguishable from a clean one. Measured on this corpus at
 * `validation/m14/fixtures/nim/fallback.mts`: 1 worker -> 0 fallback files and 0
 * empty-kind symbols; 6 workers -> 2 and 4.
 *
 * So every number this lane quotes carries its worker count, and this is what
 * makes that count choosable rather than merely reported. Six is the default
 * because that is what every artifact on record was measured at, so an unpinned
 * invocation reproduces the committed figures. Lower it on a saturated box to
 * buy a clean walk; the spread is in the doc either way.
 */
const WORKERS = Math.max(1, Number(process.env.BB_NIM_WORKERS ?? 6) || 6)

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"

const ANALYZER = path.resolve((import.meta as any).dirname ?? ".", "../../../../src/ast/real-nim-analyzer.ts")
const analyzerHash = (): string => createHash("sha256").update(readFileSync(ANALYZER)).digest("hex")
const HASH_BEFORE = analyzerHash()
const OUT = process.argv[2] && process.argv[2].endsWith(".json") ? process.argv[2] : null
const ALL_TYPES = [
  "calls", "uses", "contains", "imports", "references",
  "exports", "extends", "implements", "overrides", "instantiates",
] as const
type Type = (typeof ALL_TYPES)[number]

const SYNTHETIC_SOURCES = new Set(["(global)", "(file)", "(declared-type)", "(module)"])

// ─────────────────────────────────────────────────────────────── corpus walk
const files: { repo: string; dir: string; rel: string; abs: string; text: string }[] = []
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
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text: string
    try { if (statSync(abs).size > 512 * 1024) continue; text = readFileSync(abs, "utf8") } catch { continue }
    if (detectLanguageFromPath(abs, text) !== "nim") continue
    files.push({ repo: e, dir, rel, abs, text })
  }
}
const byRepo = new Map<string, number>()
for (const f of files) byRepo.set(f.repo, (byRepo.get(f.repo) ?? 0) + 1)

// ───────────────────────────────────── pass 1: production symbols AND edges
/** name -> how many files publish a symbol with that name. */
const publishedIn = new Map<string, Set<string>>()
/** name -> published kind, for the recall comparison. */
const publishedKind = new Map<string, Map<string, number>>()
const moduleStemsByRepo = new Map<string, Set<string>>()
for (const f of files) {
  const set = moduleStemsByRepo.get(f.repo) ?? new Set<string>()
  // A module path's last segment is its file stem, and Nim writes imports both
  // ways — `import strutils` and `import std/strutils` name the same file. The
  // first version of this script indexed only `path.basename`, so the 53.4% of
  // `imports` targets written as `std/strutils` fell into the `nowhere` bucket
  // and read as external packages that are in fact sitting in the corpus. Every
  // path SEGMENT is indexed, and a dotted/qualified target is matched on its
  // last segment as well.
  set.add(path.basename(f.rel, path.extname(f.rel)))
  // Every path segment of the extension-stripped relative path, INCLUDING the
  // stem of a file that sits at a repo's root — `aporia.nimble` contributes
  // `aporia`, which is how a bare module target resolves. Slicing by extname
  // length rather than by pattern is what keeps this equivalent to the rule the
  // comment above describes.
  const stem = f.rel.length > path.extname(f.rel).length ? f.rel.slice(0, f.rel.length - path.extname(f.rel).length) : ""
  for (const seg of stem.split("/")) if (seg) set.add(seg)
  moduleStemsByRepo.set(f.repo, set)
}
const edgesByFile: { label: string; repo: string; localNames: Set<string>; edges: { t: Type; src: string; tgt: string }[] }[] = []
let symbolsTotal = 0

/**
 * Pass 1 runs through `resumableWalk`, and the reason is specific rather than
 * general: `parseFile` can kill this PROCESS outright, so a worker pool with no
 * checkpoint loses the entire measurement to one file — and the file is always in
 * the corpus, so every re-run loses it again.
 *
 * Measured on this pass at 2 workers on 2026-10-05:
 * `nim/tests/async/tpolltimeouts.nim` printed `[BB-PARSE-ERR] … memory access
 * out of bounds` and then `[BB-HANG] parser stuck 120s on … — exiting`, taking
 * the run down with no table written. `hang-file-arbitration.ts` parses that file
 * ALONE five times in at most 40 ms — 3,000x under the engine's own 120 s
 * watchdog — and `nim/tests/overload/tgenericalias.nim` in at most 71 ms, so the
 * named input is not the cause (the message names the file whose parse threw).
 * What that costs is still the whole number: TREE-ONLY is the defect column of
 * this instrument, and a deleted run reports nothing about it.
 *
 * `resumableWalk` is shared machinery this lane imports rather than reimplements,
 * for the same reason `ontology-coverage-gate.ts` does. It appends the path
 * BEFORE the next file starts, so an arbitrary kill cannot lose the checkpoint,
 * and a file it gave up on is never retried — one poison file then costs one file
 * instead of every figure here. The checkpoint is gitignored and named per lane,
 * so it is not evidence; the numbers are re-derived from the corpus each run this
 * walk completes.
 */
const CHECKPOINT = "validation/m14/measurements/walk-resolution-audit-nim.txt"
if (process.argv.includes("--fresh")) resetCheckpoint(CHECKPOINT)

const walkStats = await resumableWalk(CHECKPOINT, files.length, {
  id: (i) => files[i].abs,
  concurrency: WORKERS,
  run: async (i) => {
    const f = files[i]
    const r: any = await parseFile(f.abs, f.dir)
    const label = `${f.repo}/${f.rel}`
    const localNames = new Set<string>()
    for (const s of r.symbols ?? []) {
      const nm = String(s.name ?? "")
      if (!nm) continue
      symbolsTotal++
      const set = publishedIn.get(nm) ?? new Set<string>()
      set.add(label)
      publishedIn.set(nm, set)
      const kinds = publishedKind.get(nm) ?? new Map<string, number>()
      const k = String(s.kind ?? "")
      kinds.set(k, (kinds.get(k) ?? 0) + 1)
      publishedKind.set(nm, kinds)
      localNames.add(nm)
      localNames.add(nm.split(".").pop() ?? nm)
      const owner = String(s.ownerName ?? "")
      if (owner) localNames.add(`${owner}.${nm}`)
    }
    const edges: { t: Type; src: string; tgt: string }[] = []
    for (const x of r.relationships ?? []) {
      const t = String(x.type ?? x.relationshipType ?? "").toLowerCase() as Type
      if (!ALL_TYPES.includes(t)) continue
      edges.push({ t, src: String(x.source ?? ""), tgt: String(x.target ?? "") })
    }
    edgesByFile.push({ label, repo: f.repo, localNames, edges })
  },
})

// ───────────────────── pass 2: what the TREES declare, straight from the wasm
const wts: any = await import("web-tree-sitter")
const WSP: any = wts.Parser ?? wts.default
const WSL: any = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-nim.wasm"))))

/**
 * Which FAMILY a name-bearing node belongs to, decided by the node's ancestor
 * chain rather than by a list of names someone expected to find.
 *
 * The first version of this table was a `Record<family, nodeType[]>` written from
 * the language rather than from the grammar, and three of its four families
 * matched nothing this wasm ever produces, which printed as `type 0`, `enum_member
 * 0`, `object_field 0` — indistinguishable from a world where the analyzer
 * publishes no types at all.
 *
 * `decl-node-census.mts` prints the table this rule is built from: every
 * name-bearing node as an ancestor chain, counted. On the `nim` repo alone
 * (3,968 files, 4,510,719 nodes, 209 distinct node types, 9 of them carrying a
 * `name` field) the `symbol_declaration` chains are:
 *
 *     symbol_declaration < symbol_declaration_list < parameter_declaration      58,131
 *     symbol_declaration < symbol_declaration_list < variable_declaration       42,743
 *     symbol_declaration < symbol_declaration_list < field_declaration          12,209
 *     symbol_declaration < enum_field_declaration < enum_declaration            7,867
 *     symbol_declaration < symbol_declaration_list < for                         6,948
 *     symbol_declaration < tuple_deconstruct_declaration < symbol_declaration_list  1,038
 *     symbol_declaration < symbol_declaration_list < variant_discriminator_declaration 295
 *
 * One node type, seven declarations, and the chain is the only thing that tells
 * them apart. Four consequences, each of which changed a printed number:
 *
 *   - a TYPE's name is on `type_symbol_declaration`. `type_declaration` is its
 *     PARENT and carries no `name` field, so the old entry counted nothing.
 *   - `enum_field_declaration` and `field_declaration` do NOT carry the name
 *     either — they carry `value` and `type`. Their names are the
 *     `symbol_declaration` children above.
 *   - `parameter`, `for_binding` and `variant_discriminator` were not families at
 *     all, so 65,374 declarations in this repo alone were read and attributed to
 *     nothing. They are families now, because the denominator a name is counted
 *     against is what the recall number means, and a `for` binding counted as a
 *     field would inflate one family and deflate another.
 *
 * AND THE 400-FILE PREFIX FALSIFIED ITSELF TWICE, which is the reason the rule is
 * written this way rather than from the census's first output:
 *
 *   - `method_declaration` did not appear in a 400-file prefix. The full corpus
 *     has 230 of them (172 in `nim`), so an earlier draft of this file concluded
 *     the grammar had no such node and dropped it — silently lowering the
 *     callable denominator.
 *   - `concept_declaration` likewise looked absent; `nim` has 116 of them (as the
 *     grandparent of a `proc_declaration`). It carries no `name` field in this
 *     grammar, so it contributes no declaration here — but "absent from the
 *     grammar" was the wrong claim, and only the whole-corpus shape table
 *     distinguishes those two mistakes.
 *
 * `blank_identifier` (`_`) is deliberately NOT a declaration. It is the discard
 * name: `proc _() = ...` declares nothing any edge can target, and counting it
 * put a permanent floor under the callable recall (356 in this run).
 */
type DeclFamily =
  | "callable" | "type" | "enum_member" | "object_field"
  | "variable" | "tuple_binding" | "parameter" | "for_binding" | "variant_discriminator"
const FAMILIES: DeclFamily[] = [
  "callable", "type", "enum_member", "object_field", "variable",
  "tuple_binding", "parameter", "for_binding", "variant_discriminator",
]
const CALLABLE_NODES = new Set([
  "proc_declaration", "func_declaration", "iterator_declaration",
  "macro_declaration", "template_declaration", "converter_declaration",
  // Present on the corpus's evidence (230 of them), not on the 400-file prefix's.
  "method_declaration",
])
/** `symbol_declaration_list`'s parent -> the family its children belong to. */
const LIST_OWNER_FAMILY: Record<string, DeclFamily> = {
  field_declaration: "object_field",
  variable_declaration: "variable",
  parameter_declaration: "parameter",
  for: "for_binding",
  variant_discriminator_declaration: "variant_discriminator",
}
function declFamilyOf(n: any): DeclFamily | null {
  if (CALLABLE_NODES.has(n.type)) return "callable"
  if (n.type === "type_symbol_declaration") return "type"
  if (n.type !== "symbol_declaration") return null
  const p = n.parent?.type
  if (p === "enum_field_declaration") return "enum_member"
  if (p === "tuple_deconstruct_declaration") return "tuple_binding"
  if (p === "symbol_declaration_list") {
    const owner = n.parent?.parent?.type
    if (owner) return LIST_OWNER_FAMILY[owner] ?? null
  }
  return null
}
/** name -> the files whose TREE declares it. */
const treeDeclaredIn = new Map<string, Set<string>>()
/** name -> the families that declare it. A name declared both as a proc PARAMETER
 *  and as a module-level proc is declared in both, and which of the two is present
 *  decides whether "the analyzer never published this" is a defect or the family
 *  contract working as written. */
const treeDeclFamilies = new Map<string, Set<string>>()
const treeDeclCount = new Map<string, number>()
const recallMisses: Record<DeclFamily, { name: string; file: string; node: string; text: string }[]> = {
  callable: [], type: [], enum_member: [], object_field: [], variable: [],
  tuple_binding: [], parameter: [], for_binding: [], variant_discriminator: [],
}
/** name-bearing nodes read but attributed to NO family, by node type — the honest
 *  answer to "is this table still blind to something?", printed rather than assumed. */
const unattributed = new Map<string, number>()
let blankIdentifiers = 0
let rawParseFailures = 0

/**
 * Every `type_declaration` the trees carry, with whether it sits inside a routine
 * and what its right-hand side declares.
 *
 * This exists to size ONE question. The analyzer publishes a type only when
 * `!inCallable` (`real-nim-analyzer.ts`, `collectDeclarations`), while its own
 * header states the exception to `LocalsAreNotSymbols` — "an object/enum/field
 * declaration … IS a symbol because the object owns it" — and the shared
 * `mutate-analyzer.ts` GO38 mutant is built on exactly that sentence. So the code
 * and the lane's stated contract disagree about in-proc types, and the
 * disagreement has a measurable size. Two rules are costed here rather than
 * guessed at:
 *
 *   OWNED  the RHS declares an object, an enum or a tuple, so the declaration
 *          OWNS member symbols and the contract's exception plainly reaches it.
 *   ANY    any in-proc type at all, including `type Ti = elementType(T)`, which
 *          owns nothing and is only a name binding.
 *
 * A rule is worth implementing only if it recovers edges, so both are reported as
 * edge counts over the same target population the TREE-ONLY column counts.
 */
const localTypes = new Map<string, { inProc: boolean; owned: boolean; sites: string[] }>()
const OWNING_RHS = new Set(["object_declaration", "enum_declaration", "tuple_type", "tuple_deconstruct_declaration"])

let pidx = 0
function treeWorker(): void {
  for (;;) {
    const i = pidx++
    if (i >= files.length) return
    const f = files[i]
    const label = `${f.repo}/${f.rel}`
    let t: any
    try { t = parser.parse(f.text) } catch { rawParseFailures++; continue }
    if (!t) { rawParseFailures++; continue }
    const lines = f.text.split("\n")
    const walk = (n: any): void => {
      if (n.type === "type_declaration") noteLocalType(n, label, lines)
      const nm = n.childForFieldName?.("name")
      if (nm) {
        const family = declFamilyOf(n)
        if (family) {
          const name = identifierNameOf(nm)
          if (name) addTreeDecl(name, family, label, n, lines)
        } else {
          // Keyed by the parent CHAIN, not the node type: `symbol_declaration` is
          // one node type for fields, vars, enum members and proc PARAMETERS, and
          // the parent chain is the only thing that separates them. A tally by
          // node type alone would print one number and teach nothing.
          const chain = `${n.type} < ${n.parent?.type ?? "(root)"}`
          unattributed.set(chain, (unattributed.get(chain) ?? 0) + 1)
        }
      }
      for (let k = 0; k < n.childCount; k++) walk(n.child(k))
    }
    walk(t.rootNode)
    t.delete?.()
  }
}
/** Record one `type_declaration`: is it inside a routine, and does its RHS own members? */
function noteLocalType(n: any, label: string, lines: string[]): void {
  const symDecl = n.namedChildCount > 0 ? n.namedChild(0) : null
  if (!symDecl || symDecl.type !== "type_symbol_declaration") return
  const name = identifierNameOf(symDecl.childForFieldName?.("name"))
  if (!name) return
  let inProc = false
  for (let p = n.parent; p; p = p.parent) {
    if (CALLABLE_NODES.has(p.type)) { inProc = true; break }
  }
  let owned = false
  const scan = (x: any): void => {
    if (OWNING_RHS.has(x.type)) { owned = true; return }
    for (let k = 0; k < x.childCount; k++) scan(x.child(k))
  }
  scan(n)
  const e = localTypes.get(name) ?? { inProc: false, owned: false, sites: [] }
  e.inProc = e.inProc || inProc
  e.owned = e.owned || owned
  if (e.sites.length < 4) {
    const ln = n.startPosition.row + 1
    e.sites.push(`${label}:${ln} |${(lines[ln - 1] ?? "").trim().slice(0, 66)}|`)
  }
  localTypes.set(name, e)
}

/**
 * The identifier a name field carries, or "" when there is none to carry.
 *
 * Two wrappers sit between a declaration and its identifier, and reading either
 * one's text publishes a name no symbol carries: `exported_symbol` wraps the
 * identifier and a `*` (`newFoo*`), and `accent_quoted` wraps it in backticks
 * (`` proc `add`(a, b) ``). Both are unwrapped to the inner identifier here. The
 * alternative — comparing against `newFoo*` — would report every exported symbol
 * in the corpus as an unpublished declaration.
 *
 * `blank_identifier` is the third case and it returns "" on purpose: see
 * `declFamilyOf`.
 */
function identifierNameOf(nm: any): string {
  if (nm.type === "blank_identifier") { blankIdentifiers++; return "" }
  if (nm.type === "exported_symbol" || nm.type === "accent_quoted") {
    return nm.namedChildCount > 0 ? String(nm.namedChild(0).text) : ""
  }
  return String(nm.text)
}
function addTreeDecl(name: string, family: string, label: string, n: any, lines: string[]): void {
  const set = treeDeclaredIn.get(name) ?? new Set<string>()
  set.add(label)
  treeDeclaredIn.set(name, set)
  const fams = treeDeclFamilies.get(name) ?? new Set<string>()
  fams.add(family)
  treeDeclFamilies.set(name, fams)
  const key = `${family}:${name}`
  treeDeclCount.set(key, (treeDeclCount.get(key) ?? 0) + 1)
  if (!publishedIn.has(name) && recallMisses[family].length < 40) {
    const ln = n.startPosition.row + 1
    recallMisses[family].push({ name, file: `${label}:${ln}`, node: n.type, text: (lines[ln - 1] ?? "").trim().slice(0, 80) })
  }
}
treeWorker()

// ─────────────────────────────────────── the analyzer's own builtin tables
const BUILTIN = new Set<string>(REAL_NIM_BUILTINS.map((b: any) => String(typeof b === "string" ? b : b?.name ?? "")))

// ──────────────────────────────────────────────────── per-type classification
type Bucket = "local" | "synthetic" | "module-stem" | "builtin" | "declared-in-corpus" | "tree-declared-only" | "nowhere"
const stats = new Map<Type, Map<Bucket, number>>()
const unresolvedNames = new Map<Type, Map<string, Bucket>>()
/** The families `LocalsAreNotSymbols` excludes from the symbol table. A name the
 *  corpus declares ONLY in one of these is not a publication gap. */
const EXCLUDED_FAMILIES = new Set(["parameter", "variable", "for_binding", "tuple_binding"])
const treeOnlySplit = new Map<Type, { "excluded-family": number; "published-family": number }>()
/** distinct target -> the families that declare it, for the published-family half */
const realGaps = new Map<string, Set<string>>()
const getStats = (t: Type): Map<Bucket, number> => {
  let m = stats.get(t)
  if (!m) { m = new Map(); stats.set(t, m) }
  return m
}
const bump = (t: Type, b: Bucket): void => { const m = getStats(t); m.set(b, (m.get(b) ?? 0) + 1) }
const classifyTarget = (t: Type, tgt: string, repo: string, local: Set<string>): Bucket => {
  if (t === "imports") {
    const mods = moduleStemsByRepo.get(repo)
    // Both the written path and its last segment, because `std/strutils` and
    // `strutils` are the same module and Nim accepts both.
    const segs = tgt.split("/")
    if (mods?.has(tgt) || segs.some((sg) => mods?.has(sg))) return "module-stem"
  }
  if (local.has(tgt) || local.has(tgt.split(".").pop() ?? tgt)) return "local"
  if (BUILTIN.has(tgt)) return "builtin"
  if (publishedIn.has(tgt)) return "declared-in-corpus"
  if (treeDeclaredIn.has(tgt)) return "tree-declared-only"
  return "nowhere"
}
for (const rec of edgesByFile) {
  const mods = moduleStemsByRepo.get(rec.repo) ?? new Set<string>()
  for (const e of rec.edges) {
    // the TARGET is the question the incoming direction asks
    const b = classifyTarget(e.t, e.tgt, rec.repo, rec.localNames)
    bump(e.t, b)
    if (b === "tree-declared-only") {
      const fams = treeDeclFamilies.get(e.tgt) ?? new Set<string>()
      // The split that decides whether this column is a defect list or the family
      // contract. `LocalsAreNotSymbols` (C-D1, and this lane's own
      // nim/locals-are-not-symbols mutant) says a parameter, a `for` binding, a
      // tuple binding and a body-local `var`/`let`/`const` are NOT symbols, and
      // this analyzer enforces it. So an edge whose target is declared ONLY in
      // those families cannot resolve BY DESIGN, and an edge whose target is
      // also declared as a callable / type / enum member / field is a real
      // publication gap the analyzer could close.
      const key = [...fams].some((f) => !EXCLUDED_FAMILIES.has(f)) ? "published-family" : "excluded-family"
      const cur = treeOnlySplit.get(e.t) ?? { "excluded-family": 0, "published-family": 0 }
      cur[key]++
      treeOnlySplit.set(e.t, cur)
      if (key === "published-family") {
        const m = unresolvedNames.get(e.t) ?? new Map<string, Bucket>()
        if (!m.has(e.tgt)) m.set(e.tgt, b)
        unresolvedNames.set(e.t, m)
        const famSet = realGaps.get(e.tgt) ?? new Set<string>()
        for (const f of fams) famSet.add(f)
        realGaps.set(e.tgt, famSet)
      }
    } else if (b === "nowhere") {
      const m = unresolvedNames.get(e.t) ?? new Map<string, Bucket>()
      if (m.size < 4000 && !m.has(e.tgt)) m.set(e.tgt, b)
      unresolvedNames.set(e.t, m)
    }
  }
}

// ──────────────────────────────────────────────────────────── the report
const w = (s: string, n: number): string => (s + " ".repeat(n)).slice(0, n)
const pct = (a: number, b: number): string => (b === 0 ? "n/a" : `${((a / b) * 100).toFixed(1)}%`)

console.log(`nim resolution audit — production parseFile + one raw parse per file`)
console.log(`analyzer    : ${path.relative(process.cwd(), ANALYZER)} sha256:${HASH_BEFORE.slice(0, 16)}`)
console.log(`corpus: ${files.length.toLocaleString()} nim files in ${byRepo.size} repos (${[...byRepo].map(([k, v]) => `${k}=${v}`).join(", ")})`)
console.log(`workers: ${WORKERS} (BB_NIM_WORKERS; every count below is a function of this — see Limitations 8/11)`)
console.log(`symbols published: ${symbolsTotal.toLocaleString()}   distinct names: ${publishedIn.size.toLocaleString()}`)
// The walk's own accounting replaces the counter a worker pool incremented, and
// the distinction matters to how the table below reads. `skippedBad` is a file
// this walk ABANDONED — it threw, or the process was killed on it — and every
// count in the table is over `walked`, not over `files.length`. So a table
// printed after a partial walk describes a smaller population than the corpus
// line above it, and the population is stated rather than inferred from the
// corpus count matching.
//
// THE POPULATION IS `edgesByFile.length`, NOT `walked + alreadyDone`, and this
// line was wrong until 2026-10-05. The checkpoint's whole job is to survive a
// kill, and it does: it records which PATHS are done. It records no RESULTS, so
// a resumed run has no in-memory state for the files it skipped and every
// aggregate below them — `publishedIn`, `symbolsTotal`, `edgesByFile`,
// `treeDeclaredIn` — holds only what THIS process parsed. Measured on that bug,
// on this corpus: a resumed run printed
//
//     walk: 6063/6063 files (100.0%)  newly walked 647, resumed 5416
//     symbols published: 5,080   distinct names: 2,941
//     calls  4,437 edges
//
// which is 647 files' worth of numbers under a 6,063-file caption. The true
// figures for the same analyzer are 116,118 symbols and 118,261 `calls` edges,
// so the resumed table understated `calls` by 26x while claiming full coverage.
// A reader comparing two runs would have read a 26-fold regression in the
// analyzer. `partial` was also computed from the wrong population, so the run
// did not even flag itself.
//
// So the caption counts what fed the table, and the resumed-but-absent files are
// named as the gap they are. The checkpoint is still worth keeping — it is what
// let the second attempt finish after `nim/tests/xml/ttree_delete.nim` trapped
// the wasm heap — it is simply not a cache of results, and a run that resumes
// cannot make a corpus statement.
const contributingPop = edgesByFile.length
const walkedPop = walkStats.walked + walkStats.alreadyDone
const absent = walkedPop - contributingPop
const tableIsWholeCorpus = contributingPop === files.length
console.log(`raw-parse failures: ${rawParseFailures}`)
console.log(
  `walk: ${contributingPop}/${files.length} files fed this table (${((contributingPop / files.length) * 100).toFixed(1)}%)  ` +
    `newly walked ${walkStats.walked}, resumed ${walkStats.alreadyDone}` +
    (walkStats.skippedBad > 0 ? `  SKIPPED-BAD ${walkStats.skippedBad}` : "") +
    (absent > 0 || walkStats.partial ? `  PARTIAL` : ""),
)
if (absent > 0) {
  console.log(
    `      NOT A CORPUS STATEMENT. ${absent} file(s) were recorded in the checkpoint but their results are not in ` +
      `this process, so every count below is over ${contributingPop} files. The checkpoint records PATHS, not results, ` +
      `so a resumed run re-parses nothing it skipped. Re-run with --fresh to re-derive all ${files.length}.`,
  )
}
if (walkStats.partial) {
  console.log(
    `      every count below is over ${contributingPop} of ${files.length} corpus files; the ${walkStats.skippedBad} skipped ` +
      `file(s) are excluded and never retried. Re-run to resume, --fresh to start over.`,
  )
}

console.log(`\n${w("type", 14)}${w("edges", 9)}${w("local", 10)}${w("module", 9)}${w("builtin", 9)}${w("other-file", 11)}${w("TREE-ONLY", 11)}${w("nowhere", 10)}share resolvable locally`)
console.log("-".repeat(120))
const table: any[] = []
for (const t of ALL_TYPES) {
  const m = stats.get(t)
  if (!m) { console.log(`${w(t, 14)}${w("0", 9)}${"-".padEnd(70)}NOT EMITTED`); table.push({ type: t, emitted: false }); continue }
  const g = (k: Bucket): number => m.get(k) ?? 0
  const total = [...m.values()].reduce((a, b) => a + b, 0)
  const locally = g("local") + g("synthetic") + g("module-stem")
  console.log(
    `${w(t, 14)}${w(total.toLocaleString(), 9)}${w(pct(g("local"), total), 10)}${w(pct(g("module-stem"), total), 9)}` +
    `${w(pct(g("builtin"), total), 9)}${w(pct(g("declared-in-corpus"), total), 11)}${w(g("tree-declared-only").toLocaleString(), 11)}${w(pct(g("nowhere"), total), 10)}` +
    `${pct(locally, total)}`,
  )
  table.push({ type: t, total, local: g("local"), synthetic: g("synthetic"), moduleStem: g("module-stem"), builtin: g("builtin"), declaredInCorpus: g("declared-in-corpus"), treeDeclaredOnly: g("tree-declared-only"), nowhere: g("nowhere") })
}
console.log(`\nTREE-ONLY is the defect column: the target IS declared on a corpus parse tree and NO symbol with`)
console.log(`that name was published anywhere. NOWHERE is a name declared on no corpus tree — a third-party`)
console.log(`package outside the corpus, or a spelling the grammar reads differently. Not the same finding.`)

// …and TREE-ONLY is not yet a defect list, because a name declared only as a
// PARAMETER or a body-local is excluded from the symbol table by the family
// contract (C-D1 `LocalsAreNotSymbols`, enforced here by the
// nim/locals-are-not-symbols mutant). So the column is split by whether the
// corpus ALSO declares the name in a family this analyzer does publish.
console.log(`\nTREE-ONLY, SPLIT BY WHETHER THE CONTRACT EXPLAINS IT`)
console.log(`  excluded-family  the corpus declares the target ONLY as a parameter / body-local / for-binding /`)
console.log(`                   tuple-binding. Unresolvable by design; publishing it would fail this lane's own mutant.`)
console.log(`  published-family the corpus ALSO declares it as a callable, type, enum member or field — a real gap.`)
let splitExcluded = 0, splitPublished = 0
const reach = { ownedEdges: 0, ownedNames: new Set<string>(), anyEdges: 0, anyNames: new Set<string>() }
for (const rec of edgesByFile) {
  for (const e of rec.edges) {
    const s = treeOnlySplit.get(e.t)
    if (!s) continue
    // Only the published-family half can be recovered by publishing anything.
    if (!realGaps.has(e.tgt)) continue
    const lt = localTypes.get(e.tgt)
    if (!lt) continue
    if (lt.owned) { reach.ownedEdges++; reach.ownedNames.add(e.tgt) }
    reach.anyEdges++; reach.anyNames.add(e.tgt)
  }
}
for (const t of ALL_TYPES) {
  const s = treeOnlySplit.get(t)
  if (!s) continue
  splitExcluded += s["excluded-family"]
  splitPublished += s["published-family"]
  console.log(`  ${w(t, 14)}${w(s["excluded-family"].toLocaleString(), 12)}${w(s["published-family"].toLocaleString(), 18)}`)
}
console.log(`  ${w("TOTAL", 14)}${w(splitExcluded.toLocaleString(), 12)}${w(splitPublished.toLocaleString(), 18)}` +
  `   distinct target names in the published-family half: ${realGaps.size}`)

// The cost of the two candidate fixes, over the same edges.
console.log(`\n  OF THOSE, HOW MANY AN IN-PROc TYPE PUBLICATION WOULD RECOVER — the analyzer publishes a type only`)
console.log(`  when !inCallable, while its header reserves object/enum/field declarations as symbols.`)
console.log(`    OWNED (object/enum/tuple RHS — the contract's exception reaches it)  ${reach.ownedEdges} edges over ${reach.ownedNames.size} names`)
console.log(`    ANY   (every in-proc type, including a bare alias)                  ${reach.anyEdges} edges over ${reach.anyNames.size} names`)
console.log(`    the difference, i.e. what OWNED declines: ${reach.anyEdges - reach.ownedEdges} edges over ${reach.anyNames.size - reach.ownedNames.size} names`)
for (const [name, lt] of [...localTypes].filter(([n]) => reach.anyNames.has(n)).slice(0, 24)) {
  console.log(`      ${w(name, 26)}owned=${lt.owned ? "Y" : "n"}  ${lt.sites[0] ?? ""}`)
}
if (realGaps.size) {
  console.log(`  every one, with the families that declare it:`)
  for (const [name, fams] of [...realGaps].sort()) {
    console.log(`    ${w(name, 30)}${[...fams].sort().join(" ")}`)
  }
}

console.log(`\nDECLARATION RECALL — the parse tree's declarations vs the run's published symbols`)
console.log(`${w("family", 15)}${w("on the tree", 14)}${w("published", 12)}${w("recall", 10)}unpublished names, most frequent`)
console.log("-".repeat(130))
const recallTable: any[] = []
for (const family of FAMILIES) {
  let onTree = 0
  const names = new Set<string>()
  for (const [key, count] of treeDeclCount) {
    if (!key.startsWith(`${family}:`)) continue
    onTree += count
    names.add(key.slice(family.length + 1))
  }
  let published = 0
  for (const nm of names) if (publishedIn.has(nm)) published += names.has(nm) ? countOf(nm, family) : 0
  const rate = names.size === 0 ? "n/a" : pct(published, onTree)
  const missing = [...names].filter((n) => !publishedIn.has(n)).slice(0, 8)
  console.log(`${w(family, 15)}${w(onTree.toLocaleString(), 14)}${w(published.toLocaleString(), 12)}${w(rate, 10)}${missing.join(" ")}`)
  recallTable.push({ family, onTree, published, names: names.size, unpublishedExamples: recallMisses[family].slice(0, 10) })
}
function countOf(nm: string, family: string): number { return treeDeclCount.get(`${family}:${nm}`) ?? 0 }

// The table above is only as good as the family rule behind it, and a family rule
// that silently stops matching looks exactly like a world where the declarations
// stopped existing. So the run prints what it read but did not attribute. The
// s19 version of this file had three families reading 0 and printed nothing about
// it, and that silence is why a wrong lookup table survived to be quoted.
console.log(`\nWHAT THE FAMILY RULE DID NOT ATTRIBUTE — name-bearing nodes read, family assigned to none`)
console.log(`  ${unattributed.size === 0 ? "0 node types" : [...unattributed].sort((a, b) => b[1] - a[1]).slice(0, 14).map(([k, n]) => `${k} ${n}`).join("\n     ")}`)
if (unattributed.size > 14) console.log(`     … and ${unattributed.size - 14} more distinct shapes`)
console.log(`  blank identifiers skipped by design (proc _() declares nothing an edge can target): ${blankIdentifiers}`)
const familyTotal = FAMILIES.reduce((a, f) => a + [...treeDeclCount].filter(([k]) => k.startsWith(`${f}:`)).reduce((x, [, n]) => x + n, 0), 0)
const unattributedTotal = [...unattributed.values()].reduce((a, b) => a + b, 0)
console.log(`  attributed ${familyTotal.toLocaleString()} declarations, unattributed ${unattributedTotal.toLocaleString()} ` +
  `(${(unattributedTotal / (familyTotal + unattributedTotal) * 100).toFixed(2)}% of name-bearing nodes)`)

console.log(`\nUnpublished declarations, with the source line (the defect list)`)
for (const family of FAMILIES) {
  const miss = recallMisses[family]
  if (!miss.length) continue
  console.log(`  ${family}: ${miss.length}${miss.length >= 40 ? "+" : ""} shown`)
  for (const m of miss.slice(0, 12)) console.log(`    ${m.file}  ${m.node}  ${m.name}   |${m.text}|`)
}

console.log(`\nUnresolved target names per type, by bucket`)
for (const t of ALL_TYPES) {
  const m = unresolvedNames.get(t)
  if (!m || m.size === 0) continue
  const treeOnly = [...m].filter(([, b]) => b === "tree-declared-only").slice(0, 10)
  const nowhere = [...m].filter(([, b]) => b === "nowhere").slice(0, 10)
  console.log(`  ${w(t, 14)}distinct unresolved ${m.size}`)
  if (treeOnly.length) console.log(`    TREE-ONLY : ${treeOnly.map(([k]) => k).join(" ")}`)
  if (nowhere.length) console.log(`    nowhere   : ${nowhere.map(([k]) => k).join(" ")}`)
}

if (OUT) {
  writeFileSync(OUT, JSON.stringify({
    analyzerSha256: HASH_BEFORE, analyzerStableDuringRun: analyzerHash() === HASH_BEFORE,
    workers: WORKERS,
    lang: "nim", corpusRoot: CR, files: files.length, filesByRepo: Object.fromEntries(byRepo),
    // The POPULATION every count below is over, not the corpus it was drawn from.
    // `files` is what discovery found; `population` is what the walk actually
    // parsed AND retained. On a resumed run `population` is `walked`, NOT
    // `walked + resumed`: the checkpoint carries paths, not results, so the
    // resumed files contribute nothing to any aggregate. `partial` is therefore
    // `population !== corpus` rather than the walk helper's own flag, which is
    // computed from paths and read `false` for a run that resumed 5,416 of 6,063.
    walk: {
      walked: walkStats.walked,
      resumed: walkStats.alreadyDone,
      resumedResultsAbsent: Math.max(0, absent),
      skippedBad: walkStats.skippedBad,
      walkPartial: walkStats.partial,
      partial: !tableIsWholeCorpus,
      population: contributingPop,
      corpus: files.length,
    },
    symbolsPublished: symbolsTotal, distinctPublishedNames: publishedIn.size,
    rawParseFailures,
    targets: table, recall: recallTable,
    treeDeclaredNames: treeDeclaredIn.size,
    // The actionable list: every distinct target an emitted edge names that IS
    // declared on some corpus tree and that NO symbol anywhere carries. Each row
    // names the files that declare it, because that is the file whose analyzer run
    // failed to publish it — the defect list, not a rate.
    treeOnlyTargets: Object.fromEntries([...unresolvedNames].map(([t, m]) => [
      t,
      [...m].filter(([, b]) => b === "tree-declared-only")
        .map(([name]) => ({ name, declaredIn: [...(treeDeclaredIn.get(name) ?? [])].slice(0, 6), declaringFileCount: (treeDeclaredIn.get(name) ?? new Set()).size })),
    ])),
    // The contract split, per edge type, plus every distinct target in the half
    // the contract does NOT explain — the actual defect list.
    treeOnlyByContract: Object.fromEntries(treeOnlySplit),
    treeOnlyExcludedTotal: splitExcluded,
    treeOnlyPublishedFamilyTotal: splitPublished,
    treeOnlyRealGaps: Object.fromEntries([...realGaps].map(([n, f]) => [n, [...f].sort()])),
    inProcTypeReach: {
      ownedEdges: reach.ownedEdges, ownedNames: [...reach.ownedNames].sort(),
      anyEdges: reach.anyEdges, anyNames: [...reach.anyNames].sort(),
      inProcTypesSeen: localTypes.size,
      inProcTypesOwned: [...localTypes].filter(([, v]) => v.owned).length,
    },
    // The instrument's own coverage, so a reader can tell a 0 that came from the
    // world from a 0 that came from the family rule.
    familyRule: { families: FAMILIES, unattributedByNodeType: Object.fromEntries(unattributed), unattributedTotal, attributedTotal: familyTotal, blankIdentifiersSkipped: blankIdentifiers },
  }, null, 2))
  console.log(`\nwrote ${OUT}`)
}console.log(`analyzer sha256 after the walk : ${HASH_BEFORE.slice(0, 16)}${analyzerHash() === HASH_BEFORE ? "  (unchanged — every number above is tied to this analyzer state)" : "  CHANGED DURING THE RUN — the numbers above are a MIXTURE of two analyzer states and are not reproducible"}`)
  

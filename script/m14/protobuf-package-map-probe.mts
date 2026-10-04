/**
 * PROTOBUF LANE — WOULD A PACKAGE MAP CLOSE THE UNBOUND `uses` TARGETS?
 *
 * ## The question
 *
 * Pass 3 counted **52** `uses` edges whose target names an id no file in the corpus
 * publishes, and **4** more whose target names nothing at all, and declared the cause
 * as "needs the include-root map, a project-level fact". That is a true statement and
 * it is not a measurement: it does not say how many of the 56 a project-level fact
 * would actually close, so a reader cannot tell whether the gap is 1 edge or 500.
 *
 * This file measures it.
 *
 * ## Why the per-file analyzer cannot close them
 *
 * `resolveViaImports` in `src/ast/real-protobuf-analyzer.ts` answers "is
 * `S.A.B.C` declared in a file this one imports?" by testing whether the DIRECTORY of
 * the candidate package appears among this file's imported module paths:
 *
 *     import "private/pbcommon/common.proto"   ->  importDirs = { "private/pbcommon" }
 *     candidate package hashicorp.consul.internal.common
 *                                          ->  dir       = "hashicorp/consul/internal/common"
 *
 * Those two strings are unrelated. consul's private protos put a package
 * `hashicorp.consul.internal.common` in a directory called `pbcommon`, so the test can
 * never fire and the reference is emitted exactly as written (`common.EnterpriseMeta`)
 * — a name no file publishes. In repos where the directory mirrors the package
 * (docker, kubernetes, boundary, pb-googleapis) the test is right and it works.
 *
 * That is the whole mechanism, and it is a fact about DIRECTORY LAYOUT, not about
 * protobuf. `protoc` resolves the same reference with a descriptor pool built from
 * the `-I` include roots, and gets it right because it never looks at directory
 * names.
 *
 * ## What this file measures
 *
 * For every `uses` target that binds to no published id corpus-wide, it asks the
 * question a package map would answer, using only facts a project-level pass could
 * have:
 *
 *   CLOSABLE-BY-PACKAGE-MAP  some spec-chain candidate of the target — the same
 *                            chain `specScopeChain` builds — IS a published id, and
 *                            the file that publishes it is one THIS file imports.
 *                            A map from import path to declared package closes it.
 *   CLOSABLE-NOT-IMPORTED    the candidate IS published, but by a file this one does
 *                            not import. protoc would not resolve it either: the
 *                            reference is wrong, or the include root is wider than
 *                            the import list. Not closeable, and correctly so.
 *   NOT-CLOSABLE             no spec-chain candidate is published anywhere.
 *
 * The three are disjoint and exhaustive, and together they are all 52 + 4. The third
 * is the only class where the target is hopeless rather than under-resolved.
 *
 * ## No regex
 *
 * The corpus walk is `readdirSync`/`statSync` and the language filter is
 * `endsWith(".proto")`. Every per-file fact — the declared package, the import paths
 * — is read off the tree-sitter parse by `node.type` and named children. Splitting a
 * dotted name is `lastIndexOf(".")`, not a pattern. No text is matched anywhere.
 *
 * ## Usage
 *
 *   npx tsx script/m14/protobuf-package-map-probe.mts [--out /tmp/pb-pkgmap.json]
 *
 * READ-ONLY with respect to the corpus. Writes one JSON file.
 */
import { readdirSync, statSync, writeFileSync, mkdirSync, readFileSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const argv = process.argv.slice(2)
const OUT = argv.includes("--out") ? argv[argv.indexOf("--out") + 1] : "/tmp/opencode/pb/pkgmap.json"
const LIMIT_ARG = argv.find((a) => a.startsWith("--limit="))
const PER_REPO_LIMIT = LIMIT_ARG ? Number(LIMIT_ARG.slice("--limit=".length)) : 0

// ---------------------------------------------------------------- corpus walk

type Repo = { name: string; files: string[] }
const repos: Repo[] = []
for (const name of readdirSync(CR).sort()) {
  const dir = path.join(CR, name)
  try {
    if (!statSync(dir).isDirectory()) continue
  } catch {
    continue
  }
  const files: string[] = []
  const walk = (d: string, depth: number): void => {
    if (depth > 24) return
    let entries: string[]
    try {
      entries = readdirSync(d)
    } catch {
      return
    }
    for (const e of entries) {
      const p = path.join(d, e)
      let st
      try {
        st = statSync(p)
      } catch {
        continue
      }
      if (st.isDirectory()) {
        if (e === ".git" || e === "node_modules") continue
        walk(p, depth + 1)
      } else if (e.endsWith(".proto")) {
        files.push(p)
      }
    }
  }
  walk(dir, 0)
  if (PER_REPO_LIMIT > 0 && files.length > PER_REPO_LIMIT) {
    const stride = Math.ceil(files.length / PER_REPO_LIMIT)
    const kept: string[] = []
    for (let i = 0; i < files.length; i += stride) kept.push(files[i])
    repos.push({ name, files: kept })
  } else {
    repos.push({ name, files: files.sort() })
  }
}
const ALL_FILES: string[] = []
for (const r of repos) for (const f of r.files) ALL_FILES.push(f)
const rel = (p: string): string => path.relative(CR, p)
console.log(`corpus: ${ALL_FILES.length} .proto files in ${repos.length} repositories`)

// ------------------------------------------- per-file package + imports, parsed

const wts: any = await import("web-tree-sitter")
const ParserClass = wts.Parser ?? wts.default ?? wts
const LanguageClass = wts.Language ?? wts.default?.Language
await ParserClass.init({
  locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm"),
})
const grammar = await LanguageClass.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-protobuf.wasm")))
const parser: any = new ParserClass()
parser.setLanguage(grammar)

/** Named children of a node, by type. No text matching. */
const namedOf = (node: any, type: string): any[] => {
  const out: any[] = []
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i)
    if (c && c.type === type) out.push(c)
  }
  return out
}
const firstOfType = (node: any, type: string): any | null => namedOf(node, type)[0] ?? null

const unquote = (s: string): string => {
  const t = s.trim()
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) return t.slice(1, -1)
  if (t.length >= 2 && t.startsWith("'") && t.endsWith("'")) return t.slice(1, -1)
  return t
}

/**
 * The declared package and the import paths, read off the parse tree. Both are
 * single parse facts: `package` carries a `full_ident`, and an `import`'s `path`
 * field is one quoted string. Nothing here inspects the text of a declaration.
 */
const headerOf = (file: string): { pkg: string; imports: string[] } => {
  const tree = parser.parse(readFileSync(file, "utf8"))
  const root = tree.rootNode
  const imports: string[] = []
  let pkg = ""
  for (let i = 0; i < root.namedChildCount; i++) {
    const c = root.namedChild(i)
    if (!c) continue
    if (c.type === "package") {
      const id = firstOfType(c, "full_ident")
      if (id) pkg = id.text
    } else if (c.type === "import") {
      const p = c.childForFieldName("path")
      if (p) imports.push(unquote(String(p.text)))
    }
  }
  return { pkg, imports }
}

// ---------------------------------------- the production run, once per file

type FileFacts = {
  rel: string
  pkg: string
  imports: string[]
  /** published ids of TYPE declarations this file publishes (message/enum/service roots) */
  typeIds: Set<string>
  /** every published id, any kind */
  allIds: Set<string>
  /** published import paths, from the production `imports` channel */
  prodImports: Set<string>
  /** the `uses` targets this file emits, with the source id */
  uses: { from: string; to: string }[]
}

const facts = new Map<string, FileFacts>()
let parsedOk = 0
let parseFail = 0
let degraded = 0

for (const file of ALL_FILES) {
  const r = rel(file)
  let res: Awaited<ReturnType<typeof parseFile>>
  try {
    res = await parseFile(file, path.dirname(file))
  } catch {
    parseFail++
    continue
  }
  const rres: any = res
  if (rres?.degraded || rres?.parseFallback) degraded++
  const syms: any[] = Array.isArray(rres?.symbols) ? rres.symbols : []
  const rels: any[] = Array.isArray(rres?.relationships) ? rres.relationships : []
  const importsArr: string[] = Array.isArray(rres?.imports)
    ? rres.imports.map((i: any) => (typeof i === "string" ? i : String(i?.path ?? i?.module ?? ""))).filter(Boolean)
    : []

  const typeIds = new Set<string>()
  const allIds = new Set<string>()
  for (const s of syms) {
    // The id the analyzer resolved and the store keys on: `metadata.id` is the
    // analyzer's own value, `qualifiedName` is what pool-worker's projection now
    // publishes, and pass 5 measured them equal for this lane. Either is used so a
    // symbol published under only one of them is still counted.
    const meta: any = s?.metadata ?? {}
    const id = typeof meta.id === "string" && meta.id.length > 0
      ? meta.id
      : typeof s?.qualifiedName === "string" && s.qualifiedName.length > 0
        ? s.qualifiedName
        : null
    if (!id) continue
    allIds.add(id)
    const k = String(s?.kind ?? "")
    if (k === "class" || k === "enum" || k === "interface") typeIds.add(id)
  }

  const uses: { from: string; to: string }[] = []
  const prodImports = new Set<string>()
  for (const e of rels) {
    const ty = String(e?.type ?? e?.relationshipType ?? "")
    // pool-worker names the endpoints `source` and `target`.
    const from = typeof e?.source === "string" ? e.source : ""
    const to = typeof e?.target === "string" ? e.target : ""
    if (ty === "uses" && from && to) uses.push({ from, to })
    if (ty === "imports" && to) prodImports.add(to)
  }
  for (const i of importsArr) prodImports.add(i)

  const h = headerOf(file)
  facts.set(r, {
    rel: r,
    pkg: h.pkg,
    imports: h.imports,
    typeIds,
    allIds,
    prodImports,
    uses,
  })
  parsedOk++
}
console.log(`parsed ${parsedOk} / ${parseFail} failed / ${degraded} degraded`)

// ------------------------------------------------- corpus-wide publication map

/** published id -> the files that publish it */
const publishers = new Map<string, Set<string>>()
for (const f of facts.values()) {
  for (const id of f.typeIds) {
    let s = publishers.get(id)
    if (!s) {
      s = new Set<string>()
      publishers.set(id, s)
    }
    s.add(f.rel)
  }
}

/**
 * protoc's scope chain, rebuilt here so this file does not import the analyzer's
 * internals: the enclosing scopes of the source declaration, then the package's own
 * ancestors, then the root — innermost first, no repeats. Same order as
 * `specScopeChain`.
 */
const specChain = (scope: string | null, pkg: string): string[] => {
  const chain: string[] = []
  const push = (v: string): void => {
    if (!chain.includes(v)) chain.push(v)
  }
  if (scope) {
    const segs = scope.split(".")
    for (let i = segs.length; i > 0; i--) push(segs.slice(0, i).join("."))
  }
  if (pkg) {
    const segs = pkg.split(".")
    for (let i = segs.length; i > 0; i--) push(segs.slice(0, i).join("."))
  }
  push("")
  return chain
}

// ------------------------------------------------------------------ classify

/**
 * Does this file import the corpus file `hf`?
 *
 * The two are written in different key spaces: an import path is relative to an
 * include root (`private/pbcommon/common.proto`, `google/protobuf/timestamp.proto`)
 * and `hf` is relative to the corpus root (`consul/proto/private/pbcommon/common.proto`).
 * The comparison is therefore a SUFFIX test, and it must land on a path-SEGMENT
 * boundary: `api/specs.proto` is a suffix of `vendor/.../v2/api/specs.proto` but
 * `pi/specs.proto` is a suffix of the same string and is not the same file. A plain
 * `endsWith` would let the second one through, so the boundary is checked.
 *
 * `prodImports` (the production `imports` channel) and `imports` (this file's own
 * import nodes) are both consulted, so a file that reached production through either
 * path counts as importing it.
 */
const importedBy = (f: FileFacts, hf: string): boolean => {
  const suffixOf = (m: string): boolean => hf === m || (hf.length > m.length && hf.endsWith(m) && hf[hf.length - m.length - 1] === "/")
  if (f.prodImports.has(hf)) return true
  for (const m of f.imports) if (suffixOf(m)) return true
  for (const m of f.prodImports) if (suffixOf(m)) return true
  return false
}

type Class =
  | "CLOSABLE-BY-PACKAGE-MAP"
  | "CLOSABLE-BY-ANCESTOR-SCOPE"
  | "NOT-CLOSABLE-BY-PACKAGE-MAP"
  | "NOT-CLOSABLE"
const tally: Record<Class, number> = {
  "CLOSABLE-BY-PACKAGE-MAP": 0,
  "CLOSABLE-BY-ANCESTOR-SCOPE": 0,
  "NOT-CLOSABLE-BY-PACKAGE-MAP": 0,
  "NOT-CLOSABLE": 0,
}
const examples: Record<Class, string[]> = {
  "CLOSABLE-BY-PACKAGE-MAP": [],
  "CLOSABLE-BY-ANCESTOR-SCOPE": [],
  "NOT-CLOSABLE-BY-PACKAGE-MAP": [],
  "NOT-CLOSABLE": [],
}
const byRepo = new Map<string, number>()
const detail: {
  target: string
  from: string
  sourceFile: string
  sourcePkg: string
  class: Class
  candidate: string | null
  candidateFiles: string[]
  importedByThisFile: boolean
}[] = []

let usesEdges = 0
let bindsSomewhere = 0

for (const f of facts.values()) {
  for (const u of f.uses) {
    usesEdges++
    const pubs = publishers.get(u.to)
    if (pubs && pubs.size > 0) {
      bindsSomewhere++
      continue
    }
    // Does not bind anywhere. Ask what a package map would have known.
    // The source declaration's scope is the longest published id that prefixes it.
    let scope: string | null = null
    for (const id of f.typeIds) {
      if (u.from === id || u.from.startsWith(id + ".")) {
        if (scope === null || id.length > scope.length) scope = id
      }
    }
    if (scope === null) {
      // The source is not a type declaration (an rpc, a top-level extension field);
      // fall back to the file's package, which is what protoc scopes from.
      scope = f.pkg || null
    }
    const chain = specChain(scope, f.pkg)
    let hit: { cand: string; files: string[] } | null = null
    for (const base of chain) {
      const cand = base.length > 0 ? `${base}.${u.to}` : u.to
      const p = publishers.get(cand)
      if (p && p.size > 0) {
        hit = { cand, files: [...p].sort() }
        break
      }
    }
    let cls: Class
    if (hit) {
      cls = hit.files.some((hf) => importedBy(f, hf)) ? "CLOSABLE-BY-PACKAGE-MAP" : "NOT-CLOSABLE-BY-PACKAGE-MAP"
    } else {
      cls = "NOT-CLOSABLE"
    }

    // THE ANCESTOR-SCOPE SHAPE. `qualify(pkg, text)` prefixes the package to an
    // UNQUALIFIED reference unconditionally, and protobuf's rule is C++ scoping:
    // `FileDescriptorProto` written inside `package google.protobuf.compiler` is
    // looked up as `google.protobuf.compiler.FileDescriptorProto` (absent) and then
    // as `google.protobuf.FileDescriptorProto` (present, in descriptor.proto). The
    // analyzer stops at the package, so the edge names a declaration that does not
    // exist. The original text is recoverable — the emitted target is `pkg + "." +
    // rest` — so the fall-through can be re-run here rather than argued about.
    //
    // This is separated from the class above because it is closable by an instrument
    // the analyzer ALREADY HAS: `resolveViaImports` tests a candidate package's
    // dotted directory against this file's imported module paths. Whether that test
    // fires depends on whether the repository's directory layout mirrors its package,
    // so the two outcomes are counted apart.
    let ancHit: { cand: string; files: string[] } | null = null
    let ancByLocalInstrument = false
    if (cls === "NOT-CLOSABLE" && f.pkg && u.to.startsWith(f.pkg + ".")) {
      const rest = u.to.slice(f.pkg.length + 1)
      const ancChain = specChain(scope, f.pkg)
      const importDirs = new Set<string>()
      for (const m of f.imports) {
        const cut = m.lastIndexOf("/")
        importDirs.add(cut > 0 ? m.slice(0, cut) : "")
      }
      for (const base of ancChain) {
        const cand = base.length > 0 ? `${base}.${rest}` : rest
        const p = publishers.get(cand)
        if (!p || p.size === 0) continue
        const dir = base.split(".").join("/")
        if (importDirs.has(dir)) {
          ancHit = { cand, files: [...p].sort() }
          ancByLocalInstrument = true
          break
        }
        if (ancHit === null) ancHit = { cand, files: [...p].sort() }
      }
      if (ancHit) cls = ancByLocalInstrument ? "CLOSABLE-BY-ANCESTOR-SCOPE" : "NOT-CLOSABLE"
    }
    tally[cls]++
    const repo = f.rel.split("/")[0]
    byRepo.set(repo, (byRepo.get(repo) ?? 0) + 1)
    if (examples[cls].length < 8) {
      examples[cls].push(
        `${u.to}  <- target of ${f.rel}  [pkg ${f.pkg || "(none)"}]${hit ? `  -> ${hit.cand} in ${hit.files[0]}` : ""}`,
      )
    }
    detail.push({
      target: u.to,
      from: u.from,
      sourceFile: f.rel,
      sourcePkg: f.pkg,
      class: cls,
      candidate: hit?.cand ?? null,
      candidateFiles: hit?.files ?? [],
      importedByThisFile: hit ? hit.files.some((hf) => importedBy(f, hf)) : false,
      ancestorCandidate: ancHit?.cand ?? null,
      ancestorCandidateFiles: ancHit?.files ?? [],
    })
  }
}

// ------------------------------------------------- WOULD THE LOCAL WALK BE SAFE?
//
// Four edges are closable by the instrument `resolveViaImports` already uses: for an
// UNQUALIFIED reference the analyzer calls `qualify(pkg, text)` and stops, while
// protobuf's rule is C++ scoping and falls through to the enclosing scopes. Before
// that walk is proposed as a fix it has to be priced, because it would run against
// EVERY unqualified cross-file reference, not only the four that currently resolve to
// nothing — and a walk that reaches the root can match the empty directory, which is
// in `importDirs` for any file with a top-level import. That is the shape that
// fabricates a bare name.
//
// So: for every unqualified cross-file `uses` target the analyzer emits, re-run the
// ancestor walk with the SAME directory test `resolveViaImports` uses, and report what
// the walk would change. Three outcomes, all counted:
//
//   WALK-LEAVES-TARGET      the walk finds nothing the directory test supports, so
//                           the emitted `pkg.text` stands and nothing moves
//   WALK-RETARGETS-BOUND    the walk lands on a PUBLISHED id — a strict improvement,
//                           an edge that names a declaration instead of nothing
//   WALK-RETARGETS-UNBOUND  the walk changes the emitted name and the new name binds
//                           to NOTHING either. This is the dangerous column: the edge
//                           is rewritten for no gain, and if the name it lands on is a
//                           bare name it has also collided with the global namespace
const walk = {
  noSupportedCandidate: 0,
  retargetsBound: 0,
  retargetsUnbound: 0,
  regressesWorkingEdge: 0,
  retargetsWorkingEdgeToOtherPublished: 0,
  noOpSameCandidate: 0,
}
const walkExamples: { retargetsBound: string[]; retargetsUnbound: string[]; regresses: string[] } = {
  retargetsBound: [],
  retargetsUnbound: [],
  regresses: [],
}
let unqualifiedCrossFile = 0
let walkAlreadyBinds = 0
/**
 * IS THE DECLINE DECIDABLE PER FILE?
 *
 * The walk above is applied UNCONDITIONALLY, which is the only way to price it: the
 * analyzer, holding one file, has no way to ask whether `pkg.text` is published
 * somewhere it was never shown. That makes the 75 a measurement of the worst
 * implementation, not of the best one, and the difference is the whole question.
 *
 * protobuf's rule is C++ scoping: search the enclosing scopes innermost first and
 * STOP at the first scope with a match. So the ONLY correct decline condition is
 * "the innermost scope already publishes this name" — and if it publishes it, the
 * walk must not move the edge at all. `google.api.apikeys.v2.AndroidApplication` is
 * declared at pb-googleapis/google/api/apikeys/v2/resources.proto:140 and referenced
 * at :136 of the same file, four lines earlier, so no scoping rule reaches
 * `google.api.AndroidApplication`.
 *
 * A per-file analyzer knows the publisher set of exactly ONE file: the one it is
 * parsing. `declaredTypeIds` in the analyzer already declines the walk when the file
 * itself declares the innermost name, so those edges never reach this code. What is
 * left is the case where the publisher is ANOTHER file in the same package, which is
 * precisely the project-level fact item 1 is about.
 *
 * So this splits the 75 by whether the referencing file is itself one of the
 * publishers of the name the walk would abandon. A non-zero count here would be a
 * per-file fix; a zero count means the decline is undecidable per file and the walk
 * is not implementable in this analyzer at all, rather than merely risky.
 */
const regressPublisherScope = { sameFile: 0, otherFileSamePackage: 0 }
const regressExamples: string[] = []
for (const f of facts.values()) {
  const importDirs = new Set<string>()
  for (const m of f.imports) {
    const cut = m.lastIndexOf("/")
    importDirs.add(cut > 0 ? m.slice(0, cut) : "")
  }
  for (const u of f.uses) {
    if (!f.pkg || !u.to.startsWith(f.pkg + ".")) continue
    const rest = u.to.slice(f.pkg.length + 1)
    const alreadyBinds = (publishers.get(u.to)?.size ?? 0) > 0
    if (!alreadyBinds) continue
    let scope: string | null = null
    for (const id of f.typeIds) {
      if (u.from === id || u.from.startsWith(id + ".")) {
        if (scope === null || id.length > scope.length) scope = id
      }
    }
    if (scope === null) scope = f.pkg
    const landed = (() => {
      for (const base of specChain(scope, f.pkg)) {
        const cand = base.length > 0 ? `${base}.${rest}` : rest
        const dir = base.split(".").join("/")
        if (!importDirs.has(dir)) continue
        let declined = false
        for (const other of specChain(scope, f.pkg)) {
          const otherDir = other.length > 0 ? other.split(".").join("/") : ""
          if (otherDir !== dir && otherDir.length > dir.length && otherDir.endsWith(dir)) {
            declined = true
            break
          }
        }
        if (declined) continue
        return cand
      }
      return null
    })()
    if (landed === null || landed === u.to) continue
    if ((publishers.get(landed)?.size ?? 0) > 0) continue
    // The walk abandons a name that binds today and lands on one that binds nowhere.
    // Who publishes the name it is abandoning?
    const pubs = publishers.get(u.to) ?? new Set<string>()
    const selfPublishes = pubs.has(f.rel)
    if (selfPublishes) regressPublisherScope.sameFile++
    else regressPublisherScope.otherFileSamePackage++
    if (regressExamples.length < 12) {
      regressExamples.push(
        `${selfPublishes ? "SAME-FILE publisher" : "other-file publisher"}: ${u.to} -> ${landed} (0 publishers)  in ${f.rel}` +
          (selfPublishes ? "  [this file declares it]" : `  [published by ${[...pubs].slice(0, 2).join(", ")}${pubs.size > 2 ? ` +${pubs.size - 2}` : ""}]`),
      )
    }
  }
}
for (const f of facts.values()) {
  const importDirs = new Set<string>()
  for (const m of f.imports) {
    const cut = m.lastIndexOf("/")
    importDirs.add(cut > 0 ? m.slice(0, cut) : "")
  }
  for (const u of f.uses) {
    // Unqualified in the source: the analyzer's emitted target is `pkg + "." + text`.
    if (!f.pkg || !u.to.startsWith(f.pkg + ".")) continue
    const rest = u.to.slice(f.pkg.length + 1)
    // PRICED OVER EVERY UNQUALIFIED CROSS-FILE REFERENCE, not only the ones that
    // currently bind to nothing. In the analyzer the walk cannot know whether
    // `pkg.text` exists, so it would run over the working edges too — and a working
    // edge it retargets is a REGRESSION, which is the number that decides whether the
    // walk is safe to propose. `alreadyBinds` is therefore recorded, not filtered.
    const alreadyBinds = (publishers.get(u.to)?.size ?? 0) > 0
    unqualifiedCrossFile++
    if (alreadyBinds) walkAlreadyBinds++
    let scope: string | null = null
    for (const id of f.typeIds) {
      if (u.from === id || u.from.startsWith(id + ".")) {
        if (scope === null || id.length > scope.length) scope = id
      }
    }
    if (scope === null) scope = f.pkg
    const landed = (() => {
      for (const base of specChain(scope, f.pkg)) {
        const cand = base.length > 0 ? `${base}.${rest}` : rest
        const dir = base.split(".").join("/")
        if (!importDirs.has(dir)) continue
        // the same DECLINE guard `resolveViaImports` uses: a matched directory that
        // is a proper suffix of a MORE SPECIFIC candidate's directory means the
        // include root sits above the package and the directory is not evidence
        let declined = false
        for (const other of specChain(scope, f.pkg)) {
          const otherDir = other.length > 0 ? other.split(".").join("/") : ""
          if (otherDir !== dir && otherDir.length > dir.length && otherDir.endsWith(dir)) {
            declined = true
            break
          }
        }
        if (declined) continue
        return cand
      }
      return null
    })()
    if (landed === null) {
      walk.noSupportedCandidate++
      continue
    }
    if ((publishers.get(landed)?.size ?? 0) > 0) {
      // A regression is the walk CHANGING the emitted name. The walk's first
      // candidate is often the package scope itself, which reproduces `u.to`
      // verbatim; that is a no-op and counting it as a retarget would overstate both
      // columns. Only a genuinely different name is counted, and only when the edge
      // already bound is it a regression rather than an improvement.
      const changed = landed !== u.to
      if (changed && alreadyBinds) {
        walk.retargetsWorkingEdgeToOtherPublished++
        if (walkExamples.regresses.length < 10) {
          walkExamples.regresses.push(
            `${u.to} (${publishers.get(u.to)!.size} publisher(s)) -> ${landed} (${publishers.get(landed)!.size} publisher(s))  in ${f.rel}`,
          )
        }
      }
      if (changed) {
        walk.retargetsBound++
        if (walkExamples.retargetsBound.length < 8) {
          walkExamples.retargetsBound.push(
            `${u.to} (BINDS NOWHERE) -> ${landed}  (${publishers.get(landed)!.size} publisher(s))  in ${f.rel}`,
          )
        }
      } else {
        walk.noOpSameCandidate++
      }
    } else if (landed !== u.to) {
      walk.retargetsUnbound++
      // The regression column. This edge binds TODAY and the walk would move it to a
      // name that binds to nothing, so it is a working edge destroyed for no gain.
      // This is the number that decides whether the walk is implementable, and it is
      // counted here rather than reasoned about.
      if (alreadyBinds) {
        walk.regressesWorkingEdge++
        if (walkExamples.regresses.length < 10) {
          walkExamples.regresses.push(
            `${u.to} (BINDS, ${publishers.get(u.to)!.size} publisher(s)) -> ${landed} (0 publishers)  in ${f.rel}`,
          )
        }
      }
      if (walkExamples.retargetsUnbound.length < 8) {
        walkExamples.retargetsUnbound.push(`${u.to} -> ${landed}  (0 publishers)  in ${f.rel}`)
      }
    } else {
      walk.noOpSameCandidate++
    }
  }
}

const unresolvable =
  tally["CLOSABLE-BY-PACKAGE-MAP"] +
  tally["CLOSABLE-BY-ANCESTOR-SCOPE"] +
  tally["NOT-CLOSABLE-BY-PACKAGE-MAP"] +
  tally["NOT-CLOSABLE"]

const out = {
  at: new Date().toISOString(),
  corpusRoot: CR,
  description:
    "for every `uses` target that binds to NO published id corpus-wide: would a map from import path to declared package close it? three disjoint classes, all edges accounted for",
  filesParsed: parsedOk,
  filesFailed: parseFail,
  degradedFallbacks: degraded,
  usesEdges,
  usesEdgesBindingSomewhere: bindsSomewhere,
  usesEdgesBindingNowhere: unresolvable,
  tally,
  byRepo: Object.fromEntries([...byRepo.entries()].sort((a, b) => b[1] - a[1])),
  examples,
  ancestorWalkCost: {
    description:
      "every unqualified cross-file `uses` target the analyzer emits that binds nowhere; what the ancestor walk `resolveViaImports` could do with it, priced against fabrication",
    unqualifiedCrossFileTargets: unqualifiedCrossFile,
    ofWhichAlreadyBindSomewhere: walkAlreadyBinds,
    regressesAWorkingEdge: walk.regressesWorkingEdge,
    retargetsAWorkingEdgeToAnotherPublishedId: walk.retargetsWorkingEdgeToOtherPublished,
    examplesRegressions: walkExamples.regresses,
    walkFindsNoSupportedCandidate: walk.noSupportedCandidate,
    walkReproducesTheSameName: walk.noOpSameCandidate,
    walkRetargetsBound: walk.retargetsBound,
    walkRetargetsUnbound: walk.retargetsUnbound,
    examplesBound: walkExamples.retargetsBound,
    examplesUnbound: walkExamples.retargetsUnbound,
    declineDecidablePerFile: {
      description:
        "of the edges the walk would break, how many the REFERENCING FILE could decline on its own. protobuf's rule is C++ scoping — stop at the first scope with a match — so the only correct decline is 'the innermost scope already publishes this name', and a per-file analyzer knows the publisher set of exactly one file",
      publisherIsTheReferencingFile: regressPublisherScope.sameFile,
      publisherIsAnotherFileInTheSamePackage: regressPublisherScope.otherFileSamePackage,
      examples: regressExamples,
    },
  },
  detail: detail.slice(0, 200),
}
mkdirSync(path.dirname(OUT), { recursive: true })
writeFileSync(OUT, JSON.stringify(out, null, 2))

const w = (s: string, n: number): string => s.padEnd(n)
console.log("")
console.log(`uses edges ${usesEdges}   binding somewhere ${bindsSomewhere}   binding NOWHERE ${unresolvable}`)
console.log("")
console.log(`${w("class", 28)}${w("edges", 8)}share of the unresolvable`)
console.log("-".repeat(70))
for (const k of Object.keys(tally) as Class[]) {
  const pct = unresolvable > 0 ? ((tally[k] / unresolvable) * 100).toFixed(2) : "0.00"
  console.log(`${w(k, 28)}${w(String(tally[k]), 8)}${pct}%`)
}
console.log("")
console.log(`--- WOULD THE LOCAL ANCESTOR WALK BE SAFE?`)
console.log(`unqualified cross-file USES targets: ${unqualifiedCrossFile}`)
console.log(`  of those, already bind somewhere today: ${walkAlreadyBinds}`)
console.log(`  walk finds NO supported candidate (emitted name stands): ${walk.noSupportedCandidate}`)
console.log(`  walk REPRODUCES the emitted name (no-op):                   ${walk.noOpSameCandidate}`)
console.log(`  walk moves the name to a PUBLISHED id, edge bound NOTHING:   ${walk.retargetsBound}   <- the gain`)
console.log(`  walk moves the name to a NON-BINDING name, edge BINDS today:  ${walk.regressesWorkingEdge}   <- the loss`)
const walkReconciles =
  walk.noSupportedCandidate +
  walk.noOpSameCandidate +
  walk.retargetsBound +
  walk.retargetsWorkingEdgeToOtherPublished +
  walk.regressesWorkingEdge
console.log(`  reconciles to the population: ${walkReconciles === unqualifiedCrossFile ? "YES" : "NO"} (${walkReconciles} vs ${unqualifiedCrossFile})`)
for (const e of walkExamples.regresses) console.log(`      REGRESS ${e}`)
for (const e of walkExamples.retargetsBound) console.log(`      BOUND   ${e}`)
for (const e of walkExamples.retargetsUnbound) console.log(`      UNBOUND ${e}`)
console.log("")
console.log(`--- IS THE DECLINE DECIDABLE PER FILE?  (the ${walk.regressesWorkingEdge} edges the walk would break)`)
console.log(`  publisher is the REFERENCING FILE itself      ${regressPublisherScope.sameFile}`)
console.log(`  publisher is ANOTHER file, same package       ${regressPublisherScope.otherFileSamePackage}`)
console.log(`  -> a per-file analyzer can decline the walk in ${regressPublisherScope.sameFile} of ${walk.regressesWorkingEdge}; the other ${regressPublisherScope.otherFileSamePackage} need the project-level map.`)
for (const e of regressExamples) console.log(`      ${e}`)
console.log("")
console.log(`by repository: ${JSON.stringify(out.byRepo)}`)
for (const k of Object.keys(examples) as Class[]) {
  if (examples[k].length === 0) continue
  console.log("")
  console.log(`--- ${k}`)
  for (const e of examples[k]) console.log(`      ${e}`)
}
console.log("")
console.log(`wrote ${OUT}`)

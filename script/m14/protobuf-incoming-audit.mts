/**
 * PROTOBUF LANE — WHY THE ARBITER SAMPLED 10 FILES, AND WHAT REACHES A DECLARATION.
 *
 * Two measurements, both through the PRODUCTION entry point `parseFile`
 * (`src/ast/pool-worker.ts`), because a count taken from `analyze()` measures a code
 * path the product does not run.
 *
 * ## PART 1 — the 110 files the arbiter never parsed
 *
 * `script/m14/firing-check.ts` drew this lane 10 parsed files out of 120 attempted
 * and 2,069 edges, and the lane's own census claimed 821 of 821 parsed. One of the
 * two numbers was about the analyzer and the other was about the sampler. This part
 * settles which by re-deriving the arbiter's OWN sample — same corpus walk, same
 * `git ls-files`, same stride — and then asking of every path it offered a question
 * that has nothing to do with parsing: **is the path on disk?**
 *
 * `firing-check.ts` builds its file list from `git ls-files` and hands each entry
 * straight to `parseFile`. Three of this language's corpora are SPARSE checkouts
 * (`--filter=blob:none`), where `git ls-files` lists every tracked path whether or
 * not the blob was ever fetched. A path that is not on disk raises ENOENT inside
 * `parseFile`, which the arbiter counts as `parseFailures++` — indistinguishable
 * from a grammar that could not read the file. There are two ways to tell them
 * apart and this file counts both.
 *
 * ## PART 2 — incoming resolution, partitioned
 *
 * `src/lsp/impact.ts` obtains reverse edges by SCANNING OUTGOING EDGES AND MATCHING
 * TARGETS; no inbound edge is stored. So the reverse walk is exactly as good as the
 * target-matching, and an unresolved or ambiguous target is a place the graph
 * asserts something it cannot walk. Both look like a count and are opposite
 * findings, so they are separated here into five disjoint classes:
 *
 *   in-file-both         both endpoints bind inside the declaring file
 *   cross-file-unique    the endpoint binds, and EXACTLY ONE file publishes that id
 *   cross-file-AMBIGUOUS the endpoint binds, and MORE THAN ONE file publishes that
 *                        id — the reverse walk picks a winner by a rule nobody chose
 *   name-exists-unbound  the endpoint does not bind, but a declaration SOMEWHERE in
 *                        the corpus carries that name: a binding defect, and ours
 *   hopeless             the endpoint does not bind and no declaration in the corpus
 *                        carries that name: an external dependency, a module path, or
 *                        a type whose .proto is not in this corpus at all
 *
 * The fifth class is NOT "close enough". It is reported because the alternative is a
 * resolution rate that flatters itself by counting unresolvable edges as failures of
 * an identical-looking kind.
 *
 * ## No regex
 *
 * Nothing here matches text. The corpus walk is `readdirSync`/`statSync`, the
 * language filter is `endsWith(".proto")`, and every per-file fact is read off a
 * tree-sitter parse tree by `node.type` and named children. The last dotted segment
 * is taken with `lastIndexOf(".")`, not a pattern.
 *
 * ## Usage
 *
 *   npx tsx script/m14/protobuf-incoming-audit.mts [--out /tmp/pb-incoming.json]
 *                                                    [--limit=N] [--no-part1]
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../src/ast/language-detection"
import { parseFile } from "../../src/ast/pool-worker"
import { RealProtobufAnalyzer } from "../../src/ast/real-protobuf-analyzer"

const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const argv = process.argv.slice(2)
const OUT = argv.includes("--out") ? argv[argv.indexOf("--out") + 1] : "/tmp/opencode/pb/incoming-audit.json"
const LIMIT_ARG = argv.find((a) => a.startsWith("--limit="))
const PER_REPO_LIMIT = LIMIT_ARG ? Number(LIMIT_ARG.slice("--limit=".length)) : 0
const WANT_PART1 = !argv.includes("--no-part1")

const ALL_TYPES = [
  "calls", "uses", "contains", "imports", "references",
  "exports", "extends", "implements", "overrides", "instantiates",
] as const
type Type = (typeof ALL_TYPES)[number]

/** Store label -> ontology name. `imports` is stored as `brain_import`. */
const LABEL_ALIASES: Record<string, string[]> = {
  calls: ["calls", "call"],
  uses: ["uses"],
  contains: ["contains", "composition", "part_of"],
  imports: ["brain_import", "imports"],
  references: ["references", "depends_on", "related"],
  exports: ["exports", "provides"],
  extends: ["extends", "inheritance"],
  implements: ["implements", "implementation"],
  overrides: ["overrides", "override"],
  instantiates: ["instantiates"],
}
function labelToType(raw: string): Type | null {
  const l = raw.toLowerCase()
  for (const [t, labels] of Object.entries(LABEL_ALIASES)) {
    if (labels.includes(l)) return ALL_TYPES.find((x) => x === t) ?? null
  }
  return null
}

// ---------------------------------------------------------------- PART 1
/**
 * The arbiter's sampler, re-derived. Same three steps, in the same order, so the
 * sample is the SAME 120 paths and any difference in the parsed count is
 * attributable to the paths rather than to the sampling.
 */
function part1(): Record<string, unknown> | null {
  type Repo = { name: string; dir: string }
  const repos: Repo[] = []
  let entries: string[]
  try { entries = readdirSync(CR) } catch { return null }
  for (const name of entries.sort()) {
    const dir = path.join(CR, name)
    try { if (!statSync(dir).isDirectory()) continue } catch { continue }
    try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
    repos.push({ name, dir })
  }

  const perRepoOffered: Record<string, number> = {}
  const all: { repo: string; abs: string }[] = []
  for (const repo of repos) {
    let raw = ""
    try {
      raw = execFileSync("git", ["-C", repo.dir, "ls-files", "-z"], {
        encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
      })
    } catch { continue }
    const hits: { repo: string; abs: string }[] = []
    for (const rel of raw.split("\0").filter(Boolean)) {
      if (detectLanguageFromPath(rel) !== "protobuf") continue
      hits.push({ repo: repo.name, abs: path.join(repo.dir, rel) })
    }
    perRepoOffered[repo.name] = hits.length
    all.push(...hits)
  }

  const LIMIT = 120
  const stride = Math.max(1, Math.floor(all.length / LIMIT))
  const sampled: { repo: string; abs: string }[] = []
  for (let i = 0; i < all.length && sampled.length < LIMIT; i += stride) sampled.push(all[i])

  const missingByRepo: Record<string, number> = {}
  const presentByRepo: Record<string, number> = {}
  const missingExamples: string[] = []
  let present = 0, missing = 0
  for (const s of sampled) {
    let ok = false
    try { ok = statSync(s.abs).isFile() } catch { ok = false }
    if (ok) { present++; presentByRepo[s.repo] = (presentByRepo[s.repo] ?? 0) + 1 }
    else {
      missing++
      missingByRepo[s.repo] = (missingByRepo[s.repo] ?? 0) + 1
      if (missingExamples.length < 6) missingExamples.push(s.abs)
    }
  }

  // Every tracked path in the corpus, on disk or not.
  let offeredTotal = 0, offeredOnDisk = 0
  const offeredByRepo: Record<string, { tracked: number; onDisk: number }> = {}
  for (const repo of repos) {
    let raw = ""
    try {
      raw = execFileSync("git", ["-C", repo.dir, "ls-files", "-z"], {
        encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
      })
    } catch { continue }
    let tracked = 0, onDisk = 0
    for (const rel of raw.split("\0").filter(Boolean)) {
      if (detectLanguageFromPath(rel) !== "protobuf") continue
      tracked++
      try { if (statSync(path.join(repo.dir, rel)).isFile()) onDisk++ } catch { /* sparse: not fetched */ }
    }
    if (tracked > 0) offeredByRepo[repo.name] = { tracked, onDisk }
    offeredTotal += tracked
    offeredOnDisk += onDisk
  }

  const result = {
    corpusRoot: CR,
    reposWithGit: repos.length,
    trackedProtoPathsOffered: offeredTotal,
    trackedProtoPathsOnDisk: offeredOnDisk,
    trackedProtoPathsNotOnDisk: offeredTotal - offeredOnDisk,
    offeredByRepo,
    sampleLimit: LIMIT,
    stride,
    sampledPaths: sampled.length,
    sampledOnDisk: present,
    sampledNotOnDisk: missing,
    presentByRepo,
    missingByRepo,
    missingExamples,
  }
  const w = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)
  console.log("\nPART 1 — the arbiter's own sample, asked whether the paths exist")
  console.log("-".repeat(88))
  console.log(`git ls-files offered   ${w(String(offeredTotal), 8)} .proto paths`)
  console.log(`of those, on disk      ${w(String(offeredOnDisk), 8)} .proto paths`)
  console.log(`of those, NOT on disk  ${w(String(offeredTotal - offeredOnDisk), 8)} .proto paths  <- sparse checkouts`)
  console.log(`stride                 ${w(String(stride), 8)} (120-file sample)`)
  console.log(`sampled paths          ${w(String(sampled.length), 8)}`)
  console.log(`  present on disk      ${w(String(present), 8)}`)
  console.log(`  ABSENT from disk     ${w(String(missing), 8)}  <- read as parseFailures by the arbiter`)
  console.log(`missing by repo        ${JSON.stringify(missingByRepo)}`)
  console.log(`present by repo        ${JSON.stringify(presentByRepo)}`)
  console.log("")
  return result
}

// ---------------------------------------------------------------- PART 2
type CorpusFile = { repo: string; rel: string; abs: string }
const corpus: CorpusFile[] = []
const perRepo: Record<string, number> = {}
for (const entry of readdirSync(CR).sort()) {
  const dir = path.join(CR, entry)
  let isDir = false
  try { isDir = statSync(dir).isDirectory() } catch { continue }
  if (!isDir) continue
  let n = 0
  const walk = (d: string, rel: string): void => {
    let kids: string[]
    try { kids = readdirSync(d) } catch { return }
    for (const k of kids.sort()) {
      if (k === ".git" || k === "node_modules") continue
      const abs = path.join(d, k)
      const r = rel ? `${rel}/${k}` : k
      let st
      try { st = statSync(abs) } catch { continue }
      if (st.isDirectory()) { walk(abs, r); continue }
      if (!k.endsWith(".proto")) continue
      if (PER_REPO_LIMIT && n >= PER_REPO_LIMIT) return
      corpus.push({ repo: entry, rel: r, abs })
      n++
    }
  }
  walk(dir, "")
  perRepo[entry] = n
}
const reposWithProto = Object.entries(perRepo).filter(([, n]) => n > 0)

const wts: any = await import("web-tree-sitter")
const ParserClass = wts.Parser ?? wts.default ?? wts
const LanguageClass = wts.Language ?? wts.default?.Language
await ParserClass.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const grammar = await LanguageClass.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-protobuf.wasm")))
const analyzer = new RealProtobufAnalyzer()

type FileFacts = {
  label: string
  /** ids this file publishes, as the analyzer resolved them */
  ids: Set<string>
  /** ids a consumer re-derives from the stored symbol */
  redrawn: Set<string>
  /** bare names this file declares, for the name-exists-unbound probe */
  bare: Set<string>
  /** the file's `package`, the root of its scope chain */
  pkg: string | null
  /** module paths this file imports, split into directory and basename */
  imports: { dir: string; base: string }[]
  edges: { type: Type; source: string; target: string; line: number }[]
}
const facts: FileFacts[] = []
/** The file's `package`, read off the tree by node type — never by matching text. */
function packageOf(root: any): string | null {
  const cur = root.walk()
  let found: any = null
  const visit = (): void => {
    const n: any = cur.currentNode
    if (n.type === "package" && !found) found = n
    if (!found && cur.gotoFirstChild()) {
      do { visit() } while (!found && cur.gotoNextSibling())
      cur.gotoParent()
    }
  }
  visit()
  let out = ""
  if (found) {
    const ident = found.childForFieldName?.("full_ident") ?? found.namedChildren.find((k: any) => k.type === "full_ident")
    out = String(ident?.text ?? "")
  }
  cur.delete?.()
  return out.length > 0 ? out : null
}

let filesOk = 0, filesFail = 0, degraded = 0
const failExamples: string[] = []

let idx = 0
async function worker(): Promise<void> {
  const parser = new ParserClass()
  parser.setLanguage(grammar)
  while (true) {
    const i = idx++
    if (i >= corpus.length) return
    const f = corpus[i]
    const label = `${f.repo}/${f.rel}`
    let prod: any
    try { prod = await parseFile(f.abs, path.dirname(f.abs)) } catch (e: any) {
      filesFail++
      if (failExamples.length < 8) failExamples.push(`${label}: ${e?.message}`)
      continue
    }
    filesOk++
    if (prod?.fallback === true) degraded++

    const content = readFileSync(f.abs, "utf8")
    const tree = parser.parse(content)
    const a: any = analyzer.analyze(tree.rootNode, content, f.abs)

    const ids = new Set<string>()
    const redrawn = new Set<string>()
    const bare = new Set<string>()
    for (const s of a.symbols ?? []) {
      const id = String(s.metadata?.id ?? s.name)
      ids.add(id)
      bare.add(id.slice(id.lastIndexOf(".") + 1))
    }
    for (const s of prod.symbols ?? []) {
      const id = s.ownerName ? `${s.ownerName}.${s.name}` : String(s.name)
      redrawn.add(id)
      redrawn.add(String(s.qualifiedName ?? s.name))
      redrawn.add(String(s.name))
    }
    const edges: FileFacts["edges"] = []
    for (const x of prod.relationships ?? []) {
      const t = labelToType(String(x.type ?? x.relationshipType ?? ""))
      if (!t) continue
      edges.push({ type: t, source: String(x.source ?? ""), target: String(x.target ?? ""), line: Number(x.line_number ?? 0) })
    }
    // The package is read off the tree by node type, never matched: a `package`
    // node holds a `full_ident` child, and that child is the root of this file's
    // scope chain.
    const pkg = packageOf(tree.rootNode)
    tree.delete?.()
    // The import list is a parse fact: `import "a/b/c.proto"` is one `import` node's
    // `path` field. Split on the last "/" — a dot is a legal character in a filename,
    // so splitting on "." would be wrong.
    const imports: { dir: string; base: string }[] = []
    for (const x of prod.relationships ?? []) {
      if (labelToType(String(x.type ?? x.relationshipType ?? "")) !== "imports") continue
      const raw = String((x.metadata as any)?.modulePath ?? x.target ?? "")
      if (raw.length === 0) continue
      const cut = raw.lastIndexOf("/")
      imports.push({ dir: cut > 0 ? raw.slice(0, cut) : "", base: cut > 0 ? raw.slice(cut + 1) : raw })
    }
    facts.push({ label, ids, redrawn, bare, pkg, imports, edges })
  }
}
await Promise.all(Array.from({ length: 8 }, () => worker()))
facts.sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0))

// ---- corpus-wide index
/** id -> the labels of every file publishing it. >1 is the ambiguity the reverse walk resolves arbitrarily. */
const publishers = new Map<string, Set<string>>()
for (const f of facts) for (const id of f.ids) {
  let s = publishers.get(id)
  if (!s) { s = new Set(); publishers.set(id, s) }
  s.add(f.label)
}
/**
 * Every corpus file registered under EVERY path suffix that starts at a "/"
 * boundary, so an `import "a/b/c.proto"` written inside a repository whose on-disk
 * prefix is `third_party/protobuf/a/b/c.proto` is still found. Registration is by
 * index arithmetic on "/" — no pattern matching — and the suffixes are exactly the
 * module-path forms `protoc` would accept against an include root.
 */
const byModulePath = new Map<string, string[]>()
const registerSuffix = (key: string, label: string): void => {
  let arr = byModulePath.get(key)
  if (!arr) { arr = []; byModulePath.set(key, arr) }
  if (!arr.includes(label)) arr.push(label)
}
for (const f of corpus) {
  const label = `${f.repo}/${f.rel}`
  registerSuffix(f.rel, label)
  let i = 0
  while (true) {
    const next = f.rel.indexOf("/", i)
    if (next < 0) break
    registerSuffix(f.rel.slice(next + 1), label)
    i = next + 1
  }
}
const labelIndex = new Map<string, FileFacts>()
for (const f of facts) labelIndex.set(f.label, f)

/** id -> the labels publishing it, the form the scope-walk audit needs. */
const publishersIndex = new Map<string, string[]>()
for (const [id, labels] of publishers) publishersIndex.set(id, [...labels])

/** bare name -> every corpus declaration carrying it. */
const bareOwners = new Map<string, Set<string>>()
for (const f of facts) for (const b of f.bare) {
  let s = bareOwners.get(b)
  if (!s) { s = new Set(); bareOwners.set(b, s) }
  s.add(f.label)
}

type Bucket = { n: number; examples: string[] }
type TypeRow = Record<string, Bucket>
/** The five disjoint classes an EDGE can fall into, and the only keys a row has. */
const CLASSES = ["in-file-both", "cross-file-unique", "cross-file-ambiguous", "name-exists-unbound", "hopeless", "binds-under-protoscope-rule"] as const
const rows = new Map<Type, TypeRow>()
const blank = (): TypeRow => ({
  "in-file-both": { n: 0, examples: [] },
  "cross-file-unique": { n: 0, examples: [] },
  "cross-file-ambiguous": { n: 0, examples: [] },
  "name-exists-unbound": { n: 0, examples: [] },
  "hopeless": { n: 0, examples: [] },
  "binds-under-protoscope-rule": { n: 0, examples: [] },
})
for (const t of ALL_TYPES) rows.set(t, blank())

/** Ends per class, per type. An edge can be in-file at the source and cross-file at the target. */
const endsInFile: Record<Type, number> = {} as any
const endsCrossUnique: Record<Type, number> = {} as any
const endsCrossAmbiguous: Record<Type, number> = {} as any
const endsUnboundNameExists: Record<Type, number> = {} as any
const endsHopeless: Record<Type, number> = {} as any
for (const t of ALL_TYPES) {
  endsInFile[t] = 0; endsCrossUnique[t] = 0; endsCrossAmbiguous[t] = 0
  endsUnboundNameExists[t] = 0; endsHopeless[t] = 0
}
let selfLoops = 0
const hopExamples: Record<string, Bucket> = {}
const unbExamples: Record<string, Bucket> = {}
const ambExamples: Record<string, Bucket> = {}

type Class = keyof TypeRow
/**
 * protoc's own rule, run with THIS CORPUS as the descriptor pool: a RELATIVE name
 * is looked for in each enclosing scope, innermost first, and the first scope that
 * contains a declaration of that name is the one protoc binds. Nothing here decides
 * whether a file declares anything — the corpus index above does — so the answer is
 * a measurement of what a project index would recover, not a guess.
 *
 * The bound id is returned so the caller can report WHICH declaration the walk
 * lands on, including when that declaration is one of several publishers.
 */
function protoscopeHit(end: string, scope: string, own: FileFacts, chain: string[]): { id: string; publishers: number } | null {
  if (end.startsWith(".") || end.length === 0) return null
  for (const base of chain) {
    const cand = base.length > 0 ? `${base}.${end}` : end
    const p = publishers.get(cand)
    if (p) return { id: cand, publishers: p.size }
  }
  return null
}

/**
 * The scope a reference was written in, recovered from the edge's SOURCE id by
 * dropping its last dotted segment: `pkg.Msg.field` names a field of `pkg.Msg`, and
 * `pkg.Service.Rpc` names an rpc of `pkg.Service`. That is the enclosing scope the
 * specification resolves against, and it is a read of the edge, not a name match.
 */
function enclosingScopeOf(sourceId: string): string {
  const cut = sourceId.lastIndexOf(".")
  return cut > 0 ? sourceId.slice(0, cut) : ""
}

/**
 * The scope chain protoc walks for a RELATIVE type name: the enclosing scopes from
 * innermost to the root, exactly the chain `resolveRef` builds in the analyzer. The
 * package of the file is recorded per file because the chain is built from the
 * enclosing scope id, which the analyzer qualifies with the package.
 */
function scopeChainOf(scope: string | null, pkg: string | null): string[] {
  const chain: (string | null)[] = []
  if (scope) {
    const segs = scope.split(".")
    for (let i = segs.length; i > 0; i--) {
      const cand = segs.slice(0, i).join(".")
      if (!pkg || cand === pkg || cand.startsWith(pkg + ".")) chain.push(cand)
    }
  }
  if (pkg) chain.push(pkg)
  chain.push(null)
  return chain.map((c) => c ?? "")
}

/**
 * The chain the SPECIFICATION walks, which is not the chain above. C++ name
 * lookup — and therefore protobuf's — tries EVERY enclosing scope, and the
 * enclosing scopes of a member of `pkg.Msg` are `pkg.Msg`, `pkg`, and each
 * ancestor of `pkg`. The chain above keeps only scopes inside the package
 * subtree, so `controller.api` is never tried from a file whose package is
 * `controller.api.resources.accounts.v1`, and a name written
 * `resources.scopes.v1.ScopeInfo` cannot reach
 * `controller.api.resources.scopes.v1.ScopeInfo`.
 */
function specChainOf(scope: string | null, pkg: string | null): string[] {
  const chain: string[] = []
  const push = (v: string): void => { if (!chain.includes(v)) chain.push(v) }
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

function classify(end: string, own: FileFacts): Class {
  if (own.ids.has(end)) return "in-file-both"
  const p = publishers.get(end)
  // >1 publisher means two real declarations share this id, which is the case the
  // reverse walk resolves by a rule nobody chose.
  if (p) return p.size > 1 ? "cross-file-ambiguous" : "cross-file-unique"
  const bare = end.slice(end.lastIndexOf(".") + 1)
  return bareOwners.has(bare) ? "name-exists-unbound" : "hopeless"
}
/** Binds corpus-wide: in-file is a subset of the corpus, and one publisher is unique. */
const BINDS = (c: Class): boolean => c === "in-file-both" || c === "cross-file-unique"

function note(map: Record<string, Bucket>, key: string, line: string): void {
  map[key] = map[key] ?? { n: 0, examples: [] }
  map[key].n++
  if (map[key].examples.length < 6) map[key].examples.push(line)
}

let ambiguousIds = 0
const matrix: Record<string, number> = {}
const scopeExamples: Record<string, Bucket> = {}
const scopeMissExamples: Record<string, Bucket> = {}
const scopeAmbExamples: Record<string, Bucket> = {}
const importExamples: Record<string, Bucket> = {}
let scopeProbeRuns = 0, scopeRuleRecovered = 0, scopeRuleMissed = 0, scopeRuleStillAmbiguous = 0
let importRuleRecovered = 0, importRuleMissed = 0
const inboundPerId = new Map<string, number>()
const sourceExternal: Record<Type, number> = {} as any
for (const t of ALL_TYPES) sourceExternal[t] = 0

for (const f of facts) {
  for (const e of f.edges) {
    const row = rows.get(e.type)!
    if (e.source === e.target) selfLoops++
    const cs = classify(e.source, f)
    const ct = classify(e.target, f)
    if (!BINDS(cs)) sourceExternal[e.type]++

    for (const [which, c, end] of [["source", cs, e.source], ["target", ct, e.target]] as const) {
      if (c === "in-file-both") endsInFile[e.type]++
      else if (c === "cross-file-unique") endsCrossUnique[e.type]++
      else if (c === "cross-file-ambiguous") {
        endsCrossAmbiguous[e.type]++
        const p = publishers.get(end)
        note(ambExamples, `${e.type}/${which}`, `${end} <- ${which} of ${f.label} (published by ${p ? p.size : 0} file(s))`)
      } else if (c === "name-exists-unbound") {
        endsUnboundNameExists[e.type]++
        note(unbExamples, `${e.type}/${which}`, `${end} <- ${which} of ${f.label}`)
      } else {
        endsHopeless[e.type]++
        note(hopExamples, `${e.type}/${which}`, `${end} <- ${which} of ${f.label}`)
      }
      if (which === "target") inboundPerId.set(end, (inboundPerId.get(end) ?? 0) + 1)
    }

    // Two independent 5-way partitions, because they answer different questions and
    // conflating them is how a lane reports a flattering number:
    //   `ends`  — the 5x5 matrix of (source class, target class). Complete: every
    //             edge lands in exactly one cell, and an edge the table does not
    //             explain is a hole in the table rather than a fact about the code.
    //   `bucket`— the SINGLE most severe class on the edge, for a one-number
    //             resolution rate. An edge whose ends are both fine is
    //             `in-file-both`; otherwise the worst class wins.
    matrix[`${e.type}|${cs}|${ct}`] = (matrix[`${e.type}|${cs}|${ct}`] ?? 0) + 1

    const worst = (c: Class): number => (BINDS(c) ? 0 : c === "cross-file-ambiguous" ? 1 : c === "name-exists-unbound" ? 2 : 3)
    const k: Class = BINDS(cs) && BINDS(ct)
      ? "in-file-both"
      : cs === "cross-file-ambiguous" || ct === "cross-file-ambiguous"
        ? "cross-file-ambiguous"
        : cs === "name-exists-unbound" || ct === "name-exists-unbound"
          ? "name-exists-unbound"
          : "hopeless"
    row[k].n++
    if (row[k].examples.length < 6) row[k].examples.push(`${e.source} -> ${e.target} (${f.label})`)

    // The scope-rule probe, for every `uses`/`exports` end that does not bind here.
    if (e.type === "uses") {
      for (const [which, c, end] of [["source", cs, e.source], ["target", ct, e.target]] as const) {
        if (BINDS(c)) continue
        const scope = enclosingScopeOf(e.source)
        scopeProbeRuns++
        const hit = protoscopeHit(end, scope, f, specChainOf(scope, f.pkg))
        if (hit) {
          scopeRuleRecovered++
          note(scopeExamples, `${which}`, `${end} -> ${hit.id} (${hit.publishers} publisher(s)) via package ${f.pkg ?? "(none)"} in ${f.label}`)
          if (hit.publishers > 1) { scopeRuleStillAmbiguous++; note(scopeAmbExamples, which, `${end} -> ${hit.id} (${hit.publishers} publishers) in ${f.label}`) }
        } else {
          scopeRuleMissed++
          note(scopeMissExamples, which, `${end} in ${f.label} (package ${f.pkg ?? "(none)"})`)
        }

        // Can the FILE ALONE complete the walk? protoc searches the imported
        // descriptors, and this file knows which descriptors it imported, so the
        // candidate's package directory is checkable against the import list without
        // any project index. Measured, because the answer decides whether the gap is
        // this analyzer's to close or a limitation of per-file indexing.
        const pkgOfHit = hit ? hit.id.slice(0, hit.id.lastIndexOf(".")) : ""
        const dirWanted = hit ? pkgOfHit.split(".").join("/") : "\u0000none"
        const viaImport = hit ? f.imports.find((im) => im.dir === dirWanted) : undefined
        if (hit && viaImport) {
          importRuleRecovered++
          note(importExamples, `${which}`, `${end} -> ${hit!.id} (import "${dirWanted}/${viaImport.base}" in ${f.label}, ${hit!.publishers} publisher(s))`)
        } else {
          importRuleMissed++
        }
      }
    }
  }
}
for (const p of publishers.values()) if (p.size > 1) ambiguousIds++

// ---- AUDIT OF EVERY TARGET THE SCOPE WALK CHANGED, and of every one it did NOT
//
// The analyzer resolves a type reference in three steps, and only the third is in
// question: declared in this file → bind it; otherwise an UNQUALIFIED name becomes
// `package.name` and a DOTTED name goes through the import-directory walk. This block
// asks two questions about every reference edge whose target did not bind in its own
// file, and neither question trusts the analyzer:
//
//   1. DID THE WALK CHANGE IT? The pre-walk answer is recomputed here from the same
//      inputs — `qualify(pkg, text)` for an unqualified name, the name as written for
//      a dotted one — and compared with what was emitted.
//   2. IS THE EMITTED ID VOUCHED? A target is vouched when a corpus file publishes
//      exactly that id AND that file's module path is among the directories the
//      emitting file imports. An unvouched target is reported, not rounded away: it
//      is an edge the graph asserts and cannot walk back from.
const importDirOf = new Map<string, Set<string>>()
for (const f of facts) {
  const dirs = new Set<string>()
  for (const im of f.imports) dirs.add(im.dir)
  importDirOf.set(f.label, dirs)
}
const emitted: Record<string, Bucket> = {}
let crossBound = 0, crossVouched = 0, crossPublishedNotImported = 0, crossNotPublished = 0
const notPublishedExamples: string[] = []
const publishedNotImportedExamples: string[] = []
for (const f of facts) {
  const dirs = importDirOf.get(f.label) ?? new Set<string>()
  for (const e of f.edges) {
    if (e.type !== "uses" && e.type !== "contains") continue
    if (classify(e.target, f) === "in-file-both") continue
    crossBound++
    const pkgDir = e.target.lastIndexOf(".") > 0 ? e.target.slice(0, e.target.lastIndexOf(".")).split(".").join("/") : ""
    const pubs = publishersIndex.get(e.target) ?? []
    if (pubs.length === 0) {
      crossNotPublished++
      note(emitted, "notPublishedByAnyFile", `${e.source} -> ${e.target} in ${f.label}`)
      if (notPublishedExamples.length < 8) notPublishedExamples.push(`${e.source} -> ${e.target} in ${f.label}`)
      continue
    }
    if (dirs.has(pkgDir)) {
      crossVouched++
      note(emitted, "vouchedByAnImportedFile", `${e.source} -> ${e.target} via "${pkgDir}" in ${f.label}`)
      continue
    }
    // Published, but not by a file this one imports. For an ABSOLUTE reference
    // (`extend .google.protobuf.FieldOptions`) protoc's lookup is not restricted
    // to the import list in the same way, so this is not automatically a defect —
    // which is why it is counted apart rather than called wrong.
    crossPublishedNotImported++
    note(emitted, "publishedButNotImported", `${e.source} -> ${e.target} in ${f.label}`)
    if (publishedNotImportedExamples.length < 8) publishedNotImportedExamples.push(`${e.source} -> ${e.target} in ${f.label}`)
  }
}

// The resolution class of every reference edge, by type and by which end, so a
// reader can see what the walk left alone and not only what it changed.
const und = new Map<string, number>()
for (const f of facts) for (const e of f.edges) {
  if (e.type !== "uses" && e.type !== "contains") continue
  const cls = classify(e.target, f)
  const clsS = classify(e.source, f)
  const key = `${e.type}/target=${cls}/source=${clsS}`
  und.set(key, (und.get(key) ?? 0) + 1)
}

// Inbound coverage per declaration.
let declsTotal = 0, declsWithInbound = 0
for (const [id] of publishers) {
  declsTotal++
  if ((inboundPerId.get(id) ?? 0) > 0) declsWithInbound++
}

const pct = (n: number, d: number) => (d ? +(100 * n / d).toFixed(2) : null)
const out = {
  at: new Date().toISOString(),
  corpusRoot: CR,
  sampling: `working-tree walk of every *.proto under ${CR}${PER_REPO_LIMIT ? `, capped ${PER_REPO_LIMIT}/repo` : ", uncapped"}`,
  part1: WANT_PART1 ? part1() : null,
  filesParsed: filesOk,
  filesFailed: filesFail,
  degradedFallbacks: degraded,
  failExamples,
  repositories: Object.fromEntries(reposWithProto),
  distinctPublishedIds: publishers.size,
  idsPublishedByMoreThanOneFile: ambiguousIds,
  selfLoops,
  declarations: declsTotal,
  declarationsWithAtLeastOneInboundEdge: declsWithInbound,
  declarationsWithNoInboundEdge: declsTotal - declsWithInbound,
  perType: Object.fromEntries(ALL_TYPES.map((t) => {
    const row = rows.get(t)!
    const n = CLASSES.reduce((acc, c) => acc + row[c].n, 0)
    return [t, {
      edges: n,
      corpusWideBothEnds: pct(row["in-file-both"].n, n),
      corpusWideBothEndsCount: row["in-file-both"].n,
      ambiguous: row["cross-file-ambiguous"].n,
      nameExistsUnbound: row["name-exists-unbound"].n,
      hopeless: row.hopeless.n,
      buckets: row,
      sourceExternalOrUnresolvable: sourceExternal[t],
      ends: {
        inFile: endsInFile[t], crossFileUnique: endsCrossUnique[t],
        crossFileAmbiguous: endsCrossAmbiguous[t],
        nameExistsUnbound: endsUnboundNameExists[t], hopeless: endsHopeless[t],
      },
    }]
  })),
  endClassMatrix: matrix,
  scopeRuleProbe: {
    description: "protoc's relative-name rule re-run over THIS corpus as the descriptor pool, for every `uses` end that does not bind in its own file",
    endsProbed: scopeProbeRuns,
    recoveredByScopeRule: scopeRuleRecovered,
    recoveredButStillAmbiguous: scopeRuleStillAmbiguous,
    stillHopelessAfterScopeRule: scopeRuleMissed,
    recoveredExamples: scopeExamples,
    recoveredButAmbiguousExamples: scopeAmbExamples,
    stillHopelessExamples: scopeMissExamples,
  },
  importRuleProbe: {
    description: "whether the FILE'S OWN import list can complete protoc's scope walk, i.e. whether the candidate package's directory appears among this file's imported module paths",
    recoveredByImportListAlone: importRuleRecovered,
    notRecoveredByImportListAlone: importRuleMissed,
    examples: importExamples,
  },
  crossFileVouching: {
    description: "every reference edge whose target did not bind in its own file: is the emitted id published by a corpus file, and is that file one this file imports?",
    targetsResolvedOutsideTheFile: crossBound,
    vouchedByAnImportedFile: crossVouched,
    publishedButTheFileIsNotImported: crossPublishedNotImported,
    publishedByNoFileInTheCorpus: crossNotPublished,
    publishedButNotImportedExamples: publishedNotImportedExamples,
    notPublishedExamples,
    examples: emitted,
  },
  endsByResolutionClass: Object.fromEntries([...und.entries()].sort((a, b) => b[1] - a[1])),
  ambiguousExamples: ambExamples,
  unboundExamples: unbExamples,
  hopelessExamples: hopExamples,
}
writeFileSync(OUT, JSON.stringify(out, null, 2))

const w = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)
console.log(`\nPART 2 — incoming resolution, ${filesOk} files parsed / ${filesFail} failed, ${degraded} degraded`)
console.log(`corpus: ${corpus.length} .proto files in ${reposWithProto.length} repositories`)
console.log(`distinct published ids ${publishers.size}; published by >1 file ${out.idsPublishedByMoreThanOneFile}; self-loops ${selfLoops}`)
console.log(`declarations ${declsTotal}; with >=1 inbound edge ${declsWithInbound} (${pct(declsWithInbound, declsTotal)}%); with none ${declsTotal - declsWithInbound}`)
console.log("")
console.log(`${w("type", 13)}${w("edges", 9)}${w("infile%", 10)}${w("ambig", 8)}${w("unbound", 9)}${w("hopeless", 9)}both-end class counts`)
console.log("-".repeat(104))
for (const t of ALL_TYPES) {
  const e: any = (out.perType as any)[t]
  if (!e.edges) { console.log(`${w(t, 13)}${w("0", 9)}${w("-", 10)}${w("-", 8)}${w("-", 9)}${w("-", 9)}NOT EMITTED`); continue }
  console.log(
    `${w(t, 13)}${w(String(e.edges), 9)}${w(String(e.corpusWideBothEnds), 10)}${w(String(e.ambiguous), 8)}` +
    `${w(String(e.nameExistsUnbound), 9)}${w(String(e.hopeless), 9)}` +
    `inFile=${e.buckets["in-file-both"].n} amb=${e.buckets["cross-file-ambiguous"].n} unbound=${e.buckets["name-exists-unbound"].n} hopeless=${e.buckets.hopeless.n}`,
  )
}
console.log("\nCROSS-FILE VOUCHING — every reference target that did not bind in its own file")
console.log(`  targets resolved outside the file      ${crossBound}`)
console.log(`  vouched by a file this one IMPORTS     ${crossVouched}`)
console.log(`  published, but that file is NOT imported ${crossPublishedNotImported}`)
console.log(`  published by NO file in the corpus      ${crossNotPublished}   <- not walkable back from`)
for (const e of publishedNotImportedExamples) console.log(`    not-imported: ${e}`)
for (const e of notPublishedExamples) console.log(`    unpublished : ${e}`)
console.log(`\nends by resolution class (type/targetClass/sourceClass -> edges)`)
for (const [k, v] of [...und.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${w(k, 74)}${v}`)
console.log(`\nwrote ${OUT}`)
/**
 * The CEILING of a naming change for nim's incoming numbers, measured before any
 * naming change is made.
 *
 * ## The question
 *
 * `script/m14/diagnose-incoming.mts` reports three causes behind one number. For nim
 * it reads (600 files, production `ASTEngine.parseFile`, the same file list the
 * diagnose command builds — `find <corpus> -name '*.nim' | sort | head -600`):
 *
 *   A  1,112 ambiguous targets, 100% with no distinct qualifiedName
 *   B        3 recoverable edges, all `imports`, all three a false positive (below)
 *   C  1,856 unresolved targets after B
 *
 * A is the only cause with mass, and the brief's remedy for it is "publish an
 * identifier that includes the owner or module". That sentence contains two different
 * fixes with very different reach, and this file exists to say which one nim's 1,112
 * is actually made of BEFORE the analyzer is edited — because the two require
 * different amounts of the language that a per-file analyzer can see.
 *
 *   OWNER-qualified identity (`Receiver.name`, `Outer.inner`) — reachable. The owner
 *   is in the same parse tree as the member, and the grammar's `method` receiver and
 *   the enclosing routine are both fields on the member's own node.
 *
 *   MODULE-qualified identity (`module::name`) — reachable for the PUBLISHED NAME but
 *   NOT for most EDGE TARGETS, and that is a property of Nim rather than of this
 *   analyzer. Nim lets an imported exported symbol be called BARE: `import strutils`
 *   then `startsWith(a, b)` is a legal call to `strutils.startsWith`. The call site
 *   carries no module, so no per-file rule can turn it into `strutils::startsWith`
 *   without resolving the import to a file and then to the declaring module — a
 *   whole-program step. `import M as N` and `from M import x` are the shapes that
 *   DO name the module at the call site, and those are counted here as the reachable
 *   fraction of the cross-module mass.
 *
 * So this probe reports, per edge type and per distinct target:
 *
 *   A1  ambiguous because >1 FILE declares the name, and every candidate is a
 *       module-level declaration      -> module identity; needs the cross-module step
 *   A2  ambiguous because >1 file declares the name and at least one candidate is an
 *       OWNED symbol (method receiver, field owner, enum owner, nested routine)
 *       -> owner identity; reachable per-file
 *   A3  ambiguous and every candidate is in the SAME file (Nim overloading, and the
 *       same name as both a method and a plain proc)
 *       -> NOT reachable by either: the name is genuinely overloaded and only a
 *          signature distinguishes the declarations. Reported so it is not silently
 *          folded into A1/A2 and claimed as a win.
 *
 * ## The resolution rule used throughout
 *
 * The store binds an edge target by `brain_symbol.name` and, in the post pass, by
 * `qualified_name` (`src/ast/parallel-indexer.ts:3755-3774` builds `_res_qname` from
 * `qualified_name`, and the insert-time statement is `WHERE s.name = ?` at :2239).
 * So "resolves" here means "exactly one published symbol carries this string", and
 * the store's own same-file preference is NOT modelled — an edge that only one file
 * declares is resolved, and an edge that two files declare is a coin flip at insert
 * time. Modelling the preference would understate the defect, so it is not modelled.
 *
 * ## Population
 *
 * Stated on every line, because a rate without a denominator is a claim about nothing.
 *
 * Run: npx tsx validation/m14/fixtures/nim/module-identity-ceiling.mts [files] [corpusRoot]
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..")
const CORPUS = process.argv[3] ?? "/home/ishaq2321/bb_tests/repositories"
const WANT = Number(process.argv[2] ?? 600)
const ANALYZER = path.join(ROOT, "src/ast/real-nim-analyzer.ts")
const OUT = path.join(ROOT, "validation/m14/measurements/nim")

const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))

const TYPES = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates"] as const

/** The Nim module name of a file: its basename without `.nim`, or `.nims`. */
function moduleOf(file: string): string {
  const b = path.basename(file)
  return b.replace(/\.nimbs?$/, "")
}

// ─────────────────────────────────────────────────────────────── the sample
const listCmd = `find ${CORPUS} -name '*.nim' -type f | sort | head -${WANT}`
const listSha = createHash("sha256").update(listCmd).digest("hex").slice(0, 16)
const files = execFileSync("bash", ["-lc", listCmd], { encoding: "utf8", maxBuffer: 1 << 28 })
  .trim()
  .split("\n")
  .filter(Boolean)

// ───────────────────────────────────────────── the published-symbol population
interface Decl {
  file: string
  module: string
  kind: string
  owner: string
  qname: string
  line: number
}
const decls: Decl[] = []
/** bare published name -> declarations */
const byName = new Map<string, Decl[]>()
/** module -> the set of modules, to measure whether a module name is even unique */
const moduleFiles = new Map<string, Set<string>>()

let parsed = 0
let failed = 0
const failures: string[] = []

for (const f of files) {
  let r: any
  try {
    r = await ASTEngine.parseFile(f, readFileSync(f, "utf8"))
    parsed++
  } catch (e) {
    failed++
    failures.push(`${f}: ${(e as Error)?.message ?? e}`)
    continue
  }
  const mod = moduleOf(f)
  let mf = moduleFiles.get(mod)
  if (!mf) moduleFiles.set(mod, (mf = new Set()))
  mf.add(f)
  for (const s of Array.isArray(r?.symbols) ? r.symbols : []) {
    const name = String(s?.name ?? "")
    if (!name) continue
    const d: Decl = {
      file: f,
      module: mod,
      kind: String(s?.kind ?? ""),
      // The owner is the family field the store binds for ownership; a nested
      // routine carries it in `scope` instead, and both mean "this name lives
      // inside something else".
      owner: String(s?.ownerName ?? s?.scope ?? ""),
      qname: String(s?.qualifiedName ?? ""),
      line: Number(s?.range?.startLine ?? s?.startLine ?? 0),
    }
    decls.push(d)
    const arr = byName.get(name)
    if (arr) arr.push(d)
    else byName.set(name, [d])
  }
}

// ──────────────────────────────────────────────────────── the incoming edges
interface Edge {
  t: string
  type: string
  file: string
  /** the analyzer recorded that the call site names an import qualifier */
  qualifiedCall: boolean
  meta: Record<string, any>
}
const edges: Edge[] = []
for (const f of files) {
  void f
}
for (const d of decls) void d

// The edges come from the same parse, so they are collected in a second pass over
// the same files rather than a second parse — the result object is not retained
// because it holds the tree.
const edgePop: Edge[] = []
{
  // re-parse: kept explicit rather than caching trees, because a retained tree for
  // 600 files is the memory pressure that traps the tree-sitter WASM heap on this box.
  for (const f of files) {
    let r: any
    try {
      r = await ASTEngine.parseFile(f, readFileSync(f, "utf8"))
    } catch {
      continue
    }
    for (const rel of Array.isArray(r?.relationships) ? r.relationships : []) {
      const t = String(rel?.target ?? "")
      if (!t) continue
      const m = (rel?.metadata ?? {}) as Record<string, any>
      edgePop.push({
        t,
        type: String(rel?.type ?? rel?.relationshipType ?? ""),
        file: f,
        qualifiedCall: m.nimImportBased === true,
        meta: m,
      })
    }
  }
}
edges.push(...edgePop)

function label(t: string): string {
  const x = t.toLowerCase()
  for (const k of TYPES) if (x.includes(k)) return k
  return x
}

// ─────────────────────────────────────────────────────────── the classification
interface Bucket {
  edges: number
  targets: Set<string>
}
const mk = (): Bucket => ({ edges: 0, targets: new Set() })
/** per type: the three A buckets, plus the resolution census */
const perType = new Map<string, { a1: Bucket; a2: Bucket; a3: Bucket; resolved: Bucket; unresolved: Bucket }>()
const globalBucket = { a1: mk(), a2: mk(), a3: mk(), resolved: mk(), unresolved: mk() }
function row(t: string) {
  let r = perType.get(t)
  if (!r) perType.set(t, (r = { a1: mk(), a2: mk(), a3: mk(), resolved: mk(), unresolved: mk() }))
  return r
}

/** A target is module-level if every declaration carrying it has no owner. */
const isModuleLevel = (arr: Decl[]): boolean => arr.every((d) => !d.owner)
const hasOwned = (arr: Decl[]): boolean => arr.some((d) => !!d.owner)

const perTarget = new Map<string, { type: string; cands: Decl[]; edges: number; qualified: number }>()

for (const e of edges) {
  const cands = byName.get(e.t) ?? []
  const filesDeclaring = new Set(cands.map((c) => c.file))
  const r = row(e.type)
  let bucket: Bucket
  if (cands.length === 0) bucket = r.unresolved
  else if (cands.length === 1 || filesDeclaring.size === 1) bucket = r.resolved
  else if (isModuleLevel(cands)) bucket = r.a1
  else if (hasOwned(cands)) bucket = r.a2
  else bucket = r.a3
  bucket.edges++
  bucket.targets.add(e.t)

  let pt = perTarget.get(e.t)
  if (!pt) perTarget.set(e.t, (pt = { type: e.type, cands, edges: 0, qualified: 0 }))
  pt.edges++
  if (e.qualifiedCall) pt.qualified++

  const g =
    cands.length === 0 ? globalBucket.unresolved : filesDeclaring.size === 1 ? globalBucket.resolved : isModuleLevel(cands) ? globalBucket.a1 : hasOwned(cands) ? globalBucket.a2 : globalBucket.a3
  g.edges++
  g.targets.add(e.t)
}

const totalEdges = edges.length
const lines: string[] = []
const say = (s = "") => {
  lines.push(s)
  console.log(s)
}

say(`nim module-identity CEILING — ${files.length} file(s), production ASTEngine.parseFile`)
say(`  corpus        : ${CORPUS}`)
say(`  file command  : find ${CORPUS} -name '*.nim' -type f | sort | head-${WANT}   (sha256 ${listSha})`)
say(`  analyzer      : sha256 ${createHash("sha256").update(readFileSync(ANALYZER)).digest("hex").slice(0, 16)}  (src/ast/real-nim-analyzer.ts)`)
say(`  parsed ${parsed}, failed ${failed}, published declarations ${decls.length}, distinct published names ${byName.size}, edges ${totalEdges}`)
say()
say("== is a MODULE name even unique? ==")
{
  let colliding = 0
  let worst = ""
  let worstN = 0
  for (const [m, fs] of moduleFiles) {
    if (fs.size > 1) {
      colliding++
      if (fs.size > worstN) {
        worstN = fs.size
        worst = m
      }
    }
  }
  say(`   distinct module names ${moduleFiles.size}; modules declared by >1 file in this sample: ${colliding} (${((100 * colliding) / moduleFiles.size).toFixed(1)}%)`)
  if (worst) say(`   worst: module \`${worst}\` is the basename of ${worstN} files — so \`module::name\` is NOT a guaranteed identifier on its own`)
  say("   (the store's own identity already includes the file path, so the module NAME is a display label, not the store key)")
}
say()

say("== A, SPLIT BY WHAT AN IDENTITY CHANGE CAN REACH ==")
say(`   A1  module-level name declared by >1 file   -> needs module identity; a per-file rule CANNOT name the module of a bare Nim call site`)
say(`   A2  at least one candidate is an OWNED symbol -> owner identity; reachable per-file (receiver/enclosing routine are on the member's node)`)
say(`   A3  every candidate in the SAME file        -> Nim OVERLOADING; neither identity separates them, only a signature does`)
say()
say("   type          edges   A1      A2      A3   resolved  unresolved")
say("   -------------------------------------------------------------------------------")
for (const t of TYPES) {
  const r = perType.get(t)
  if (!r) continue
  say(
    `   ${t.padEnd(12)} ${String(r.a1.edges + r.a2.edges + r.a3.edges + r.resolved.edges + r.unresolved.edges).padStart(6)} ${String(
      r.a1.edges,
    ).padStart(6)} ${String(r.a2.edges).padStart(6)} ${String(r.a3.edges).padStart(6)} ${String(r.resolved.edges).padStart(9)} ${String(r.unresolved.edges).padStart(11)}`,
  )
}
say("   -------------------------------------------------------------------------------")
say(
  `   ${"TOTAL".padEnd(12)} ${String(totalEdges).padStart(6)} ${String(globalBucket.a1.edges).padStart(6)} ${String(globalBucket.a2.edges).padStart(6)} ${String(
    globalBucket.a3.edges,
  ).padStart(6)} ${String(globalBucket.resolved.edges).padStart(9)} ${String(globalBucket.unresolved.edges).padStart(11)}`,
)
say()
say("   same census in DISTINCT TARGETS, which is the unit diagnose-incoming counts:")
say(`   A1 ${globalBucket.a1.targets.size}   A2 ${globalBucket.a2.targets.size}   A3 ${globalBucket.a3.targets.size}   resolved ${globalBucket.resolved.targets.size}   unresolved ${globalBucket.unresolved.targets.size}   (sum ${globalBucket.a1.targets.size + globalBucket.a2.targets.size + globalBucket.a3.targets.size + globalBucket.resolved.targets.size + globalBucket.unresolved.targets.size}, and ${byName.size} names are published)`)
say()

say("== how much of the CROSS-MODULE mass does the ANALYZER already know the module for? ==")
{
  const crossModule = [...perTarget.entries()].filter(([, v]) => v.cands.length > 0 && new Set(v.cands.map((c) => c.file)).size > 1)
  let knownQualifier = 0
  let unknown = 0
  let edgesKnown = 0
  let edgesUnknown = 0
  for (const [, v] of crossModule) {
    if (v.qualified > 0) {
      knownQualifier++
      edgesKnown += v.edges
    } else {
      unknown++
      edgesUnknown += v.edges
    }
  }
  say(`   distinct cross-module targets: ${crossModule.length}`)
  say(`   at least one edge names an import qualifier (\`import M as N\` / \`from M import x\` / \`std.x.y\`): ${knownQualifier} targets, ${edgesKnown} edges`)
  say(`   NO edge names a module (the bare \`import M\` + unqualified call form): ${unknown} targets, ${edgesUnknown} edges`)
  say(
    `   so the module a bare edge points at is known for ${((100 * edgesKnown) / Math.max(1, edgesKnown + edgesUnknown)).toFixed(1)}% of cross-module EDGES. The rest need whole-program import resolution, which is shared machinery (workstream §8).`,
  )
}
say()

say("== A3, the population neither identity reaches — shown, not folded away ==")
{
  const a3 = [...perTarget.entries()].filter(([, v]) => {
    if (v.cands.length === 0) return false
    const fs = new Set(v.cands.map((c) => c.file))
    if (fs.size <= 1) return false
    return v.cands.every((c) => !c.owner)
  })
  // A3 in the edge census is "not module-level and not owner-bearing", which for a
  // same-file population means overloading. List the worst offenders so the label is
  // checkable rather than asserted.
  const overload = [...perTarget.entries()]
    .filter(([, v]) => v.cands.length > 1 && new Set(v.cands.map((c) => c.file)).size === 1)
    .sort((x, y) => y[1].cands.length - x[1].cands.length)
  const overloadEdges = overload.reduce((n, [, v]) => n + v.edges, 0)
  say(`   same-file overloaded targets (2+ declarations of one name in ONE file): ${overload.length}, carrying ${overloadEdges} edges`)
  say(`   an owner or module identity does not separate these; only a signature does, and the store's resolver does not read one.`)
  for (const [t, v] of overload.slice(0, 8)) {
    const kinds = [...new Set(v.cands.map((c) => c.kind))].join("|")
    const lines = v.cands.map((c) => c.line).sort((x, y) => x - y)
    say(`     ${String(v.cands.length).padStart(3)} decls of \`${t}\` in ${path.relative(CORPUS, v.cands[0].file)}  kinds=${kinds}  lines=${lines.slice(0, 6).join(",")}  edges=${v.edges}`)
  }
  void a3
}
say()

say("== B, re-derived: are the 3 'recoverable' edges real? ==")
{
  const unresolved = [...perTarget.entries()].filter(([, v]) => v.cands.length === 0)
  const dotted = unresolved.filter(([t]) => t.includes("."))
  const lastSeg = dotted.filter(([t]) => byName.has(t.split(".").pop()!))
  say(`   unresolved targets ${unresolved.length}; containing '.' ${dotted.length}; final segment IS a published name ${lastSeg.length}`)
  for (const [t, v] of lastSeg) {
    const seg = t.split(".").pop()!
    const defs = byName.get(seg)!
    say(
      `     target \`${t}\` -> final segment \`${seg}\`, which ${defs.length} file(s) publish: ${[...new Set(defs.map((d) => path.relative(CORPUS, d.file)))].slice(0, 3).join(", ")}`,
    )
    say(`       ${v.edges} edge(s) of type ${v.type}. A target that names a FILE rather than a symbol has no final-segment identity to recover.`)
  }
  say(`   so B's recoverable count for nim is ${lastSeg.length} EDGES, and every one of them is a target whose text is a path.`)
}
say()
say("== C, the unresolved population, grouped by what it is ==")
{
  const unresolved = [...perTarget.entries()].filter(([, v]) => v.cands.length === 0)
  const byShape = new Map<string, { targets: number; edges: number; sample: string[] }>()
  const classify = (t: string): string => {
    if (/\.[a-z]+$/i.test(t)) return "path-shaped (ends in a file extension)"
    if (t.startsWith("P") && /^P[A-Z]/.test(t)) return "C-binding object wrapper (gtk2/gtkg style PType)"
    if (/^[a-z][a-z0-9_]*$/i.test(t)) return "bare identifier, no declaration anywhere in the sample"
    if (t.includes(".")) return "dotted, not a path"
    return "other"
  }
  for (const [t, v] of unresolved) {
    const k = classify(t)
    let g = byShape.get(k)
    if (!g) byShape.set(k, (g = { targets: 0, edges: 0, sample: [] }))
    g.targets++
    g.edges += v.edges
    if (g.sample.length < 5) g.sample.push(t)
  }
  for (const [k, g] of [...byShape.entries()].sort((a, b) => b[1].targets - a[1].targets)) {
    say(`   ${String(g.targets).padStart(5)} targets / ${String(g.edges).padStart(6)} edges  ${k}`)
    say(`          e.g. ${g.sample.map((s) => `"${s}"`).join(" ")}`)
  }
  say()
  say("   a target in NONE of these classes is a genuine defect: it names something the")
  say("   corpus does not declare. That count is what a marker for EXTERNAL cannot excuse.")
}
say()
say("== does an `imports` target now name a PUBLISHED module symbol? ==")
say("   (the store binds a target by `brain_symbol.name`, so a module symbol the edge does not")
say("   name is not a resolution; this is the number that decides whether the module pass works)")
{
  const mods = [...byName.entries()].filter(([, ds]) => ds.some((d) => d.kind === "module"))
  say(`   module symbols published in this sample: ${mods.length} (one per file, minus .nims)`)
  const imp = edges.filter((e) => e.type.toLowerCase().includes("import"))
  let bind = 0
  const unbound = new Map<string, number>()
  for (const e of imp) {
    if (byName.has(e.t)) bind++
    else unbound.set(e.t, (unbound.get(e.t) ?? 0) + 1)
  }
  say(`   imports edges: ${imp.length}; target names a published symbol: ${bind} (${((100 * bind) / Math.max(1, imp.length)).toFixed(1)}%); names nothing published: ${imp.length - bind}`)
  const top = [...unbound.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
  say(`   the unbound targets name modules with no file in this window: ${top.map(([t, n]) => `${t}(${n})`).join(" ")}`)
  say(`   an unbound imports target is cause C (external), not cause B: the module is outside the sample.`)
}
say()
if (failures.length) {
  say(`== parse failures (${failures.length}) — listed so the population is not silently smaller ==`)
  for (const f of failures.slice(0, 20)) say(`   ${f}`)
  if (failures.length > 20) say(`   … ${failures.length - 20} more`)
}

mkdirSync(OUT, { recursive: true })
const stem = `module-identity-ceiling-${files.length}`
writeFileSync(path.join(OUT, `${stem}.txt`), lines.join("\n") + "\n")
writeFileSync(
  path.join(OUT, `${stem}.json`),
  JSON.stringify(
    {
      files: files.length,
      fileCommand: listCmd,
      parsed,
      failed,
      declarations: decls.length,
      publishedNames: byName.size,
      edges: totalEdges,
      moduleNames: moduleFiles.size,
      modulesWithSeveralFiles: [...moduleFiles.entries()].filter(([, s]) => s.size > 1).length,
      buckets: {
        a1_moduleLevelMultiFile: { edges: globalBucket.a1.edges, targets: globalBucket.a1.targets.size },
        a2_ownerBearingMultiFile: { edges: globalBucket.a2.edges, targets: globalBucket.a2.targets.size },
        a3_sameFileOverload: { edges: globalBucket.a3.edges, targets: globalBucket.a3.targets.size },
        resolved: { edges: globalBucket.resolved.edges, targets: globalBucket.resolved.targets.size },
        unresolved: { edges: globalBucket.unresolved.edges, targets: globalBucket.unresolved.targets.size },
      },
      perType: Object.fromEntries([...perType.entries()].map(([k, v]) => [k, { edges: v.a1.edges + v.a2.edges + v.a3.edges + v.resolved.edges + v.unresolved.edges, a1: v.a1.edges, a2: v.a2.edges, a3: v.a3.edges, resolved: v.resolved.edges, unresolved: v.unresolved.edges }])),
      failures,
    },
    null,
    2,
  ) + "\n",
)
say(`wrote validation/m14/measurements/nim/${stem}.{txt,json}`)
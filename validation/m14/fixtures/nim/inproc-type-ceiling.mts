/**
 * IN-PROC TYPE CEILING — what publishing a routine-local `type` declaration would
 * recover, and what it would cost.
 *
 * ## The disagreement this measures
 *
 * The lane's own header states the exception to `LocalsAreNotSymbols`:
 *
 *     "The one exception is an object/enum/field declaration, which IS a symbol
 *      because the object owns it."
 *
 * and the code does not honour it inside a routine body.
 * `real-nim-analyzer.ts:386` reads `if (!inCallable || docExample)`, so a
 * `type X = object` written inside a `proc` publishes no symbol, no fields and
 * no `contains` edges — while the SAME declaration in a `runnableExamples` block
 * publishes all three, because the doc-example arm re-enables exactly this path.
 *
 * So this is not "we chose not to": the header claims the construct IS a symbol
 * and the code suppresses it. `resolution-audit.ts` already sizes the TARGET of
 * that disagreement (TREE-ONLY, published-family half: 131 edges / 86 names at
 * 6,063 files, of which OWNED 73 edges / 49 names). What is unmeasured is the
 * other side of the trade, and it is the side that decides whether to build:
 *
 *   GAIN  edges whose target is published by NO file and whose target name is an
 *         in-proc type declaration. These are the defect edges.
 *   COST  names published by EXACTLY ONE file today that also carry an in-proc
 *         declaration elsewhere. Publishing those adds a second declaring file,
 *         so every edge that resolves cleanly against the one file becomes
 *         AMBIGUOUS. That is a conversion, not an addition, and a resolution
 *         column that only counts additions cannot see it.
 *
 * The COST is the reason `resolution-audit.ts`'s 131 cannot simply be shipped.
 *
 * ## What it does NOT claim
 *
 * It does not claim a recovered edge would be CORRECT — only that the far end
 * would BIND. Which of two same-named declarations an edge means is a resolution
 * question, and publishing an in-proc type without also threading its scope into
 * the target string (which is what `field-type-ceiling.mts` measures for member
 * access, and declines at 38 edges) would leave multi-site names ambiguous on
 * purpose rather than by accident.
 *
 * READ-ONLY. Touches no analyzer state.
 */
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { parseFile } from "../../../../src/ast/pool-worker"
import { resumableWalk, resetCheckpoint } from "../../../../script/m14/resumable-walk"

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

const CALLABLE_NODES = new Set([
  "proc_declaration", "func_declaration", "iterator_declaration",
  "converter_declaration", "method_declaration",
  "template_declaration", "macro_declaration",
])
/** An RHS that OWNS member symbols — the contract's exception, read literally. */
const OWNING_RHS = new Set([
  "object_declaration", "enum_declaration", "tuple_type", "tuple_deconstruct_declaration",
])

const w = (s: string | number, n: number): string => String(s).padEnd(n)
const wa = (s: string | number, n: number): string => String(s).padStart(n)

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

// ────────────────────────────────── pass 1: production symbols AND edges
/** name -> the files that publish a symbol with that name. */
const publishedIn = new Map<string, Set<string>>()
/** name -> how many SYMBOLS (not files) carry it, for the kind table. */
const publishedKinds = new Map<string, Set<string>>()
const edgesByFile: { label: string; edges: { t: Type; tgt: string; src: string }[] }[] = []
let symbolsTotal = 0
let emptyKindSymbols = 0
let emptyNameSymbols = 0

const CHECKPOINT = "validation/m14/measurements/walk-inproc-ceiling-nim.txt"
if (process.argv.includes("--fresh")) resetCheckpoint(CHECKPOINT)

const walkStats = await resumableWalk(CHECKPOINT, files.length, {
  id: (i) => files[i].abs,
  concurrency: WORKERS,
  run: async (i) => {
    const f = files[i]
    const r: any = await parseFile(f.abs, f.dir)
    const label = `${f.repo}/${f.rel}`
    for (const s of r.symbols ?? []) {
      const nm = String(s.name ?? "")
      if (!nm) { emptyNameSymbols++; continue }
      if (!String(s.kind ?? "")) emptyKindSymbols++
      symbolsTotal++
      let set = publishedIn.get(nm)
      if (!set) { set = new Set(); publishedIn.set(nm, set) }
      set.add(label)
      let ks = publishedKinds.get(nm)
      if (!ks) { ks = new Set(); publishedKinds.set(nm, ks) }
      ks.add(String(s.kind ?? "(empty)"))
    }
    const edges: { t: Type; tgt: string; src: string }[] = []
    for (const x of r.relationships ?? []) {
      const t = String(x.type ?? x.relationshipType ?? "").toLowerCase() as Type
      if (!ALL_TYPES.includes(t)) continue
      edges.push({
        t,
        tgt: String(x.target ?? x.targetName ?? ""),
        src: String(x.source ?? x.from ?? x.sourceName ?? ""),
      })
    }
    edgesByFile.push({ label, edges })
  },
})

// ───────────────────── pass 2: raw parse for IN-PROC type declarations only
const wts: any = await import("web-tree-sitter")
const WSP: any = wts.Parser ?? wts.default
const WSL: any = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-nim.wasm"))))

/** name -> the in-proc declarations of it */
const inProc = new Map<string, { owned: boolean; sites: string[] }>()
/** name -> files carrying an in-proc declaration of it */
const inProcFiles = new Map<string, Set<string>>()
/** `enclosing.Type` -> the files declaring that PAIR. A scoped target is only
 *  safe if the pair is unique, so the pair — not the name — is the unit here. */
const scopedPairs = new Map<string, Set<string>>()
/** `enclosing.Type` -> OWNED?  A bare-alias in-proc type owns nothing. */
const scopedOwned = new Map<string, boolean>()
/** every `type_declaration` in the corpus, for the in-proc share */
let typeDecls = 0
let inProcTypeDecls = 0
let rawParseFailures = 0

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
      if (n.type === "type_declaration") {
        typeDecls++
        noteType(n, label, lines)
      }
      for (let k = 0; k < n.childCount; k++) walk(n.child(k))
    }
    walk(t.rootNode)
    t.delete?.()
  }
}
function noteType(n: any, label: string, lines: string[]): void {
  const symDecl = n.namedChildCount > 0 ? n.namedChild(0) : null
  if (!symDecl || symDecl.type !== "type_symbol_declaration") return
  const nm = symDecl.childForFieldName?.("name")
  let name = ""
  if (nm) {
    if (nm.type === "blank_identifier") return
    name = nm.type === "exported_symbol" || nm.type === "accent_quoted"
      ? (nm.namedChildCount > 0 ? String(nm.namedChild(0).text) : "")
      : String(nm.text)
  }
  if (!name) return
  // IN-proc = a CALLABLE ancestor. `runnableExamples` bodies are NOT callables,
  // which is exactly why the analyzer's own doc-example arm reaches them.
  let inProcFlag = false
  let enclosing = ""
  for (let p = n.parent; p; p = p.parent) {
    if (CALLABLE_NODES.has(p.type)) {
      inProcFlag = true
      const cn = p.childForFieldName?.("name")
      if (cn) {
        enclosing = cn.type === "exported_symbol" || cn.type === "accent_quoted"
          ? (cn.namedChildCount > 0 ? String(cn.namedChild(0).text) : "")
          : String(cn.text)
      }
      break
    }
  }
  if (!inProcFlag) return
  inProcTypeDecls++
  let owned = false
  const scan = (x: any): void => {
    if (OWNING_RHS.has(x.type)) { owned = true; return }
    for (let k = 0; k < x.childCount; k++) scan(x.child(k))
  }
  scan(n)
  const e = inProc.get(name) ?? { owned: false, sites: [] }
  e.owned = e.owned || owned
  const ln = n.startPosition.row + 1
  if (e.sites.length < 4) e.sites.push(`${label}:${ln} |${(lines[ln - 1] ?? "").trim().slice(0, 66)}|`)
  inProc.set(name, e)
  let fs = inProcFiles.get(name)
  if (!fs) { fs = new Set(); inProcFiles.set(name, fs) }
  fs.add(label)
  // The scoped pair is what a TARGET would have to name. An empty `enclosing`
  // means the grammar did not spell a name on the ancestor — reported, not
  // silently treated as module scope.
  if (enclosing) {
    const pair = `${enclosing}.${name}`
    let ps = scopedPairs.get(pair)
    if (!ps) { ps = new Set(); scopedPairs.set(pair, ps) }
    ps.add(label)
    scopedOwned.set(pair, (scopedOwned.get(pair) ?? false) || owned)
  }
}
treeWorker()
parser.delete?.()

// ──────────────────────── pass 3: the trade, per name, against real edges
/** target name -> the edges pointing at it, by type. Only UNRESOLVED ones. */
const unresolvedByName = new Map<string, Map<Type, number>>()
/** target name -> edges of any kind, for the COST side. */
const allEdgesByName = new Map<string, Map<Type, number>>()
/** `enclosing` -> the unresolved edges SOURCED there, so a scoped target can be
 *  matched to the edges it could actually retarget. */
const unresolvedBySrc = new Map<string, Map<Type, number>>()
for (const { edges } of edgesByFile) {
  for (const { t, tgt, src } of edges) {
    if (!tgt || tgt === "unknown") continue
    let m = allEdgesByName.get(tgt)
    if (!m) { m = new Map(); allEdgesByName.set(tgt, m) }
    m.set(t, (m.get(t) ?? 0) + 1)
    if (publishedIn.has(tgt)) continue
    let u = unresolvedByName.get(tgt)
    if (!u) { u = new Map(); unresolvedByName.set(tgt, u) }
    u.set(t, (u.get(t) ?? 0) + 1)
    let s = unresolvedBySrc.get(src)
    if (!s) { s = new Map(); unresolvedBySrc.set(src, s) }
    s.set(t, (s.get(t) ?? 0) + 1)
  }
}

type Row = {
  name: string
  owned: boolean
  declFiles: number
  publishedFiles: number
  publishedKinds: string[]
  gainEdges: number
  gainByType: Record<string, number>
  costEdges: number
  costByType: Record<string, number>
  sites: string[]
}
const rows: Row[] = []
for (const [name, info] of inProc) {
  const declFiles = inProcFiles.get(name)?.size ?? 0
  const pubFiles = publishedIn.get(name)?.size ?? 0
  const gainByType: Record<string, number> = {}
  let gainEdges = 0
  const costByType: Record<string, number> = {}
  let costEdges = 0
  if (pubFiles === 0) {
    // Unpublished everywhere: every edge at this name is a tree-only defect.
    for (const [t, c] of unresolvedByName.get(name) ?? []) { gainByType[t] = c; gainEdges += c }
  } else if (pubFiles === 1) {
    // Published by exactly one file TODAY. An in-proc declaration elsewhere makes
    // it two, so every edge that binds cleanly against the one file now splits.
    const existing = publishedIn.get(name)!
    const inProcSites = [...(inProcFiles.get(name) ?? [])].filter((f) => !existing.has(f))
    if (inProcSites.length > 0) {
      for (const [t, c] of allEdgesByName.get(name) ?? []) { costByType[t] = c; costEdges += c }
    }
  }
  if (gainEdges > 0 || costEdges > 0) {
    rows.push({
      name, owned: info.owned, declFiles, publishedFiles: pubFiles,
      publishedKinds: [...(publishedKinds.get(name) ?? [])].sort(),
      gainEdges, gainByType, costEdges, costByType, sites: info.sites,
    })
  }
}

const sum = (rs: Row[], f: (r: Row) => number): number => rs.reduce((a, r) => a + f(r), 0)
const byType = (rs: Row[], f: (r: Row) => Record<string, number>): Record<string, number> => {
  const m: Record<string, number> = {}
  for (const r of rs) for (const [t, c] of Object.entries(f(r))) m[t] = (m[t] ?? 0) + c
  return m
}
const ownedRows = rows.filter((r) => r.owned)
const anyRows = rows.filter((r) => !r.owned)

// ─────────────────────────────────────────────────────────────────── report
console.log(`nim in-proc type ceiling — production parseFile + one raw parse per file`)
console.log(`analyzer    : src/ast/real-nim-analyzer.ts sha256:${HASH_BEFORE.slice(0, 16)}`)
console.log(`corpus: ${files.length.toLocaleString()} nim files in ${byRepo.size} repos (${[...byRepo].map(([k, v]) => `${k}=${v}`).join(", ")})`)
console.log(`workers: ${WORKERS} (BB_NIM_WORKERS)`)
console.log(`walk: ${walkStats.done}/${files.length} files  newly walked ${walkStats.walked ?? walkStats.done}  resumed ${walkStats.resumed ?? 0}`)
console.log(`symbols published: ${symbolsTotal.toLocaleString()}   empty name ${emptyNameSymbols}   EMPTY KIND ${emptyKindSymbols}`)
console.log(`raw-parse failures: ${rawParseFailures}`)
console.log(`declarations: type_declaration ${typeDecls.toLocaleString()}, of which IN-PROc ${inProcTypeDecls.toLocaleString()} (${((inProcTypeDecls / Math.max(1, typeDecls)) * 100).toFixed(1)}%)`)
const ownedNameCount = [...inProc.values()].filter((i) => i.owned).length
console.log(`distinct in-proc type names: ${inProc.size}   OWNED (object/enum/tuple RHS) ${ownedNameCount}   bare alias only ${inProc.size - ownedNameCount}`)

console.log(`\nTHE DISAGREEMENT, quoted: header says an object/enum/field declaration "IS a`)
console.log(`symbol because the object owns it"; :386 reads \`if (!inCallable || docExample)\`.`)

console.log(`\n=== GAIN and COST, OWNED (RHS owns members) ===`)
console.log(`  ${w("pop", 34)}${wa("declFiles", 10)}${wa("pubFiles", 10)}${wa("gainEdges", 11)}${wa("costEdges", 11)}`)
const gOwned = sum(ownedRows, (r) => r.gainEdges)
const cOwned = sum(ownedRows, (r) => r.costEdges)
console.log(`  ${w("OWNED names with traffic", 34)}${wa([...inProc.values()].filter((i) => i.owned).length, 10)}${wa("", 10)}${wa(gOwned, 11)}${wa(cOwned, 11)}`)
console.log(`  ${w("ANY (all in-proc, bare alias)", 34)}${wa(inProc.size, 10)}${wa("", 10)}${wa(sum(anyRows, (r) => r.gainEdges), 11)}${wa(sum(anyRows, (r) => r.costEdges), 11)}`)
console.log(`  gain by type  OWNED: ${JSON.stringify(byType(ownedRows, (r) => r.gainByType))}`)
console.log(`  cost by type  OWNED: ${JSON.stringify(byType(ownedRows, (r) => r.costByType))}`)
console.log(`  gain by type  ANY  : ${JSON.stringify(byType(anyRows, (r) => r.gainByType))}`)
console.log(`  cost by type  ANY  : ${JSON.stringify(byType(anyRows, (r) => r.costByType))}`)

console.log(`\nCOST is a CONVERSION, not an addition: those edges resolve TODAY against the`)
console.log(`one file that publishes the name, and would become AMBIGUOUS. A resolution`)
console.log(`column that counts only gains cannot see it, which is why both are here.`)

const gainNames = rows.filter((r) => r.gainEdges > 0)
const costNames = rows.filter((r) => r.costEdges > 0)
console.log(`\nnames gaining: ${gainNames.length} (owned ${gainNames.filter((r) => r.owned).length})   names costing: ${costNames.length} (owned ${costNames.filter((r) => r.owned).length})`)
console.log(`\nGAIN rows, every one, largest first:`)
for (const r of [...gainNames].sort((a, b) => b.gainEdges - a.gainEdges).slice(0, 30)) {
  console.log(`  ${wa(r.gainEdges, 5)}  ${r.owned ? "OWNED" : "any  "}  ${w(r.name, 30)} ${JSON.stringify(r.gainByType)}`)
  for (const s of r.sites.slice(0, 2)) console.log(`          ${s}`)
}
console.log(`\nCOST rows, every one, largest first:`)
for (const r of [...costNames].sort((a, b) => b.costEdges - a.costEdges).slice(0, 30)) {
  console.log(`  ${wa(r.costEdges, 5)}  ${r.owned ? "OWNED" : "any  "}  ${w(r.name, 30)} pub=${r.publishedFiles} kinds=${r.publishedKinds.join(",")} ${JSON.stringify(r.costByType)}`)
  for (const s of r.sites.slice(0, 2)) console.log(`          ${s}`)
}

const totalEdges = [...allEdgesByName.values()].reduce((a, m) => a + [...m.values()].reduce((x, y) => x + y, 0), 0)
const totalUnresolved = [...unresolvedByName.values()].reduce((a, m) => a + [...m.values()].reduce((x, y) => x + y, 0), 0)

console.log(`\n=== SCOPED TARGET — publish in-proc types as \`enclosing.Type\` ===`)
console.log(`  pool-worker.ts:930 stores s.qualifiedName || s.metadata?.fqn || (s.scope ? scope.name : name)`)
console.log(`  so an EXPLICIT qualifiedName is stored verbatim and matched by Strategy 1's exact`)
console.log(`  qualified_name lookup. Retargeting to the pair therefore costs nothing in`)
console.log(`  collisions IF the pair is unique — which is what this table decides.`)

const scopedRows: { pair: string; files: number; owned: boolean; edges: number; byType: Record<string, number> }[] = []
for (const [pair, fs] of scopedPairs) {
  if (fs.size !== 1) continue // a pair declared twice cannot name ONE thing
  const enclosing = pair.slice(0, pair.lastIndexOf("."))
  const byType: Record<string, number> = {}
  let edges = 0
  for (const [t, c] of unresolvedBySrc.get(enclosing) ?? []) { byType[t] = c; edges += c }
  if (edges > 0) scopedRows.push({ pair, files: fs.size, owned: scopedOwned.get(pair) ?? false, edges, byType })
}
const sOwned = scopedRows.filter((r) => r.owned)
const sAny = scopedRows.filter((r) => !r.owned)
console.log(`  ${w("scope of the population", 40)}${wa("pairs", 9)}${wa("edges", 9)}`)
console.log(`  ${w("OWNED pairs, unique, with edges", 40)}${wa(sOwned.length, 9)}${wa(sum(sOwned, (r) => r.edges), 9)}`)
console.log(`  ${w("bare-alias pairs, unique, with edges", 40)}${wa(sAny.length, 9)}${wa(sum(sAny, (r) => r.edges), 9)}`)
console.log(`  OWNED by type: ${JSON.stringify(sOwned.reduce((m, r) => { for (const [t, c] of Object.entries(r.byType)) m[t] = (m[t] ?? 0) + c; return m }, {} as Record<string, number>))}`)
console.log(`  pairs declared in >1 file (NOT retargetable, listed so the population is complete):`)
const multiPair = [...scopedPairs.entries()].filter(([, f]) => f.size > 1)
for (const [p, f] of multiPair.slice(0, 12)) console.log(`    ${w(p, 34)} ${f.size} files`)
if (multiPair.length > 12) console.log(`    ...and ${multiPair.length - 12} more`)

console.log(`\n=== THE DECISION, both rules, same walk, same denominators ===`)
console.log(`  ${w("rule", 40)}${wa("recovered", 11)}${wa("broken", 9)}${wa("net", 9)}${wa("% of edges", 11)}`)
console.log(`  ${w("publish bare (naive)", 40)}${wa(gOwned, 11)}${wa(cOwned, 9)}${wa(gOwned - cOwned, 9)}${wa((((gOwned - cOwned) / totalEdges) * 100).toFixed(3), 11)}`)
console.log(`  ${w("publish scoped \`proc.Type\`", 40)}${wa(sum(sOwned, (r) => r.edges), 11)}${wa(0, 9)}${wa(sum(sOwned, (r) => r.edges), 9)}${wa(((sum(sOwned, (r) => r.edges) / totalEdges) * 100).toFixed(3), 11)}`)

console.log(`\n== DENOMINATORS, so the two columns are rates and not impressions ==`)
console.log(`  edges total ${totalEdges.toLocaleString()}   unresolved ${totalUnresolved.toLocaleString()} (${((totalUnresolved / totalEdges) * 100).toFixed(1)}%)`)
console.log(`  GAIN OWNED ${gOwned} = ${((gOwned / totalUnresolved) * 100).toFixed(2)}% of all unresolved, ${((gOwned / totalEdges) * 100).toFixed(3)}% of all edges`)
console.log(`  COST OWNED ${cOwned} = ${((cOwned / totalEdges) * 100).toFixed(3)}% of all edges (${cOwned > 0 ? ((cOwned / Math.max(1, gOwned)) * 100).toFixed(0) : "n/a"}% of the gain)`)
console.log(`  NET OWNED ${gOwned - cOwned}`)

const HASH_AFTER = analyzerHash()
console.log(`\nanalyzer sha256 after the walk: ${HASH_AFTER.slice(0, 16)} (${HASH_AFTER === HASH_BEFORE ? "unchanged" : "CHANGED"})`)

if (OUT) {
  writeFileSync(OUT, JSON.stringify({
    analyzerSha256: HASH_AFTER,
    analyzerStableDuringRun: HASH_AFTER === HASH_BEFORE,
    workers: WORKERS,
    files: files.length,
    filesByRepo: Object.fromEntries(byRepo),
    walk: walkStats,
    symbolsPublished: symbolsTotal,
    emptyKindSymbols,
    emptyNameSymbols,
    rawParseFailures,
    typeDeclarations: typeDecls,
    inProcTypeDeclarations: inProcTypeDecls,
    distinctInProcNames: inProc.size,
    ownedNames: [...inProc.entries()].filter(([, i]) => i.owned).map(([n]) => n),
    edgesTotal: totalEdges,
    unresolvedTotal: totalUnresolved,
    gainOwned: gOwned,
    costOwned: cOwned,
    gainAny: sum(anyRows, (r) => r.gainEdges),
    costAny: sum(anyRows, (r) => r.costEdges),
    gainByTypeOwned: byType(ownedRows, (r) => r.gainByType),
    costByTypeOwned: byType(ownedRows, (r) => r.costByType),
    rows: rows.sort((a, b) => b.gainEdges - a.gainEdges || b.costEdges - a.costEdges),
    scopedPairsTotal: scopedPairs.size,
    scopedPairsUniqueWithEdges: sOwned.length + sAny.length,
    scopedOwnedEdges: sum(sOwned, (r) => r.edges),
    scopedAnyEdges: sum(sAny, (r) => r.edges),
    scopedOwnedByType: sOwned.reduce((m, r) => { for (const [t, c] of Object.entries(r.byType)) m[t] = (m[t] ?? 0) + c; return m }, {} as Record<string, number>),
    scopedRows: scopedRows.sort((a, b) => b.edges - a.edges),
    multiFileScopedPairs: multiPair.length,
  }, null, 2))
  console.log(`wrote ${OUT}`)
}
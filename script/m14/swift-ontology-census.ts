/**
 * DERIV_EXPORTS_SWIFT — the lane's own census. One pass over a real corpus,
 * production path only, answers the questions the ontology gate asks.
 *
 * WHY A LANE SCRIPT AND NOT THE SHARED GATES
 *
 *   `script/m14/firing-check-v2.mjs` hardcodes `REPO =
 *   "$HOME/backbencher-brain"` (line 36) and imports both the engine
 *   and the analyzer from there, so a lane working in a worktree CANNOT measure
 *   its own branch with it: the instrument reads the MAIN CHECKOUT's copy of
 *   `real-swift-analyzer.ts`, not this branch's. Measured fact about the shared
 *   harness, reported to MASTER, not fixed here — script/m14/** is not this
 *   lane's to edit.
 *   `script/m14/ontology-coverage-gate.ts` refuses to run for a language with no
 *   RULING TABLE (`RULED_BY_LANG` holds only bash and json): it exits 2 rather
 *   than call every un-emitted type RULED-UNJUSTIFIED, so for swift it reports
 *   nothing at all. Also reported, not fixed.
 *
 *   So this script measures, from the production entry (`parseFile` ->
 *   ASTEngine.parseFile -> getParser -> parse -> analyze), what those two would,
 *   and adds the per-type questions neither answers: does each edge endpoint bind
 *   to a real symbol declared in the file (RESOLVED), what confidence and
 *   evidenceClass does the edge carry (CONFIDENT), does the recorded line
 *   actually name its target (checkable), and are there empty-name or
 *   placeholder endpoints (R7).
 *
 * NO REGEX (workstream rule 1). Every judgement is made from node.type, named
 * children, anonymous keyword tokens, or `String.includes` on a value already
 * extracted from an AST node. No RegExp literal and no `new RegExp` appears in
 * this file, and nothing matches raw source text except the file-level
 * code-bearing filter and the recorded-line containment check — the two places
 * where the alternative is not an AST at all (firing-check-v2 does the same, and
 * the ontology gate's header records what text matching cost it: two false
 * positives that would have convicted a correct ruling).
 *
 * USAGE
 *   bun script/m14/swift-ontology-census.ts --corpus=<dir> [--limit=N] [--shard=i/n] <out.json>
 *   bun script/m14/swift-ontology-census.ts --merge <a.json> <b.json> ... <out.json>
 *
 * Sharding is not decoration: `ASTEngine.parseFile` arms a wall-clock
 * self-destruct around the synchronous parse (see the SHARDING note in
 * script/m60/java-imports-exports-oracle.ts), so a shard is one process and a
 * poison file cannot delete a whole measurement. The sample is a deterministic
 * PREFIX of a sorted path list, so shards taken by stride are disjoint and their
 * union is exactly the sample the single-process run would take.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync, statSync, readdirSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../src/ast/pool-worker"
import { getParser } from "../../src/ast/engine"

const ALL_TYPES = [
  "calls", "uses", "contains", "imports", "references",
  "exports", "extends", "implements", "overrides", "instantiates",
] as const
type Type = (typeof ALL_TYPES)[number]

const argv = process.argv.slice(2)
function argValue(flag: string): string | null {
  for (const a of argv) if (a.startsWith(`${flag}=`)) return a.slice(flag.length + 1)
  return null
}
function isType(s: string): s is Type {
  for (const t of ALL_TYPES) if (t === s) return true
  return false
}

const corpusArg = argValue("--corpus") ?? "$HOME/fixtures/repositories/swift-corpus"
const limitArg = Number(argValue("--limit") ?? "400")
const shardArg = argValue("--shard")
const mergeMode = argv.includes("--merge")
const outPath = argv[argv.length - 1]

if (mergeMode) {
  const ins = argv.slice(1, argv.length - 1)
  const merged = mergeCensus(ins)
  writeFileSync(outPath, JSON.stringify(merged, null, 1))
  console.log(`merged ${ins.length} shard file(s) -> ${outPath}`)
  process.exit(0)
}

// ---------------------------------------------------------------------------
// corpus: git-tracked .swift files, code-bearing, deterministic order
// ---------------------------------------------------------------------------
// A .swift file carrying none of these tokens is a licence header or a fixture
// data table, not code. This is firing-check-v2's SHAPE (one declaration signal
// required) applied to TRACKED files only, so the sample is reproducible from the
// pin rather than from directory-walk order.
const CODE_SIGNALS = ["func ", "class ", "let ", "var ", "import ", "struct ", "protocol "]

interface CorpusFile { abs: string; rel: string; repo: string; dir: string }

function collectTracked(dir: string): string[] {
  try {
    return execFileSync("git", ["-C", dir, "ls-files", "-z"], {
      encoding: "utf8",
      maxBuffer: 512 * 1024 * 1024,
    }).split("\0").filter(Boolean)
  } catch {
    return []
  }
}

function corpusFiles(corpus: string): CorpusFile[] {
  const out: CorpusFile[] = []
  const roots: Array<{ repo: string; dir: string }> = []
  let st: any = null
  try { st = statSync(corpus) } catch { return out }
  if (!st.isDirectory()) return out
  const entries = readdirSync(corpus)
  for (const e of entries) {
    const d = path.join(corpus, e)
    try { if (statSync(d).isDirectory()) roots.push({ repo: e, dir: d }) } catch {}
  }
  // A corpus path may be a repo itself (swift-corpus) or a directory of repos.
  if (roots.length === 0) roots.push({ repo: path.basename(corpus), dir: corpus })

  for (const root of roots) {
    for (const rel of collectTracked(root.dir)) {
      if (!rel.endsWith(".swift")) continue
      const abs = path.join(root.dir, rel)
      let text: string
      try {
        if (statSync(abs).size > 400_000) continue
        text = readFileSync(abs, "utf8")
      } catch { continue }
      let codeBearing = false
      for (const s of CODE_SIGNALS) if (text.includes(s)) { codeBearing = true; break }
      if (!codeBearing) continue
      out.push({ abs, rel, repo: root.repo, dir: root.dir })
    }
  }
  out.sort((a, b) => (a.abs < b.abs ? -1 : a.abs > b.abs ? 1 : 0))
  return out
}

const allTracked = corpusFiles(corpusArg)
const window = allTracked.slice(0, limitArg)
let sample = window
if (shardArg) {
  const parts = shardArg.split("/")
  const i = Number(parts[0])
  const n = Number(parts[1])
  if (!(n > 0) || !(i >= 0 && i < n)) {
    console.error(`bad --shard=${shardArg}`)
    process.exit(2)
  }
  sample = window.filter((_, idx) => idx % n === i)
}

// ---------------------------------------------------------------------------
// measurement structures
// ---------------------------------------------------------------------------
interface Bucket {
  n: number
  fileSet: string[]
  conf: Record<string, number>
  evidence: Record<string, number>
  withLine: number
  lineNamesTarget: number
  srcDeclared: number
  tgtDeclared: number
  bothDeclared: number
  emptyEndpoint: number
  placeholderEndpoint: number
  examples: string[]
}
function newBucket(): Bucket {
  return {
    n: 0, fileSet: [], conf: {}, evidence: {}, withLine: 0, lineNamesTarget: 0,
    srcDeclared: 0, tgtDeclared: 0, bothDeclared: 0, emptyEndpoint: 0,
    placeholderEndpoint: 0, examples: [],
  }
}
function bump(rec: Record<string, number>, key: string, by = 1) {
  rec[key] = (rec[key] ?? 0) + by
}
/** Map counter. Deliberately NOT `bump`: that one indexes an object by key, and
 *  passing it a Map writes an own property on the Map object while `.size` stays
 *  0 — a counter that reports nothing and looks like a measurement of zero. */
function bumpMap(m: Map<string, number>, key: string, by = 1) {
  m.set(key, (m.get(key) ?? 0) + by)
}
function mergeCounter(a: Record<string, number>, b: Record<string, number> | undefined): Record<string, number> {
  const o: Record<string, number> = { ...a }
  for (const k of Object.keys(b ?? {})) o[k] = (o[k] ?? 0) + (b![k] ?? 0)
  return o
}

/** Placeholder-literal endpoints (standing rule R7): a name that is a
 *  vocabulary placeholder rather than a program identifier. Fixed list, string
 *  equality — no pattern matching. */
const PLACEHOLDERS = new Set([
  "TODO", "FIXME", "XXX", "unknown", "UNKNOWN", "<name>", "?", "-", "n/a",
  "<unknown>", "undefined", "null", "None", "name", "value",
])

// EXPORT CONSTRUCT PROBES — the corpus measurements the `exports` verdict rests on.
interface Probe {
  nodeTypes: Map<string, number>
  visibilityTokens: Map<string, number>
  exportishNodeTypes: Map<string, number>
  exportAnonTokens: number
  topLevelPublicish: number
  topLevelNominal: number
  topLevelOther: number
  topLevelFiles: Set<string>
  memberPublicish: number
  atExported: number
  atExportedFiles: Set<string>
  examples: string[]
}
function newProbe(): Probe {
  return {
    nodeTypes: new Map(), visibilityTokens: new Map(), exportishNodeTypes: new Map(),
    exportAnonTokens: 0, topLevelPublicish: 0, topLevelNominal: 0, topLevelOther: 0,
    topLevelFiles: new Set(), memberPublicish: 0, atExported: 0, atExportedFiles: new Set(),
    examples: [],
  }
}
const DECL_TYPES = new Set([
  "class_declaration", "protocol_declaration", "typealias_declaration",
  "function_declaration", "protocol_function_declaration", "property_declaration",
  "protocol_property_declaration", "init_declaration", "associatedtype_declaration",
])
const NOMINAL_TYPES = new Set([
  "class_declaration", "protocol_declaration", "typealias_declaration",
])

function probeTree(root: any, label: string, probe: Probe) {
  if (!root) return
  const stack: any[] = [root]
  let guard = 0
  while (stack.length > 0 && guard++ < 3_000_000) {
    const n = stack.pop()!
    const t = String(n.type ?? "")
    bumpMap(probe.nodeTypes, t)
    if (t.indexOf("export") !== -1) bumpMap(probe.exportishNodeTypes, t)
    if (!n.isNamed && t === "export") probe.exportAnonTokens++
    if (t === "visibility_modifier") {
      const txt = String(n.text ?? "")
      bumpMap(probe.visibilityTokens, txt)
      if (txt === "public" || txt === "open" || txt === "package") {
        // The modifier's parent is `modifiers`; the DECLARATION is that node's
        // parent. (Reading n.parent directly tests `modifiers`, which is in no
        // DECL_TYPES set, and the whole probe then reports 0 on files that
        // plainly declare `public struct` — a counter that cannot fail.)
        const decl = n.parent?.parent
        if (decl && DECL_TYPES.has(String(decl.type))) {
          const topLevel = !!decl.parent && String(decl.parent.type) === "source_file"
          if (topLevel) {
            probe.topLevelPublicish++
            probe.topLevelFiles.add(label)
            if (NOMINAL_TYPES.has(String(decl.type))) probe.topLevelNominal++
            else probe.topLevelOther++
            if (probe.examples.length < 8) probe.examples.push(`${label}:${decl.startPosition.row + 1} ${decl.type} ${txt}`)
          } else {
            probe.memberPublicish++
          }
        }
      }
    }
    if (t === "attribute") {
      const txt = String(n.text ?? "")
      if (txt.indexOf("_exported") !== -1) {
        probe.atExported++
        probe.atExportedFiles.add(label)
      }
    }
    for (let i = n.namedChildCount - 1; i >= 0; i--) {
      const c = n.namedChild(i)
      if (c) stack.push(c)
    }
  }
}

const relBuckets = new Map<Type, Bucket>()
const relFiles = new Map<Type, Set<string>>()
const probe = newProbe()
const importChannel = {
  n: 0, files: 0, withLine: 0,
  firstFiles: [] as string[],
  modules: new Map<string, number>(),
}
const exportChannel = { n: 0, files: 0 }
const failures: Array<{ file: string; err: string }> = []
let filesParsed = 0
let filesFailed = 0
let symbolsTotal = 0
let relTotal = 0
let linesWithEdge = 0
let filesWithRelationships = 0
let filesWithSymbols = 0

const parser = await getParser("swift")

for (const f of sample) {
  const label = `${f.repo}/${f.rel}`
  let content = ""
  try { content = readFileSync(f.abs, "utf8") } catch { filesFailed++; continue }
  let r: any
  try {
    r = await parseFile(f.abs, f.dir)
  } catch (e) {
    filesFailed++
    if (failures.length < 10) failures.push({ file: label, err: String(e).slice(0, 160) })
    continue
  }
  filesParsed++
  const symbols: any[] = r.symbols ?? []
  symbolsTotal += symbols.length
  if (symbols.length > 0) filesWithSymbols++
  const declared = new Set<string>()
  for (const s of symbols) {
    const nm = String(s?.name ?? "")
    if (!nm) continue
    declared.add(nm)
    const owner = String(s?.ownerName ?? "")
    if (owner) declared.add(`${owner}.${nm}`)
  }
  const rels: any[] = r.relationships ?? []
  relTotal += rels.length
  if (rels.length > 0) filesWithRelationships++

  const contentLines = content.split("\n")
  const lineText = (line: number): string => (line >= 1 && line <= contentLines.length ? contentLines[line - 1] : "")

  const perFile = new Set<Type>()
  for (const rel of rels) {
    const t = String(rel.type ?? rel.relationshipType ?? "").toLowerCase()
    if (!isType(t)) continue
    let b = relBuckets.get(t)
    if (!b) { b = newBucket(); relBuckets.set(t, b) }
    let fs = relFiles.get(t)
    if (!fs) { fs = new Set(); relFiles.set(t, fs) }
    perFile.add(t)
    fs.add(label)
    const s = String(rel.source ?? "")
    const tg = String(rel.target ?? "")
    b.n++
    if (b.examples.length < 4) b.examples.push(`${label}:${rel.line_number ?? "?"} ${s} -> ${tg}`)
    bump(b.conf, String(rel.confidence ?? "none"))
    bump(b.evidence, String((rel.metadata ?? {}).evidenceClass ?? "none"))
    if (typeof rel.line_number === "number") {
      b.withLine++
      linesWithEdge++
      if (tg && lineText(rel.line_number).includes(tg)) b.lineNamesTarget++
    }
    const sOk = s !== "" && s !== "root" && declared.has(s)
    const tOk = tg !== "" && declared.has(tg)
    if (sOk) b.srcDeclared++
    if (tOk) b.tgtDeclared++
    if (sOk && tOk) b.bothDeclared++
    if (s === "" || tg === "") b.emptyEndpoint++
    if (PLACEHOLDERS.has(s) || PLACEHOLDERS.has(tg)) b.placeholderEndpoint++
  }
  for (const t of perFile) {
    const b = relBuckets.get(t)!
    b.fileSet.push(label)
  }

  const imps: any[] = r.imports ?? []
  importChannel.n += imps.length
  if (imps.length > 0) {
    importChannel.files++
    if (importChannel.firstFiles.length < 5) importChannel.firstFiles.push(label)
    for (const im of imps) {
      // parseFile maps the analyzer's ImportInfo onto a BasicImport, whose name
      // field is `name` (with `path` carrying the module); `module` is the
      // analyzer-side spelling. Read all three rather than assume one.
      const m = String(im?.module ?? im?.name ?? im?.path ?? "")
      if (m) bumpMap(importChannel.modules, m)
      if (typeof im?.line === "number") importChannel.withLine++
    }
  }
  const exps: any[] = r.exports ?? []
  exportChannel.n += exps.length
  if (exps.length > 0) exportChannel.files++

  // The construct probe needs the TREE, which parseFile does not return; it is a
  // question about the LANGUAGE, not about the analyzer's edges, so it parses
  // with the same pinned grammar through the same engine parser.
  try {
    const tree = await parser.parse(content)
    if (tree) {
      probeTree(tree.rootNode, label, probe)
      tree.delete?.()
    }
  } catch { /* probe is best-effort; parseFile already succeeded above */ }
}

const channel: Record<string, any> = {}
for (const t of ALL_TYPES) {
  const b = relBuckets.get(t)
  if (!b) continue
  channel[t] = {
    n: b.n,
    files: (relFiles.get(t)?.size ?? 0),
    firstFiles: b.fileSet.slice(0, 5),
    confidence: b.conf,
    evidenceClass: b.evidence,
    withLine: b.withLine,
    lineNamesTarget: b.lineNamesTarget,
    sourceBindsToFileSymbol: b.srcDeclared,
    targetBindsToFileSymbol: b.tgtDeclared,
    bothBindToFileSymbol: b.bothDeclared,
    emptyEndpoint: b.emptyEndpoint,
    placeholderEndpoint: b.placeholderEndpoint,
    examples: b.examples,
  }
}

const out: any = {
  tool: "swift-ontology-census",
  corpus: corpusArg,
  trackedCodeBearing: allTracked.length,
  limit: limitArg,
  shard: shardArg ?? "all",
  sampleSize: sample.length,
  filesParsed,
  filesFailed,
  filesWithSymbols,
  filesWithRelationships,
  symbolsTotal,
  relationshipsTotal: relTotal,
  relationshipsWithLine: linesWithEdge,
  failures,
  relationshipChannel: channel,
  importChannel: {
    n: importChannel.n,
    files: importChannel.files,
    withLine: importChannel.withLine,
    firstFiles: importChannel.firstFiles,
    distinctModules: importChannel.modules.size,
    topModules: [...importChannel.modules.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12),
  },
  exportChannel: { n: exportChannel.n, files: exportChannel.files },
  exportConstructProbe: {
    distinctNodeTypes: probe.nodeTypes.size,
    nodeTypeNamesContainingExport: [...probe.exportishNodeTypes.entries()].sort((a, b) => b[1] - a[1]),
    exportKeywordAnonTokens: probe.exportAnonTokens,
    visibilityModifierTokens: [...probe.visibilityTokens.entries()].sort((a, b) => b[1] - a[1]),
    topLevelPublicOrOpen: probe.topLevelPublicish,
    topLevelPublicOrOpenFiles: probe.topLevelFiles.size,
    topLevelNominal: probe.topLevelNominal,
    topLevelOther: probe.topLevelOther,
    memberPublicOrOpen: probe.memberPublicish,
    atExportedAttributes: probe.atExported,
    atExportedFiles: probe.atExportedFiles.size,
    examples: probe.examples,
  },
}

writeFileSync(outPath, JSON.stringify(out, null, 1))
console.error(`parsed ${filesParsed}/${sample.length} (${filesFailed} failed) -> ${outPath}`)

// ---------------------------------------------------------------------------
// merge
// ---------------------------------------------------------------------------
function mergeCensus(ins: string[]): any {
  const parts = ins.map((p) => JSON.parse(readFileSync(p, "utf8")))
  const merged: any = {
    tool: "swift-ontology-census (merged)",
    corpus: parts[0]?.corpus,
    shard: "merged",
    trackedCodeBearing: parts[0]?.trackedCodeBearing,
    sampleSize: parts.reduce((a: number, p: any) => a + (p.sampleSize ?? 0), 0),
    filesParsed: parts.reduce((a: number, p: any) => a + (p.filesParsed ?? 0), 0),
    filesFailed: parts.reduce((a: number, p: any) => a + (p.filesFailed ?? 0), 0),
    filesWithSymbols: parts.reduce((a: number, p: any) => a + (p.filesWithSymbols ?? 0), 0),
    filesWithRelationships: parts.reduce((a: number, p: any) => a + (p.filesWithRelationships ?? 0), 0),
    symbolsTotal: parts.reduce((a: number, p: any) => a + (p.symbolsTotal ?? 0), 0),
    relationshipsTotal: parts.reduce((a: number, p: any) => a + (p.relationshipsTotal ?? 0), 0),
    relationshipsWithLine: parts.reduce((a: number, p: any) => a + (p.relationshipsWithLine ?? 0), 0),
    failures: parts.flatMap((p: any) => p.failures ?? []).slice(0, 12),
    relationshipChannel: {},
  }
  const sum = (field: string) => parts.reduce((a: number, p: any) => a + (p[field] ?? 0), 0)
  for (const t of ALL_TYPES) {
    let n = 0, withLine = 0, lineNamesTarget = 0, srcDeclared = 0, tgtDeclared = 0
    let bothDeclared = 0, emptyEndpoint = 0, placeholderEndpoint = 0
    let conf: Record<string, number> = {}
    let evidence: Record<string, number> = {}
    const files = new Set<string>()
    const firstFiles: string[] = []
    const examples: string[] = []
    for (const p of parts) {
      const b = p.relationshipChannel?.[t]
      if (!b) continue
      n += b.n ?? 0
      withLine += b.withLine ?? 0
      lineNamesTarget += b.lineNamesTarget ?? 0
      srcDeclared += b.sourceBindsToFileSymbol ?? 0
      tgtDeclared += b.targetBindsToFileSymbol ?? 0
      bothDeclared += b.bothBindToFileSymbol ?? 0
      emptyEndpoint += b.emptyEndpoint ?? 0
      placeholderEndpoint += b.placeholderEndpoint ?? 0
      conf = mergeCounter(conf, b.confidence)
      evidence = mergeCounter(evidence, b.evidenceClass)
      for (const f of b.firstFiles ?? []) if (firstFiles.length < 8 && !firstFiles.includes(f)) firstFiles.push(f)
      for (const e of b.examples ?? []) if (examples.length < 8) examples.push(e)
    }
    // file counts: a file belongs to exactly ONE shard (stride split over one
    // sorted list), so summing the per-shard distinct-file counts is exact.
    if (n > 0) {
      merged.relationshipChannel[t] = {
        n,
        files: [...parts].reduce((a: number, p: any) => a + (p.relationshipChannel?.[t]?.files ?? 0), 0),
        firstFiles,
        confidence: conf,
        evidenceClass: evidence,
        withLine,
        lineNamesTarget,
        sourceBindsToFileSymbol: srcDeclared,
        targetBindsToFileSymbol: tgtDeclared,
        bothBindToFileSymbol: bothDeclared,
        emptyEndpoint,
        placeholderEndpoint,
        examples,
      }
    }
  }
  const mods = new Map<string, number>()
  const importFirstFiles: string[] = []
  for (const p of parts) {
    for (const [k, v] of p.importChannel?.topModules ?? []) bumpMap(mods, k, v)
    for (const f of p.importChannel?.firstFiles ?? []) {
      if (importFirstFiles.length < 8 && !importFirstFiles.includes(f)) importFirstFiles.push(f)
    }
  }
  merged.importChannel = {
    n: parts.reduce((a: number, p: any) => a + (p.importChannel?.n ?? 0), 0),
    files: parts.reduce((a: number, p: any) => a + (p.importChannel?.files ?? 0), 0),
    withLine: parts.reduce((a: number, p: any) => a + (p.importChannel?.withLine ?? 0), 0),
    firstFiles: importFirstFiles,
    topModules: [...mods.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12),
  }
  merged.exportChannel = {
    n: parts.reduce((a: number, p: any) => a + (p.exportChannel?.n ?? 0), 0),
    files: parts.reduce((a: number, p: any) => a + (p.exportChannel?.files ?? 0), 0),
  }
  const addPairs = (field: string): Array<[string, number]> => {
    const m = new Map<string, number>()
    for (const p of parts) {
      for (const [k, v] of p.exportConstructProbe?.[field] ?? []) bumpMap(m, k, v)
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }
  const psum = (field: string) => parts.reduce((a: number, p: any) => a + (p.exportConstructProbe?.[field] ?? 0), 0)
  merged.exportConstructProbe = {
    distinctNodeTypes: Math.max(...parts.map((p: any) => p.exportConstructProbe?.distinctNodeTypes ?? 0), 0),
    nodeTypeNamesContainingExport: addPairs("nodeTypeNamesContainingExport"),
    exportKeywordAnonTokens: psum("exportKeywordAnonTokens"),
    visibilityModifierTokens: addPairs("visibilityModifierTokens"),
    topLevelPublicOrOpen: psum("topLevelPublicOrOpen"),
    topLevelPublicOrOpenFiles: psum("topLevelPublicOrOpenFiles"),
    topLevelNominal: psum("topLevelNominal"),
    topLevelOther: psum("topLevelOther"),
    memberPublicOrOpen: psum("memberPublicOrOpen"),
    atExportedAttributes: psum("atExportedAttributes"),
    atExportedFiles: psum("atExportedFiles"),
    examples: parts.flatMap((p: any) => p.exportConstructProbe?.examples ?? []).slice(0, 10),
  }


  return merged
}
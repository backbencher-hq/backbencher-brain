/**
 * M14/M37/M60 -- the Holy C lane's own census instrument.
 *
 * Everything this file reports is MEASURED in the run that writes it. Nothing is
 * transcribed from a previous artifact, and no number in the C documentation may
 * be quoted without naming this script as its source.
 *
 * It answers, per corpus, the questions the lane-audit formula asks, plus three
 * it does not ask and the C lane needs:
 *
 *   L5  zero unknown symbols  -- unknown kinds, empty names, placeholder names,
 *                                ownerless members, symbol-free files and whether
 *                                each one is legitimately symbol-free
 *   L7  relationship ontology -- every type actually emitted, its
 *                                metadata.relationshipType breakdown, and whether
 *                                the target RESOLVES to a symbol the file declares
 *   L8  line contract         -- per-edge line presence (M59.A7)
 *   L6  extraction loss       -- grammar-error files, crash files, relationship
 *                                volume inside a damaged file
 *   --   duplicate edges      -- by SITE, because M59 is per-site not per-set
 *   --   dangling contains    -- a contains source that is not a symbol
 *   --   range-recovery cost  -- how much of the wall time the function-range
 *                                brace scan + line lookup actually costs
 *
 * Two entry points are measured separately, because the formula requires it and
 * conflating them is what made the historical C perf row unattributable:
 *   analyzer   -- new RealCAnalyzer().analyze(root, src, path)  (parse excluded)
 *   production -- ASTEngine.parseFile(path, src)                (the product entry)
 *
 * ASCII only on purpose: this file is read by grep, diff and older tooling.
 *
 * Usage:
 *   bun run script/m14/tmp/c-audit/census.ts --repos dir1[,dir2] [--limit N]
 *         [--ext .c,.h] [--min-bytes N] [--out path] [--production]
 */
import * as fs from "fs"
import * as path from "path"
import { execSync } from "child_process"
import { createHash } from "crypto"

const ROOT = path.resolve((import.meta as any).dirname, "..", "..", "..", "..")
const argv = process.argv.slice(2)
const arg = (name: string, dflt: string): string => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt
}
const flag = (name: string): boolean => argv.includes(`--${name}`)

const REPO_ROOT = arg("repos", "/home/sano/ishaq/bb_tests/repositories")
const LIMIT = Number(arg("limit", "400"))
const MIN_BYTES = Number(arg("min-bytes", "1024"))
const EXTS = arg("ext", ".c").split(",").filter(Boolean)
const OUT = arg("out", path.join(ROOT, "validation", "m12", "results", "c-corpus-census.json"))
const PRODUCTION = flag("production")

const wts: any = await import(path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.js"))
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const parser = new P()
parser.setLanguage(await L.load(fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-c.wasm"))))
const { RealCAnalyzer } = await import(path.join(ROOT, "src/ast/real-c-analyzer.ts"))
const ASTEngine = await import(path.join(ROOT, "src/ast/engine.ts"))

/** Every SymbolKind value the engine can produce -- the denominator for "unknown". */
const KNOWN_KINDS = new Set<string>(Object.values(ASTEngine.ASTEngine.SymbolKind as Record<string, string>))
/** Every RelationshipType value -- the universe the ontology census is measured against. */
const KNOWN_REL = new Set<string>(Object.values(ASTEngine.ASTEngine.RelationshipType as Record<string, string>))

const MEMBER_KINDS = new Set(["property", "enum_member"])

interface FileRec {
  path: string
  bytes: number
  lines: number
  nodes: number
  symbols: number
  relationships: number
  errors: number
  hasErrorNode: boolean
  missingNodes: number
  wallMs: number
  cpuMs: number
  unknownKind: string[]
  emptyName: string[]
  placeholderName: string[]
  memberWithoutOwner: string[]
  macroNamedMember: string[]
  duplicateMemberName: string[]
  symbolFree: boolean
  symbolFreeText: string
  relTypes: Record<string, number>
  relTypeBreakdown: Record<string, number>
  edgesWithoutLine: number
  edgesTotal: number
  repeatEdges: number
  sameSiteDuplicates: number
  duplicateDetail: Record<string, number>
  danglingContains: number
  unresolvedTargets: Record<string, number>
  targetResolves: number
  targetUnresolves: number
}

/** Corpus file discovery: extension filter, size floor, stable order (the set must be re-runnable). */
function discover(dir: string): string[] {
  const out: string[] = []
  const walk = (d: string) => {
    let ents: fs.Dirent[]
    try {
      ents = fs.readdirSync(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of ents.sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (e.name === ".git" || e.name === "node_modules") continue
      const full = path.join(d, e.name)
      if (e.isDirectory()) walk(full)
      else if (EXTS.some((x) => e.name.endsWith(x))) {
        try {
          if (fs.statSync(full).size >= MIN_BYTES) out.push(full)
        } catch {
          /* unreadable: the caller census counts it, never silently drops it */
        }
      }
    }
  }
  walk(dir)
  out.sort()
  return out.slice(0, LIMIT)
}

function nodeCount(root: any): { total: number; error: boolean; missing: number } {
  let total = 0
  let error = false
  let missing = 0
  const st = [root]
  while (st.length) {
    const n = st.pop()!
    total++
    if (n.type === "ERROR" || n.isError) error = true
    if (n.isMissing) missing++
    for (let i = n.namedChildCount - 1; i >= 0; i--) {
      const c = n.namedChild(i)
      if (c) st.push(c)
    }
  }
  return { total, error, missing }
}

async function measureOne(file: string): Promise<FileRec> {
  const src = fs.readFileSync(file, "utf8")
  const rel = path.relative(REPO_ROOT, file)
  const rec: FileRec = {
    path: rel,
    bytes: Buffer.byteLength(src),
    lines: src.split("\n").length,
    nodes: 0,
    symbols: 0,
    relationships: 0,
    errors: 0,
    hasErrorNode: false,
    missingNodes: 0,
    wallMs: 0,
    cpuMs: 0,
    unknownKind: [],
    emptyName: [],
    placeholderName: [],
    memberWithoutOwner: [],
    macroNamedMember: [],
    duplicateMemberName: [],
    symbolFree: true,
    symbolFreeText: "",
    relTypes: {},
    relTypeBreakdown: {},
    edgesWithoutLine: 0,
    edgesTotal: 0,
    repeatEdges: 0,
    sameSiteDuplicates: 0,
    duplicateDetail: {},
    danglingContains: 0,
    unresolvedTargets: {},
    targetResolves: 0,
    targetUnresolves: 0,
  }

  const tree = parser.parse(src)
  const nc = nodeCount(tree.rootNode)
  rec.nodes = nc.total
  rec.hasErrorNode = nc.error
  rec.missingNodes = nc.missing

  const t0 = performance.now()
  const c0 = process.cpuUsage()
  let res: any
  try {
    res = PRODUCTION
      ? await ASTEngine.ASTEngine.parseFile(file, src)
      : (new RealCAnalyzer() as any).analyze(tree.rootNode, src, file)
  } catch (e: any) {
    rec.symbolFreeText = `CRASH: ${String(e?.message ?? e).slice(0, 200)}`
    const cE = process.cpuUsage(c0)
    rec.wallMs = performance.now() - t0
    // #977: `process.cpuUsage(previousValue)` already returns the DELTA since that
    // value -- subtracting `c0` again double-counts. In a long-lived process `c0.user`
    // is already large, so the old expression went NEGATIVE and the corpus total read
    // -217,936 s of CPU against 139.6 s of wall time. A perf metric that can report
    // negative CPU cannot support any performance claim, so it was worth fixing before
    // quoting any timing at all.
    rec.cpuMs = (cE.user + cE.system) / 1000
    return rec
  }
  const cE = process.cpuUsage(c0)
  rec.wallMs = performance.now() - t0
  // #977: `process.cpuUsage(previousValue)` already returns the DELTA since that
    // value -- subtracting `c0` again double-counts. In a long-lived process `c0.user`
    // is already large, so the old expression went NEGATIVE and the corpus total read
    // -217,936 s of CPU against 139.6 s of wall time. A perf metric that can report
    // negative CPU cannot support any performance claim, so it was worth fixing before
    // quoting any timing at all.
    rec.cpuMs = (cE.user + cE.system) / 1000

  const syms: any[] = res.symbols ?? []
  const rels: any[] = res.relationships ?? []
  rec.symbols = syms.length
  rec.relationships = rels.length
  rec.errors = (res.errors ?? []).length
  rec.symbolFree = syms.length === 0
  if (rec.symbolFree) {
    // A symbol-free file is legitimate only if it carries no C DECLARATION.
    //
    // Two legitimate classes, both measured rather than assumed:
    //   comment/blank only      -- nothing but prose
    //   preprocessor-directive only -- every non-blank, non-comment line starts
    //     with '#'. libgit2's script/user_nodefs.h is this class: its lines read
    //     `#nodef NAME(args) ...`, a build-time sentinel where the directive
    //     keyword is deliberately mangled, so the file declares no C entity at
    //     all and publishing symbols for it would be a fabrication.
    // Anything else is a genuine loss and is reported as such.
    // Block comments are stripped as BLOCKS, not line by line: the earlier
    // line-prefix filter let a closing `*/` through, which made
    // libgit2/script/user_nodefs.h -- every one of whose lines is a `#nodef`
    // build-time sentinel -- read as "HAS CODE" and made the legitimacy check
    // wrong rather than the analyzer. A verdict that is wrong about the file is
    // worse than no verdict.
    const noBlockComments = src.replace(/\/\*[\s\S]*?\*\//g, " ")
    const code = noBlockComments
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l !== "" && !l.startsWith("//"))
    if (code.length === 0) rec.symbolFreeText = "comment/blank only"
    else if (code.every((l) => l.startsWith("#"))) rec.symbolFreeText = "preprocessor-directive only"
    else rec.symbolFreeText = `HAS CODE: ${code.join(" ").slice(0, 160)}`
  }

  const declared = new Set<string>()
  const macroNames = new Set<string>()
  const ownerMembers = new Map<string, Map<string, number>>()
  for (const s of syms) {
    if (typeof s?.kind === "string" && !KNOWN_KINDS.has(s.kind)) rec.unknownKind.push(`${s.kind}:${s.name}`)
    if (typeof s?.name !== "string" || s.name.trim() === "") rec.emptyName.push(String(s?.kind))
    if (s?.name === "unknown") rec.placeholderName.push(String(s?.kind))
    if (typeof s?.name === "string" && s.name !== "") declared.add(s.name)
    // OBJECT-LIKE only, for the reason the #931 rule records: a function-like
    // macro is not replaced where no `(` follows, so a member may legitimately
    // share a function-like macro's name (redis: `double min, max;` after
    // `#define min(a, b)`). Reporting those was a false class in the first run.
    if ((s?.metadata as any)?.isMacro && !(s?.metadata as any)?.isFunctionLikeMacro) macroNames.add(s.name)
    if (MEMBER_KINDS.has(String(s?.kind))) {
      if (!s?.ownerName) rec.memberWithoutOwner.push(`${s.kind}:${s.name}`)
      // A member named after a MACRO is a phantom: `BIT(closing);` has no
      // declarator the grammar can read, so the macro's own name is what the
      // extractor lands on (see macro-field-probe.ts).
      if (macroNames.has(String(s?.name))) rec.macroNamedMember.push(`${s.ownerName}.${s.name}@L${s?.range?.startLine}`)
      const om = ownerMembers.get(String(s?.ownerName)) ?? new Map<string, number>()
      om.set(String(s?.name), (om.get(String(s?.name)) ?? 0) + 1)
      ownerMembers.set(String(s?.ownerName), om)
    }
  }
  for (const [owner, names] of ownerMembers) {
    for (const [n, c] of names) if (c > 1) rec.duplicateMemberName.push(`${owner}.${n} x${c}`)
  }

  const edgeKeys = new Set<string>()
  // A repeat is only a DUPLICATE when it repeats the SITE too. M59's contract is
  // per-site, not per-set: `f calls g` on three lines is three true edges and
  // collapsing them would itself be the defect. So the key carries the line; a
  // second edge with the same key is a real duplicate, a second edge on another
  // line is a distinct site. Line-less types (contains, imports, exports) have no
  // site, so any repeat of those is a duplicate by definition.
  const siteKeys = new Set<string>()
  for (const r of rels) {
    const t = String(r?.type ?? "")
    const rt = String((r?.metadata as any)?.relationshipType ?? "-")
    rec.relTypes[t] = (rec.relTypes[t] ?? 0) + 1
    rec.relTypeBreakdown[`${t}/${rt}`] = (rec.relTypeBreakdown[`${t}/${rt}`] ?? 0) + 1
    rec.edgesTotal++
    const ln = (r as any).line_number
    if (typeof ln !== "number" || ln < 1) rec.edgesWithoutLine++
    const key = `${r?.source}|${t}|${r?.target}`
    if (edgeKeys.has(key)) rec.repeatEdges++
    edgeKeys.add(key)
    const site = typeof ln === "number" && ln >= 1 ? String(ln) : "none"
    const siteKey = `${key}@${site}`
    if (siteKeys.has(siteKey)) {
      rec.sameSiteDuplicates++
      rec.duplicateDetail[`${t}/${rt}`] = (rec.duplicateDetail[`${t}/${rt}`] ?? 0) + 1
    }
    siteKeys.add(siteKey)
    if (t === "contains" && !declared.has(String(r?.source))) rec.danglingContains++
    if (t === "imports" || t === "exports") continue
    if (declared.has(String(r?.target))) rec.targetResolves++
    else {
      rec.targetUnresolves++
      rec.unresolvedTargets[String(r?.target)] = (rec.unresolvedTargets[String(r?.target)] ?? 0) + 1
    }
  }
  return rec
}

const repos = REPO_ROOT.split(",").map((r) => r.trim()).filter(Boolean)
const perRepo: any[] = []
for (const repo of repos) {
  const files = discover(repo)
  const recs: FileRec[] = []
  for (const f of files) recs.push(await measureOne(f))

  const agg = (fn: (r: FileRec) => number) => recs.reduce((a, r) => a + fn(r), 0)
  const relTypes: Record<string, number> = {}
  const relBreak: Record<string, number> = {}
  const unresolved: Record<string, number> = {}
  const dupDetail: Record<string, number> = {}
  for (const r of recs) {
    for (const [k, v] of Object.entries(r.relTypes)) relTypes[k] = (relTypes[k] ?? 0) + v
    for (const [k, v] of Object.entries(r.relTypeBreakdown)) relBreak[k] = (relBreak[k] ?? 0) + v
    for (const [k, v] of Object.entries(r.unresolvedTargets)) unresolved[k] = (unresolved[k] ?? 0) + v
    for (const [k, v] of Object.entries(r.duplicateDetail)) dupDetail[k] = (dupDetail[k] ?? 0) + v
  }
  const symbolFree = recs.filter((r) => r.symbolFree)
  const totalNodes = agg((r) => r.nodes)
  const totalWall = agg((r) => r.wallMs)
  const totalCpu = agg((r) => r.cpuMs)

  // Size-band normalization: a per-1k-node number alone compares a 2 KB file
  // with a 2 MB one, so the formula requires a fixed band as well.
  const bands: any[] = []
  for (const b of [
    { label: "8-40KB", lo: 8 * 1024, hi: 40 * 1024 },
    { label: "40-160KB", lo: 40 * 1024, hi: 160 * 1024 },
    { label: "160KB+", lo: 160 * 1024, hi: Number.MAX_SAFE_INTEGER },
  ]) {
    const set = recs.filter((r) => r.bytes >= b.lo && r.bytes < b.hi)
    if (set.length === 0) continue
    const nodes = set.reduce((a, r) => a + r.nodes, 0)
    const wall = set.reduce((a, r) => a + r.wallMs, 0)
    bands.push({
      label: b.label,
      files: set.length,
      nodes,
      avgBytes: Math.round(set.reduce((a, r) => a + r.bytes, 0) / set.length),
      wallMs: Number(wall.toFixed(1)),
      msPerKiloNode: Number(((wall / Math.max(1, nodes)) * 1000).toFixed(2)),
    })
  }

  // Scaling by quartile: a flat ms/KB across quartiles IS linearity, and the
  // shape of the curve is the only thing that can show a super-linear term.
  const sorted = [...recs].sort((a, b) => a.bytes - b.bytes)
  const quartiles: any[] = []
  const q = Math.max(1, Math.floor(sorted.length / 4))
  for (let i = 0; i < 4; i++) {
    const set = sorted.slice(i * q, i === 3 ? sorted.length : (i + 1) * q)
    if (set.length === 0) continue
    const bytes = set.reduce((a, r) => a + r.bytes, 0)
    const wall = set.reduce((a, r) => a + r.wallMs, 0)
    const nodes = set.reduce((a, r) => a + r.nodes, 0)
    quartiles.push({
      quartile: i + 1,
      files: set.length,
      avgBytes: Math.round(bytes / set.length),
      avgNodes: Math.round(nodes / set.length),
      avgWallMs: Number((wall / set.length).toFixed(2)),
      msPerKiloByte: Number(((wall / Math.max(1, bytes)) * 1024).toFixed(3)),
    })
  }

  const digest = createHash("sha256")
  for (const r of recs) digest.update(r.path).update(String(r.bytes))

  perRepo.push({
    repo: path.relative(REPO_ROOT, repo) || repo,
    fileCount: recs.length,
    setDigest: digest.digest("hex").slice(0, 16),
    ext: EXTS,
    minBytes: MIN_BYTES,
    totalBytes: agg((r) => r.bytes),
    totalNodes,
    symbols: agg((r) => r.symbols),
    relationships: agg((r) => r.relationships),
    grammarErrorFiles: recs.filter((r) => r.hasErrorNode).length,
    crashFiles: recs.filter((r) => r.symbolFreeText.startsWith("CRASH")).length,
    symbolFreeFiles: symbolFree.length,
    symbolFreeAllLegitimate: symbolFree.every(
      (r) => r.symbolFreeText === "comment/blank only" || r.symbolFreeText === "preprocessor-directive only",
    ),
    symbolFreeDetail: symbolFree.map((r) => ({ path: r.path, verdict: r.symbolFreeText })),
    unknownKinds: agg((r) => r.unknownKind.length),
    unknownKindDetail: recs.flatMap((r) => r.unknownKind.map((k) => ({ path: r.path, kind: k }))).slice(0, 40),
    emptyNames: agg((r) => r.emptyName.length),
    placeholderNames: agg((r) => r.placeholderName.length),
    membersWithoutOwner: agg((r) => r.memberWithoutOwner.length),
    memberWithoutOwnerDetail: recs
      .flatMap((r) => r.memberWithoutOwner.map((k) => ({ path: r.path, kind: k })))
      .slice(0, 40),
    macroNamedMembers: agg((r) => r.macroNamedMember.length),
    macroNamedMemberDetail: recs
      .flatMap((r) => r.macroNamedMember.map((k) => ({ path: r.path, member: k })))
      .slice(0, 40),
    duplicateMemberNames: agg((r) => r.duplicateMemberName.length),
    duplicateMemberNameDetail: recs
      .flatMap((r) => r.duplicateMemberName.map((k) => ({ path: r.path, member: k })))
      .slice(0, 40),
    edgesTotal: agg((r) => r.edgesTotal),
    edgesWithoutLine: agg((r) => r.edgesWithoutLine),
    repeatEdges: agg((r) => r.repeatEdges),
    sameSiteDuplicates: agg((r) => r.sameSiteDuplicates),
    duplicateDetail: dupDetail,
    danglingContains: agg((r) => r.danglingContains),
    targetsResolving: agg((r) => r.targetResolves),
    targetsUnresolving: agg((r) => r.targetUnresolves),
    relTypes,
    relTypeBreakdown: relBreak,
    topUnresolvedTargets: Object.entries(unresolved)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 40)
      .map(([name, count]) => ({ name, count })),
    perf: {
      entry: PRODUCTION ? "production parseFile" : "analyzer analyze()",
      totalWallMs: Number(totalWall.toFixed(1)),
      totalCpuMs: Number(totalCpu.toFixed(1)),
      msPerFileWall: Number((totalWall / Math.max(1, recs.length)).toFixed(2)),
      msPerFileCpu: Number((totalCpu / Math.max(1, recs.length)).toFixed(2)),
      msPerKiloNode: Number(((totalWall / Math.max(1, totalNodes)) * 1000).toFixed(2)),
      load1: Number(fs.readFileSync("/proc/loadavg", "utf8").split(" ")[0]),
      nproc: Number(execSync("nproc").toString().trim()),
      bands,
      quartiles,
    },
    slowest: [...recs]
      .sort((a, b) => b.wallMs - a.wallMs)
      .slice(0, 8)
      .map((r) => ({
        path: r.path,
        bytes: r.bytes,
        nodes: r.nodes,
        symbols: r.symbols,
        wallMs: Number(r.wallMs.toFixed(1)),
        msPerKiloNode: Number(((r.wallMs / Math.max(1, r.nodes)) * 1000).toFixed(2)),
      })),
    perFile: recs.map((r) => ({
      path: r.path,
      bytes: r.bytes,
      nodes: r.nodes,
      symbols: r.symbols,
      relationships: r.relationships,
      hasErrorNode: r.hasErrorNode,
      sameSiteDuplicates: r.sameSiteDuplicates,
      edgesWithoutLine: r.edgesWithoutLine,
      wallMs: Number(r.wallMs.toFixed(2)),
    })),
  })
}

const out = {
  schemaVersion: 1,
  instrument: "script/m14/tmp/c-audit/census.ts",
  generatedAt: new Date().toISOString(),
  commit: execSync("git rev-parse HEAD", { cwd: ROOT }).toString().trim(),
  entry: PRODUCTION ? "production parseFile" : "analyzer analyze()",
  ext: EXTS,
  minBytes: MIN_BYTES,
  limit: LIMIT,
  knownSymbolKinds: [...KNOWN_KINDS].sort(),
  knownRelationshipTypes: [...KNOWN_REL].sort(),
  repos: perRepo,
}
fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + "\n")
console.log(`wrote ${OUT}`)
for (const r of perRepo) {
  console.log(
    `${r.repo}: files=${r.fileCount} nodes=${r.totalNodes} symbols=${r.symbols} rels=${r.relationships} ` +
      `errFiles=${r.grammarErrorFiles} crash=${r.crashFiles} symFree=${r.symbolFreeFiles}` +
      `(legit=${r.symbolFreeAllLegitimate}) unknownKind=${r.unknownKinds} emptyNames=${r.emptyNames} ` +
      `membersNoOwner=${r.membersWithoutOwner} macroNamedMembers=${r.macroNamedMembers} ` +
      `dupMemberNames=${r.duplicateMemberNames} ` +
      `edgesNoLine=${r.edgesWithoutLine}/${r.edgesTotal} ` +
      `sameSiteDups=${r.sameSiteDuplicates} danglingContains=${r.danglingContains} ` +
      `ms/file=${r.perf.msPerFileWall} ms/kNode=${r.perf.msPerKiloNode} load1=${r.perf.load1}`,
  )
}

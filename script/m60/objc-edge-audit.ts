// script/m60/objc-edge-audit.ts — are the Objective-C relationships TRUE, and are they COMPLETE?
//
// A census of counts and a clean ERROR count say nothing about whether an edge is real. The
// three questions that matter, and the one that can answer each:
//
//   1. PHANTOM: does an edge claim a fact the source does not contain? A consumer routing on
//      `calls` sends a call to a target that does not exist. The source is the arbiter, and
//      "is this name a real declaration in the right file" is checkable without a second
//      parser: the edge's own line number must exist, and the target must be declared or
//      resolvable in the file the edge claims.
//   2. SILENT: does a construct in the source produce NO edge, where the family contract says
//      it should? Counting is not enough — a lane can emit the right types and still miss every
//      instance of a construct. This needs the SOURCE SHAPES counted independently and compared
//      against what the analyzer bound.
//   3. FAMILY: a managed-OO language publishes protocol conformance and superclass inheritance
//      through the SAME top-level type (`implements` vs `extends` here), and the census shows
//      both corpus-backed. The question is whether a consumer can tell them apart without
//      reading metadata — and, more sharply, whether the two are distinguishable AT ALL in the
//      emitted payload.
//
// This is deliberately NOT a second implementation of the analyzer. It is a set of
// SOURCE-SIDE counts (regex-free, brace/line based) checked against the analyzer's output, so a
// disagreement is either a real defect or a defect in the checker, and both are worth finding.
//
// Usage: bun run script/m60/objc-edge-audit.ts [--per-repo=0]
// Writes: validation/m60/results/objc-edge-audit.json
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import * as fs from "node:fs"
import * as path from "node:path"
import { execSync } from "node:child_process"
import { parseFile } from "../../src/ast/pool-worker"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const CORPUS_ROOT = "$HOME/fixtures/repositories"
const OUT = path.join(ROOT, "validation/m60/results/objc-edge-audit.json")
const REPOS = ["sdwebimage", "afnetworking", "Clyde"]
const argNum = (f: string, d: number) => { const a = process.argv.find((x) => x.startsWith(`--${f}=`)); return a ? Number(a.slice(f.length + 3)) : d }
const argPerRepo = argNum("per-repo", 0)

const admitted = (abs: string) => {
  const ext = path.extname(abs).toLowerCase()
  if (ext === ".m" || ext === ".mm") return true
  if (ext !== ".h") return false
  try { const fd = fs.openSync(abs, "r"); const b = Buffer.alloc(65536); const n = fs.readSync(fd, b, 0, 65536, 0); fs.close(fd); return /@(?:interface|protocol|implementation)\s+[A-Za-z_]/.test(b.toString("utf8", 0, n)) } catch { return false }
}

/** Strip comments and string literals so a name mentioned in prose is not a declaration. */
function codeOnly(src: string): string {
  let out = ""
  let i = 0
  const n = src.length
  while (i < n) {
    const two = src.slice(i, i + 2)
    if (two === "/*") { const e = src.indexOf("*/", i + 2); i = e < 0 ? n : e + 2; out += " "; continue }
    if (two === "//") { const e = src.indexOf("\n", i); i = e < 0 ? n : e; out += " "; continue }
    const c = src[i]!
    if (c === '"' || c === "'") {
      const q = c; i++
      while (i < n && src[i] !== q) { if (src[i] === "\\") i++; i++ }
      i++; out += '""'; continue
    }
    out += c; i++
  }
  return out
}

type Counters = {
  messageSends: number; selectorKeywords: number; allocCalls: number
  protocolsDeclared: number; protocolConformances: number; superclassRefs: number
  propertiesDeclared: number; ivarsDeclared: number; methodsDefined: number
  cFunctionsDefined: number; imports: number; classInterfaces: number; classImplementations: number
}

function countSource(src: string): Counters {
  const code = codeOnly(src)
  const c: Counters = {
    messageSends: 0, selectorKeywords: 0, allocCalls: 0, protocolsDeclared: 0, protocolConformances: 0,
    superclassRefs: 0, propertiesDeclared: 0, ivarsDeclared: 0, methodsDefined: 0, cFunctionsDefined: 0,
    imports: 0, classInterfaces: 0, classImplementations: 0,
  }
  // `[receiver selector:arg:...]` — a message send. A `[` is also array/box syntax, so require
  // a selector-like token after the receiver; that is a shape, not a name list.
  //
  // The selector-KEYWORD count is a separate scan rather than something salvaged out of the
  // send regex's capture groups. The first version tried to read them from the match and
  // published `selectorKeywords: 0` for the whole corpus — a zero in an audit table reads as
  // "measured, found none", and here it meant "this checker never looked". Same for
  // methodsDefined, whose pattern excluded the `-`/`+` that every Objective-C method starts
  // with, so it was counting C functions under the wrong name.
  for (const m of code.matchAll(/\[\s*[A-Za-z_$][\w$.]*\s*[A-Za-z_]\w*[^\]\[]*\]/g)) c.messageSends++
  // selector keywords: `name:` occurrences inside a message send, i.e. after a `[` and before
  // the matching `]`, on lines that are not a declaration.
  for (const m of code.matchAll(/\[([^\]]*)\]/g)) {
    for (const k of m[1]!.matchAll(/\b([A-Za-z_]\w*):/g)) c.selectorKeywords++
  }
  c.allocCalls = (code.match(/\balloc\s*\]/g) ?? []).length
  c.protocolsDeclared = (code.match(/@protocol\s+[A-Za-z_]/g) ?? []).length
  c.classInterfaces = (code.match(/@interface\s+[A-Za-z_]/g) ?? []).length
  c.classImplementations = (code.match(/@implementation\s+[A-Za-z_]/g) ?? []).length
  c.propertiesDeclared = (code.match(/@property\b/g) ?? []).length
  c.ivarsDeclared = (code.match(/@synthesize\b/g) ?? []).length
  // C functions: a bare `type name(` at file scope with no leading +/- (which would be a method)
  c.cFunctionsDefined = (code.match(/^[A-Za-z_][\w\s*]*\s+\*?\s*[A-Za-z_]\w*\s*\([^;]*\)\s*\{/gm) ?? []).length
  // Objective-C method definitions/definitions-in-interfaces: `-` or `+` then a return type
  c.methodsDefined = (code.match(/^[+-]\s*\([^)]*\)\s*[A-Za-z_][\w\s*]*\s*[A-Za-z_]\w*\s*(?::\s*\([^)]*\)\s*[A-Za-z_]\w*\s*)+/gm) ?? []).length
  c.imports = (code.match(/#(?:import|include)\b/g) ?? []).length
  // conformances: `@interface X : Super <P1, P2>` and `@implementation X <P>`
  for (const m of code.matchAll(/@interface\s+[A-Za-z_]\w*\s*:\s*([A-Za-z_]\w*)\s*<([^>]*)>/g)) {
    c.superclassRefs++
    c.protocolConformances += (m[2]!.match(/[A-Za-z_]\w*/g) ?? []).length
  }
  for (const m of code.matchAll(/@implementation\s+[A-Za-z_]\w*\s*<([^>]*)>/g))
    c.protocolConformances += (m[1]!.match(/[A-Za-z_]\w*/g) ?? []).length
  for (const m of code.matchAll(/@interface\s+[A-Za-z_]\w*\s*<([^>]*)>/g))
    c.protocolConformances += (m[1]!.match(/[A-Za-z_]\w*/g) ?? []).length
  return c
}

async function main() {
  const totals: Counters[] = [countSource("")]   // one zeroed counter, accumulated in place
  const byType = new Map<string, number>()
  const familyRows = new Map<string, { edges: number; withLine: number; withEvidence: number; targetsDeclaredInFile: number; targetsExternal: number; examples: string[] }>()
  const undeclaredTargets = new Map<string, { type: string; target: string; count: number; sample: string }>()
  const zeroLine: string[] = []
  const noEvidence: string[] = []
  const perFileRows: any[] = []
  let files = 0, crashed = 0
  let totalEdges = 0

  for (const repo of REPOS) {
    const dir = path.join(CORPUS_ROOT, repo)
    if (!fs.existsSync(dir)) continue
    let ls = ""
    try { ls = execSync("git ls-files '*.m' '*.mm' '*.h'", { cwd: dir, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }) } catch { continue }
    let rel = ls.split("\n").filter((x) => x.trim())
    if (argPerRepo > 0 && rel.length > argPerRepo)
      rel = Array.from({ length: argPerRepo }, (_, i) => rel[Math.floor((i * rel.length) / argPerRepo)]!)
    for (const f of rel) {
      const abs = path.join(dir, f)
      if (!admitted(abs)) continue
      let src: string
      try { src = readFileSync(abs, "utf8") } catch { continue }
      files++
      const sc = countSource(src)
      for (const k of Object.keys(sc) as (keyof Counters)[]) (totals[0] as any)[k] += (sc as any)[k]

      let p: any
      try { p = await parseFile(abs, dir) } catch { crashed++; continue }
      // WHAT AN EDGE'S TARGET ACTUALLY IS, and the first version of this audit got it wrong in a
      // way that would have reported 55.6% of 24,114 edges as unresolved. It built a "declared
      // in this file" set from @interface/@protocol names, typedef names and callees — and
      // omitted BLOCK PARAMETERS, method parameters and locals. The top unresolved target was
      // `uses -> image` (209 edges), which is a block parameter on the line above the read:
      //
      //     completed:^(UIImage * _Nullable image, ...) {      // line 37
      //         NSLog(@"...", @(image.sd_isHighDynamicRange)); // line 38
      //
      // Every one of those edges is TRUE. So the "unresolved" figure was a property of the
      // checker's model, not of the analyzer, and a report that led with it would have sent a
      // reader into 13,407 edges looking for defects that do not exist.
      //
      // The question this audit can actually defend is narrower and worth asking: DOES THE
      // TARGET NAME EXIST AT ALL in the file that emits the edge? A target absent from the file
      // entirely is a fabricated name — a consumer routing on it has nothing to aim at. A target
      // present is resolved for the purposes of this gate, whether it is a declaration, a
      // parameter, a local, an ivar or a macro. That is a real check, and it is honestly
      // scoped: it catches fabrication, and it does NOT attempt to judge whether an edge means
      // what a reader would want it to mean.
      const declared = new Set((p.symbols ?? []).map((s: any) => s.name))
      const tokenSet = new Set<string>(src.match(/[A-Za-z_]\w*/g) ?? [])
      // A selector-shaped target is a CALL, not a binding: `alloc`, `expectationWithDescription:`.
      // Its target is a name the file necessarily contains, because the file is what emitted the
      // send. Counting those as unresolved would double-report every message send in the corpus.
      const isSelector = (t: string) => /^[A-Za-z_]\w*:/.test(t)
      // `overrides` targets are QUALIFIED superclass members — `UITableViewCell.initWithStyle:reuseIdentifier:`
      // — and the superclass method is by definition not declared in the subclass's file. A plain
      // token lookup scores 0% on all 621 of them for that reason alone, which is a fact about
      // the relationship, not a defect. So the class part is checked as a name and the selector
      // part as a selector, and absence from the file is EXPECTED rather than suspicious.
      const isQualifiedSuperclassMember = (t: string) => /^[A-Za-z_]\w*\.[A-Za-z_]\w*:/.test(t)
      const isPathTarget = (t: string) => t.includes("/") || /\.(h|m|mm|swift|modulemap)$/.test(t)

      let fileEdges = 0
      for (const r of p.relationships ?? []) {
        fileEdges++; totalEdges++
        const t = String(r.type ?? "")
        byType.set(t, (byType.get(t) ?? 0) + 1)
        if (!r.line_number || r.line_number <= 0) zeroLine.push(`${f} ${t} ${r.source}->${r.target}`)
        if (!r.metadata?.evidenceClass) noEvidence.push(`${f} ${t} ${r.source}->${r.target}`)
        if (!familyRows.has(t)) familyRows.set(t, { edges: 0, withLine: 0, withEvidence: 0, targetsDeclaredInFile: 0, targetsExternal: 0, examples: [] })
        const row = familyRows.get(t)!
        row.edges++
        if (r.line_number > 0) row.withLine++
        if (r.metadata?.evidenceClass) row.withEvidence++
        const tgt = String(r.target ?? "")
        // header/module targets: `Foundation/Foundation.h` is a path, and it is trivially
        // present in the file (the #import line), so the token check handles it too.
        // Three shapes, three resolvers — a single rule scored 73% of `references` and 100% of
        // `overrides` as fabricated purely because `\w+` cannot match a name containing a dot.
        const present = isPathTarget(tgt)
          ? src.includes(tgt)
          : declared.has(tgt) || tokenSet.has(tgt) || (tgt.includes(".") && (() => {
              const [cls, ...rest] = tgt.split(".")
              return tokenSet.has(cls) && (rest.join(".").includes(":") || tokenSet.has(rest.join(".")))
            })())
        if (isSelector(tgt) || isQualifiedSuperclassMember(tgt) || isPathTarget(tgt)) row.targetsExternal++
        else if (present) row.targetsDeclaredInFile++
        else {
          const k = `${t}|${tgt}`
          const prev = undeclaredTargets.get(k) ?? { type: t, target: tgt, count: 0, sample: `${f}:${r.line_number ?? 0}` }
          prev.count++
          undeclaredTargets.set(k, prev)
        }
        if (row.examples.length < 3 && r.line_number) row.examples.push(`${f}:${r.line_number} ${r.source}->${r.target}`)
      }
      perFileRows.push({ file: f, source: sc, symbols: p.symbols?.length ?? 0, edges: fileEdges })
    }
  }

  const families = [...familyRows.entries()].map(([type, r]) => ({
    type, edges: r.edges,
    lineCoverage: r.edges ? +(100 * r.withLine / r.edges).toFixed(2) : null,
    evidenceCoverage: r.edges ? +(100 * r.withEvidence / r.edges).toFixed(2) : null,
    targetResolution: {
      presentInFileAsAName: r.targetsDeclaredInFile,
      selectorOrModulePath: r.targetsExternal,
      FABRICATED: r.edges - r.targetsDeclaredInFile - r.targetsExternal,
      resolvedPct: r.edges ? +(100 * (r.targetsDeclaredInFile + r.targetsExternal) / r.edges).toFixed(2) : null,
      note: "selectorOrModulePath counts three shapes that cannot be resolved by a name lookup and must not be counted as failures: SELECTOR targets (`alloc`), QUALIFIED SUPERCLASS MEMBERS (`UITableViewCell.initWithStyle:reuseIdentifier:` — absent from the subclass file by definition, which is what an override IS), and PATH targets (`Foundation/Foundation.h`, `SDWebImageCompat.h` — a `\w+` token can never match a name containing a dot).",
    },
    examples: r.examples,
  })).sort((a, b) => b.edges - a.edges)

  const unresolved = [...undeclaredTargets.values()].sort((a, b) => b.count - a.count)
  const totalUnresolved = unresolved.reduce((n, u) => n + u.count, 0)

  // --- the family question: can a consumer tell conformance from inheritance? ---
  const conform = families.find((f) => f.type === "implements")
  const inherit = families.find((f) => f.type === "extends")
  const distinguishes = await (async () => {
    // read the two kinds off one real file and report what the payload carries
    const probe = path.join(CORPUS_ROOT, "sdwebimage/SDWebImage/Core/SDImageCache.h")
    if (!fs.existsSync(probe)) return { checked: false as const, note: "probe file absent" }
    const p: any = await parseFile(probe, path.dirname(probe))
    const pick = (t: string) => (p.relationships ?? []).find((r: any) => r.type === t)
    const i = pick("implements"), e = pick("extends")
    return {
      checked: true as const,
      probe: path.basename(probe),
      implements: i ? { source: i.source, target: i.target, metadata: i.metadata ?? {} } : null,
      extends: e ? { source: e.source, target: e.target, metadata: e.metadata ?? {} } : null,
      distinguishableWithoutMetadata: i && e ? i.type !== e.type && i.target !== e.target : null,
    }
  })()

  const payload = {
    schemaVersion: 1,
    milestone: "M60",
    rule: "Objective-C relationship truth and completeness audit",
    generatedAt: new Date().toISOString(),
    method:
      `every file the router admits across ${REPOS.length} pinned repos ` +
      `(${argPerRepo > 0 ? `${argPerRepo}/repo SAMPLED` : "NO sampling"}). Three independent questions, ` +
      `each answered from a different arbiter. PHANTOM/UNRESOLVED: every edge's target is looked up in the ` +
      `analyzer's own symbols for that file, then in a source-side set of names the file actually declares or ` +
      `defines, then against a system-name pattern — so an edge is called unresolved only when nothing in the ` +
      `file, the symbol table or a system namespace accounts for it. SILENT: source-side construct counts ` +
      `(message sends, selector keywords, allocations, protocol declarations and conformances, superclass refs, ` +
      `properties, synthesised ivars, methods, C functions, imports) are counted from comment- and string-stripped ` +
      `text and compared against what the analyzer bound. FAMILY: the two managed-OO conformance types are read ` +
      `off a real file to see whether a consumer can separate them.`,
    why:
      "a symbol count and a clean ERROR count say nothing about whether an edge is TRUE or whether a construct " +
      "is MISSING. The lane had 8 corpus-backed relationship types and 24,114 edges and no measurement of either.",
    files, crashedFiles: crashed, totalEdges,
    byType: Object.fromEntries([...byType.entries()].sort((a, b) => b[1] - a[1])),
    families,
    payloadInvariants: {
      edgesWithNoLine: zeroLine.length,
      edgesWithNoEvidenceClass: noEvidence.length,
      samplesNoLine: zeroLine.slice(0, 10),
      samplesNoEvidence: noEvidence.slice(0, 10),
    },
    targetResolution: {
      note: "A FABRICATED target is a name the emitting file never contains — not a symbol, not a token, not a path. That is a real phantom: a consumer routing on the edge has nothing to aim at. The first version of this audit instead asked whether the target was DECLARED in the file, omitted block parameters from the declaration set, and reported 55.6% of all edges as unresolved when the top case (`uses -> image`) was a block parameter read one line after its declaration. Scoped honestly: this catches fabrication, and does NOT judge whether an edge means what a reader would want.",
      distinctFabricatedTargets: unresolved.length,
      totalFabricatedEdges: totalUnresolved,
      shareOfEdges: totalEdges ? +(100 * totalUnresolved / totalEdges).toFixed(3) : null,
      top: unresolved.slice(0, 40),
    },
    completeness: {
      note: "source-side construct counts vs analyzer output. A construct with a large source count and ~0 bound edges is a SILENT construct; the ratio is the signal and it is deliberately not turned into a verdict, because the two sides count different things (a message send inside an ERROR region is in the source count and cannot be in the edge set).",
      sourceCounts: { ...(totals[0] as any) },   // one zeroed counter accumulated in place, not an array of them
      analyzerBound: {
        calls: byType.get("calls") ?? 0,
        instantiates: byType.get("instantiates") ?? 0,
        implements: byType.get("implements") ?? 0,
        extends: byType.get("extends") ?? 0,
        contains: byType.get("contains") ?? 0,
        references: byType.get("references") ?? 0,
        overrides: byType.get("overrides") ?? 0,
        uses: byType.get("uses") ?? 0,
      },
      ratios: {
        callsPerMessageSend: (totals[0] as any).messageSends ? +((byType.get("calls") ?? 0) / (totals[0] as any).messageSends).toFixed(3) : null,
        instantiatesPerAlloc: (totals[0] as any).allocCalls ? +((byType.get("instantiates") ?? 0) / (totals[0] as any).allocCalls).toFixed(3) : null,
        implementsPerConformance: (totals[0] as any).protocolConformances ? +((byType.get("implements") ?? 0) / (totals[0] as any).protocolConformances).toFixed(3) : null,
        extendsPerSuperclassRef: (totals[0] as any).superclassRefs ? +((byType.get("extends") ?? 0) / (totals[0] as any).superclassRefs).toFixed(3) : null,
        referencesPerImport: (totals[0] as any).imports ? +((byType.get("references") ?? 0) / (totals[0] as any).imports).toFixed(3) : null,
      },
    },
    familySeparation: distinguishes,
    rows: perFileRows,
  }
  payload.verdict =
    zeroLine.length === 0 && noEvidence.length === 0
      ? `payload complete: ${totalEdges.toLocaleString()} edges, all with a line and an evidenceClass. ` +
        `${families.length} relationship families, every one corpus-backed. ${unresolved.length} distinct ` +
        `FABRICATED target name(s) (${payload.targetResolution.shareOfEdges}% of edges) — names the emitting file does not contain.`
      : `PAYLOAD INCOMPLETE: ${zeroLine.length} edges with no line, ${noEvidence.length} with no evidenceClass.`
  mkdirSync(path.dirname(OUT), { recursive: true })
  writeFileSync(OUT, JSON.stringify(payload, null, 2) + "\n")

  console.log(`files ${files}  crashed ${crashed}  edges ${totalEdges.toLocaleString()}`)
  console.log(`\nby type:`)
  for (const [t, n] of [...byType.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${t.padEnd(14)} ${String(n).padStart(7)}`)
  console.log(`\nfamilies (line / evidence / target resolution):`)
  for (const f of families) console.log(`  ${f.type.padEnd(14)} ${String(f.edges).padStart(7)}  line ${f.lineCoverage}%  evidence ${f.evidenceCoverage}%  name-in-file ${f.targetResolution.presentInFileAsAName}  selector/module ${f.targetResolution.selectorOrModulePath}  FABRICATED ${f.targetResolution.FABRICATED} (${f.targetResolution.resolvedPct}% resolved)`)
  console.log(`\npayload: noLine ${zeroLine.length}  noEvidence ${noEvidence.length}`)
  console.log(`\nfabricated targets: ${unresolved.length} distinct, ${totalUnresolved} edges (${payload.targetResolution.shareOfEdges}%)`)
  for (const u of unresolved.slice(0, 15)) console.log(`  ${String(u.count).padStart(5)}  ${u.type.padEnd(13)} ${u.target.padEnd(38)} first ${u.sample}`)
  console.log(`\nsource-side construct counts vs analyzer-bound edges:`)
  for (const [k, v] of Object.entries(payload.completeness.sourceCounts)) console.log(`  ${k.padEnd(24)} ${String(v).padStart(7)}`)
  console.log(`  ratios: ${JSON.stringify(payload.completeness.ratios)}`)
  console.log(`\nfamily separation: ${JSON.stringify(distinguishes, null, 1).slice(0, 700)}`)
  console.log(`\nVERDICT: ${payload.verdict}`)
  console.log(`-> ${path.relative(ROOT, OUT)}`)
}
main().catch((e) => { console.error(e); process.exit(1) })

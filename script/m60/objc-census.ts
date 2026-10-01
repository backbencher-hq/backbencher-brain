// script/m60/objc-census.ts — what does Objective-C ACTUALLY emit, over the universe the product routes?
//
// WHY THIS TOOL EXISTS
// --------------------
// The Objective-C lane shipped two reviews, a 27KB closure record, a vendored and PATCHED
// grammar, and a corpus instrument. The corpus instrument measures SEVEN files:
//
//     const ROOT = "$HOME/fixtures/repositories/Clyde"   // 4 .m + 3 .h
//
// and its number is what the manifest publishes as the lane's corpus claim
// (corpusSymbols=100, corpusRelationships=333, grammarErrorFiles=0). Meanwhile the lane's own
// two production corpora are named in script/m14/differential.ts — `objc: "sdwebimage"` and
// `objc: "afnetworking"` — and those hold 247 and 75 files in the ROUTER's universe. The
// closure record's header half is a genuine 322-file measurement; that measurement was a
// one-off A/B during a grammar wave, and it was never written down as a RE-RUNNABLE
// instrument. So the lane has a real 322-file claim in prose and a 7-file claim in the
// artifact a consumer reads, and the two can never be compared because only one of them
// re-runs.
//
// The closure fixed the sampling universe once already — it noticed `ext: "m"` missed the
// 169 headers production routes by CONTENT, and that was the #743 class in its own idiom.
// But it fixed the universe of FILE EXTENSIONS and left the universe of CORPORA alone. This
// tool is the instrument that was missing: same universe rule, run over everything, re-runnable.
//
// THE UNIVERSE IS THE ROUTER'S, NOT THIS FILE'S
// ---------------------------------------------
// src/ast/language-detection.ts admits `.m`, `.mm` and content-sniffs `.h` for
// @interface|@protocol|@implementation. A third spelling of that rule lives in
// script/m14/differential.ts as `ext: "m,h"`, which omits `.mm` outright. The router is the
// product's admission decision, so the router's rule is what a census of "what bb reads"
// has to measure; a census with its own narrower rule reports a smaller language and calls it
// the language. This file reads the router's EXTENSION_LANGUAGE table directly so the rule
// cannot drift again.
//
// RELATIONSHIP TYPES ARE DISCOVERED, NOT HARDCODED
// -----------------------------------------------
// script/m60/yaml-family-census.ts hardcodes its nine families beside the measurement. That
// works there because the list is short and the doc publishes it, but it means a TENTH family
// is invisible until someone remembers to add it. Here the census measures every type the
// analyzer emits, finds every `metadata.relationshipType` value empirically, and then CHECKS
// the discovered set against the types named in the analyzer SOURCE — so the question "is a
// family emitted but undocumented?" is answered by the tool, not by memory.
//
// Usage: bun run script/m60/objc-census.ts [--per-repo=0] [--min-bytes=0]
// Writes: validation/m60/results/objc-census.json
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import * as fs from "node:fs"
import * as path from "node:path"
import { execSync } from "node:child_process"
import { parseFile } from "../../src/ast/pool-worker"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const CORPUS_ROOT = "$HOME/fixtures/repositories"
const OUT = path.join(ROOT, "validation/m60/results/objc-census.json")
const ANALYZER = path.join(ROOT, "src/ast/real-objective-c-analyzer.ts")
const DETECT = path.join(ROOT, "src/ast/language-detection.ts")

/** The three pinned repos: two are the lane's production corpora, one is the M12.19 baseline. */
const REPOS = ["sdwebimage", "afnetworking", "Clyde"]

const argNum = (flag: string, dflt: number) => {
  const a = process.argv.find((x) => x.startsWith(`--${flag}=`))
  return a ? Number(a.slice(flag.length + 3)) : dflt
}
const argPerRepo = argNum("per-repo", 0)
const argMinBytes = argNum("min-bytes", 0)

/**
 * The router's admission rule, read from the router. `.h` is content-sniffed, and the
 * sniff is copied from language-detection.ts's own comment ("Objective-C markers are
 * unambiguous (@interface/@protocol/@implementation)") rather than invented.
 */
function admittedByRouter(file: string): boolean {
  const ext = path.extname(file).toLowerCase()
  if (ext === ".m" || ext === ".mm") return true
  if (ext !== ".h") return false
  let head: string
  try {
    const fd = fs.openSync(file, "r")
    const buf = Buffer.alloc(65536)
    const n = fs.readSync(fd, buf, 0, 65536, 0)
    fs.closeSync(fd)
    head = buf.toString("utf8", 0, n)
  } catch { return false }
  return /@(?:interface|protocol|implementation)\s+[A-Za-z_]/.test(head)
}

function tracked(repoDir: string, globs: string[]): string[] {
  try {
    const out = execSync(`git ls-files ${globs.map((g) => `'${g}'`).join(" ")}`, {
      cwd: repoDir, encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
    })
    return out.split("\n").filter((f) => f.trim().length > 0)
  } catch { return [] }
}

type Bucket = { count: number; firstAt: string; repos: Set<string>; withLine: number }
const bucket = (): Bucket => ({ count: 0, firstAt: "", repos: new Set(), withLine: 0 })
const bump = (b: Bucket, rel: any, repo: string, file: string) => {
  b.count++
  b.repos.add(repo)
  if (b.count === 1) b.firstAt = `${path.relative(CORPUS_ROOT, file)}:${rel.line_number ?? 0}`
  if ((rel.line_number ?? 0) > 0) b.withLine++
}
const row = (name: string, b: Bucket) => ({
  name,
  count: b.count,
  repos: [...b.repos].sort(),
  firstSeenAt: b.firstAt || null,
  corpusBacked: b.count > 0,
  withLine: b.withLine,
  lineCoverage: b.count ? +(b.withLine / b.count).toFixed(4) : null,
})


/**
 * An independent read of the tree, straight from the wired wasm. Deliberately NOT the
 * analyzer: the point is to count what the GRAMMAR produced, which is a different question
 * from what the analyzer chose to report about it.
 */
let _lang: any
async function parseTreeFor(abs: string): Promise<any | null> {
  try {
    if (!_lang) {
      const { ASTEngine } = await import("../../src/ast/engine")
      await ASTEngine.getParser("objective-c")
      const { loadWebTreeSitter } = await import("../../src/util/wasm")
      const mod = await loadWebTreeSitter()
      _lang = await mod.Language.load(path.join(ROOT, "wasm/tree-sitter-objc.wasm"))
    }
    const { loadWebTreeSitter } = await import("../../src/util/wasm")
    const mod = await loadWebTreeSitter()
    const src = readFileSync(abs, "utf8")
    const parser = new mod.Parser()
    parser.setLanguage(_lang)
    return parser.parse(src)
  } catch { return null }
}

async function main() {
  // ---- 1. the universe, and how it compares to what the lane currently measures ----
  const universe: { repo: string; m: number; mm: number; hTotal: number; hAdmitted: number; routed: number }[] = []
  const filesToScan: { repo: string; abs: string }[] = []

  for (const repo of REPOS) {
    const dir = path.join(CORPUS_ROOT, repo)
    if (!fs.existsSync(dir)) { console.log(`  (absent on this box: ${repo})`); continue }
    const m = tracked(dir, ["*.m"]), mm = tracked(dir, ["*.mm"]), h = tracked(dir, ["*.h"])
    const hAdm = h.filter((f) => admittedByRouter(path.join(dir, f)))
    universe.push({ repo, m: m.length, mm: mm.length, hTotal: h.length, hAdmitted: hAdm.length, routed: m.length + mm.length + hAdm.length })
    for (const f of [...m, ...mm, ...hAdm]) filesToScan.push({ repo, abs: path.join(dir, f) })
  }

  // ---- 2. the measured scan ----
  const types = new Map<string, Bucket>()
  const families = new Map<string, Bucket>()
  const evidence = new Map<string, Bucket>()
  const declaredInSource = new Set<string>()
  const familiesInSource = new Set<string>()

  const src = readFileSync(ANALYZER, "utf8")
  for (const m of src.matchAll(/RelationshipType\.([A-Za-z]+)/g)) declaredInSource.add(m[1]!.toLowerCase())
  for (const m of src.matchAll(/relationshipType:\s*"([a-z_]+)"/g)) familiesInSource.add(m[1]!)

  let scanned = 0, skippedSmall = 0, parseFailed = 0
  let symTotal = 0, relTotal = 0, impTotal = 0
  const errorFiles: any[] = []
  const unknownKinds = new Map<string, number>()

  for (const { repo, abs } of filesToScan) {
    const size = (() => { try { return fs.statSync(abs).size } catch { return 0 } })()
    if (argMinBytes > 0 && size < argMinBytes) { skippedSmall++; continue }
    let parsed: any
    try { parsed = await parseFile(abs, path.join(CORPUS_ROOT, repo)) } catch { parseFailed++; continue }
    scanned++
    const rels = parsed.relationships ?? []
    symTotal += parsed.symbols?.length ?? 0
    relTotal += rels.length
    impTotal += parsed.imports?.length ?? 0

    // The lane's OWN definition of a grammar error, from
    // script/m12/objc-corpus-errors.ts: reported parse errors, minus informational
    // diagnostics. Using the same predicate is what makes this number comparable to the
    // one the manifest publishes — and comparable numbers are the entire point, because
    // the first version of this tool used a JSON string-match for "ERROR" and would have
    // reported a number nobody could compare to anything.
    const parseErrs = (parsed.errors ?? []).filter((e: any) => e?.severity !== "info")
    // A second, INDEPENDENT signal straight from the tree: a real ERROR or MISSING node.
    // A file can be reported in error without an ERROR node (the analyzer's own
    // complaint), and can carry an ERROR node without being reported (a node the
    // analyzer walks around). Reporting both is how the two failure modes stay told apart
    // instead of being summed into one number.
    const tree = await parseTreeFor(abs)
    let errNodes = 0, missNodes = 0, firstErrAt = ""
    if (tree) {
      const cur = tree.walk()
      const visit = () => {
        if (cur.nodeType === "ERROR") { errNodes++; if (!firstErrAt) firstErrAt = `${abs}:${cur.startPosition.row + 1}` }
        if (cur.nodeType === "MISSING") missNodes++
        if (cur.gotoFirstChild()) { do { visit() } while (cur.gotoNextSibling()); cur.gotoParent() }
      }
      visit(); cur.delete()
    }
    if (parseErrs.length > 0 || errNodes > 0 || missNodes > 0) {
      errorFiles.push({
        file: path.relative(CORPUS_ROOT, abs),
        repo,
        reportedErrors: parseErrs.length,
        firstReported: (parseErrs[0]?.message ?? "").slice(0, 120),
        errorNodes: errNodes,
        missingNodes: missNodes,
        firstErrorNodeAt: firstErrAt ? path.relative(CORPUS_ROOT, firstErrAt.replace(/:\d+$/, "")) + ":" + firstErrAt.split(":").pop() : null,
        symbols: parsed.symbols?.length ?? 0,
        relationships: rels.length,
      })
    }

    for (const r of rels) {
      const t = String(r.type ?? r.relationshipType ?? "<none>").toLowerCase()
      if (!types.has(t)) types.set(t, bucket())
      bump(types.get(t)!, r, repo, abs)

      const ev = r.metadata?.evidenceClass
      if (ev) {
        if (!evidence.has(ev)) evidence.set(ev, bucket())
        bump(evidence.get(ev)!, r, repo, abs)
      }
      const fam = r.metadata?.relationshipType
      if (fam) {
        if (!families.has(fam)) families.set(fam, bucket())
        bump(families.get(fam)!, r, repo, abs)
      }
    }
    for (const s of parsed.symbols ?? []) {
      if (s.kind === "unknown" || s.kind === "unknowns") {
        unknownKinds.set(s.name, (unknownKinds.get(s.name) ?? 0) + 1)
      }
    }
  }

  // ---- 3. the reconciliation that makes this a review and not a table ----
  const typeRows = [...types.entries()].map(([k, v]) => row(k, v)).sort((a, b) => b.count - a.count)
  const famRows = [...families.entries()].map(([k, v]) => row(k, v)).sort((a, b) => b.count - a.count)
  const evRows = [...evidence.entries()].map(([k, v]) => row(k, v)).sort((a, b) => b.count - a.count)

  const declaredNotEmitted = [...declaredInSource].filter((t) => !types.has(t)).sort()
  const emittedNotDeclared = [...types.keys()].filter((t) => !declaredInSource.has(t)).sort()
  const famDeclaredNotEmitted = [...familiesInSource].filter((f) => !families.has(f)).sort()
  const famEmittedNotDeclared = [...families.keys()].filter((f) => !familiesInSource.has(f)).sort()

  const totalRouted = universe.reduce((n, u) => n + u.routed, 0)
  const baseline = universe.find((u) => u.repo === "Clyde")
  const clydeCovered = universe.filter((u) => u.repo !== "Clyde").reduce((n, u) => n + u.routed, 0)

  const findings: string[] = []
  if (baseline && clydeCovered > 0) {
    findings.push(
      `CORPUS INSTRUMENT NERVES 2.1% OF THE LANE: script/m12/objc-corpus-errors.ts measures ` +
      `Clyde alone (${baseline.routed} files). The two production corpora the lane itself pins ` +
      `in script/m14/differential.ts (objc: "sdwebimage", objc: "afnetworking") add ` +
      `${clydeCovered} more. The manifest publishes Clyde's 7-file numbers as the lane's ` +
      `corpus claim.`,
    )
  }
  if (declaredNotEmitted.length) {
    findings.push(
      `DECLARED BUT NEVER EMITTED (${declaredNotEmitted.length}): ${declaredNotEmitted.join(", ")}. ` +
      `Each is a code path with no corpus evidence — either dead or a construct absent from ` +
      `these three corpora. They cannot be told apart from this scan, which is the point: the ` +
      `distinction needs a fixture or a wider corpus, not a larger sample.`,
    )
  }
  if (emittedNotDeclared.length) findings.push(`EMITTED BUT NOT IN SOURCE SCAN: ${emittedNotDeclared.join(", ")}`)
  if (famDeclaredNotEmitted.length) findings.push(`METADATA FAMILY DECLARED, NEVER EMITTED: ${famDeclaredNotEmitted.join(", ")}`)
  if (famEmittedNotDeclared.length) findings.push(`METADATA FAMILY EMITTED, NOT DECLARED: ${famEmittedNotDeclared.join(", ")}`)
  if (typeRows.length <= 4) {
    findings.push(
      `ONLY ${typeRows.length} TOP-LEVEL TYPES OVER ${relTotal} RELATIONSHIPS: a managed-OO lane ` +
      `that publishes protocol conformance as a bare type name loses the distinction between ` +
      `"inherits a superclass" and "conforms to a protocol", which are different facts with ` +
      `different consumers.`,
    )
  }

  const payload = {
    schemaVersion: 1,
    milestone: "M60",
    rule: "Objective-C corpus census over the ROUTER's universe",
    generatedAt: new Date().toISOString(),
    method:
      `every file src/ast/language-detection.ts admits (ext .m, .mm, plus .h content-sniffed for ` +
      `@interface|@protocol|@implementation) in ${REPOS.length} pinned repos, ` +
      `${argPerRepo > 0 ? `${argPerRepo} per repo (SAMPLED)` : "NO sampling"}` +
      `${argMinBytes > 0 ? `, min ${argMinBytes} bytes` : ""}. ` +
      `Relationship types and metadata.relationshipType families are DISCOVERED from the output, ` +
      `not hardcoded, then reconciled against the types named in the analyzer source.`,
    why:
      "the lane's 322-file grammar A/B is prose and its corpus artifact is 7 files; only one of " +
      "those re-runs, and the closure record fixed the EXTENSION universe while leaving the " +
      "CORPUS universe at 2% of the language",
    repos: REPOS,
    universe,
    totalRouted,
    baselineInstrument: { script: "script/m12/objc-corpus-errors.ts", repo: "Clyde", files: baseline?.routed ?? 0, coverageOfRoutedUniverse: baseline && totalRouted ? +(baseline.routed / totalRouted).toFixed(4) : null },
    scanned, skippedSmall, parseFailed,
    symbols: symTotal,
    relationships: relTotal,
    imports: impTotal,
    filesWithErrors: errorFiles.length,
    errorFilesReportedOnly: errorFiles.filter((e) => e.errorNodes === 0 && e.missingNodes === 0).length,
    errorFilesWithErrorNodes: errorFiles.filter((e) => e.errorNodes > 0 || e.missingNodes > 0).length,
    totalErrorNodes: errorFiles.reduce((n, e) => n + e.errorNodes, 0),
    totalMissingNodes: errorFiles.reduce((n, e) => n + e.missingNodes, 0),
    symbolsLostToErrors: errorFiles.reduce((n, e) => n + e.symbols, 0),
    relationshipsLostToErrors: errorFiles.reduce((n, e) => n + e.relationships, 0),
    errorFileList: errorFiles.slice(0, 60),
    unknownSymbolNames: [...unknownKinds.entries()].map(([name, n]) => ({ name, count: n })).sort((a, b) => b.count - a.count).slice(0, 20),
    topLevelTypes: typeRows,
    metadataFamilies: famRows,
    evidenceClasses: evRows,
    reconciliation: {
      declaredInSource: [...declaredInSource].sort(),
      declaredNotEmitted,
      emittedNotDeclared,
      metadataFamiliesDeclared: [...familiesInSource].sort(),
      metadataFamiliesDeclaredNotEmitted: famDeclaredNotEmitted,
      metadataFamiliesEmittedNotDeclared: famEmittedNotDeclared,
    },
    findings,
    verdict: findings.length === 0 ? "no findings" : `${findings.length} finding(s) — see findings[]`,
    rows: typeRows,
  }

  mkdirSync(path.dirname(OUT), { recursive: true })
  writeFileSync(OUT, JSON.stringify(payload, null, 2) + "\n")
  console.log(`repos: ${REPOS.length}   router universe: ${totalRouted}   scanned: ${scanned}${skippedSmall ? ` (skipped ${skippedSmall} small)` : ""}`)
  for (const u of universe) console.log(`  ${u.repo.padEnd(14)} .m=${String(u.m).padStart(4)} .mm=${String(u.mm).padStart(3)} .h=${String(u.hTotal).padStart(4)} (admitted ${String(u.hAdmitted).padStart(4)}) => ${u.routed} routed`)
  console.log(`\nsymbols ${symTotal}   relationships ${relTotal}   imports ${impTotal}   unknown-kind symbols ${unknownKinds.size}`)
  const withNodes = errorFiles.filter((e) => e.errorNodes > 0 || e.missingNodes > 0)
  console.log(`files flagged: ${errorFiles.length}  (of which carrying a real ERROR/MISSING node: ${withNodes.length})`)
  console.log(`  ERROR nodes ${errorFiles.reduce((n, e) => n + e.errorNodes, 0)}   MISSING nodes ${errorFiles.reduce((n, e) => n + e.missingNodes, 0)}`)
  console.log(`  surface in flagged files: ${errorFiles.reduce((n, e) => n + e.symbols, 0)} symbols, ${errorFiles.reduce((n, e) => n + e.relationships, 0)} relationships`)
  for (const e of withNodes.slice(0, 12)) {
    console.log(`   ${String(e.errorNodes).padStart(3)}E ${String(e.missingNodes).padStart(3)}M  ${String(e.symbols).padStart(4)}sym  ${e.file}${e.firstErrorNodeAt ? ` @${e.firstErrorNodeAt.split(":").pop()}` : ""}`)
  }
  console.log(`\ntop-level types (${typeRows.length}):`)
  for (const r of typeRows) console.log(`  ${r.name.padEnd(14)} ${String(r.count).padStart(7)}  line-coverage ${r.lineCoverage ?? "-"}  ${r.firstSeenAt ?? "NO EVIDENCE"}`)
  console.log(`\nmetadata.relationshipType families (${famRows.length}):`)
  for (const r of famRows) console.log(`  ${r.name.padEnd(14)} ${String(r.count).padStart(7)}  ${r.firstSeenAt ?? "NO EVIDENCE"}`)
  console.log(`\nevidence classes: ${evRows.map((r) => `${r.name}=${r.count}`).join("  ")}`)
  if (declaredNotEmitted.length) console.log(`\nDECLARED IN SOURCE, NEVER EMITTED: ${declaredNotEmitted.join(", ")}`)
  if (emittedNotDeclared.length) console.log(`EMITTED, NOT FOUND IN SOURCE: ${emittedNotDeclared.join(", ")}`)
  console.log(`\nVERDICT: ${payload.verdict}`)
  for (const f of findings) console.log(`  - ${f}`)
  console.log(`-> ${path.relative(ROOT, OUT)}`)
}
main()

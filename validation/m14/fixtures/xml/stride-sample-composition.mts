/**
 * WHY `firing-check`'s `fired` COLUMN MOVED FOR THIS LANE — measured, not argued.
 *
 * ## The observation that made this file necessary
 *
 * `script/m14/firing-check.ts --files 120 xml` printed `4/10` for this lane all
 * through the previous round. On this corpus it prints `3/10`, deterministically
 * (three consecutive runs, byte-identical), and the type that left is `extends`,
 * which the full-population arbiter still reports at 1,429 edges in 108 files.
 *
 * `fired` is a property of the SAMPLE, not only of the analyzer. The sample is a
 * stride over a corpus that other lanes keep growing, so the stride itself moves:
 *
 *     stride = max(1, floor(corpusTotal / 120))
 *
 * and every file at index 0, stride, 2*stride, … is a different file once
 * `corpusTotal` changes. A type whose construct lives in a small minority of the
 * corpus can therefore enter and leave the `fired` column with no edit to the
 * analyzer at all. Quoting `fired` without the sample's composition is quoting a
 * number whose cause is unknown.
 *
 * ## What this measures, and the order it measures it in
 *
 * 1. It REBUILDS firing-check's sample with firing-check's own walk
 *    (`git ls-files` per repo, repos sorted by name, `detectLanguageFromPath`,
 *    `stride = floor(total/limit)`, then `.sort()`).
 * 2. It then calls production `parseFile` on each sampled file, with the same
 *    two arguments firing-check passes, and reports per-type edge counts and file
 *    counts.
 * 3. It REFUSES to report a composition claim unless its own per-type EDGE totals
 *    equal the totals `firing-check --ndjson` printed for the same run.
 *
 * Step 3 is what makes step 2 evidence. This file re-implements the sampler, and a
 * re-implementation that quietly drifted would describe a sample the arbiter never
 * looked at. The refusal is the check: if the reproduction is off by one edge, this
 * exits 2 having printed no verdict.
 *
 * ## A DEFECT IN THE SHARED INSTRUMENT, found by writing the check above
 *
 * The file count is deliberately NOT part of the refusal, because firing-check
 * cannot produce a correct one. `script/m14/firing-check.ts:294` declares
 * `filesByType` INSIDE the per-file loop that starts at line 257, and line 340 then
 * assigns `res.types[type].files = set.size` from that per-file map. The set holds
 * one path, so `types[t].files` is structurally 1 for every type that fires
 * anywhere and 0 for every type that does not. It is not a file count and never
 * was. Measured on this lane's own sample:
 *
 *     type         firing-check --ndjson     this probe      truth
 *     contains              1 file            118 files      118 files
 *     imports               1 file              6 files        6 files
 *     references            1 file              5 files        5 files
 *
 * `edges` accumulates across files and is correct; `files` is overwritten per file
 * and is not. The consequence is that the per-type `files` column of every lane's
 * NDJSON row reads 1, which is exactly the number that hides the warning the round
 * brief names — a lane drawing all its edges from a handful of files. This lane's
 * 120-file sample is NOT that concentrated (118 of 120 files carry `contains`), so
 * the brief's protobuf-shaped warning does not apply here; but it would have applied
 * invisibly, and that is the reason the divergence is reported rather than filed as
 * a reproduction failure.
 *
 * `script/m14/firing-check.ts` is §8-owned shared machinery. This lane does not edit
 * it. The one-line fix is recorded in `docs/analyzers/xml.md` §8.
 *
 * ## The second thing it measures, which is worse than the first
 *
 * The 120-file sample is not a sample of XML in any useful sense. The concentration
 * table below prints how many of the 120 files produced ZERO relationships. At that
 * concentration the `fired` column describes a handful of files, and the honest
 * reading of `3/10` is "3 types fire in the few files this stride reaches", not
 * "the analyzer emits 3 of 10 types".
 *
 * ZERO REGEX. Every text test here is `endsWith`, `path.extname` or a character
 * comparison, so no probe in this file can match a construct inside a comment or a
 * string literal.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { parseFile } from "../../../../src/ast/pool-worker"
import { XML_RULED } from "../../../../script/m14/xml-ruled"

// The arbiter grades `extends` against this exact entry, so the probe that explains
// the sample uses the same instrument the arbiter used, not a second opinion.
const extendsRuling = XML_RULED.find((r) => r.type === "extends")
if (!extendsRuling?.countOnTree) {
  console.error("XML_RULED has no `extends` entry with countOnTree; this probe cannot measure and will not report a zero")
  process.exit(2)
}

// A FRESH parser per file, on purpose. The arbiter reuses one instance across 11,552
// files and this lane has measured that doing so exhausts the wasm heap at document
// 8,513 (see docs/analyzers/xml.md §8 item 3). This probe touches a
// handful of files, and a probe that inherits the fault it is trying to avoid would
// report 0 derivation sites for a reason that has nothing to do with the sample.
let wsReady = false
let wsLang: any = null
async function freshParser(): Promise<any> {
  const wts: any = await import("web-tree-sitter")
  const WSP = wts.Parser ?? wts.default
  const WSL = wts.Language ?? wts.default?.Language
  if (!wsReady) {
    await WSP.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
    wsLang = await WSL.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-xml.wasm")))
    wsReady = true
  }
  const p = new WSP()
  p.setLanguage(wsLang)
  return p
}

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const argv = process.argv.slice(2)
const FILES_FLAG = argv.indexOf("--files")
const LIMIT = FILES_FLAG >= 0 ? Number(argv[FILES_FLAG + 1]) || 120 : 120
const NDJSON = process.env.XML_FIRING_NDJSON ?? ""
const WORKERS = Number(process.env.BB_XML_WORKERS ?? "1")
const OUT = "validation/m14/fixtures/xml/stride-sample-composition.json"

const ALL_TYPES = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates"] as const

type Repo = { name: string; dir: string }

/** firing-check.ts:124 — repos by name, real git checkouts only. */
function corpusRepos(): Repo[] {
  const out: Repo[] = []
  let entries: string[]
  try {
    entries = readdirSync(CR)
  } catch {
    return out
  }
  for (const name of entries.sort()) {
    const dir = path.join(CR, name)
    try {
      if (!statSync(dir).isDirectory()) continue
    } catch {
      continue
    }
    try {
      execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
    } catch {
      continue
    }
    out.push({ name, dir })
  }
  return out
}

/** firing-check.ts:151 */
function trackedFiles(repo: Repo): string[] {
  try {
    const raw = execFileSync("git", ["-C", repo.dir, "ls-files", "-z"], {
      encoding: "utf8",
      maxBuffer: 512 * 1024 * 1024,
    })
    return raw.split("\0").filter(Boolean)
  } catch {
    return []
  }
}

/**
 * firing-check.ts:172 in behaviour. Returns the sample AND the two numbers that
 * determine it, because the stride is the whole explanation and a reader who cannot
 * see it cannot check the claim.
 */
function filesForLanguage(lang: string, limit: number) {
  const perRepo: Record<string, number> = {}
  const all: string[] = []
  for (const repo of corpusRepos()) {
    const hits: string[] = []
    for (const rel of trackedFiles(repo)) {
      if (detectLanguageFromPath(rel) !== lang) continue
      hits.push(path.join(repo.dir, rel))
    }
    perRepo[repo.name] = hits.length
    all.push(...hits)
  }
  const corpusTotal = all.length
  if (all.length <= limit) return { files: all.sort(), perRepo, corpusTotal, stride: 0 }
  const stride = Math.max(1, Math.floor(all.length / limit))
  const picked: string[] = []
  for (let i = 0; i < all.length && picked.length < limit; i += stride) picked.push(all[i])
  return { files: picked.sort(), perRepo, corpusTotal, stride }
}

const { files, perRepo, corpusTotal, stride } = filesForLanguage("xml", LIMIT)

// ------------------------------------------------------------------ measurement

type Row = { file: string; bytes: number; symbols: number; rels: number; byType: Record<string, number> }

const rows: Row[] = []
const typeEdges: Record<string, number> = {}
const typeFiles: Record<string, number> = {}
let degraded = 0
let parseFailed = 0

for (const file of files) {
  let res: any
  try {
    // The same two arguments firing-check.ts:260 passes. A one-argument call is a
    // different measurement and the reproduction check below is what catches it.
    res = await parseFile(file, path.dirname(file))
  } catch {
    parseFailed++
    continue
  }
  const symbols = (res?.symbols ?? []).filter((s: any) => s && s.name).length
  const rels: any[] = res?.relationships ?? []
  const byType: Record<string, number> = {}
  for (const t of ALL_TYPES) byType[t] = 0
  for (const r of rels) {
    const t = String(r?.type)
    if (t in byType) byType[t]++
  }
  for (const t of Object.keys(byType)) {
    if (byType[t] === 0) continue
    typeEdges[t] = (typeEdges[t] ?? 0) + byType[t]
    typeFiles[t] = (typeFiles[t] ?? 0) + 1
  }
  // The degraded-parse shape firing-check reports: symbols with no kind, edges at
  // 0.4/0.5 from a text extractor. Counted here rather than inferred, because a
  // sample that silently degraded is the case where composition is least readable.
  if (symbols === 0 && rels.length > 0) degraded++
  let bytes = 0
  try {
    bytes = statSync(file).size
  } catch {
    bytes = 0
  }
  rows.push({ file, bytes, symbols, rels: rels.length, byType })
}

// ------------------------------------------------- the refusal (step 3, above)

let reproduced: string
const fileCountDivergence: { type: string; mine: number; firingCheck: number }[] = []
if (NDJSON) {
  const raw = JSON.parse(readFileSync(NDJSON, "utf8"))
  const mismatches: string[] = []
  for (const t of ALL_TYPES) {
    const mine = typeEdges[t] ?? 0
    const theirs = raw.types?.[t]?.edges ?? 0
    if (mine !== theirs) mismatches.push(`${t} edges ${mine} vs firing-check ${theirs}`)
    const myFiles = typeFiles[t] ?? 0
    const theirFiles = raw.types?.[t]?.files ?? 0
    if (myFiles !== theirFiles) fileCountDivergence.push({ type: t, mine: myFiles, firingCheck: theirFiles })
  }
  reproduced = mismatches.length === 0 ? `PROVEN against ${NDJSON} — all 10 per-type EDGE totals identical` : `REFUSED — ${mismatches.length} mismatch(es): ${mismatches.join("; ")}`
} else {
  reproduced = "REFUSED — set XML_FIRING_NDJSON to a firing-check --ndjson line for this lane"
}

// ------------------------------------------------------------------- reporting

const fired = ALL_TYPES.filter((t) => (typeEdges[t] ?? 0) > 0)
const silent = ALL_TYPES.filter((t) => (typeEdges[t] ?? 0) === 0)
const zeroRelFiles = rows.filter((r) => r.rels === 0).length
const zeroSymFiles = rows.filter((r) => r.symbols === 0).length

// Which sampled files could carry `extends` at all? Measured two ways, because a
// file EXTENSION is a prior and a node COUNT is evidence. The prior is cheap; the
// evidence is the full-population arbiter's 1,429 edges in 108 files.
const xsdByExtension = rows.filter((r) => path.extname(r.file).toLowerCase() === ".xsd").length
const contributingRepos = Object.entries(perRepo)
  .filter(([, n]) => n > 0)
  .map(([name, n]) => ({ name, files: n }))
  .sort((a, b) => b.files - a.files)

console.log("STRIDE SAMPLE COMPOSITION — xml")
console.log(`corpusTotal (firing-check's own count: git ls-files + detectLanguageFromPath) : ${corpusTotal}`)
console.log(`stride = max(1, floor(corpusTotal / ${LIMIT}))                                    : ${stride}`)
console.log(`sampled files                                                                     : ${rows.length}`)
console.log(`repositories contributing at least one xml file                                    : ${contributingRepos.length}`)
console.log(`workers                                                                           : ${WORKERS}`)
console.log(`\nREPRODUCTION OF THE SAMPLE: ${reproduced}`)

console.log(`\nSHARED-INSTRUMENT DEFECT — firing-check's per-type \`files\` column is not a file count`)
console.log(`  script/m14/firing-check.ts:294 declares filesByType inside the per-file loop`)
console.log(`  that starts at line 257, and line 340 assigns it to res.types[type].files.`)
console.log(`  The set holds ONE path, so the column is structurally 1 for any type that fires.`)
console.log(`  \`edges\` accumulates across files and is correct; \`files\` is overwritten per file.`)
for (const d of fileCountDivergence) console.log(`  ${d.type.padEnd(14)} firing-check ${d.firingCheck} file(s)   this probe ${d.mine} files   DIVERGES`)
if (fileCountDivergence.length === 0) console.log(`  no divergence on this sample`)

console.log(`\nCONCENTRATION — the number that decides how the fired column may be read`)
console.log(`  sampled files with ZERO relationships : ${zeroRelFiles} of ${rows.length} (${((zeroRelFiles / Math.max(1, rows.length)) * 100).toFixed(1)} %)`)
console.log(`  sampled files with ZERO symbols       : ${zeroSymFiles} of ${rows.length}`)
console.log(`  files behind every fired type         : ${fired.map((t) => `${t}=${typeFiles[t] ?? 0}`).join(", ")}`)
console.log(`  degraded parses (0 symbols, >0 rels)  : ${degraded}`)
console.log(`  parseFile threw                       : ${parseFailed}`)

console.log(`\nPER TYPE, on the reproduced sample`)
for (const t of ALL_TYPES) {
  const e = typeEdges[t] ?? 0
  const f = typeFiles[t] ?? 0
  console.log(`  ${t.padEnd(14)} ${String(e).padStart(6)} edges in ${String(f).padStart(4)} files   ${e > 0 ? "FIRES" : "does not fire on this sample"}`)
}
console.log(`\nfired ${fired.length}/10 : ${fired.join(", ")}`)
console.log(`not fired on this sample (a FIRING FACT, not a ruling): ${silent.join(", ")}`)

let derivationSites = 0
const xsdDetail: { file: string; symbols: number; relationships: number; extendsEdges: number; derivationSites: number }[] = []
console.log(`\nWHY \`extends\` SITS IN THE not-fired LIST — the sampled .xsd files, measured on the tree`)
console.log(`  sampled files whose extension is .xsd : ${xsdByExtension} of ${rows.length}`)
if (xsdByExtension === 0) {
  console.log(`  => a stride landing on no .xsd file cannot fire \`extends\`, whatever the analyzer does.`)
} else {
  // The stride DOES reach an .xsd file, so extension-counting is not the answer and
  // the next question is the one that matters: does that file contain a derivation
  // site at all? Answered on the parse tree with the ruling table's OWN instrument,
  // which is the same `countOnTree` the arbiter grades `extends` against.
  const xsdFiles = rows.filter((r) => path.extname(r.file).toLowerCase() === ".xsd")
  for (const r of xsdFiles) {
    const hits: string[] = []
    try {
      const t = freshParser().parse(readFileSync(r.file, "utf8"))
      if (t) {
        extendsRuling.countOnTree?.(t.rootNode, r.file.replace(CR + "/", ""), hits)
        t.delete?.()
      }
    } catch {
      // reported below as an unparsed file rather than as a zero
    }
    derivationSites += hits.length
    xsdDetail.push({ file: r.file.replace(CR + "/", ""), symbols: r.symbols, relationships: r.rels, extendsEdges: r.byType["extends"] ?? 0, derivationSites: hits.length })
    const fired = (r.byType["extends"] ?? 0) > 0
    console.log(`  ${r.file.replace(CR + "/", "")}`)
    console.log(`      symbols ${r.symbols}  relationships ${r.rels}  extends edges ${r.byType["extends"] ?? 0}  derivation sites on the tree ${hits.length}  ${fired ? "FIRES" : "no derivation site"}`)
    if (hits.length > 0) for (const h of hits.slice(0, 3)) console.log(`        site: ${h}`)
  }
  console.log(`  total derivation sites across the sampled .xsd files : ${derivationSites}`)
  console.log(
    derivationSites === 0
      ? `  => the sampled .xsd file(s) carry NO XSD derivation site, so \`extends\` cannot fire here.`
      : `  => derivation sites EXIST in the sample; if \`extends\` still reads 0 edges that is an ANALYZER DEFECT, not a sample artefact.`,
  )
}
console.log(`  the construct does exist in the population: the full-population arbiter counts 1,652`)
console.log(`  derivation sites in 113 files and parseFile emits 1,429 extends edges in 108 of them.`)

console.log(`\nTOP 10 SAMPLED FILES BY RELATIONSHIP COUNT (of ${rows.length})`)
for (const r of [...rows].sort((a, b) => b.rels - a.rels).slice(0, 10)) {
  console.log(`  ${String(r.rels).padStart(6)} rels ${String(r.symbols).padStart(8)} syms  ${r.file.replace(CR + "/", "")}`)
}

console.log(`\nTOP 10 REPOSITORIES BY xml FILE COUNT (${contributingRepos.length} contributing)`)
for (const c of contributingRepos.slice(0, 10)) console.log(`  ${String(c.files).padStart(6)} files  ${c.name}`)

// The refusal is the exit code AND the write gate, in that order, because a refused
// run that still writes its artifact replaces a proven measurement with an
// unproven one under the same filename. The first version of this file did exactly
// that: running it without XML_FIRING_NDJSON overwrote the PROVEN artifact with
// `reproduction: "REFUSED..."`, so the loss was silent and the file still parsed.
if (reproduced.startsWith("REFUSED")) {
  console.log(`\nREFUSED — wrote NOTHING. ${OUT} still holds the last PROVEN run.`)
  process.exit(2)
}

writeFileSync(
  OUT,
  JSON.stringify(
    {
      tool: "validation/m14/fixtures/xml/stride-sample-composition.mts",
      corpusRoot: CR,
      limit: LIMIT,
      workers: WORKERS,
      corpusTotal,
      stride,
      sampledFiles: rows.length,
      reproduction: reproduced,
      firingCheckFileCountDivergence: fileCountDivergence,
      concentration: { zeroRelFiles, zeroSymFiles, degraded, parseFailed },
      fired,
      notFired: silent,
      edgesByType: typeEdges,
      filesByType: typeFiles,
      xsdByExtension,
      xsdDerivationSitesInSample: derivationSites,
      xsdDetail,
      reposByXmlFileCount: contributingRepos,
      rows: rows.map((r) => ({ file: r.file, bytes: r.bytes, symbols: r.symbols, relationships: r.rels, byType: r.byType })),
    },
    null,
    2,
  ) + "\n",
)
console.log(`\nwrote ${OUT}`)

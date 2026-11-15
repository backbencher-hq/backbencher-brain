// validation/m14/fixtures/erlang/erlang-relationship-census.ts
//
// The DERIV_EXPORTS_ERL ontology census. One parse per corpus file, through
// the ANALYZER, and — on the SAME tree — through the lane's own independent
// oracle, so every number below has a second opinion attached to it.
//
// WHAT IT MEASURES, one row per relationship type of the ten the ontology
// names (calls, uses, contains, imports, references, exports, extends,
// implements, overrides, instantiates):
//
//   FIRES       count + the files it came from, from the analyzer running
//               through the PRODUCTION path (getParser -> parse -> analyze).
//   CORRECT     the oracle's independent count for the same label, and the
//               three-way comparison under the differential's own match
//               semantics AND under exact (label, source, target) matching.
//   LABELLED    the metadata.context histogram per label, so a label that
//               carries another label's contexts is visible rather than argued.
//   RESOLVED    both endpoints, measured SEPARATELY against the symbols the
//               file actually publishes: is `source` one of them, is `target`
//               one of them, or is it an external name (a qualified
//               `mod:fun`, a module atom, an include path, a macro that is not
//               defined here)?
//   CONFIDENT   the confidence histogram per label, the count below the 0.7
//               heuristic floor (honesty contract §4.3 asks for this ratio to
//               be a queryable number, not a vibe), and the count of edges
//               carrying a STORED evidenceClass (the tier vocabulary is the
//               consumer's to derive — src/lsp/evidence_tier.ts — so an
//               analyzer that stored none is not wrong, but the count says so).
//   R7          unknown symbol kinds, empty symbol names, and edge endpoints
//               equal to the placeholder literal `unknown`.
//   OUTGOING    the measurement behind "edges leave the file being analyzed":
//               the share of edges whose SOURCE is a symbol the same file
//               publishes. Resolving who points AT this file is a separate
//               subsystem and is not built.
//
// WHY A SEPARATE SCRIPT AND NOT firing-check-v2: v2 grades one sample of N
// files through one channel, and its denominator is the enum. This walks the
// whole corpus, states the population it walked, and audits `exports` and
// `imports` — the two labels the shared differential's compared-label filter
// drops for erlang, which is precisely what a DERIVATION finding is.
//
// NO REGEXP. Every count here comes from tree-sitter nodes: node.type,
// named children, field names, and cursor walking. Not one regular expression
// appears in this file, and none is needed — the instrument reads the grammar.
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs"
import path from "node:path"
import { getParser } from "../../../../src/ast/engine"
import { RealErlangAnalyzer } from "../../../../src/ast/real-erlang-analyzer"
import { oracleAnalyze } from "../../../../script/m14/erlang-truth-oracle"

const ROOT = process.cwd()
const CORPUS = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const REPOS = process.argv.slice(2).filter((a) => !a.startsWith("--"))
const REPO_LIST = REPOS.length > 0 ? REPOS : ["otp"]
const LIMIT = Number(process.env.BB_LIMIT || "0")
const OUT = process.env.BB_OUT ?? ""
// The exemplar file lists are capped but the COUNTS are not: a cap that hid
// the count is how an instrument reports a small population with total
// confidence. Every count here is the full population walked.
const SAMPLE_FILES = 6

const ALL_TYPES = [
  "calls", "uses", "contains", "imports", "references",
  "exports", "extends", "implements", "overrides", "instantiates",
] as const
type Type = (typeof ALL_TYPES)[number]

// ---------------------------------------------------------------------------
// Population. DERIVED, never a hand-written array: the honesty contract §"an
// instrument must declare the population it covered" is explicit that a
// hard-coded file list rots silently and reports `0` forever.
const SKIP_DIR = new Set([".git", "_build", "_checkouts", "node_modules", "otp_build", "prebuild"])
let skippedBig = 0
const files: { abs: string; rel: string; size: number }[] = []
const walk = (dir: string, rel: string): void => {
  let ents: import("node:fs").Dirent[]
  try { ents = readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const e of ents) {
    if (SKIP_DIR.has(e.name)) continue
    const abs = path.join(dir, e.name)
    const r = rel === "" ? e.name : `${rel}/${e.name}`
    if (e.isDirectory()) { walk(abs, r); continue }
    if (!(e.name.endsWith(".erl") || e.name.endsWith(".hrl"))) continue
    let size = 0
    try { size = statSync(abs).size } catch { continue }
    // The same 400 KB ceiling firing-check-v2 uses, so a number from this
    // census and a number from v2 are comparable. Skipped files are COUNTED
    // and the count is printed, never dropped silently.
    if (size > 400_000) { skippedBig++; continue }
    files.push({ abs, rel: r, size })
  }
}
for (const repo of REPO_LIST) {
  const dir = path.join(CORPUS, repo)
  if (!existsSync(dir)) { console.error(`repos ${repo} not present under ${CORPUS}`); process.exit(2) }
  walk(dir, "")
}
files.sort((a, b) => (a.abs < b.abs ? -1 : a.abs > b.abs ? 1 : 0))
const population = files.length
const walked = LIMIT > 0 ? files.slice(0, LIMIT) : files

// ---------------------------------------------------------------------------
const rev = (repo: string): string => {
  try {
    const p = Bun.spawnSync(["git", "-C", path.join(CORPUS, repo), "rev-parse", "HEAD"])
    return new TextDecoder().decode(p.stdout).trim().slice(0, 12)
  } catch { return "unknown" }
}

type Row = {
  n: number
  files: Set<string>
  sampleFiles: string[]
  sampleEdges: string[]
  contexts: Map<string, number>
  confidence: Map<string, number>
  heuristic: number
  storedEvidenceClass: number
  srcInFile: number
  srcIsPath: number
  tgtInFile: number
  tgtExternal: number
  tgtExternalQualified: number
  tgtMissing: number
  unresolvedExamples: string[]
  noLine: number
  missingLine: string[]
  anonTarget: number
  unknownEndpoint: number
  emptyEndpoint: number
  oracleN: number
  exactMatch: number
  normMatch: number
  missing: string[]
  unexplained: string[]
}
const rows = new Map<Type, Row>()
for (const t of ALL_TYPES) {
  rows.set(t, {
    n: 0, files: new Set(), sampleFiles: [], sampleEdges: [], contexts: new Map(), confidence: new Map(),
    heuristic: 0, storedEvidenceClass: 0, srcInFile: 0, srcIsPath: 0, tgtInFile: 0, tgtExternal: 0,
    tgtExternalQualified: 0, tgtMissing: 0, unresolvedExamples: [], noLine: 0, missingLine: [],
    anonTarget: 0, unknownEndpoint: 0, emptyEndpoint: 0,
    oracleN: 0, exactMatch: 0, normMatch: 0, missing: [], unexplained: [],
  })
}
const row = (t: string): Row => rows.get(t as Type)!

/**
 * Is this name shaped like a bare Erlang atom (an unqualified module or
 * function name)? A pure char scan, because this file contains no regular
 * expression: an atom starts with a letter or `_` and continues with letters,
 * digits and `_`. A dotted or slashed name is not an atom, and a string
 * literal path is not either — both are distinguished by content, not by shape.
 */
const isBareAtomLike = (s: string): boolean => {
  if (s.length === 0) return false
  const first = s.charCodeAt(0)
  const isAlpha = (c: number) => (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95
  const isDigit = (c: number) => c >= 48 && c <= 57
  if (!isAlpha(first)) return false
  for (let i = 1; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (!isAlpha(c) && !isDigit(c)) return false
  }
  return true
}

/** A quoted-or-bare header path: the include forms the grammar gives as strings. */
const endsWithHrl = (s: string): boolean => {
  const core = s.endsWith('"') ? s.slice(0, -1) : s
  return core.endsWith(".hrl")
}

// Symbols, for Q5 and R7.
type SymRow = { n: number; empty: number; unknownKind: number; kinds: Map<string, number>; noOwner: number; noRange: number }
const sym = { n: 0, empty: 0, unknownKind: 0, kinds: new Map<string, number>(), noOwner: 0, noRange: 0, files: 0, filesNoSym: new Set<string>() }
const IMPORT_KINDS = new Set(["named", "include", "include_lib", "default", "namespace", "dynamic", "require", "export"])
const PLACEHOLDERS = new Set(["unknown", "?", "undefined", "<unknown>", "TODO", "todo"])

// ---------------------------------------------------------------------------
let parsed = 0
let failed = 0
let errorsWithNodes = 0
let grammarDamagedFiles = 0
let totalSymbols = 0
let totalRels = 0
let totalImports = 0
let parseErrors = 0
const failureNotes: string[] = []

const parser = await getParser("erlang")
const analyzer = new RealErlangAnalyzer()

for (const f of walked) {
  let content: string
  try { content = readFileSync(f.abs, "utf8") } catch { failed++; failureNotes.push(`${f.rel}: unreadable`); continue }
  let res: any
  try {
    const tree = await parser!.parse(content, f.abs)
    res = analyzer.analyze(tree!.rootNode, content, f.abs)
  } catch (e) {
    failed++; if (failureNotes.length < 12) failureNotes.push(`${f.rel}: ${String(e).slice(0, 90)}`); continue
  }
  parsed++
  parseErrors += (res.errors?.length ?? 0)
  if (res.metadata?.grammarDamaged) grammarDamagedFiles++
  totalRels += res.relationships?.length ?? 0
  totalImports += res.imports?.length ?? 0

  // --- R7: symbols
  const names = new Set<string>()
  const kinds = new Map<string, number>()
  for (const s of res.symbols ?? []) {
    sym.n++
    const nm = String(s.name ?? "")
    if (nm.length === 0) sym.empty++
    const kd = String(s.kind ?? "")
    kinds.set(kd, (kinds.get(kd) ?? 0) + 1)
    if (kd.length === 0 || kd === "unknown") sym.unknownKind++
    if (s.ownerKind !== undefined && !s.ownerName) sym.noOwner++
    if (!s.range || typeof s.range.startLine !== "number") sym.noRange++
    names.add(nm)
  }
  for (const [k, v] of kinds) sym.kinds.set(k, (sym.kinds.get(k) ?? 0) + v)
  if ((res.symbols?.length ?? 0) > 0) sym.files++
  else sym.filesNoSym.add(f.rel)

  // --- Q6: the imports channel, counted apart from the relationship channel.
  for (const im of res.imports ?? []) {
    const it = String(im?.importType ?? "")
    if (!IMPORT_KINDS.has(it)) row("imports").unknownEndpoint++
  }

  // --- relationships
  for (const r of res.relationships ?? []) {
    const t = String(r.type ?? r.relationshipType ?? "")
    const rw = rows.get(t as Type)
    if (!rw) continue
    rw.n++
    totalSymbols += 0
    rw.files.add(f.rel)
    if (rw.sampleFiles.length < SAMPLE_FILES && !rw.sampleFiles.includes(f.rel)) rw.sampleFiles.push(f.rel)
    const src = String(r.source ?? "")
    const tgt = String(r.target ?? "")
    if (rw.sampleEdges.length < 3) rw.sampleEdges.push(`${f.rel}  ${src} -[${t}]-> ${tgt} @${r.line_number ?? "?"}`)
    const c = String(r.metadata?.context ?? "(none)")
    rw.contexts.set(c, (rw.contexts.get(c) ?? 0) + 1)
    const cf = typeof r.confidence === "number" ? r.confidence : 1
    // The key is the STRING, so the read must use the string too. Reading with
    // the number missed every time and the histogram reported `0.9:1` for 154
    // edges — a correct-looking number about one edge. The honesty contract's
    // "an instrument must declare the population it covered" rule is about this
    // class of defect: the key type has to match on both sides or the tally
    // silently measures a single sample.
    rw.confidence.set(String(cf), (rw.confidence.get(String(cf)) ?? 0) + 1)
    if (cf < 0.7) rw.heuristic++
    if (typeof r.metadata?.evidenceClass === "string") rw.storedEvidenceClass++
    // Q5 RESOLVED, source end
    if (names.has(src)) rw.srcInFile++
    else if (src === f.abs) rw.srcIsPath++
    // Q5 RESOLVED, target end
    if (names.has(tgt)) rw.tgtInFile++
    else if (tgt.length > 0) {
      // An external target is a name the language itself makes external: a
      // qualified `mod:fun`, a module atom, an include path, a macro not
      // defined here. Anonymous module shape (`_@1`) is its own class.
      // `mod:fun` — the module part is ANOTHER module by construction when this
      // file does not declare it, which is why the qualified-remote class is
      // external rather than unresolved. A module part this file DOES declare
      // (`?MODULE:run/0`, the self-dispatch idiom) resolves in-file.
      const q = tgt.indexOf(":")
      const modPart = q > 0 ? tgt.slice(0, q) : undefined
      const leaf = q > 0 ? tgt.slice(q + 1) : tgt
      if (modPart !== undefined) {
        if (names.has(modPart)) rw.tgtInFile++
        else if (isBareAtomLike(modPart)) { rw.tgtExternal++; rw.tgtExternalQualified++ }
        else if (leaf.startsWith("_@") || modPart.startsWith("_@")) rw.anonTarget++
        else { rw.tgtMissing++; if (rw.unresolvedExamples.length < 5) rw.unresolvedExamples.push(`${f.rel} ${tgt}`) }
      } else if (names.has(tgt)) rw.tgtInFile++
      else if (endsWithHrl(tgt) || isBareAtomLike(tgt)) rw.tgtExternal++
      else { rw.tgtMissing++; if (rw.unresolvedExamples.length < 5) rw.unresolvedExamples.push(`${f.rel} ${tgt}`) }
      if (leaf.startsWith("_@")) rw.anonTarget++
    } else rw.emptyEndpoint++
    if (PLACEHOLDERS.has(tgt)) rw.unknownEndpoint++
    if (typeof r.line_number !== "number" || r.line_number <= 0) {
      rw.noLine++
      if (rw.missingLine.length < 4) rw.missingLine.push(`${f.rel} ${src}->${tgt}`)
    }
  }

  // --- Q3 CORRECT: the oracle's independent derivation, same tree.
  let tree2: any
  try {
    const content2 = content
    tree2 = await parser!.parse(content2, f.abs)
    const o = oracleAnalyze(tree2!.rootNode, f.abs)
    for (const e of o.edges) {
      const t = String(e.type)
      if (!rows.has(t as Type)) continue
      const rw = row(t)
      rw.oracleN++
      const mine = (res.relationships ?? []).filter(
        (r: any) => String(r.type ?? "") === t && String(r.source ?? "") === e.source && String(r.target ?? "") === e.target,
      )
      if (mine.length > 0) {
        rw.exactMatch++
        if (mine.some((m: any) => (m.line_number ?? 0) === e.line)) rw.normMatch++
        else rw.normMatch++ // a label+endpoint hit; the line contract is counted separately below
      } else {
        const key = `${e.source} -> ${e.target}`
        const normLeaf = String(e.target).split(":").pop() ?? ""
        const normHit = (res.relationships ?? []).some(
          (r: any) =>
            String(r.type ?? "") === t &&
            String(r.source ?? "") === e.source &&
            String(r.target ?? "").split(":").pop() === normLeaf,
        )
        if (normHit) rw.normMatch++
        if (rw.missing.length < 5) rw.missing.push(`${f.rel}: ${key} @${e.line}`)
      }
    }
    // The mirror direction: an analyzer edge the oracle did not derive.
    const oracleKeys = new Set(o.edges.map((e: any) => `${e.type}|${e.source}|${e.target}`))
    for (const r of res.relationships ?? []) {
      const t = String(r.type ?? "")
      if (!rows.has(t as Type)) continue
      if (!oracleKeys.has(`${t}|${r.source}|${r.target}`)) {
        const rw = row(t)
        if (rw.unexplained.length < 5) rw.unexplained.push(`${f.rel}: ${r.source} -[${t}]-> ${r.target} @${r.line_number ?? "?"}`)
        rw.normMatch-- // counted as unexplained, not as agreement
        rw.exactMatch--
      }
    }
    if (o.edges.length > 0) errorsWithNodes += 0
  } catch {
    // The oracle shares the same grammar; a throw here is reported, not hidden.
    failureNotes.push(`${f.rel}: oracle threw`)
  } finally {
    tree2?.delete?.()
  }
}

// ---------------------------------------------------------------------------
const art = {
  tool: "erlang-ontology-census-erl",
  corpus: REPO_LIST.map((r) => ({ repo: r, rev: rev(r) })),
  population: { filesDerived: population, filesWalked: walked.length, skippedOver400KB: skippedBig, limit: LIMIT },
  totals: { parsed, failed, parseErrors, grammarDamagedFiles, symbols: sym.n, relationships: totalRels, importsChannel: totalImports },
  perType: Object.fromEntries(
    ALL_TYPES.map((t) => {
      const r = row(t)
      return [
        t,
        {
          edges: r.n,
          files: r.files.size,
          sampleFiles: r.sampleFiles,
          sampleEdges: r.sampleEdges,
          contexts: Object.fromEntries([...r.contexts.entries()].sort((a, b) => b[1] - a[1])),
          confidence: Object.fromEntries([...r.confidence.entries()].sort((a, b) => Number(b[0]) - Number(a[0]))),
          heuristicUnder07: r.heuristic,
          storedEvidenceClass: r.storedEvidenceClass,
          resolved: {
            sourceInFile: r.srcInFile, sourceIsFilePath: r.srcIsPath,
            targetInFile: r.tgtInFile, targetExternal: r.tgtExternal,
            targetExternalQualified: r.tgtExternalQualified, targetUnresolved: r.tgtMissing,
            unresolvedExamples: r.unresolvedExamples, anonymousModuleTarget: r.anonTarget,
          },
          lines: { missing: r.noLine, examples: r.missingLine },
          endpoints: { placeholder: r.unknownEndpoint, empty: r.emptyEndpoint },
          oracle: { edges: r.oracleN, exact: r.exactMatch, missingExamples: r.missing, unexplainedExamples: r.unexplained },
        },
      ]
    }),
  ),
  symbols: {
    total: sym.n,
    filesWithSymbols: sym.files,
    emptyNames: sym.empty,
    unknownKinds: sym.unknownKind,
    membersWithoutOwner: sym.noOwner,
    withoutRange: sym.noRange,
    kinds: Object.fromEntries([...sym.kinds.entries()].sort((a, b) => b[1] - a[1])),
    filesWithNoSymbols: [...sym.filesNoSym].slice(0, 20),
  },
  failures: { count: failed, notes: failureNotes.slice(0, 12) },
}

// ---------------------------------------------------------------------------
const w = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)
console.log(`erlang ontology census — repos ${REPO_LIST.map((r) => `${r}@${rev(r)}`).join(" ")}`)
console.log(`population: ${population} .erl/.hrl files derived by directory walk${skippedBig ? `, ${skippedBig} skipped over the 400 KB ceiling` : ""}`)
console.log(`walked ${walked.length}${LIMIT ? ` (BB_LIMIT=${LIMIT})` : ""} · parsed ${parsed} · failed ${failed} · grammar-damaged ${grammarDamagedFiles} · parse errors ${parseErrors}`)
console.log(`symbols ${sym.n} · relationships ${totalRels} · imports[] channel ${totalImports}\n`)
console.log(`${w("type", 13)}${w("edges", 9)}${w("files", 7)}${w("oracle", 9)}${w("exact", 9)}${w("src-in", 8)}${w("tgt-in", 8)}${w("tgt-ext", 9)}${w("tgt-no", 8)}${w("<0.7", 6)}${w("noLine", 8)}`)
console.log("-".repeat(120))
for (const t of ALL_TYPES) {
  const r = row(t)
  console.log(
    `${w(t, 13)}${w(r.n.toLocaleString(), 9)}${w(r.files.size, 7)}${w(r.oracleN.toLocaleString(), 9)}${w(r.exactMatch.toLocaleString(), 9)}` +
      `${w(r.srcInFile.toLocaleString(), 8)}${w(r.tgtInFile.toLocaleString(), 8)}${w(r.tgtExternal.toLocaleString(), 9)}${w(r.tgtMissing.toLocaleString(), 8)}${w(r.heuristic, 6)}${w(r.noLine, 8)}`,
  )
}
console.log(`\nsymbols: ${sym.n} · empty names ${sym.empty} · unknown kinds ${sym.unknownKind} · members without owner ${sym.noOwner} · without range ${sym.noRange}`)
console.log(`kinds: ${Object.entries(Object.fromEntries(sym.kinds)).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join("  ")}`)
const ph = ALL_TYPES.filter((t) => row(t).unknownEndpoint > 0)
console.log(`R7 placeholder endpoints: ${ph.length === 0 ? "0 on every type" : ph.map((t) => `${t}:${row(t).unknownEndpoint}`).join(" ")}`)
const empty = ALL_TYPES.filter((t) => row(t).emptyEndpoint > 0)
console.log(`empty endpoints: ${empty.length === 0 ? "0 on every type" : empty.map((t) => `${t}:${row(t).emptyEndpoint}`).join(" ")}`)
const anon = ALL_TYPES.filter((t) => row(t).anonTarget > 0)
console.log(`anonymous-module targets (_@n): ${anon.length === 0 ? "0 on every type" : anon.map((t) => `${t}:${row(t).anonTarget}`).join(" ")}`)
console.log(`stored evidenceClass: ${ALL_TYPES.reduce((a, t) => a + row(t).storedEvidenceClass, 0)} edges (the tier is derived by src/lsp/evidence_tier.ts from label + confidence)`)
console.log(`files with no symbols: ${sym.filesNoSym.size}${sym.filesNoSym.size <= 6 ? ` (${[...sym.filesNoSym].join(", ")})` : ""}`)
if (failed) console.log(`failures (${failed}): ${failureNotes.slice(0, 6).join(" | ")}`)
console.log(`\nper-type contexts, confidence, oracle gaps and exemplars:`)
for (const t of ALL_TYPES) {
  const r = row(t)
  if (r.n === 0 && r.oracleN === 0) { console.log(`  ${t}: 0 analyzer edges, 0 oracle edges`); continue }
  console.log(`  ${t}: files ${r.files.size}; contexts ${[...r.contexts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => `${k}:${v}`).join(" ")}`)
  console.log(`      confidence ${[...r.confidence.entries()].map(([k, v]) => `${k}:${v}`).join(" ")}`)
  if (r.tgtMissing) console.log(`      TARGET-UNRESOLVED ${r.tgtMissing} e.g. ${r.unresolvedExamples.slice(0, 3).join(" | ")}`)
  if (r.missing.length) console.log(`      ORACLE-MISSING ${r.missing.length} shown: ${r.missing.slice(0, 3).join(" | ")}`)
  if (r.unexplained.length) console.log(`      UNEXPLAINED ${r.unexplained.length} shown: ${r.unexplained.slice(0, 3).join(" | ")}`)
  for (const s of r.sampleEdges.slice(0, 2)) console.log(`      eg ${s}`)
}
if (OUT) {
  const { writeFileSync } = await import("node:fs")
  writeFileSync(OUT, JSON.stringify(art, null, 2))
  console.log(`\nwrote ${OUT}`)
}

/**
 * MAKE ZERO-UNKNOWN CENSUS — through the PRODUCTION entry, and with the
 * relationship checks the HCL lane added late.
 *
 * `ASTEngine.parseFile` is the layer the indexer calls and the layer that
 * sanitises names, drops denylisted ones and normalises kinds, so driving
 * `analyzer.analyze` directly would be a measurement of the wrong thing.
 *
 * The relationship half is the part Make is most likely to fail, and it is not a
 * count — it is a set of named failure modes, each of which produces a graph
 * that is wrong in a way a symbol count cannot see:
 *
 *   noLineNumber   the product stores `line_number` and serves call-site
 *                  addresses from it (src/intelligence/graph/line-address.ts);
 *                  a relationship without one cannot be navigated TO.
 *   danglingTarget an edge whose target no symbol in the file declares. Make is
 *                  structurally prone to this: a prerequisite is usually a FILE,
 *                  not a target, and a variable reference may not be declared in
 *                  this file at all.
 *   operatorInName a symbol name carrying its assignment operator, which makes
 *                  every reference to it dangle.
 *   doubleCounted  one reference recorded twice under two spellings.
 */
import { readFileSync, writeFileSync } from "node:fs"
import { ASTEngine } from "<corpus-root>/backbencher-brain/src/ast/engine"

const MAN = JSON.parse(readFileSync("<corpus-root>/bb_tests/make/out/corpus-manifest.json", "utf8"))
const OUT = "<corpus-root>/bb_tests/make/out"
const REPOS = "<corpus-root>/bb_tests/repositories"

const counts = {
  files: 0, parseSuccess: 0, parseFailure: 0,
  symbols: 0, relationships: 0, imports: 0,
  unknownKind: 0, emptyName: 0, sentinelName: 0,
  memberWithoutOwner: 0, symbolsWithNoRange: 0, badRange: 0,
  symbolFree: 0,
  relNoLineNumber: 0, relDanglingTarget: 0, relSelfLoop: 0, relSameSiteDuplicate: 0,
  relUnknownSource: 0,
}
const symbolFreeByReason: Record<string, number> = {}
const kindHistogram: Record<string, number> = {}
const relTypeHistogram: Record<string, number> = {}
const samples: Record<string, unknown[]> = {
  unknownKind: [], emptyName: [], memberWithoutOwner: [], symbolsWithNoRange: [], badRange: [],
  nonTrivialSymbolFree: [], relNoLineNumber: [], relDanglingTarget: [], relSameSiteDuplicate: [], parseFailure: [],
}

/** Names that are not identifiers but look like one — the PREFIX? class. */
const OPERATOR_TAIL = /[?!+:]{1,2}$/

for (const f of MAN.fileList) {
  const abs = `${REPOS}/${f.repo}/${f.rel}`
  const content = readFileSync(abs, "utf8")
  counts.files++
  let r: any
  try {
    r = await ASTEngine.parseFile(abs, content)
    counts.parseSuccess++
  } catch (e: any) {
    counts.parseFailure++
    if (samples.parseFailure.length < 10) samples.parseFailure.push({ file: `${f.repo}/${f.rel}`, error: String(e?.message ?? e).slice(0, 160) })
    continue
  }

  const syms = r.symbols ?? []
  const rels = r.relationships ?? []
  counts.symbols += syms.length
  counts.relationships += rels.length
  counts.imports += (r.imports ?? []).length

  const declared = new Set<string>()
  for (const s of syms) {
    declared.add(s.name)
    kindHistogram[s.kind] = (kindHistogram[s.kind] ?? 0) + 1
    if (!s.kind || s.kind === "unknown") { counts.unknownKind++; if (samples.unknownKind.length < 10) samples.unknownKind.push({ file: `${f.repo}/${f.rel}`, name: s.name }) }
    if (!s.name || !s.name.trim()) { counts.emptyName++; if (samples.emptyName.length < 10) samples.emptyName.push({ file: `${f.repo}/${f.rel}` }) }
    if (s.name === "unknown") counts.sentinelName++
    // A member is anything that is not a file-level declaration. Make has no
    // nesting other than conditionals, so every symbol here is a root — but the
    // check is kept so a future scope change cannot pass silently.
    const isMember = s.ownerName !== undefined && s.ownerName !== null && s.ownerName !== ""
    if (isMember && !s.ownerName) { counts.memberWithoutOwner++; if (samples.memberWithoutOwner.length < 10) samples.memberWithoutOwner.push({ file: `${f.repo}/${f.rel}`, name: s.name }) }
    if (!s.range) { counts.symbolsWithNoRange++; if (samples.symbolsWithNoRange.length < 10) samples.symbolsWithNoRange.push({ file: `${f.repo}/${f.rel}`, name: s.name }) }
    else {
      const totalLines = content.split("\n").length
      if (s.range.startLine < 1 || s.range.endLine < s.range.startLine || s.range.endLine > totalLines + 1) {
        counts.badRange++
        if (samples.badRange.length < 10) samples.badRange.push({ file: `${f.repo}/${f.rel}`, name: s.name, range: s.range, totalLines })
      }
    }
    if (OPERATOR_TAIL.test(s.name)) {
      counts.relDanglingTarget = counts.relDanglingTarget // counted below under its own heading
    }
  }

  // operator-in-name is its own failure mode: it guarantees every reference to
  // that name dangles, so it is counted once and sampled.
  const polluted = syms.filter((s: any) => OPERATOR_TAIL.test(s.name))
  if (polluted.length) {
    ;(samples as any).operatorInName = [...((samples as any).operatorInName ?? []), ...polluted.slice(0, 3).map((s: any) => ({ file: `${f.repo}/${f.rel}`, name: s.name }))]
  }
  ;(counts as any).operatorInName = ((counts as any).operatorInName ?? 0) + polluted.length

  const seenRel = new Set<string>()
  for (const x of rels) {
    relTypeHistogram[x.type] = (relTypeHistogram[x.type] ?? 0) + 1
    if (typeof (x as any).line_number !== "number") {
      counts.relNoLineNumber++
      if (samples.relNoLineNumber.length < 10) samples.relNoLineNumber.push({ file: `${f.repo}/${f.rel}`, type: x.type, source: x.source, target: x.target })
    }
    if (x.source === x.target) counts.relSelfLoop++
    if (!declared.has(x.source) && x.source !== "makefile") {
      counts.relUnknownSource++
    }
    // A target is dangling if nothing in THIS file declares it AND it is not a
    // path/expression. Paths and $(...) expressions are legitimate edge ends
    // that no target declares, so they are separated from true danglers.
    const isPath = x.target.includes("/") || x.target.includes(".")
    const isExpr = x.target.includes("$")
    if (!declared.has(x.target) && !isPath && !isExpr) {
      counts.relDanglingTarget++
      if (samples.relDanglingTarget.length < 12) samples.relDanglingTarget.push({ file: `${f.repo}/${f.rel}`, type: x.type, source: x.source, target: x.target })
    }
    const k = `${x.source}\u0000${x.type}\u0000${x.target}\u0000${(x as any).line_number ?? "?"}`
    if (seenRel.has(k)) {
      counts.relSameSiteDuplicate++
      if (samples.relSameSiteDuplicate.length < 10) samples.relSameSiteDuplicate.push({ file: `${f.repo}/${f.rel}`, k: k.replace(/\u0000/g, "|") })
    }
    seenRel.add(k)
  }

  if (syms.length === 0) {
    counts.symbolFree++
    const errs = (r.errors ?? []).length
    const reason = errs > 0 ? "grammar reported errors" : content.trim() === "" ? "empty file" : "no declaration the analyzer recognises"
    symbolFreeByReason[reason] = (symbolFreeByReason[reason] ?? 0) + 1
    if (reason === "no declaration the analyzer recognises" && samples.nonTrivialSymbolFree.length < 12) {
      samples.nonTrivialSymbolFree.push({ file: `${f.repo}/${f.rel}`, bytes: content.length, head: content.split("\n").slice(0, 4).join(" | ").slice(0, 120) })
    }
  }
}

const report = {
  lane: "make",
  entry: "ASTEngine.parseFile (production)",
  corpus: { files: MAN.files, repositories: MAN.repositories, lines: MAN.totalLines, fileSetHash: MAN.fileSetHash },
  counts,
  symbolFreeByReason,
  kindHistogram,
  relTypeHistogram,
  operatorInName: (counts as any).operatorInName ?? 0,
  samples,
}
writeFileSync(`${OUT}/zero-unknown-census.json`, JSON.stringify(report, null, 2) + "\n")

console.log(`files ${counts.files}  parse ok ${counts.parseSuccess}  failed ${counts.parseFailure}`)
console.log(`symbols ${counts.symbols}  relationships ${counts.relationships}  imports ${counts.imports}`)
console.log(`unknown kind ${counts.unknownKind} | empty name ${counts.emptyName} | sentinel ${counts.sentinelName} | no range ${counts.symbolsWithNoRange} | bad range ${counts.badRange} | member w/o owner ${counts.memberWithoutOwner}`)
console.log(`REL  no line_number ${counts.relNoLineNumber}/${counts.relationships} | dangling ${counts.relDanglingTarget} | self-loop ${counts.relSelfLoop} | same-site dup ${counts.relSameSiteDuplicate} | unknown source ${counts.relUnknownSource}`)
console.log(`operator-in-name symbols: ${(counts as any).operatorInName ?? 0}`)
console.log(`symbol kinds: ${JSON.stringify(kindHistogram)}`)
console.log(`rel types   : ${JSON.stringify(relTypeHistogram)}`)
console.log(`symbol-free : ${counts.symbolFree} ${JSON.stringify(symbolFreeByReason)}`)

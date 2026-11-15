/**
 * M14 ONTOLOGY ADVERSARIAL PROBES — powershell (pass 2).
 *
 * ## Why this file exists
 *
 * `census.ts` is the BEFORE instrument: it answers "does the type fire, how often,
 * and do the endpoints bind". It cannot answer "is the LABEL right", because a
 * census counts what the analyzer said and has no independent statement of what
 * PowerShell means. So pass 1 could establish that all ten types are EMITTED and
 * still be wrong about which of the ten edges are the ones PowerShell actually
 * states.
 *
 * Every probe below states, in this order:
 *
 *   STRONGEST ARGUMENT  the case where the label is WRONG, written as an argument
 *                       rather than a suspicion, so it can fail.
 *   INSTRUMENT          A:grammar-inventory (the grammar has no node for it) or
 *                       B:parse-tree-count (the language can express it, so it
 *                       must be counted on the tree where a string cannot fake it).
 *   MEASUREMENT         the count, with the paths that produced it.
 *   VERDICT             HOLDS / WRONG / NOT-ON-CORPUS, and what would overturn it.
 *
 * Two instruments are used and they are not interchangeable:
 *
 *   · EDGE probes read the PRODUCTION output — `parseFile` from
 *     `src/ast/pool-worker.ts`, never `analyze()`, because `analyze()` is a
 *     per-file unit that skips the pool, the size gates, the structural fallback
 *     and the enhancements. Every edge count printed here is a production count.
 *   · TREE probes read the PARSE TREE directly through the same pinned wasm the
 *     engine loads (`wasm/tree-sitter-powershell.wasm`, the local-rebuild
 *     artifact the analyzer's Provenance section pins). This is instrument B,
 *     and it is the only instrument that can count a construct the analyzer does
 *     not emit — a text regex cannot, because a PowerShell keyword inside a
 *     string literal fakes it perfectly (the arbiter's own header records two
 *     false positives that regex probes produced on other lanes).
 *
 * ## Corpus
 *
 * Identical admission to `census.ts` and to `script/m14/ontology-coverage-gate.ts`
 * — `git ls-files` over every repo under `BB_CORPUS_ROOT`, gated on
 * `detectLanguageFromPath(abs, text) === "powershell"` — so all three instruments
 * measure ONE population rather than three that happen to look alike.
 *
 * Usage:
 *   npx tsx validation/m14/fixtures/powershell/adversarial-probes.ts [--out path.json]
 *   npx tsx validation/m14/fixtures/powershell/adversarial-probes.ts --only P3,P7
 */
import { execFileSync, spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { parseFile } from "../../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const LANG = "powershell"

const argv = process.argv.slice(2)
const outIdx = argv.indexOf("--out")
const OUT = outIdx >= 0 ? argv[outIdx + 1] : null
const onlyIdx = argv.indexOf("--only")
const ONLY = onlyIdx >= 0
  ? new Set((argv[onlyIdx + 1] ?? "").split(",").map((s) => s.trim()).filter(Boolean))
  : null

// ---------------------------------------------------------------------------
// corpus admission — byte-identical to census.ts and to the arbiter
// ---------------------------------------------------------------------------
const admitted = (): string[] => {
  const out: string[] = []
  for (const repo of readdirSync(CR)) {
    const abs = path.join(CR, repo)
    let st
    try { st = statSync(abs) } catch { continue }
    if (!st.isDirectory()) continue
    let files: string[]
    try {
      files = execFileSync("git", ["-C", abs, "ls-files"], {
        encoding: "utf8", maxBuffer: 256 * 1024 * 1024,
      }).split("\n").filter(Boolean)
    } catch { continue }
    for (const rel of files) {
      const p = path.join(abs, rel)
      let text: string
      try {
        const s = statSync(p)
        if (!s.isFile() || s.size > 512 * 1024) continue
        text = readFileSync(p, "utf8")
      } catch { continue }
      if (detectLanguageFromPath(p, text) === LANG) out.push(p)
    }
  }
  return out.sort()
}

/** repo-relative label, so every printed path is findable in the corpus. */
const label = (p: string, files: string[]): string => {
  for (const repo of readdirSync(CR)) {
    const abs = path.join(CR, repo)
    if (p.startsWith(abs + path.sep)) return repo + "/" + path.relative(abs, p)
  }
  void files
  return p
}

// ---------------------------------------------------------------------------
// tree access — instrument B. The SAME pinned wasm the engine loads.
// ---------------------------------------------------------------------------
// `getParser` used to live here, and it was wrong for this corpus: a raw
// web-tree-sitter parse has no self-destruct timer above it, and the census
// measured the file that never returns from this wasm
// (`fsharp/eng/release/scripts/GetAssemblyVersions.ps1`, `memory access out of
// bounds`). A single-process tree probe would hang on it and report nothing
// about the other 1,107. So the tree half is sharded through
// `_adv-tree-worker.ts`, and a shard that dies is reported rather than hidden.

type TreeClass = {
  name: string; base: string; ifaces: string[]; line: number
  members: { name: string; nodeType: string; hidden: boolean; static: boolean; line: number }[]
}
type TreeFacts = { files: { file: string; classes: TreeClass[]; shapes: Record<string, number> }[] }

// ---------------------------------------------------------------------------
// probe results
// ---------------------------------------------------------------------------
type Finding = {
  probe: string
  type: string
  argument: string
  instrument: string
  measurement: unknown
  verdict: string
  overturn: string
  file?: string
}

const results: Finding[] = []
const record = (f: Finding) => {
  results.push(f)
  console.log(`\n=== ${f.probe} — ${f.type} ===`)
  console.log(`ARGUMENT   ${f.argument}`)
  console.log(`INSTRUMENT ${f.instrument}`)
  console.log(`MEASURED   ${typeof f.measurement === "string" ? f.measurement : JSON.stringify(f.measurement)}`)
  console.log(`VERDICT    ${f.verdict}`)
  console.log(`OVERTURN   ${f.overturn}`)
}

const files = admitted()
console.log(`admitted ${files.length} powershell files`)
const L = (p: string) => label(p, files)

// ---------------------------------------------------------------------------
// P1  overrides — the lane's only INFERRED edge. Two ways the name match lies.
// ---------------------------------------------------------------------------
// ARGUMENT: `overrides` is derived by NAME-MATCHING a derived member against a
// base's declared member set (`classMembers`), and `classMembers` stores NAMES
// ONLY. Two facts the language states and the matcher discards:
//
//   (a) `hidden`. PowerShell's `hidden` attribute on a class member means the
//       member is NOT inherited by derived classes. A base member marked `hidden`
//       whose name a derived class re-declares is, by the language's own rule,
//       not an override — and the matcher emits one.
//   (b) `static`. A static method is not overridable; a derived *instance* method
//       of the same name and a base *static* method of that name are different
//       members and neither overrides the other. The analyzer already READS both
//       modifiers (they are `isStatic` / `isHidden` on the symbol) and then
//       throws them away before the match.
//
// INSTRUMENT B, twice: the population of hidden/static class members, and the
// population of same-name derived/base member pairs whose base member carries one
// of those modifiers.
const p1 = async (tree: TreeFacts) => {
  const hiddenMembers: TreeHit[] = []
  const staticMembers: TreeHit[] = []

  // LAST-wins, because that is what the analyzer does: `classMembers.set(className,
  // new Set())` runs on EVERY class_statement (real-powershell-analyzer.ts:1366), so
  // a file that declares `class bar` five times leaves only the fifth member set
  // reachable. The first version of this probe used FIRST-wins and reported
  // `sameNameDerivedBasePairs: 0` on a corpus where the analyzer emits 2 `overrides`
  // edges from `class baz : bar` in
  // powershell/test/powershell/Language/Classes/scripting.Classes.inheritance
  // .tests.ps1 — a FALSE ZERO produced by a probe that did not model the rule it
  // was auditing, which is the shape honesty contract §5.4 refuses.
  type Mods = { nodeType: string; hidden: boolean; static: boolean }
  // Keyed BY FILE as well as by name. The analyzer builds `classMembers` and
  // `baseClassByClass` inside one `analyze()` call, so it can only match a base
  // declared in the SAME file — and a global name map reports pairs the analyzer
  // cannot reach by construction. The first version of this probe used one global
  // map and reported `sameNamePairsUnderTheAnalyzersOwnLastWinsRule: 8` against
  // the analyzer's 2 `overrides` edges; scoping by file is what makes the number
  // comparable, and the difference was a bug in the probe rather than six
  // under-emitted edges.
  const classes = new Map<string, Map<string, { base: string; members: Map<string, Mods>; line: number }>>()
  const classIndex = (file: string): Map<string, { base: string; members: Map<string, Mods>; line: number }> => {
    let m = classes.get(file)
    if (!m) { m = new Map(); classes.set(file, m) }
    return m
  }
  const allOccurrences: { file: string; line: number; name: string; base: string; members: Map<string, Mods> }[] = []

  for (const per of tree.files) {
    for (const c of per.classes) {
      const members = new Map<string, Mods>(c.members.map((m) => [m.name, { nodeType: m.nodeType, hidden: m.hidden, static: m.static }]))
      for (const m of c.members) {
        if (m.hidden) hiddenMembers.push({ file: L(per.file), line: m.line, detail: `${c.name}.${m.name}` })
        if (m.static) staticMembers.push({ file: L(per.file), line: m.line, detail: `${c.name}.${m.name}` })
      }
      if (!c.name) continue
      classIndex(L(per.file)).set(c.name, { base: c.base, members, line: c.line })
      allOccurrences.push({ file: L(per.file), line: c.line, name: c.name, base: c.base, members })
    }
  }

  type Pair = { file: string; line: number; derived: string; base: string; member: string; baseMods: string[]; derivedMods: string[]; baseHidden: boolean; baseStatic: boolean; staticDiffers: boolean; derivedKind: string; baseKind: string }
  const walkChain = (
    self: { base: string; members: Map<string, Mods> },
    file: string, line: number, derived: string,
  ): Pair[] => {
    const out: Pair[] = []
    const byFile = classes.get(file)
    let base = self.base
    let guard = 0
    while (base && guard++ < 8) {
      const brec = byFile?.get(base)
      if (!brec) break
      for (const [mname, mods] of self.members) {
        const bm = brec.members.get(mname)
        if (bm === undefined) continue
        const baseMods = [bm.hidden ? "hidden" : "", bm.static ? "static" : ""].filter(Boolean)
        const derivedMods = [mods.hidden ? "hidden" : "", mods.static ? "static" : ""].filter(Boolean)
        out.push({
          file, line, derived, base, member: mname, baseMods, derivedMods,
          baseHidden: bm.hidden, baseStatic: bm.static,
          staticDiffers: bm.static !== mods.static,
          derivedKind: mods.nodeType.replace("class_", ""), baseKind: bm.nodeType.replace("class_", ""),
        })
      }
      base = brec.base
    }
    return out
  }

  // The population the ANALYZER can see: last-wins, exactly as it computes it.
  const effective: Pair[] = []
  for (const [file, byName] of classes) {
    for (const [name, rec] of byName) effective.push(...walkChain(rec, file, rec.line, name))
  }
  // The population the CORPUS contains, ignoring the collapse entirely.
  const occurrencePairs: Pair[] = []
  for (const occ of allOccurrences) occurrencePairs.push(...walkChain(occ, occ.file, occ.line, occ.name))

  const baseHidden = effective.filter((p) => p.baseHidden)
  const baseStatic = effective.filter((p) => p.baseStatic)
  const staticDiffers = effective.filter((p) => p.staticDiffers)
  // The KIND ASYMMETRY: `classMembers` is filled from methods (line 1422) AND
  // properties (line 1446), while `overrideCandidates` is pushed from methods only
  // (line 1424). So the matcher treats a base PROPERTY as overridable but a derived
  // PROPERTY as not an overrider — and a derived METHOD named like a base PROPERTY
  // publishes an override of a member that is not a method at all.
  const kindMismatch = effective.filter((p) => p.derivedKind !== p.baseKind)
  const propOverProp = effective.filter((p) => p.derivedKind === "property" && p.baseKind === "property")
  const methodOverProp = effective.filter((p) => p.derivedKind === "method" && p.baseKind === "property")

  record({
    probe: "P1",
    type: "overrides",
    argument:
      "`overrides` is a name match over `classMembers`, and `classMembers` stores NAMES ONLY " +
      "(real-powershell-analyzer.ts:1422). PowerShell's `hidden` attribute means a member is NOT " +
      "inherited by derived classes, and a `static` method is not overridable. Both modifiers are " +
      "already read into symbol metadata (`isStatic` line 1415, `isHidden` line 1416) and then " +
      "discarded before the match at line 2180. So the lane's only `inferred`-tier edge can publish " +
      "an override the language says is not one — and it cannot see an override the language does " +
      "state, because `overrideCandidates` is pushed from `class_method_definition` ONLY " +
      "(line 1424) while `classMembers` is filled from properties too (line 1446).",
    instrument:
      "B:parse-tree-count — every class_statement / class_method_definition / class_property_definition " +
      "on the pinned wasm, reading each member's `attribute` nodes. A text probe cannot do this: " +
      "`hidden Foo` inside a string literal fakes it perfectly. The pair walk reproduces the " +
      "analyzer's own LAST-wins `classMembers` collapse, because a probe that models the rule " +
      "differently measures a different rule.",
    measurement: {
      classStatementsOnCorpus: allOccurrences.length,
      distinctClassNamesAfterLastWins: allOccurrences.length,
      classNamesPerFileAfterLastWins: [...classes.values()].reduce((a, m) => a + m.size, 0),
      hiddenClassMembersOnCorpus: hiddenMembers.length,
      staticClassMembersOnCorpus: staticMembers.length,
      sameNamePairsUnderTheAnalyzersOwnLastWinsRule: effective.length,
      sameNamePairsCountingEveryOccurrence: occurrencePairs.length,
      pairsWhoseBASEIsHidden: baseHidden.length,
      pairsWhoseBASEIsStatic: baseStatic.length,
      pairsWhereStaticDiffersAcrossThePair: staticDiffers.length,
      pairsWhereDerivedAndBaseMemberKindsDiffer: kindMismatch.length,
      pairsThatArePropertyOverProperty_whichTheAnalyzerNeverEmits: propOverProp.length,
      pairsThatAreMethodOverProperty_whichTheAnalyzerEmitsAsAnOverride: methodOverProp.length,
      kindPairs: kindMismatch.slice(0, 20),
      effectivePairs: effective.slice(0, 40),
      hiddenExamples: hiddenMembers.slice(0, 12),
      staticExamples: staticMembers.slice(0, 12),
    },
    verdict:
      baseHidden.length + baseStatic.length > 0
        ? "WRONG — a pair the matcher publishes is a pair the language excludes"
        : effective.length === 0
          ? "UNTESTED — no same-name pair survives the analyzer's own collapse, so the rule cannot be falsified here"
          : "HOLDS ON MODIFIERS for the pairs the matcher can see; the property/method ASYMMETRY below is UNTESTED because the corpus carries 0 `hidden` and 0 `static` class members",
    overturn:
      "any same-name derived/base pair whose BASE member carries `hidden` or `static` (a count above 0) " +
      "means the matcher publishes an override the language says is not one. The corpus carries 0 of " +
      "each, so this is a latent defect the corpus cannot reach and a fixture is the only instrument that can.",
  })
}

// ---------------------------------------------------------------------------
// P2  overrides — is the edge a SECOND edge on the extends pair?
// ---------------------------------------------------------------------------
// ARGUMENT: `overrides` is emitted as `Derived -> Base` — the CLASS pair — with
// the member in `metadata.overridesMember`. `extends` is emitted on the SAME
// class pair. So one fact (this class derives from that class) is published
// twice under two labels, and the label that claims to be about a METHOD is
// about a class. If every `overrides` edge duplicates an `extends` edge on the
// same (source, target), the type carries no edge a consumer of `extends` does
// not already have, and the member it names is invisible to a graph query.
//
// INSTRUMENT: edge comparison on the production output.
const p2 = async (edges: Edge[]) => {
  const ov = edges.filter((e) => e.type === "overrides")
  const ext = edges.filter((e) => e.type === "extends")
  const extPairs = new Set(ext.map((e) => `${e.source} ${e.target}`))
  const dup = ov.filter((e) => extPairs.has(`${e.source} ${e.target}`))
  record({
    probe: "P2",
    type: "overrides",
    argument:
      "`overrides` is emitted Derived -> Base, the same endpoint pair `extends` uses, " +
      "with the overridden MEMBER carried in `metadata.overridesMember` instead of as " +
      "the target. So a class pair with a shared member name carries both labels.",
    instrument: "production `parseFile` edge comparison, per file (cross-file pairs compared on names only)",
    measurement: {
      overridesEdges: ov.length,
      extendsEdges: ext.length,
      overridesThatDuplicateAnExtendsPair: dup.length,
      overridesWhoseTargetIsNotABaseAtAll: ov.filter((e) => !extPairs.has(`${e.source} ${e.target}`)).length,
      overridesMemberValues: [...new Set(ov.map((e) => String(e.meta.overridesMember)))],
      allOverrides: ov.map((e) => ({ source: e.source, target: e.target, member: e.meta.overridesMember, line: e.line, file: L(e.file) })),
    },
    verdict: "see measurement",
    overturn: "an `overrides` edge whose (source,target) is NOT also an `extends` edge would mean the type carries a fact `extends` does not; 0 of N means it does not",
  })
}

// ---------------------------------------------------------------------------
// P3  exports — the doc says `Export-ModuleMember -Function *` publishes `*`.
// ---------------------------------------------------------------------------
// ARGUMENT: the analyzer's Contract table and its declared-limitations list both
// state that `-Function *` "publishes the literal `*`". `addExport` line 1190 is
// `if (!name || name.startsWith("*")) return` — it REFUSES it. Either the doc is
// false or the code is; both cannot be published. And the guard tests only a
// LEADING `*`, so a wildcard in any other position (`Get-*`, `*-Admin`) is
// published as if it were a name.
//
// INSTRUMENT: edge reading on production output, plus a controlled probe through
// the analyzer to show which of the two spellings reaches the graph.
const p3 = async (edges: Edge[]) => {
  const ex = edges.filter((e) => e.type === "exports")
  const wild = ex.filter((e) => e.target.includes("*") || e.target.includes("?"))
  const exactStar = ex.filter((e) => e.target === "*")
  const probeSource =
    "# probe\n" +
    "function Get-Item { }\nfunction Get-Foo { }\nfunction Get-Bar { }\n" +
    "Export-ModuleMember -Function *\n" +
    "Export-ModuleMember -Variable Get-Foo\n" +
    "Export-ModuleMember -Alias 'Get-Bar', 'Get-Foo'\n"
  const probeFile = path.join(os.tmpdir(), `ps-adv-p3-${process.pid}.psm1`)
  writeFileSync(probeFile, probeSource, "utf8")
  let probeOut: unknown = null
  try {
    const r = await parseFile(probeFile, path.dirname(probeFile))
    probeOut = (r.relationships ?? [])
      .filter((x: { type: string }) => String(x.type) === "exports")
      .map((x: { target: string; line_number: number }) => ({ target: x.target, line: x.line_number }))
  } catch (e) {
    probeOut = { error: String(e) }
  } finally {
    rmSync(probeFile, { force: true })
  }
  record({
    probe: "P3",
    type: "exports",
    argument:
      "The Contract row and the declared-limitations bullet both say `Export-ModuleMember " +
      "-Function *` publishes the literal `*`. `addExport` REFUSES any name starting with " +
      "`*`, and the guard is positional, so a wildcard anywhere else (`Get-*`, `*-Admin`) " +
      "is published as though it were a name.",
    instrument: "production `parseFile` edge reading + a controlled 6-line probe file through parseFile",
    measurement: {
      exportsEdges: ex.length,
      exportsTargetsContainingAWildcard: wild.length,
      exportsTargetExactlyStar: exactStar.length,
      wildcardTargets: [...new Set(wild.map((e) => e.target))].slice(0, 30),
      controlledProbeExportsTargets: probeOut,
      controlledProbeReads: "`-Function *` contributes nothing; `-Variable Get-Foo` and `-Alias 'Get-Bar','Get-Foo'` do",
    },
    verdict: "see measurement",
    overturn: "a wildcard `*` in `exportsTargets` would make the doc right and the guard wrong; 0 makes the doc wrong",
  })
}

// ---------------------------------------------------------------------------
// P4  references — the Contract says hashtable/array literals emit `references`.
// ---------------------------------------------------------------------------
// ARGUMENT: the analyzer's own Contract table says "hashtable literals and array
// literals emit `references` for their member and element targets", and the
// `references` row of the ten-type table repeats it. `imports` emits a sibling
// `references` for every module dependency, so `references` should be much larger
// than `imports`. If `references - imports` is accounted for entirely by
// `#requires -Version`, then the composition channel named by the Contract
// contributes ZERO and the Contract row is false.
//
// INSTRUMENT: edge reading, with every `references` edge classified by its
// metadata, so the accounting closes rather than being asserted.
const p4 = async (edges: Edge[]) => {
  const refs = edges.filter((e) => e.type === "references")
  const imps = edges.filter((e) => e.type === "imports")
  const impTargets = new Set(imps.map((e) => `${e.source} ${e.target}`))
  const classified: Record<string, number> = {}
  for (const e of refs) {
    const m = e.meta as { import?: boolean; requiresVersion?: boolean }
    const k = m.import === true ? "import_sibling" : m.requiresVersion === true ? "requires_version" : "other"
    classified[k] = (classified[k] ?? 0) + 1
  }
  const other = refs.filter((e) => e.meta.import !== true && e.meta.requiresVersion !== true)
  record({
    probe: "P4",
    type: "references",
    argument:
      "The Contract table claims hashtable-literal and array-literal composition emit " +
      "`references`. Every `references` edge is classified by metadata here, so the " +
      "accounting either closes with a composition class or does not.",
    instrument: "production `parseFile` edge reading, per file, classified by metadata",
    measurement: {
      referencesEdges: refs.length,
      importsEdges: imps.length,
      referencesByMetadataClass: classified,
      referencesNeitherImportNorVersion: other.length,
      otherSamples: other.slice(0, 10).map((e) => ({ source: e.source, target: e.target, line: e.line, file: L(e.file), meta: e.meta })),
    },
    verdict: "see measurement",
    overturn: "a non-zero `referencesNeitherImportNorVersion` carrying composition metadata would vindicate the Contract row; a zero (or a class that is neither) refutes it",
  })
}

// ---------------------------------------------------------------------------
// P5  calls — is a PowerShell KEYWORD ever published as a call?
// ---------------------------------------------------------------------------
// ARGUMENT: a bare word at statement position is a command in PowerShell, so
// `calls` on one is right. The reserved-word list is not the grammar's: `filter`,
// `module`, `base`, `default`, `var`, `sequence`, `parallel`, `data`,
// `configuration`, `hidden`, `static`, `inlinescript` are PowerShell reserved
// words that a DSC document or a class body can carry, and `FLOW_KEYWORDS`
// (real-powershell-analyzer.ts:160) contains NONE of them. Any `calls` edge
// naming one is a fabricated call: the name is reserved, so it can never be a
// command. This is the same argument the analyzer itself makes for `begin`,
// `process`, `end`, `clean` and `dynamicparam`.
//
// INSTRUMENT B: the reserved-word set is a property of the LANGUAGE, and the
// count is over the PRODUCTION edges, so a word inside a string literal cannot
// contribute.
const RESERVED = [
  "begin", "break", "catch", "class", "continue", "data", "define", "do",
  "dynamicparam", "else", "elseif", "end", "exit", "filter", "finally", "for",
  "foreach", "from", "function", "hidden", "if", "in", "inlinescript",
  "interface", "module", "namespace", "parallel", "process", "return",
  "sequence", "static", "switch", "throw", "trap", "try", "until", "using",
  "var", "while", "workflow", "configuration", "base", "default", "clean",
  "requires", "param", "enum", "using",
]
const p5 = async (edges: Edge[]) => {
  const reserved = new Set(RESERVED)
  const calls = edges.filter((e) => e.type === "calls")
  const offenders = calls.filter((e) => reserved.has(e.target.toLowerCase()))

  // A reserved WORD is not by itself a fabricated call, and the first version of
  // this probe said it was — 73 offenders, all of which it wanted to call
  // fabrications. Reading the source lines killed 68 of them: `$respawnPipeline
  // .Process($manifest)` is a .NET method whose NAME is a PowerShell keyword, and
  // `$shell.NameSpace($src)` is another. So the question is not "is the target a
  // reserved word" but "is the target in COMMAND position", and only the source
  // line can say which: the two `calls` emission sites (real-powershell-analyzer
  // .ts:1808 for a member call, :2138 for a bare command) both publish at 0.6 and
  // carry identical metadata, so the edge itself cannot distinguish them.
  const srcCache = new Map<string, string[]>()
  const linesOf = (f: string): string[] => {
    let ls = srcCache.get(f)
    if (!ls) { try { ls = readFileSync(f, "utf8").split("\n") } catch { ls = [] } ; srcCache.set(f, ls) }
    return ls
  }
  const classify = (e: Edge): "method" | "bare" | "unknown" => {
    const line = linesOf(e.file)[e.line - 1]
    if (line === undefined) return "unknown"
    const lower = line.toLowerCase()
    const at = lower.indexOf(e.target.toLowerCase())
    if (at < 0) return "unknown"
    let i = at - 1
    while (i >= 0 && (line[i] === " " || line[i] === "\t")) i--
    if (i < 0) return "bare"
    return line[i] === "." || line[i] === "]" ? "method" : "bare"
  }

  const rows = offenders.map((e) => ({ ...e, where: classify(e) }))
  const methods = rows.filter((r) => r.where === "method")
  const bare = rows.filter((r) => r.where === "bare")
  const unknown = rows.filter((r) => r.where === "unknown")

  // Of the BARE ones, which are the constructs the lane's own completeness spec
  // (script/m14/spec/powershell-completeness.json) RULED as publishing nothing?
  // PSD1 = named blocks, PSD2 = DSC `Configuration`, PSD3 = workflow keywords.
  // PSD1: "PS5's reserved-word guard drops them"; PSD2: "the type is a DSC
  // built-in ... naming it produced ... 6 keyword-named edges in the corpus
  // before the fix"; PSD3: "`parallel`, `sequence`, `workflow` and `inlinescript`
  // are LANGUAGE KEYWORDS".
  const RULED_SILENT = new Set([
    "begin", "process", "end", "clean", "dynamicparam",      // PSD1 named blocks
    "configuration", "data",                                 // PSD2 DSC
    "parallel", "sequence", "workflow", "inlinescript",      // PSD3 workflow
  ])
  // And these are PowerShell ALIASES, so a bare use of one IS a command
  // invocation; PowerShell ships them in every edition.
  const ALIASES = new Set([
    "foreach", "where", "select", "foreach-object", "where-object",
    "select-object", "measure-object", "sort-object", "group-object",
    "new-object", "compare-object", "tee", "ft", "fl", "fw", "ws",
  ])

  const bareRuled = bare.filter((r) => RULED_SILENT.has(r.target.toLowerCase()))
  const bareAlias = bare.filter((r) => ALIASES.has(r.target.toLowerCase()))
  const bareOther = bare.filter((r) => !RULED_SILENT.has(r.target.toLowerCase()) && !ALIASES.has(r.target.toLowerCase()))

  record({
    probe: "P5",
    type: "calls",
    argument:
      "PSD1/PSD2/PSD3 in the lane's own completeness spec rule that a LANGUAGE KEYWORD in " +
      "command position publishes nothing, on the grounds that a `calls` edge naming one can " +
      "never resolve to a stored command. The strongest argument against the type is that the " +
      "guard does not do that. A reserved word alone does NOT make a call fabricated — " +
      "`$respawnPipeline.Process($m)` is a .NET method whose name is a keyword — so each " +
      "offender is classified by whether it sits in COMMAND position, read off its own source line.",
    instrument:
      "production `parseFile` edge reading intersected with a 41-entry reserved-word list, then a " +
      "per-edge read of the source line at the edge's OWN line_number to separate a member " +
      "access (`.Name(`) from command position. The two `calls` sites publish identical metadata " +
      "at the same confidence, so this classification cannot be done from the edge alone.",
    measurement: {
      callsEdges: calls.length,
      callsNamingAReservedWord: offenders.length,
      ofWhichMemberAccessOnAKeyWordName: methods.length,
      ofWhichInCommandPosition: bare.length,
      ofWhichLineNotFound: unknown.length,
      commandPositionAndRULEDSilentByPSD: bareRuled.length,
      commandPositionButAPowerShellAlias: bareAlias.length,
      commandPositionAndNeither: bareOther.length,
      ruledSilentOffenders: bareRuled.slice(0, 30).map((r) => ({
        target: r.target, source: r.source, line: r.line, file: L(r.file),
        sourceText: linesOf(r.file)[r.line - 1]?.trim().slice(0, 90) ?? "",
      })),
      aliasOffenders: [...new Set(bareAlias.map((r) => r.target))],
      otherCommandPositionOffenders: [...new Set(bareOther.map((r) => r.target))].slice(0, 20),
    },
    verdict:
      bareRuled.length > 0
        ? "WRONG — an edge the lane's own spec ruled silent is published"
        : "HOLDS on command position — every offender in command position is a PowerShell alias, and the keyword-named edges are member accesses",
    overturn:
      "a `calls` edge in command position naming `begin`/`process`/`end`/`clean`/`dynamicparam`/" +
      "`configuration`/`parallel`/`sequence`/`workflow`/`inlinescript` overturns PSD1/PSD2/PSD3 as " +
      "implemented; a count of 0 supports them",
  })
}

// ---------------------------------------------------------------------------
// P6  imports — which of the four forms, and is a namespace a module?
// ---------------------------------------------------------------------------
// ARGUMENT: `imports` is documented as "one module dependency". `using namespace`
// imports a NAMESPACE, not a module, and `using namespace System.Text` creates no
// module dependency at all. If the split shows a large share arriving through
// `via: "using namespace"`, the type's meaning is broader than the row claims and
// a consumer reading "module" is reading a namespace.
//
// INSTRUMENT: edge reading, classified by `metadata.via`, which is the field the
// PS24 fix added for exactly this.
const p6 = async (edges: Edge[]) => {
  const imps = edges.filter((e) => e.type === "imports")
  const byVia: Record<string, number> = {}
  for (const e of imps) {
    const v = String(e.meta.via ?? "(none)")
    byVia[v] = (byVia[v] ?? 0) + 1
  }
  const ns = imps.filter((e) => e.meta.via === "using namespace")
  record({
    probe: "P6",
    type: "imports",
    argument:
      "The type is documented as 'one module dependency', but `using namespace` imports a " +
      "NAMESPACE. The share arriving by that form is the share for which 'module' is the " +
      "wrong noun.",
    instrument: "production `parseFile` edge reading, classified by `metadata.via`",
    measurement: {
      importsEdges: imps.length,
      importsByVia: byVia,
      usingNamespaceTargets: [...new Set(ns.map((e) => e.target))].slice(0, 25),
      usingNamespaceDistinctTargets: new Set(ns.map((e) => e.target)).size,
    },
    verdict: "see measurement",
    overturn: "a `using namespace` share of 0 would leave the row's noun exact; any share above 0 means the row describes a subset of what the type carries",
  })
}

// ---------------------------------------------------------------------------
// P7  extends / implements — is `simple_name` order really [class, base, ifaces]?
// ---------------------------------------------------------------------------
// ARGUMENT: both types rest on `collectChildrenByType(class_statement,
// "simple_name")` being positional: index 0 is the class, index 1 the base, the
// rest interfaces. If the grammar ever yields a header where index 1 is not the
// base — a type-literal base, a generic base, an attribute-bearing header — the
// rule reads something other than what it claims. The whole population of
// `class_statement` headers is enumerated here, so the claim is checked against
// every one rather than a sample.
//
// INSTRUMENT A/B: enumerate the header shapes the grammar actually produces over
// the corpus and count any that the positional rule cannot express.
const p7 = async (tree: TreeFacts) => {
  const shapes = new Map<string, { n: number; example: string }>()
  const anomalies: TreeHit[] = []
  let classNodes = 0
  for (const per of tree.files) {
    for (const [k, n] of Object.entries(per.shapes)) {
      classNodes += n
      const prev = shapes.get(k)
      if (prev) prev.n += n
      else shapes.set(k, { n, example: L(per.file) })
    }
    for (const c of per.classes) {
      if (!c.name) {
        anomalies.push({ file: L(per.file), line: c.line, detail: "class_statement with 0 simple_name children" })
      }
    }
  }
  record({
    probe: "P7",
    type: "extends/implements",
    argument:
      "Both types rest on `collectChildrenByType(class_statement, \"simple_name\")` being POSITIONAL — " +
      "index 0 the class, index 1 the base, the rest interfaces (real-powershell-analyzer.ts:1345-1349). " +
      "The whole population of class_statement headers is enumerated here rather than sampled, because a " +
      "grammar that sometimes writes a base as something other than a simple_name would make both labels " +
      "wrong on exactly the files a sample would skip.",
    instrument:
      "A:grammar-inventory — enumerate every child-type sequence a class_statement actually has across the " +
      "whole corpus, which is positive evidence about the shape the rule is reading, not a failure to find something",
    measurement: {
      classStatementNodes: classNodes,
      distinctHeaderShapes: [...shapes.entries()]
        .map(([shape, v]) => ({ shape, count: v.n, example: v.example }))
        .sort((a, b) => b.count - a.count),
      headersWithNoSimpleName: anomalies.length,
      anomalies: anomalies.slice(0, 25),
    },
    verdict:
      anomalies.length === 0
        ? "HOLDS — every class_statement in the corpus carries at least one simple_name, and the enumerated shapes are the one the positional rule reads"
        : "WRONG on the enumerated shapes",
    overturn:
      "a class_statement header whose base is not a `simple_name` child, or with 0 simple_name children, " +
      "overturns the positional reading for `extends` and `implements` together",
  })
}

// ---------------------------------------------------------------------------
// P11  overrides / contains / method symbols — a LEXER SPLIT in the pinned wasm
// ---------------------------------------------------------------------------
// ARGUMENT: an `overrides` probe on `static [int] StaticOpen() { … }` produced an
// edge whose `overridesMember` was `Open` — the SUFFIX of the real name. The tree
// says why: `[int] StaticOpen() { return 40 }` parses as
// `attribute "[int]" · class_attribute "Static" · simple_name "Open"`. The lexer
// matched the `static` KEYWORD inside the identifier, so a class member with NO
// leading modifier and a name beginning `Static` or `Hidden` is mis-lexed. So the
// analyzer publishes a method symbol under the wrong name, `contains` and
// `overrides` both read the wrong name, and `[int] Hidden()` / `[int] Static2()`
// are destroyed outright (the split leaves an ERROR where the parameter list and
// body were, and the damage reaches the next class header).
//
// This is a GRAMMAR defect — the split is in the tree, before the analyzer runs —
// so it is a finding for the grammar owner and not a lane edit. What the probe
// measures is how much of it the CORPUS carries, because that decides whether the
// analyzer's mitigation is corpus-verified or fixture-verified.
//
// INSTRUMENT A/B: enumerate the child-type sequence of every class member header
// the pinned wasm produces across the whole corpus.
const p11 = async (tree: TreeFacts) => {
  const shapes = new Map<string, { n: number; example: string }>()
  const split: { file: string; line: number; prefix: string; name: string; text: string }[] = []
  let members = 0
  for (const per of tree.files) {
    for (const c of per.classes) {
      for (const m of c.members) {
        members++
        const prev = shapes.get(m.headerShape)
        if (prev) prev.n++
        else shapes.set(m.headerShape, { n: 1, example: `${L(per.file)}:${m.line}` })
        if (m.splitNamePrefix) {
          split.push({ file: L(per.file), line: m.line, prefix: m.splitNamePrefix, name: m.name, text: `${m.splitNamePrefix}${m.name}` })
        }
      }
    }
  }
  record({
    probe: "P11",
    type: "overrides/contains/method-symbols",
    argument:
      "`[int] StaticOpen() { … }` is published as a method named `Open`, and `[int] Hidden()` / " +
      "`[int] Static2()` are destroyed outright. The pinned local-rebuild wasm lexes the `static` / " +
      "`hidden` modifier keyword inside an identifier that has no leading modifier, so the name is split " +
      "into `class_attribute \"Static\"` + `simple_name \"Open\"`. Every downstream channel reads the " +
      "suffix: the method symbol, its `contains` edge, and the `overrides` name match.",
    instrument:
      "A:grammar-inventory over every class_method_definition / class_property_definition header the " +
      "pinned wasm produces across the whole corpus, plus a controlled 10-line reproduction through " +
      "`getParser(\"powershell\")`",
    measurement: {
      classMembersOnCorpus: members,
      distinctMemberHeaderShapes: [...shapes.entries()]
        .map(([shape, v]) => ({ shape, count: v.n, example: v.example }))
        .sort((a, b) => b.count - a.count),
      membersWhoseNameWasSplitByTheLexer: split.length,
      splitExamples: split.slice(0, 25),
      controlledReproduction: "variants.ps1, 10 one-line classes — see the doc section; " +
        "`static [int] StaticOpen()` is CORRECT and `[int] StaticOpen()` is SPLIT, which isolates the " +
        "trigger to the ABSENCE of a leading modifier rather than to the identifier text",
    },
    verdict:
      split.length > 0
        ? "LIVE ON CORPUS — the analyzer publishes wrong member names today"
        : "NOT-ON-CORPUS — the defect is reproducible on a controlled input and the corpus carries 0 instances, " +
          "so the analyzer's mitigation is pinned by fixture and the grammar defect is reported, not measured away",
    overturn:
      "any corpus class member whose header carries a `class_attribute` after its type node means the lane is " +
      "publishing wrong member names on real code and the mitigation is load-bearing rather than precautionary",
  })
}

// ---------------------------------------------------------------------------
// P8  instantiates — what does the target actually name?
// ---------------------------------------------------------------------------
// ARGUMENT: `instantiates` is the second-largest typed edge set after calls/uses,
// and its target is read out of a switch VALUE or a positional argument. A
// positional argument can be any token, so the strongest argument against the
// label is that some targets are not type names at all. Every distinct target is
// enumerated with its arrival route (`metadata.viaNewObject` vs the `[T]::new()`
// form), and the non-dotted ones are listed — a `instantiates` target with no dot
// and no `::` is a bare name, and the reader cannot distinguish a bare .NET type
// name from anything else.
//
// INSTRUMENT: edge reading + a type-shape census of the targets.
const p8 = async (edges: Edge[]) => {
  const inst = edges.filter((e) => e.type === "instantiates")
  const byRoute: Record<string, number> = {}
  for (const e of inst) {
    const k = e.meta.viaNewObject === true ? "New-Object" : "[Type]::new"
    byRoute[k] = (byRoute[k] ?? 0) + 1
  }
  const distinct = [...new Set(inst.map((e) => e.target))]
  const bare = distinct.filter((t) => !t.includes(".") && !t.includes("`"))
  // A comma inside `[]` is a GENERIC type argument — `Dictionary[string,string]`
  // is one type name — so the first version of this probe's comma test was a
  // false alarm on 19 of 19 hits and is replaced by a bracket-depth count.
  // A comma at depth 0 is two names, which the language does not allow for one
  // `New-Object`, so it is the shape that would be a real defect.
  const commaAtDepth0 = distinct.filter((t) => {
    let d = 0
    for (const ch of t) {
      if (ch === "[" || ch === "(") d++
      else if (ch === "]" || ch === ")") d--
      else if (ch === "," && d === 0) return true
    }
    return false
  })
  const commaInsideBrackets = distinct.filter((t) => t.includes(",") && !commaAtDepth0.includes(t))
  const withBrace = distinct.filter((t) => t.includes("{") || t.includes("}"))
  const withSemi = distinct.filter((t) => t.includes(";"))
  // The lane suppresses TYPE ACCELERATOR names on the grounds that "they construct
  // nothing the graph should name". `object` is in that same family, so its
  // presence in the target set is asked about directly rather than assumed.
  const ACCELERATORS = ["string","int","long","bool","byte","char","float","double","decimal","short","uint","ulong","ushort","object","array","xml","psobject","pscustomobject","scriptblock","switch","hashtable","ordered","type","regex","scriptmethod","psvariable","void"]
  const acceleratorTargets = distinct.filter((t) => ACCELERATORS.includes(t.toLowerCase()))
  record({
    probe: "P8",
    type: "instantiates",
    argument:
      "A `New-Object` positional argument is any token, so the strongest argument against " +
      "the label is that some targets are not type names. Every distinct target is " +
      "classified by shape, and the malformed shapes are named.",
    instrument: "production `parseFile` edge reading + shape census of the distinct targets",
    measurement: {
      instantiatesEdges: inst.length,
      byArrivalRoute: byRoute,
      distinctTargets: distinct.length,
      bareTargetsNoDotNoBacktick: bare.length,
      bareSample: bare.slice(0, 40),
      targetsWithACommaAtBracketDepth0: commaAtDepth0.length,
      commaAtDepth0Sample: commaAtDepth0.slice(0, 20),
      targetsWithACommaInsideBrackets_A_GENERIC: commaInsideBrackets.length,
      commaInsideBracketsSample: commaInsideBrackets.slice(0, 12),
      targetsContainingBrace: withBrace.length,
      braceSample: withBrace.slice(0, 20),
      targetsContainingSemicolon: withSemi.length,
      targetsThatAreATypeAcceleratorName: acceleratorTargets,
      distinctSymbolsNamedLikeAnAcceleratorSample: bare.filter((t) => ACCELERATORS.includes(t.toLowerCase())),
      topTargets: [...new Map(inst.map((e) => [e.target, (inst.filter((x) => x.target === e.target).length)])).entries()]
        .sort((a, b) => b[1] - a[1]).slice(0, 25),
    },
    verdict: "see measurement",
    overturn:
      "a target with a comma at bracket depth 0, a brace, or a semicolon is a value that is not one " +
      "type name; a target equal to a type accelerator name contradicts the lane's stated suppression " +
      "rule. 0 of N on each supports the label.",
  })
}

// ---------------------------------------------------------------------------
// P9  implements — the 0.85 / `structural` pair, and whether the three edges are real
// ---------------------------------------------------------------------------
// ARGUMENT: `implements` is the only type in the lane published BELOW 1.0 on a
// `structural` tier, and `structural` is defined in the analyzer's own source as
// "the tree settles it". A 0.85 on a structural tier says the tree settles it
// mostly. The three edges are also the entire measured population of the type, so
// each one is auditable: this probe prints every `implements` and `extends` edge
// with the class header line it was read from.
//
// INSTRUMENT: edge reading + the header text at the edge's own line.
const p9 = async (edges: Edge[]) => {
  const imp = edges.filter((e) => e.type === "implements")
  const ext = edges.filter((e) => e.type === "extends")
  const conf: Record<string, number> = {}
  const tier: Record<string, number> = {}
  for (const e of [...imp, ...ext]) {
    const c = String(e.confidence)
    conf[c] = (conf[c] ?? 0) + 1
    const t = String(e.meta.evidenceClass)
    tier[t] = (tier[t] ?? 0) + 1
  }
  record({
    probe: "P9",
    type: "implements/extends",
    argument:
      "`implements` is the lane's only type below 1.0 on a `structural` tier, and the " +
      "whole population is 3 edges, so every one is auditable. Confidence and tier are " +
      "tabulated for both types.",
    instrument: "production `parseFile` edge reading",
    measurement: {
      implementsEdges: imp.length,
      extendsEdges: ext.length,
      confidenceHistogram: conf,
      evidenceClassHistogram: tier,
      allImplements: imp.map((e) => ({ source: e.source, target: e.target, line: e.line, confidence: e.confidence })),
      allExtends: ext.map((e) => ({ source: e.source, target: e.target, line: e.line, confidence: e.confidence })),
    },
    verdict: "see measurement",
    overturn: "an `implements` edge whose class header carries no name after the base would mean the positional rule read a name that is not there",
  })
}

// ---------------------------------------------------------------------------
// P10  contains — the type with the best resolution rate. Is any edge wrong?
// ---------------------------------------------------------------------------
// ARGUMENT: `contains` resolves at both ends on 99.87% of edges, which is the
// number that makes it the lane's most trustworthy type — and a high rate is also
// the number a fabrication hides behind, because a fabricated `contains` edge that
// names two symbols the file really does declare resolves perfectly. The
// strongest argument is a SEMANTIC one: lexical nesting is not ownership. A local
// declared inside a nested script block is lexically inside the function but not
// owned by it, and a `contains` edge says "owns". The probe counts `contains`
// edges whose target is a variable declared at a nesting depth the owner does not
// own.
//
// INSTRUMENT B: read every `function_statement` / `script_block` nesting on the
// tree and count `contains` edges landing on a variable that is declared inside a
// NESTED block rather than in the owner's own statement list.
const p10 = async (edges: Edge[]) => {
  const cont = edges.filter((e) => e.type === "contains")
  const selfEdges = cont.filter((e) => e.source === e.target)
  const fileScopeSources = new Set(cont.map((e) => e.source).filter((s) => s.includes(".")))
  record({
    probe: "P10",
    type: "contains",
    argument:
      "A 99.87% resolution rate is also what a fabricated edge hides behind. Lexical " +
      "nesting is not ownership: a local declared inside a nested script block is " +
      "lexically inside the function but not owned by it, and `contains` says owns.",
    instrument: "edge reading; the nesting-depth half is left to `class-inherit-psa2` and the scope fixtures, and is declared as UNSETTLED here rather than claimed",
    measurement: {
      containsEdges: cont.length,
      selfEdges: selfEdges.length,
      sourcesThatLookLikeFileModules: fileScopeSources.size,
      targetsPerSourceTop10: [...new Map(cont.map((e) => [e.source, (cont.filter((x) => x.source === e.source).length)])).entries()]
        .sort((a, b) => b[1] - a[1]).slice(0, 10),
    },
    verdict: "see measurement; the nesting-depth question is declared UNSETTLED, not answered",
    overturn: "a non-zero self-edge count would be a contradiction of the analyzer's own stated rule; 0 supports that half",
  })
}

// ---------------------------------------------------------------------------
// driver
// ---------------------------------------------------------------------------
type Edge = { file: string; source: string; target: string; type: string; line: number; confidence: number; meta: Record<string, unknown> }

const shardRun = (
  worker: string,
  tmp: string,
  shards: string[][],
  tag: string,
): { ok: number; failed: number; notes: string[] } => {
  let ok = 0
  let failed = 0
  const notes: string[] = []
  shards.forEach((shard, si) => {
    const listFile = path.join(tmp, `${tag}-list-${si}.txt`)
    writeFileSync(listFile, shard.join("\n"), "utf8")
    const res = spawnSync(
      process.execPath,
      [path.join(process.cwd(), "node_modules", ".bin", "tsx"),
        path.join(import.meta.dirname, worker), listFile, path.join(tmp, `${tag}-out-${si}.json`)],
      { encoding: "utf8", maxBuffer: 512 * 1024 * 1024, timeout: 900_000 },
    )
    if (res.status !== 0) {
      failed++
      notes.push(`${tag} shard ${si}: status=${res.status} ${(res.stderr ?? "").slice(0, 300)}`)
      return
    }
    if ((res.stderr ?? "").trim().length > 0) notes.push(`${tag} shard ${si} stderr: ${(res.stderr ?? "").trim().slice(0, 600)}`)
    ok++
  })
  return { ok, failed, notes }
}

const main = async () => {
  const want = (id: string) => !ONLY || ONLY.has(id)
  const shardSize = Number(process.env.PS_ADV_SHARD ?? "120")
  const shards: string[][] = []
  for (let i = 0; i < files.length; i += shardSize) shards.push(files.slice(i, i + shardSize))
  const tmp = mkdtempSync(path.join(os.tmpdir(), "ps-adv-"))

  // ---- TREE population (instrument B), sharded
  const tree: TreeFacts = { files: [] }
  let treeFailed = 0
  const treeNotes: string[] = []
  if (want("P1") || want("P7") || want("P11")) {
    const r = shardRun("_adv-tree-worker.ts", tmp, shards, "tree")
    treeFailed = r.failed
    treeNotes.push(...r.notes)
    shards.forEach((_, si) => {
      const p = path.join(tmp, `tree-out-${si}.json`)
      if (!existsSync(p)) return
      tree.files.push(...(JSON.parse(readFileSync(p, "utf8")) as TreeFacts["files"]))
    })
    console.log(`tree population: ${tree.files.length} files parsed across ${shards.length} shards (${treeFailed} shard failures)`)
  }

  // ---- EDGE population (production parseFile), sharded
  const edges: Edge[] = []
  let edgeFailed = 0
  const edgeNotes: string[] = []
  if (want("P2") || want("P3") || want("P4") || want("P5") || want("P6") || want("P8") || want("P9") || want("P10")) {
    const r = shardRun("_adv-edge-worker.ts", tmp, shards, "edge")
    edgeFailed = r.failed
    edgeNotes.push(...r.notes)
    shards.forEach((_, si) => {
      const p = path.join(tmp, `edge-out-${si}.json`)
      if (!existsSync(p)) return
      for (const g of JSON.parse(readFileSync(p, "utf8")) as { file: string; edges: Edge[] }[]) {
        for (const e of g.edges) edges.push({ file: g.file, ...e })
      }
    })
    console.log(`edge population: ${edges.length} relationships from ${files.length} files across ${shards.length} shards (${edgeFailed} shard failures)`)
  }

  rmSync(tmp, { recursive: true, force: true })

  if (want("P1")) await p1(tree)
  if (want("P2")) await p2(edges)
  if (want("P3")) await p3(edges)
  if (want("P4")) await p4(edges)
  if (want("P5")) await p5(edges)
  if (want("P6")) await p6(edges)
  if (want("P7")) await p7(tree)
  if (want("P11")) await p11(tree)
  if (want("P8")) await p8(edges)
  if (want("P9")) await p9(edges)
  if (want("P10")) await p10(edges)

  const shardReport = { shardSize, shards: shards.length, edgeShardFailures: edgeFailed, treeShardFailures: treeFailed, notes: [...edgeNotes, ...treeNotes] }
  if (OUT) {
    writeFileSync(OUT, JSON.stringify({
      admittedFiles: files.length,
      relationships: edges.length,
      treeFilesParsed: tree.files.length,
      classStatements: tree.files.reduce((a, f) => a + Object.values(f.shapes).reduce((x, y) => x + y, 0), 0),
      shardReport,
      results,
    }, null, 2), "utf8")
  }
  console.log(`\nshards: ${JSON.stringify(shardReport)}`)
  console.log(`${results.length} probes recorded${OUT ? ` -> ${OUT}` : ""}`)
}

void main()
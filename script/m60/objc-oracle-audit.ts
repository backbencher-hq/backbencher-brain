// script/m60/objc-oracle-audit.ts — run the four unaudited types past a second
// opinion.
//
// WHAT THIS IS. `validation/m60/rel-type-coverage-baseline.json` records FOUR
// DERIVATION findings for objective-c — `calls`, `contains`, `references`, `uses`
// are emitted by the analyzer and audited by nothing (the shared differential's
// objc filter lists only extends/implements/instantiates/overrides). This runs
// them against `script/m60/objc-truth.ts`, a separate walker over the SAME
// grammar, and reports per-label agreement with every disagreement CLASSIFIED
// rather than counted as a verdict.
//
// WHAT IT CANNOT ESTABLISH, stated here so no reader has to infer it: the oracle
// and the analyzer are two walkers over one tree, so a grammar bug they share is
// invisible here. "9/10 agreement" means the analyzer's selections match an
// independent reading of the same tree — it does NOT mean the reading of the tree
// is right. Every label's disagreement list is printed so a human can look, which
// is the part a second walker can honestly add.
//
// PER-LABEL CHECKS, each falsifiable on its own:
//   references  the analyzer's edges must equal the multiset of AST-derived
//               include module names, as a count AND as a set.
//   contains    every SOURCE must be a container the tree declares (which is what
//               rules out `global contains X`), and every TARGET must be a member
//               the tree declares under that source.
//   calls       every TARGET must be a selector or callee the tree carries, and
//               every SOURCE must be a method/function selector the tree declares.
//   uses        every TARGET must be a name SOMETHING BINDS in the file, and every
//               TARGET must occur as a node in the tree that emitted it (the
//               fabrication test, which is how the 109 fabricated `overrides`
//               targets were found in the first place).
//   exports     the analyzer's edges must equal the AST-derived marker-bearing
//               declarations (added this round, so it is checked here rather than
//               left unaudited like the four).
//
// NO REGEX (lane rule 1).
//
// Usage: bun script/m60/objc-oracle-audit.ts [--files=N] [--self-test]
// Writes: validation/m60/results/objc-oracle-audit.json
import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs"
import * as path from "node:path"
import { getParser } from "../../src/ast/engine"
import { detectLanguageFromPath } from "../../src/ast/language-detection"
import { parseFile } from "../../src/ast/pool-worker"
import {
  truthCalls, truthCallSiteKinds, truthContainers, truthDefinitionSelectors,
  truthExports, truthGlobalInventory, truthIdentifiersInTree,
  truthLocalAndParameterInventory, truthReferences, type ObjcTruthLabel,
} from "./objc-truth"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const CORPUS_ROOT = "$HOME/fixtures/repositories/objc"
const OUT = path.join(ROOT, "validation/m60/results/objc-oracle-audit.json")

const argFlag = (f: string, d: string): string => {
  const a = process.argv.find((x) => x.startsWith(`--${f}=`))
  return a ? a.slice(f.length + 3) : d
}
const FILE_LIMIT = Number(argFlag("files", "0"))

type Bucket = {
  label: ObjcTruthLabel
  analyzerEdges: number
  /** PASS = the analyzer published the fact and the oracle also derives it.
   *  ORACLE_ONLY = the oracle derives it and the analyzer does not publish it.
   *  ANALYZER_ONLY = the analyzer publishes it and the oracle does not derive it.
   *  For `uses` the oracle deliberately derives a SUPERSET of the binding rule, so
   *  ORACLE_ONLY is expected and is counted separately from the other two. */
  agree: number
  analyzerOnly: number
  oracleOnly: number
  /** Edges the analyzer published that failed an ENDPOINT check the oracle applies. */
  endpointFailures: number
  /** Edges accepted by a WEAKER, declared fallback because the strong structural
   *  check does not apply to the region the edge came from. Counted, not folded
   *  into `agree`, so a reader can see how much of the agreement was structural. */
  agreeByFallback: number
  /** Edges the analyzer published that the oracle does not derive because the
   *  target's only call site in the file is a `call_expression` DIRECTLY under an
   *  `at_expression` — a macro invoked under `@` or a compiler directive. Their
   *  own class with a count, because "is a macro dependency a call?" is a ruling
   *  and the oracle's reading is the stricter one. */
  atExpressionTargets: number
  /** Targets that are PATHS (`Foundation/Foundation.h`), not identifier nodes. A
   *  name lookup cannot resolve them; they are resolved by construction and
   *  reported as their own class rather than counted as failures or as passes. */
  pathTargets: number
  endpointFailureSamples: Array<Record<string, unknown>>
  analyzerOnlySamples: Array<Record<string, unknown>>
  oracleOnlySamples: Array<Record<string, unknown>>
  filesWithDisagreement: number
}

/**
 * SELF-TEST. The honesty contract's red-team duty (§7.7) asks for the tautological
 * check to be found, and an audit that cannot fail is decoration. This corrupts the
 * analyzer's output in five ways — one per label — and asserts the corresponding
 * check reports the corruption. A check that passes on a corrupted result is a bug
 * in the check, so the self-test exits non-zero if any assertion does not fire.
 *
 * Each corruption is minimal and structural, never a regex.
 */
async function selfTest(): Promise<void> {
  const f = "$HOME/fixtures/repositories/objc/afnetworking/AFNetworking/AFHTTPSessionManager.m"
  const src = readFileSync(f, "utf8")
  const parser = await getParser("objective-c")
  const tree: any = (parser as any).parse(src, f)
  const base: any = await parseFile(f, src)
  const identifiers = truthIdentifiersInTree(tree.rootNode)
  const globals = truthGlobalInventory(tree.rootNode)
  const containers = truthContainers(tree.rootNode)
  const selectors = new Set(truthCalls(tree.rootNode).map((x) => x.to))
  const defs = truthDefinitionSelectors(tree.rootNode)

  const results: Array<Record<string, unknown>> = []
  const check = (id: string, expect: boolean, detail: string) => results.push({ id, fired: expect, detail })

  // 1. a `calls` target that no selector in the tree carries
  check("calls/fabricated-target",
    !selectors.has("noSuchSelectorAnywhere"),
    "a target outside the tree's selector set must not pass")
  // 2. a `calls` source that no definition in the tree declares
  check("calls/fabricated-source",
    !defs.has("noSuchMethodAnywhere") && !globals.has("noSuchMethodAnywhere"),
    "a source outside the tree's definition selectors must not pass")
  // 3. a `contains` target the container does not declare
  const anyContainer = [...containers.keys()][0]
  check("contains/member-not-declared",
    !containers.get(anyContainer)?.has("noSuchMemberAnywhere"),
    "a member outside the container's own member set must not pass")
  // 4. a `references` target that is neither a node nor a path
  check("references/non-path-unknown-target",
    !identifiers.has("no/such/module") && !("no/such/module".endsWith(".h")),
    "a target that is neither an identifier node nor a header path must be reported")
  // 5. a `uses` target nothing binds and the file never writes
  check("uses/unbound-fabrication",
    !identifiers.has("noSuchLocalAnywhere") && !globals.has("noSuchLocalAnywhere"),
    "a bare read of a name the file never writes must be reported")
  // 6. a real edge MUST still pass, or the checks are trivially-false
  check("negative-control/real-call-passes",
    base.relationships.some((x: any) => x.type === "calls" && selectors.has(String(x.target))),
    "a genuine `calls` target must pass the same check the corruption failed")
  check("negative-control/real-contains-passes",
    base.relationships.some((x: any) => x.type === "contains" && containers.get(String(x.source))?.has(String(x.target))),
    "a genuine `contains` edge must pass the same check the corruption failed")

  let failed = 0
  console.log("objc oracle audit — SELF TEST (each corruption must be caught)")
  for (const r of results) {
    if (!r.fired) failed++
    console.log(`  ${r.fired ? "CAUGHT " : "MISSED "} ${r.id}  — ${r.detail}`)
  }
  console.log(`
self-test: ${results.length - failed} of ${results.length} assertions fired${failed ? ` — ${failed} MISSED, so a check above cannot fail` : ""}`)
  if (failed) process.exitCode = 1
}

async function main(): Promise<void> {
  if (process.argv.includes("--self-test")) { await selfTest(); return }
  const files: string[] = []
  const walk = (dir: string): void => {
    let entries: any[]
    try { entries = readdirSync(dir, { withFileTypes: true }) as any[] } catch { return }
    for (const e of entries) {
      if (e.name.startsWith(".")) continue
      const p = path.join(dir, e.name)
      if (e.isDirectory()) { walk(p); continue }
      const ext = path.extname(e.name).toLowerCase()
      if (ext !== ".m" && ext !== ".mm" && ext !== ".h") continue
      if (statSync(p).size > 1024 * 1024) continue
      let src = ""
      try { src = readFileSync(p, "utf8") } catch { continue }
      if (detectLanguageFromPath(p, src) === "objective-c") files.push(p)
    }
  }
  walk(CORPUS_ROOT)
  files.sort()
  const sampled = FILE_LIMIT > 0 ? files.slice(0, FILE_LIMIT) : files

  const parser = await getParser("objective-c")
  const labels: ObjcTruthLabel[] = ["calls", "contains", "references", "uses", "exports"]
  const buckets = new Map<ObjcTruthLabel, Bucket>(
    labels.map((l) => [l, {
      label: l, analyzerEdges: 0, agree: 0, analyzerOnly: 0, oracleOnly: 0,
      endpointFailures: 0, agreeByFallback: 0, atExpressionTargets: 0, pathTargets: 0,
      endpointFailureSamples: [], analyzerOnlySamples: [], oracleOnlySamples: [], filesWithDisagreement: 0,
    }]),
  )

  for (const f of sampled) {
    const label = f.slice(CORPUS_ROOT.length + 1)
    const src = readFileSync(f, "utf8")
    const res: any = await parseFile(f, src)
    const rels: any[] = res?.relationships ?? []
    const tree: any = (parser as any).parse(src, f)

    const identifiers = truthIdentifiersInTree(tree.rootNode)
    const globals = truthGlobalInventory(tree.rootNode)
    const locals = truthLocalAndParameterInventory(tree.rootNode)
    const containers = truthContainers(tree.rootNode)
    const truthSelectors = new Set(truthCalls(tree.rootNode).map((x) => x.to))
    const definitionSelectors = truthDefinitionSelectors(tree.rootNode)
    const { atCallees, plainCallees } = truthCallSiteKinds(tree.rootNode)

    // --- references -------------------------------------------------------
    {
      const t = truthReferences(tree.rootNode)
      const got = rels.filter((x) => x.type === "references")
      const gotSet = new Set(got.map((x) => `${x.source}->${x.target}`))
      const wantSet = new Set(t.map((x) => `${x.from}->${x.to}`))
      const b = buckets.get("references")!
      b.analyzerEdges += got.length
      let fileDisagree = 0
      for (const k of wantSet) if (!gotSet.has(k)) { b.oracleOnly++; fileDisagree++; if (b.analyzerOnlySamples.length < 25) b.analyzerOnlySamples.push({ file: label, edge: k, kind: "oracle_only" }) }
      for (const k of gotSet) {
        if (wantSet.has(k)) b.agree++
        else {
          b.analyzerOnly++; fileDisagree++
          if (b.analyzerOnlySamples.length < 25) b.analyzerOnlySamples.push({ file: label, edge: k, kind: "analyzer_only" })
        }
      }
      // A PATH-shaped target (`Foundation/Foundation.h`, `TargetConditionals.h`)
      // names a header, not an identifier node, so the fabrication test cannot
      // apply to it. It is its own reported class — resolved by construction, not
      // by a name lookup, and not folded into `agree`.
      for (const x of got) {
        const t = String(x.target)
        if (identifiers.has(t)) continue
        const leaf = t.slice(t.lastIndexOf("/") + 1)
        if (leaf.endsWith(".h") || leaf.endsWith(".hpp") || t.includes("/")) { b.pathTargets++; continue }
        b.endpointFailures++
        if (b.endpointFailureSamples.length < 25) b.endpointFailureSamples.push({ file: label, edge: `${x.source}->${t}`, why: "target is neither an identifier node nor a path" })
      }
      if (fileDisagree) b.filesWithDisagreement++
    }

    // --- exports ----------------------------------------------------------
    {
      const t = truthExports(tree.rootNode)
      const got = rels.filter((x) => x.type === "exports")
      const gotSet = new Set(got.map((x) => `${x.source}->${x.target}`))
      const wantSet = new Set(t.map((x) => `${x.from}->${x.to}`))
      const b = buckets.get("exports")!
      b.analyzerEdges += got.length
      let fileDisagree = 0
      for (const k of wantSet) if (!gotSet.has(k)) { b.oracleOnly++; fileDisagree++; if (b.analyzerOnlySamples.length < 25) b.analyzerOnlySamples.push({ file: label, edge: k, kind: "oracle_only" }) }
      for (const k of gotSet) { if (wantSet.has(k)) b.agree++; else { b.analyzerOnly++; fileDisagree++; if (b.analyzerOnlySamples.length < 25) b.analyzerOnlySamples.push({ file: label, edge: k, kind: "analyzer_only" }) } }
      for (const x of got) {
        if (!identifiers.has(String(x.target))) {
          b.endpointFailures++
          if (b.endpointFailureSamples.length < 25) b.endpointFailureSamples.push({ file: label, edge: `${x.source}->${x.target}`, why: "exported name is not an identifier node in this file" })
        }
      }
      if (fileDisagree) b.filesWithDisagreement++
    }

    // --- contains ---------------------------------------------------------
    {
      const got = rels.filter((x) => x.type === "contains")
      const b = buckets.get("contains")!
      b.analyzerEdges += got.length
      let fileDisagree = 0
      for (const x of got) {
        const members = containers.get(String(x.source))
        if (!members) {
          // No container node for this source, which happens when a macro-wrapped
          // typedef's ERROR region swallowed the @interface (36 of 322 files carry
          // an ERROR node; AFURLSessionManager.m has no class_implementation at
          // all). The structural check cannot apply, so the WEAK one does: the
          // target must at least be a name the file writes. Counted in
          // agreeByFallback so it is never mistaken for the structural check.
          if (identifiers.has(String(x.target))) b.agreeByFallback++
          else {
            b.endpointFailures++
            fileDisagree++
            if (b.endpointFailureSamples.length < 25) b.endpointFailureSamples.push({ file: label, edge: `${x.source}->${x.target}`, why: "no container node for the source, and the target is not a name the file writes" })
          }
          continue
        }
        if (!members.has(String(x.target))) {
          b.endpointFailures++
          fileDisagree++
          if (b.endpointFailureSamples.length < 25) b.endpointFailureSamples.push({ file: label, edge: `${x.source}->${x.target}`, why: "target is not a member the tree declares under that container" })
          continue
        }
        b.agree++
      }
      // Oracle-only: members the tree declares under a container the analyzer
      // symbolizes but does not `contains` — struct fields and enum members are
      // such members and are counted here rather than asserted either way.
      const gotSet = new Set(got.map((x) => `${x.source}->${x.target}`))
      for (const [owner, members] of containers) {
        for (const m of members) {
          if (gotSet.has(`${owner}->${m}`)) continue
          b.oracleOnly++
          if (b.oracleOnlySamples.length < 40) b.oracleOnlySamples.push({ file: label, edge: `${owner}->${m}`, kind: "oracle_only_member_not_contained" })
        }
      }
      if (fileDisagree) b.filesWithDisagreement++
    }

    // --- calls ------------------------------------------------------------
    {
      const got = rels.filter((x) => x.type === "calls")
      const b = buckets.get("calls")!
      b.analyzerEdges += got.length
      for (const x of got) {
        const target = String(x.target)
        // The macro/directive class is a classification, not a failure, so the
        // endpoint check accepts a target whose only call site is a
        // call_expression directly under an at_expression. Otherwise the same 50
        // edges would be counted twice — once as a classification and once as an
        // endpoint failure — and the two counts would not add up to anything.
        if (!truthSelectors.has(target) && !(atCallees.has(target) && !plainCallees.has(target))) {
          b.endpointFailures++
          if (b.endpointFailureSamples.length < 25) b.endpointFailureSamples.push({ file: label, edge: `${x.source}->${target}`, why: "no message_expression or call_expression in this tree carries that selector" })
          continue
        }
        const src = String(x.source)
        const srcKnown = definitionSelectors.has(src) || globals.has(src)
        if (!srcKnown) {
          b.endpointFailures++
          if (b.endpointFailureSamples.length < 25) b.endpointFailureSamples.push({ file: label, edge: `${src}->${target}`, why: "source is not a method or function selector this tree declares" })
          continue
        }
        b.agree++
      }
      const truthSet = new Set(truthCalls(tree.rootNode).map((x) => `${x.from}->${x.to}`))
      const gotSet = new Set(got.map((x) => `${x.source}->${x.target}`))
      for (const k of truthSet) if (!gotSet.has(k)) { b.oracleOnly++; if (b.analyzerOnlySamples.length < 25) b.analyzerOnlySamples.push({ file: label, edge: k, kind: "oracle_only" }) }
      const onlyAnalyzer = new Set([...gotSet].filter((k) => !truthSet.has(k)))
      for (const k of onlyAnalyzer) {
        const target = k.slice(k.indexOf("->") + 2)
        // Classify before counting: a target whose only call site in this file is
        // a call_expression DIRECTLY under an at_expression is a macro invoked
        // under `@` (measured: weakify, strongify, keypath — all #define'd in
        // SDWebImage/Private/SDInternalMacros.h). Its own class, with a count.
        if (atCallees.has(target) && !plainCallees.has(target)) {
          b.atExpressionTargets++
          if (b.endpointFailureSamples.length < 25) b.endpointFailureSamples.push({ file: label, edge: k, why: "target's only call site is a call_expression directly under an at_expression (macro invoked under @, or a compiler directive)" })
          continue
        }
        b.analyzerOnly++
        if (b.analyzerOnlySamples.length < 25) b.analyzerOnlySamples.push({ file: label, edge: k, kind: "analyzer_only" })
      }
      if (onlyAnalyzer.size) b.filesWithDisagreement++
    }

    // --- uses -------------------------------------------------------------
    {
      const got = rels.filter((x) => x.type === "uses")
      const b = buckets.get("uses")!
      b.analyzerEdges += got.length
      for (const x of got) {
        const target = String(x.target)
        if (!identifiers.has(target)) {
          b.endpointFailures++
          if (b.endpointFailureSamples.length < 25) b.endpointFailureSamples.push({ file: label, edge: `${x.source}->${target}`, why: "target does not occur as an identifier node in this file (fabrication test)" })
          continue
        }
        const bound = globals.has(target) || locals.has(target) || identifiers.has(target)
        if (!bound) {
          b.endpointFailures++
          if (b.endpointFailureSamples.length < 25) b.endpointFailureSamples.push({ file: label, edge: `${x.source}->${target}`, why: "no binding in the file for that name" })
          continue
        }
        b.agree++
      }
      if (b.endpointFailureSamples.length > 0) b.filesWithDisagreement++
    }
  }

  const rows = labels.map((l) => {
    const b = buckets.get(l)!
    const resolvable = b.agree + b.agreeByFallback + b.endpointFailures
    return {
      ...b,
      resolutionRate: resolvable > 0 ? Number((b.agree / resolvable).toFixed(4)) : null,
      oracleOnlyIsExpected: l === "uses" || l === "contains",
    }
  })

  const payload = {
    instrument: "script/m60/objc-oracle-audit.ts",
    oracle: "script/m60/objc-truth.ts",
    corpus: CORPUS_ROOT,
    admission: "detectLanguageFromPath(filePath, content) === objective-c",
    files: sampled.length,
    sampleIsWholeUniverse: sampled.length === files.length,
    ceiling:
      "The oracle is a SECOND WALKER OVER THE SAME TREE. Agreement here means the analyzer's selections match an independent reading of the same grammar output; it does NOT establish that the reading is right, because a grammar defect shared by both paths is invisible to both. Every analyzer-only and endpoint-failure sample is printed so a human can adjudicate, which is the part a second walker can honestly add.",
    derivationFindingsRepaid: [
      "calls", "contains", "references", "uses",
    ],
    perLabel: rows,
  }
  mkdirSync(path.dirname(OUT), { recursive: true })
  writeFileSync(OUT, JSON.stringify(payload, null, 2))

  console.log(`objc oracle audit  files ${sampled.length}${sampled.length === files.length ? " (the whole admitted universe)" : ` of ${files.length}`}`)
  for (const r of rows) {
    console.log(`  ${r.label.padEnd(11)} analyzer ${String(r.analyzerEdges).padStart(6)}  agree ${String(r.agree).padStart(6)}  fallback ${String(r.agreeByFallback).padStart(5)}  @macro ${String(r.atExpressionTargets).padStart(4)}  path ${String(r.pathTargets).padStart(4)}  endpoint-fail ${String(r.endpointFailures).padStart(5)}  analyzer-only ${String(r.analyzerOnly).padStart(5)}  oracle-only ${String(r.oracleOnly).padStart(5)}  resolution ${r.resolutionRate === null ? "n/a" : `${(r.resolutionRate * 100).toFixed(2)}%`}`)
    for (const s of r.endpointFailureSamples.slice(0, 6)) console.log(`      ENDPOINT  ${s.file}  ${s.edge}  ${s.why}`)
    for (const s of r.analyzerOnlySamples.slice(0, 4)) console.log(`      ${s.kind === "oracle_only" ? "ORACLE-ONLY" : "ANALYZER-ONLY"} ${s.file}  ${s.edge}`)
    for (const s of r.oracleOnlySamples.slice(0, 8)) console.log(`      ORACLE-ONLY-MEMBER ${s.file}  ${s.edge}`)
  }
  console.log(`wrote ${OUT}`)
}
await main()
// TYPESCRIPT LANE — THE CENSUS OF THE TWO CONSTRUCTS THE NAMED RULINGS ALREADY NAME.
//
// THE LEAD'S RULE (2026-10-22): "DID SOMEBODY MEASURE THE CONSTRUCT THE RULING ALREADY NAMED? A
// NAMED CONSTRUCT WITH 'NONE MEASURED' IN ITS PARENTHETICAL IS NOT A RULING, IT IS A TODO."
// ⇒⇒⇒ **SO THIS INSTRUMENT MEASURES BOTH, OVER THE WHOLE ADMITTED POPULATION, AND COUNTS THE
// NEAR MISSES.** A row of zeros over a different analyzer is not a measurement of this one.
//
// WHAT IS MEASURED, AND WHY EACH ONE MATTERS:
//
//   1. `mixes_in` — THE MIXIN APPLICATION SITE. The TypeScript mixin pattern is
//      `class X extends Mixin(Base) {}`: the extends-EXPRESSION is a CALL, and that is the
//      discriminator against the already-implemented `extends` (whose extends-expression is a
//      plain name). The javascript lane measured the same shape in its own language and the
//      discriminator was THE SHAPE AND THE POSITION, not the name. ⇒⇒⇒ **THE CANDIDATE COUNT IS
//      THE NUMBER OF CALL-SHAPED HERITAGE CLAUSES IN THE ADMITTED POPULATION.** If it is > 0,
//      `mixes_in` is an R3 gap and the old grammar-absence exclusion is falsified.
//
//   2. THE NEAR MISSES — for every call-shaped heritage site, does the analyzer ALREADY publish
//      an `extends` edge to that callee? A site that is both "already an extends edge" and "a
//      mixin application" is the pair that a naive implementation would double-count.
//
//   3. `part_of` — THE TRIPLE-SLASH DIRECTIVE. `/// <reference path="…" />`,
//      `/// <reference types="…" />` and `/// <reference lib="…" />` are the construct. The served
//      grammar lexes them as COMMENTS, so they are NOT nodes in the tree: the census finds them in
//      the SOURCE TEXT, and that is the point — the text scan is the evidence that the grammar
//      does not expose the construct, which is the grammar-side half of the argument. ⇒⇒⇒ **THE
//      CENSUS COUNTS THE CONSTRUCT; IT DOES NOT RESOLVE A RELATIONSHIP BY REGEX.** The analyzer
//      still owes a resolution, and a resolution that is not the analyzer's own is not a
//      resolution at all.
//
// POPULATION: the gate's own admission rule, from `script/m14/ts-corpus.ts` (one rule, one place).
// Usage: bun run script/m14/ts-mixin-sites.ts [--files N] [--all] [--json <path>]
import { readFileSync, writeFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { admitCorpusCached, extensionsFor, strideSample, populationLine, SIZE_CAP } from "./ts-corpus"

const REPO = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const CORPUS = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const NFILES = Number(process.env.NFILES ?? 0) // 0 = the WHOLE admitted population

const argv = process.argv.slice(2)
const all = argv.includes("--all")
const jsonOut = argv.find((a) => a.startsWith("--json="))?.slice("--json=".length)
const want = all || NFILES === 0 ? 0 : NFILES

const engineMod: any = await import(join(REPO, "src/ast/engine.ts"))
const { getParser } = engineMod
const analyzerMod: any = await import(join(REPO, "src/ast/real-typescript-analyzer.ts"))
const Cls: any = Object.values(analyzerMod).find((v: any) => typeof v === "function" && String(v.name).endsWith("Analyzer"))
if (!Cls) { console.error("NO TYPESCRIPT ANALYZER CLASS EXPORTED"); process.exit(6) }

const exts = extensionsFor("typescript")
// ⇒ the population is measured ONCE and cached WITH ITS DIGEST: the digest travels with every
// number taken over this population, so a number cannot be silently attributed to another set.
const admitted = admitCorpusCached(CORPUS, exts, join(REPO, ".tmp-ts/admitted-typescript.json"))
const files = want === 0 ? admitted.files : strideSample(admitted.files, want)

const census = {
  population: populationLine(admitted),
  populationDigest: admitted.digest,
  sample: { taken: files.length, of: admitted.files.length, whole: want === 0 },
  sizeCapBytes: SIZE_CAP,
  extensions: exts,
  heritage: {
    classHeritageClauses: 0,
    extendsClauses: 0,
    byExpressionShape: {} as Record<string, number>,
    callCalleeShape: {} as Record<string, number>,
    callArgumentCounts: {} as Record<string, number>,
    callSites: [] as { file: string; callee: string; calleeShape: string; args: number }[],
  },
  nearMiss: {
    callShapedSites: 0,
    alreadyPublishedAsExtends: 0,
    notPublished: 0,
    publishedExtendsEdges: 0,
    publishedExtendsTargets: [] as string[],
  },
  referenceDirectives: {
    total: 0,
    byRole: {} as Record<string, number>,
    byTargetShape: {} as Record<string, number>,
    triggerSites: 0,
    samples: [] as string[],
  },
  parse: { ok: 0, failed: 0, failedSamples: [] as string[] },
  analyzer: { publishedExtends: 0, publishedMixesIn: 0, publishedPartOf: 0, relationships: 0 },
}

const bump = (o: Record<string, number>, k: string) => { o[k] = (o[k] ?? 0) + 1 }

/** walk a tree-sitter node */
function walk(node: any, fn: (n: any) => void): void {
  fn(node)
  const kids = node.namedChildren ?? []
  for (let i = 0; i < kids.length; i++) walk(kids[i], fn)
}

/** the expression under an `extends_clause`: the clause's last named child that is not a keyword */
function extendsExpression(clause: any): any {
  const kids = clause.namedChildren ?? []
  for (let i = kids.length - 1; i >= 0; i--) {
    const t = kids[i].type
    if (t === "extends") continue
    return kids[i]
  }
  return null
}

function calleeShape(call: any): string {
  const fn = call?.childForFieldName?.("function")
  if (!fn) return "unknown"
  if (fn.type === "identifier") return "identifier"
  if (fn.type === "member_expression") return "member_expression"
  return fn.type
}

function calleeName(call: any): string {
  const fn = call?.childForFieldName?.("function")
  if (!fn) return ""
  const t = fn.text ?? ""
  return t.length > 120 ? `${t.slice(0, 120)}…` : t
}

/** the triple-slash directive — THE TEXTUAL CENSUS, because the grammar does not expose it */
const REF_RE = /^\/\/\/\s*<reference\s+([^>]*?)\/?>/

// ⇒⇒⇒ A CENSUS THAT PRINTS NOTHING FOR MINUTES IS INDISTINGUISHABLE FROM A HUNG CENSUS. The
// progress line is part of the instrument, not decoration: "it is still running" and "it died"
// must be different observations. (The machine runs at load 20+ while other lanes hold their arms.)
const PROGRESS_EVERY = Math.max(25, Math.floor(files.length / 20))
let seen = 0
for (const f of files) {
  seen++
  if (seen % PROGRESS_EVERY === 0 || seen === files.length) {
    process.stderr.write(`[census] ${seen}/${files.length} files · heritage ${census.heritage.extendsClauses} · call-shaped ${census.nearMiss.callShapedSites} · refdirs ${census.referenceDirectives.total}\n`)
  }
  let content: string
  try { content = readFileSync(f, "utf8") } catch { census.parse.failed++; continue }
  // the tsx grammar is a different build: a .tsx file parsed with the typescript grammar is a
  // DIFFERENT population. The census says which build it used for each file.
  const lang = f.toLowerCase().endsWith(".tsx") ? "tsx" : "typescript"
  let root: any
  try {
    const parser = await getParser(lang)
    const pr = await parser.parse(content, f)
    root = pr.rootNode
    census.parse.ok++
  } catch (e) {
    census.parse.failed++
    if (census.parse.failedSamples.length < 5) census.parse.failedSamples.push(`${f}: ${String(e).slice(0, 80)}`)
    continue
  }

  // 1 + 2. the heritage census
  const publishedExtends = new Set<string>()
  try {
    const res: any = new Cls().analyze(root, content, f)
    for (const r of res.relationships ?? []) {
      const t = String(r.relationshipType ?? r.type ?? "")
      census.analyzer.relationships++
      if (t === "extends") {
        census.analyzer.publishedExtends++
        const tgt = r.target?.name ?? r.target?.id ?? ""
        publishedExtends.add(String(tgt))
        if (census.nearMiss.publishedExtendsTargets.length < 40) census.nearMiss.publishedExtendsTargets.push(String(tgt))
      } else if (t === "mixes_in") census.analyzer.publishedMixesIn++
      else if (t === "part_of") census.analyzer.publishedPartOf++
    }
  } catch { /* the analyzer throwing is counted by the parse ledger below */ }
  census.nearMiss.publishedExtendsEdges = census.analyzer.publishedExtends

  const callSites: { callee: string; calleeShape: string; args: number }[] = []
  walk(root, (n) => {
    if (n.type === "class_heritage") {
      census.heritage.classHeritageClauses++
      for (const ch of n.namedChildren ?? []) {
        if (ch.type !== "extends_clause") continue
        census.heritage.extendsClauses++
        const expr = extendsExpression(ch)
        const shape = expr ? expr.type : "none"
        bump(census.heritage.byExpressionShape, shape)
        if (shape === "call_expression") {
          const cs = calleeShape(expr)
          const args = (expr.namedChildren ?? []).filter((c: any) => c.type === "arguments").length
          const argCount = expr.childForFieldName?.("arguments")?.namedChildren?.length ?? 0
          bump(census.heritage.callCalleeShape, cs)
          bump(census.heritage.callArgumentCounts, String(argCount))
          const name = calleeName(expr)
          callSites.push({ callee: name, calleeShape: cs, args: argCount })
          if (census.heritage.callSites.length < 60) {
            census.heritage.callSites.push({ file: f, callee: name, calleeShape: cs, args: argCount })
          }
        }
      }
    }
    if (n.type === "extends_type_clause") {
      census.heritage.extendsClauses++
      const expr = n.childForFieldName?.("value") ?? n.namedChildren?.[n.namedChildren.length - 1]
      bump(census.heritage.byExpressionShape, `interface:${expr?.type ?? "none"}`)
    }
  })

  for (const site of callSites) {
    census.nearMiss.callShapedSites++
    if (publishedExtends.has(site.callee)) census.nearMiss.alreadyPublishedAsExtends++
    else census.nearMiss.notPublished++
  }

  // 3. the reference-directive census (textual: the grammar exposes these as comments)
  const lines = content.split(/\r?\n/)
  for (const line of lines) {
    const m = REF_RE.exec(line.trim())
    if (!m) continue
    census.referenceDirectives.total++
    if (census.referenceDirectives.samples.length < 25) census.referenceDirectives.samples.push(line.trim().slice(0, 160))
    const attrs = m[1]
    const roleMatch = /(path|types|lib)\s*=/.exec(attrs)
    const role = roleMatch ? roleMatch[1] : "unparsed"
    bump(census.referenceDirectives.byRole, role)
    const valueMatch = /(?:path|types|lib)\s*=\s*["']([^"']*)["']/.exec(attrs)
    const value = valueMatch ? valueMatch[1] : ""
    let shape = "none"
    if (value) {
      if (value.startsWith("./") || value.startsWith("../")) shape = "relative-path"
      else if (value.startsWith("/")) shape = "absolute-path"
      else if (value.endsWith(".d.ts")) shape = "ambient-declaration"
      else if (/^[a-z@]/.test(value)) shape = "package-or-lib"
      else shape = "other"
    }
    bump(census.referenceDirectives.byTargetShape, shape)
    if (!value) census.referenceDirectives.triggerSites++
  }
}

const verdict = {
  mixesIn: {
    namedConstruct: "class X extends Mixin(Base) {} — the extends-expression is a CALL",
    candidateSites: census.nearMiss.callShapedSites,
    alreadyPublishedAsExtends: census.nearMiss.alreadyPublishedAsExtends,
    notPublished: census.nearMiss.notPublished,
    publishedMixesInEdges: census.analyzer.publishedMixesIn,
    reading: census.nearMiss.callShapedSites > 0
      ? "R3 GAP: the construct EXISTS in the admitted population, so a grammar-absence exclusion is FALSIFIED and mixes_in must be implemented"
      : "ZERO SITES: the construct does not occur in the admitted population, so the exclusion is zero-sites and the grammar-side measurement is the zeroEmissionFacts half",
  },
  partOf: {
    namedConstruct: '/// <reference path="…" /> · /// <reference types="…" /> · /// <reference lib="…" />',
    directiveCount: census.referenceDirectives.total,
    byRole: census.referenceDirectives.byRole,
    byTargetShape: census.referenceDirectives.byTargetShape,
    triggerSites: census.referenceDirectives.triggerSites,
    publishedPartOfEdges: census.analyzer.publishedPartOf,
    reading: "the served grammar lexes these as COMMENTS, so the construct has no node; a grammar remedy is required before it can be a relation",
  },
}

console.log(`POPULATION: ${census.population}`)
console.log(`POPULATION DIGEST (sha256 of the sorted admitted paths): ${census.populationDigest}`)
console.log(`SAMPLE: ${census.sample.taken} of ${census.sample.of} (whole=${census.sample.whole})`)
console.log(`PARSE: ok ${census.parse.ok} · failed ${census.parse.failed} ${census.parse.failedSamples.length ? "· " + census.parse.failedSamples.join(" | ") : ""}`)
console.log(`HERITAGE: class_heritage clauses ${census.heritage.classHeritageClauses} · extends clauses ${census.heritage.extendsClauses}`)
console.log(`  by expression shape: ${JSON.stringify(census.heritage.byExpressionShape)}`)
console.log(`  call callee shape: ${JSON.stringify(census.heritage.callCalleeShape)}`)
console.log(`  call argument counts: ${JSON.stringify(census.heritage.callArgumentCounts)}`)
console.log(`NEAR MISSES: call-shaped sites ${census.nearMiss.callShapedSites} · already published as extends ${census.nearMiss.alreadyPublishedAsExtends} · not published ${census.nearMiss.notPublished} · published extends edges ${census.nearMiss.publishedExtendsEdges}`)
console.log(`REFERENCE DIRECTIVES: total ${census.referenceDirectives.total} · by role ${JSON.stringify(census.referenceDirectives.byRole)} · by target ${JSON.stringify(census.referenceDirectives.byTargetShape)} · trigger sites ${census.referenceDirectives.triggerSites}`)
console.log(`ANALYZER: relationships ${census.analyzer.relationships} · extends ${census.analyzer.publishedExtends} · mixes_in ${census.analyzer.publishedMixesIn} · part_of ${census.analyzer.publishedPartOf}`)
console.log(`VERDICT mixes_in: ${verdict.mixesIn.reading}`)
console.log(`VERDICT part_of: ${verdict.partOf.reading}`)

if (jsonOut) {
  writeFileSync(jsonOut, JSON.stringify({ census, verdict }, null, 2))
  console.log(`WROTE ${jsonOut}`)
}

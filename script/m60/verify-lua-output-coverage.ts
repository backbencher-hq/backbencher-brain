/**
 * M60: OUTPUT COVERAGE — does everything the Lua analyzer produces actually
 * reach the product?
 *
 * The lane had three separate claims and this is the fourth, the one that none of
 * them covered. `lua-truth-oracle` compares the ANALYZER against a tree-derived
 * truth: it proves the analyzer does not miss anything. It says nothing about
 * what happens after the analyzer returns, because it reads the analyzer's result
 * directly and never goes near `parseFile`.
 *
 * So the entire production seam was unmeasured. `pool-worker` is where an
 * analyzer's output is turned into what the indexer stores, and it is a lossy
 * function that nobody had read against an analyzer's intent:
 *
 *   - it RETURNS an object with no `exports` key at all, so every export the
 *     analyzer found is invisible to the index (LUA-14);
 *   - it runs `filterNoiseRelationships`, whose `NOISE_TARGETS` denylist holds
 *     32 names of which 16 are tree-sitter API identifiers — `type`, `parent`,
 *     `text`, `namedChild`, `startPosition`. Those are ordinary names in
 *     ordinary Lua, so the filter drops real edges (LUA-16);
 *   - it filters SYMBOLS by a second denylist before returning them.
 *
 * The measurement is direct-path vs pipeline-path over a pinned corpus:
 *
 *   EMITTED       the direct path produced it AND `parseFile` returned it
 *   LOST          the direct path produced it and `parseFile` did not
 *   SPURIOUS      `parseFile` returned it and the direct path did not
 *
 * and every LOST edge must be attributed. Here is the part that matters: the
 * attribution is made by CALLING `filterNoiseRelationships` — the production
 * function, imported from `pool-worker`, not a re-implementation. An audit that
 * re-implements the filter agrees with it only while the copy stays in step, and
 * a copy that has drifted invents confident wrong reasons for missing edges. This
 * repo has already shipped that bug once: a classifier that excused edges by
 * inferring, under which a collapsed analyzer passed clean.
 *
 * So the rule is: if the production filter says KEEP, and the edge is still
 * missing, the edge is UNEXPLAINED and the audit fails. No label can talk its way
 * out of that. The human-readable rule NAMES attached to a loss are only labels
 * for a decision the production code already made; they never decide anything.
 *
 * Usage:
 *   bun script/m60/verify-lua-output-coverage.ts --repo kong
 *   bun script/m60/verify-lua-output-coverage.ts --repo luvit
 *   bun script/m60/verify-lua-output-coverage.ts --repo kong --files <list>
 *   bun script/m60/verify-lua-output-coverage.ts --repo kong --mutate
 */
import { readFileSync, writeFileSync } from "node:fs"
import { parseWithAnalyzer } from "./lua-analyzer-direct"
import { parseFile, filterNoiseRelationships, keepSymbol, nameTheSymbolRule } from "../../src/ast/pool-worker"

const argv = process.argv.slice(2)
const arg = (n: string) => {
  const i = argv.indexOf(n)
  return i >= 0 ? argv[i + 1] : undefined
}
const REPO = arg("--repo") ?? "kong"
const CORPUS: Record<string, { root: string; project: string }> = {
  kong: { root: "$HOME/fixtures/repositories/kong", project: "$HOME/fixtures/repositories/kong" },
  luvit: { root: "$HOME/fixtures/repositories/luvit", project: "$HOME/fixtures" },
}
const cfg = CORPUS[REPO]
if (!cfg) {
  console.error(`unknown --repo ${REPO}; known: ${Object.keys(CORPUS).join(", ")}`)
  process.exit(2)
}
const MUTATE = argv.includes("--mutate")

/** 1-based line of the name-bearing node, per the M59/M60 line rule. */
const relKey = (r: any) => `${r.type}|${r.source}|${r.target}`

/**
 * A symbol's identity, normalized across the two shapes.
 *
 * This audit's first version keyed on `s.range.startLine` and reported 0.0000%
 * symbol coverage with 1,798 "spurious" symbols on twelve files — which looked
 * exactly like catastrophic loss, and was not. `pool-worker` flattens the
 * analyzer's `range` object into `startLine`/`endLine`/`startIndex`/`endIndex` in
 * a `.map()` before returning, so on the pipeline side `s.range` is `undefined`
 * and the key was never equal to anything.
 *
 * Worth recording as a caution rather than a detail: an audit that mis-keys two
 * representations does not report zero, it reports a catastrophe with a confident
 * number attached. The reason it was caught is that the numbers were mutually
 * inconsistent (1,804 lost against 1,798 spurious from a 12-file slice), not
 * because anything complained.
 *
 * `startIndex` is in the key because name+kind+line is not unique: a file can
 * declare `local function f()` twice on one line, and a byte offset settles it.
 */
const symKey = (s: any) => {
  const startLine = s.range?.startLine ?? s.startLine ?? -1
  const startIndex = s.range?.startIndex ?? s.startIndex ?? -1
  const kind = s.kind ?? s.type ?? ""
  return `${kind}|${s.name}|${startLine}|${startIndex}`
}

/**
 * Label a loss with the rule that fired, for the report only.
 *
 * These conditions are transcribed from `filterNoiseRelationships` purely to put a
 * name on a decision that function has ALREADY made. Nothing here can change a
 * verdict: the caller has already asked the production filter whether the edge
 * survives, and only reaches this function for edges it dropped. If this
 * transcription were wrong the result would be a wrong LABEL, never a wrong
 * EXONERATION.
 */
function nameTheRule(r: any, language: string, declaredNames: Set<string>): string {
  const target = r.target || r.targetId || r.to || r.toSymbol || ""
  if (!target) return "no-target (kept by the filter)"
  if (["json", "yaml", "hcl", "terraform", "graphql"].includes(language)) return "language-exempt (filter returns early)"
  if (language === "bash" && ["imports", "references"].includes(r.type)) {
    if (target.length > 200 || target.includes("\n")) return "oversize-or-newline target"
    return "bash import/reference (kept)"
  }
  if (target.length > 200 || target.includes("\n")) return "target over 200 chars or containing a newline"
  const noLine = String(target).replace(/:\d+$/, "")
  const segments = noLine.split(":").filter((s) => s.length > 0)
  const last = segments[segments.length - 1] ?? ""
  const leaf = last.split(".").slice(-1)[0]
  if (leaf.length > 80 || leaf.length < 1) return "leaf name longer than 80 or empty"
  if (/[{}`<>\n\r\t]/.test(leaf)) return "leaf contains a brace, backtick, angle bracket or whitespace class"
  if (leaf.startsWith(" ") || leaf.includes("  ")) return "leaf padded with spaces"
  // The denylist, and the one with teeth: these are tree-sitter API names.
  if (declaredNames.has(String(r.target))) return "denylisted but the file declares the name (kept)"
  return "NOISE_TARGETS denylist (a tree-sitter API name the file does not declare)"
}

interface Bucket {
  emitted: number
  lost: number
  spurious: number
}

const results: {
  files: number
  skipped: string[]
  parseError: string[]
  symbols: Bucket
  relationships: Bucket
  exports: Bucket
  imports: Bucket
  lossByRule: Record<string, number>
  lossByRuleRelType: Record<string, number>
  lossByTargetName: Record<string, number>
  unexplained: { file: string; rel: string; why: string }[]
  spurious: { file: string; what: string }[]
  droppedSymbolNames: Record<string, number>
  importSample: string[]
  totals: {
    directRels: number
    pipelineRels: number
    directSymbols: number
    pipelineSymbols: number
    directExports: number
  }
} = {
  files: 0,
  skipped: [],
  parseError: [],
  symbols: { emitted: 0, lost: 0, spurious: 0 },
  relationships: { emitted: 0, lost: 0, spurious: 0 },
  exports: { emitted: 0, lost: 0, spurious: 0 },
  imports: { emitted: 0, lost: 0, spurious: 0 },
  lossByRule: {},
  lossByRuleRelType: {},
  lossByTargetName: {},
  unexplained: [],
  spurious: [],
  droppedSymbolNames: {},
  importSample: [],
  totals: { directRels: 0, pipelineRels: 0, directSymbols: 0, pipelineSymbols: 0, directExports: 0 },
}

const filesArg = arg("--files")
let files: string[]
if (filesArg) {
  const want = new Set(readFileSync(filesArg, "utf8").split("\n").map((x) => x.trim()).filter(Boolean))
  files = (await collectLua(cfg.root)).filter((f) => want.has(f.slice(cfg.root.length + 1)))
} else {
  files = await collectLua(cfg.root)
}
files.sort()

async function collectLua(root: string): Promise<string[]> {
  const out: string[] = []
  const walk = async (dir: string): Promise<void> => {
    const { readdir } = await import("node:fs/promises")
    for (const e of await readdir(dir, { withFileTypes: true })) {
      if (e.name === ".git" || e.name === "node_modules") continue
      const p = `${dir}/${e.name}`
      if (e.isDirectory()) await walk(p)
      else if (e.name.endsWith(".lua")) out.push(p)
    }
  }
  await walk(root)
  return out
}

const log = (s: string) => process.stdout.write(s + "\n")

for (const file of files) {
  const rel = file.slice(cfg.root.length + 1)
  let direct: any
  let pipeline: any
  try {
    direct = await parseWithAnalyzer(file)
  } catch (e: any) {
    results.parseError.push(`${rel}: direct: ${e?.message ?? e}`)
    continue
  }
  try {
    pipeline = await parseFile(file, cfg.project)
  } catch (e: any) {
    results.skipped.push(`${rel}: pipeline: ${e?.message ?? e}`)
    continue
  }
  results.files++

  // ── RELATIONSHIPS ────────────────────────────────────────────────────────
  const dRels: any[] = direct.relationships ?? []
  const pRels: any[] = pipeline.relationships ?? []
  results.totals.directRels += dRels.length
  results.totals.pipelineRels += pRels.length
  const pRelKeys = new Set(pRels.map(relKey))
  const declaredNames = new Set((direct.symbols ?? []).map((s: any) => String(s?.name ?? "")).filter(Boolean))

  for (const r of dRels) {
    const k = relKey(r)
    if (pRelKeys.has(k)) {
      results.relationships.emitted++
      continue
    }
    // Ask the PRODUCTION filter. If it says keep, the edge vanished anyway and
    // that is unexplained — no label, no excuse.
    const survives = filterNoiseRelationships([r], direct.language ?? "lua", declaredNames)
    if (survives.length > 0) {
      results.unexplained.push({
        file: rel,
        rel: k,
        why: "filterNoiseRelationships KEEPS this edge, yet parseFile did not return it",
      })
      results.relationships.lost++
      continue
    }
    const rule = nameTheRule(r, direct.language ?? "lua", declaredNames)
    results.lossByRule[rule] = (results.lossByRule[rule] ?? 0) + 1
    if (rule.startsWith("NOISE_TARGETS")) {
      const leaf = String(r.target ?? "").split(":").filter(Boolean).pop()?.split(".").pop() ?? "?"
      results.lossByTargetName[leaf] = (results.lossByTargetName[leaf] ?? 0) + 1
    }
    const rt = `${rule} :: ${r.type}`
    results.lossByRuleRelType[rt] = (results.lossByRuleRelType[rt] ?? 0) + 1
    results.relationships.lost++
  }
  for (const r of pRels) {
    if (!dRels.some((d) => relKey(d) === relKey(r))) {
      results.relationships.spurious++
      if (results.spurious.length < 40) results.spurious.push({ file: rel, what: `relationship ${relKey(r)}` })
    }
  }

  // ── EXPORTS ─────────────────────────────────────────────────────────────
  const dExports: any[] = direct.exports ?? []
  const pExports: any[] = pipeline.exports ?? []
  results.totals.directExports += dExports.length
  const pExportNames = new Set(pExports.map((e: any) => e.name))
  for (const e of dExports) {
    if (pExportNames.has(e.name)) results.exports.emitted++
    else {
      results.exports.lost++
      results.lossByRule["exports: pool-worker's returned object has no `exports` key (LUA-14)"] =
        (results.lossByRule["exports: pool-worker's returned object has no `exports` key (LUA-14)"] ?? 0) + 1
    }
  }
  for (const e of pExports) {
    if (!dExports.some((d) => d.name === e.name)) {
      results.exports.spurious++
      if (results.spurious.length < 40) results.spurious.push({ file: rel, what: `export ${e.name}` })
    }
  }

  // ── IMPORTS ─────────────────────────────────────────────────────────────
  // The two sides do not agree on what an import row IS, and the first version of
  // this dimension compared them field-for-field and reported 0% coverage with 162
  // lost and 162 spurious on twelve files — the same mis-key as the symbol
  // dimension, caught the same way, by the counts being mirror images.
  //
  //   direct   { module: "kong.tools.table", items: [...], ... }
  //   pipeline { name: "kong.tools.table", path: "...", type: "default", ... }
  //
  // and the pipeline's `flatMap` emits ONE ROW PER ITEM, so a single analyzer row
  // can become several. The comparable identity is therefore the set of NAMES each
  // side mentions: the module path, plus every item the module binds.
  const dImports: any[] = direct.imports ?? []
  const pImports: any[] = pipeline.imports ?? []
  const directImportNames = new Set<string>()
  for (const i of dImports) {
    if (i?.module) directImportNames.add(String(i.module))
    for (const it of i?.items ?? []) {
      if (typeof it === "string") directImportNames.add(it)
      else if (it?.name) directImportNames.add(String(it.name))
    }
  }
  const pipelineImportNames = new Set(pImports.map((i: any) => String(i?.name ?? i?.module ?? i?.path ?? "")))
  for (const n of directImportNames) {
    if (pipelineImportNames.has(n)) results.imports.emitted++
    else {
      results.imports.lost++
      results.lossByRule["imports: name absent from parseFile's import rows"] =
        (results.lossByRule["imports: name absent from parseFile's import rows"] ?? 0) + 1
      if (results.unexplained.length < 4000 && !results.importSample.includes(n)) results.importSample.push(n)
    }
  }
  for (const n of pipelineImportNames) {
    if (!directImportNames.has(n)) {
      results.imports.spurious++
      if (results.spurious.length < 40) results.spurious.push({ file: rel, what: `import ${n}` })
    }
  }

  // ── SYMBOLS ─────────────────────────────────────────────────────────────
  const dSyms: any[] = direct.symbols ?? []
  const pSyms: any[] = pipeline.symbols ?? []
  results.totals.directSymbols += dSyms.length
  results.totals.pipelineSymbols += pSyms.length
  const pSymKeys = new Set(pSyms.map(symKey))
  for (const s of dSyms) {
    if (pSymKeys.has(symKey(s))) {
      results.symbols.emitted++
      continue
    }
    // Same rule as relationships: ask the PRODUCTION predicate. `keepSymbol` used
    // to be an inline `.filter()` callback, so this dimension could only report
    // dropped names and guess a reason; the 68 Lua drops were unclassifiable by
    // construction. The callback is now an exported function, so a drop the
    // production predicate would KEEP is unexplained and fails the audit.
    const lang = direct.language ?? "lua"
    if (keepSymbol(s, lang)) {
      results.unexplained.push({
        file: rel,
        rel: `symbol ${symKey(s)}`,
        why: "keepSymbol KEEPS this symbol, yet parseFile did not return it",
      })
      results.symbols.lost++
      continue
    }
    const srule = nameTheSymbolRule(s, lang)
    results.lossByRule[`symbols: ${srule}`] = (results.lossByRule[`symbols: ${srule}`] ?? 0) + 1
    results.symbols.lost++
    const n = String(s?.name ?? "")
    results.droppedSymbolNames[n] = (results.droppedSymbolNames[n] ?? 0) + 1
  }
  for (const s of pSyms) {
    if (!dSyms.some((d) => symKey(d) === symKey(s))) results.symbols.spurious++
  }
}

// ── REPORT ────────────────────────────────────────────────────────────────
const pct = (e: number, l: number) => (e + l === 0 ? 1 : e / (e + l))
log("")
log(`M60 lua OUTPUT COVERAGE — ${REPO}`)
log(`  files measured            ${results.files}   (direct errors ${results.parseError.length}, pipeline skips ${results.skipped.length})`)
log("")
log("  RELATIONSHIPS  analyzer -> parseFile")
log(`    emitted ${results.relationships.emitted}   lost ${results.relationships.lost}   spurious ${results.relationships.spurious}   coverage ${(pct(results.relationships.emitted, results.relationships.lost) * 100).toFixed(4)}%`)
log(`    direct ${results.totals.directRels} rels -> pipeline ${results.totals.pipelineRels} rels`)
log("")
log("  EXPORTS  analyzer -> parseFile")
log(`    emitted ${results.exports.emitted}   lost ${results.exports.lost}   spurious ${results.exports.spurious}`)
log("")
log("  IMPORTS  analyzer -> parseFile  (by name; the pipeline rewrites the row)")
log(`    emitted ${results.imports.emitted}   lost ${results.imports.lost}   spurious ${results.imports.spurious}   coverage ${(pct(results.imports.emitted, results.imports.lost) * 100).toFixed(4)}%`)
log("")
log("  SYMBOLS  analyzer -> parseFile")
log(`    emitted ${results.symbols.emitted}   lost ${results.symbols.lost}   spurious ${results.symbols.spurious}   coverage ${(pct(results.symbols.emitted, results.symbols.lost) * 100).toFixed(4)}%`)
log("")
log("  WHERE THE LOSS IS, by the rule the PRODUCTION filter applied:")
const rules = Object.entries(results.lossByRule).sort((a, b) => b[1] - a[1])
if (!rules.length) log("    (none)")
for (const [rule, n] of rules) log(`    ${String(n).padStart(6)}  ${rule}`)
log("")
const byTarget = Object.entries(results.lossByTargetName).sort((a, b) => b[1] - a[1])
if (byTarget.length) {
  log(`  THE DENYLIST'S ACTUAL VICTIMS (relationship type per name — this is the actionable list):`)
  const relTypes: Record<string, Record<string, number>> = {}
  for (const [k, v] of Object.entries(results.lossByRuleRelType)) {
    const name = k.slice(k.indexOf("::") + 3).trim()
    if (byTarget.some(([n]) => n === name)) relTypes[name] = relTypes[name] ?? {}
  }
  for (const [n, c] of byTarget) log(`    ${String(c).padStart(6)}  ${n}`)
  log("")
}
const top = Object.entries(results.droppedSymbolNames).sort((a, b) => b[1] - a[1])
if (top.length) {
  log(`  DROPPED SYMBOL NAMES (each attributed above by keepSymbol(), listed here for eyeballing):`)
  log(`    ${top.length} distinct names, top 20: ${top.slice(0, 20).map(([n, c]) => `${n}(${c})`).join("  ")}`)
  log("")
}
log(`  UNEXPLAINED (the filter keeps them and parseFile dropped them anyway): ${results.unexplained.length}`)
for (const u of results.unexplained.slice(0, 25)) log(`    ${u.file}  ${u.rel}\n        ${u.why}`)
log("")
log(`  SPURIOUS (parseFile returned something the analyzer did not): ${results.relationships.spurious + results.exports.spurious + results.symbols.spurious}`)
for (const s of results.spurious.slice(0, 15)) log(`    ${s.file}  ${s.what}`)

const out = `$HOME/backbencher-brain/validation/m60/results/lua-output-coverage-${REPO}.json`
writeFileSync(out, JSON.stringify({ schemaVersion: 1, gate: "verify-lua-output-coverage", repo: REPO, ...results, mutation: MUTATE ? "mutant" : "none" }, null, 2))
log("")
log(`  wrote ${out}`)

/**
 * What makes this gate FAIL.
 *
 * The first version failed on `unexplained.length > 0` alone, and mutation
 * testing immediately showed that was not enough: setting the worker's
 * `exports: []` — the exact LUA-14 regression, a TOTAL loss of the entire export
 * surface — left `unexplained` at 0 and the gate printed OK. An exports field that
 * is never read is indistinguishable from an exports field that is never lost, so
 * the dimension the gate did not check was the one the product was missing.
 *
 * So the requirements are stated per dimension, and relationships, exports and
 * imports are held to 100% rather than to a baseline. That is strict on purpose:
 * every remaining loss is now attributed to production code, so a NEW loss means
 * something changed in `pool-worker` and deserves a human, not a threshold bump.
 * Symbols are the one dimension allowed to be below 100%, because a small number
 * of names are legitimately not declarations — but every symbol loss must still
 * be one the production `keepSymbol` rejected, which is checked above.
 */
const strictDimensions: [string, number][] = [
  ["relationships", results.relationships.lost],
  ["exports", results.exports.lost],
  ["imports", results.imports.lost],
]
const reasons: string[] = []
for (const [name, lost] of strictDimensions) if (lost > 0) reasons.push(`${lost} ${name} lost`)
if (results.symbols.lost > 0 && Object.keys(results.lossByRule).some((k) => !k.startsWith("symbols:"))) {
  reasons.push(`${results.symbols.lost} symbol losses not attributed to keepSymbol`)
}
// A catastrophe guard, and deliberately the only numeric floor in the gate.
//
// Mutation testing found the hole: making `keepSymbol` reject EVERY symbol — the
// worker returning no symbols at all, the most total regression the seam admits —
// left relationships, exports and imports at 100% and the gate printed OK, because
// symbols were not a strict dimension. Relationships are not a proxy for symbols;
// a file can have a perfect relationship graph and no symbols in it.
//
// The floor is 99% and the measured values are 99.76% (luvit, 9 losses) and
// 99.8864% (kong, 59), every one of them a name `keepSymbol` rejects. It is a guard
// against wholesale loss, not a quality target: lowering it needs a recorded
// reason, in this file, the same as everything else here.
//
// WHAT THIS GATE DOES NOT COVER, stated so nobody assumes otherwise: the opposite
// mutation — `keepSymbol` accepting everything — also passes, and correctly. That
// makes the denylist toothless, so noise reaches the graph, but it loses no
// coverage, and "is this name noise" is a different question with a different
// owner. This gate measures whether output is COMPLETE. Whether the filter is
// RIGHT is not its claim.
if (results.unexplained.length > 0) reasons.push(`${results.unexplained.length} losses the production filter would KEEP`)
const symTotal = results.symbols.emitted + results.symbols.lost
if (symTotal > 0 && results.symbols.emitted / symTotal < 0.99) {
  reasons.push(`symbol coverage ${(results.symbols.emitted / symTotal * 100).toFixed(4)}% is below the 99% catastrophe floor (${results.symbols.lost} of ${symTotal} lost)`)
}
const spuriousTotal = results.relationships.spurious + results.exports.spurious + results.imports.spurious + results.symbols.spurious
if (spuriousTotal > 0) reasons.push(`${spuriousTotal} spurious rows the analyzer never produced`)

log("")
if (reasons.length === 0) {
  log("OK — relationships, exports and imports are at 100% output coverage;")
  log("     every remaining symbol loss is a name the production keepSymbol() rejects;")
  log("     nothing is unexplained and nothing is spurious.")
  process.exit(0)
}
log(`FAIL — ${reasons.length} unmet requirement(s):`)
for (const r of reasons) log(`  - ${r}`)
process.exit(1)

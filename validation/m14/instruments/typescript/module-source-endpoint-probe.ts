/**
 * MODULE-SOURCE ENDPOINT PROBE — is a `path.basename` source endpoint real?
 *
 * ## The finding that produced this file
 *
 * `ts-r7-endpoint-probe.ts` over element-plus @3e07b0c677, 400 files, 22,631
 * edges, production `parseFile`, reports 400 NOT-AN-IDENTIFIER endpoints across
 * 89 distinct values in 69 files. 321 of the 400 are SOURCE endpoints and every
 * one of the 321 contains a `-`:
 *
 *     imports/source 210    exports/source  59    calls/source  52
 *
 * `imports`, `exports` and `calls` all fall back to `moduleLeafName()` when the
 * emission site has no enclosing declaration
 * (`real-typescript-analyzer.ts:5625,5654,5669,5706,5748`), and
 * `moduleLeafName()` is `path.basename(filePath, path.extname(filePath))`
 * (`:5764`). For `docs/.vitepress/build/crowdin-credentials.ts` that is the
 * string `crowdin-credentials`.
 *
 * A `-` cannot appear in a TypeScript identifier, so no declaration in any file
 * can ever carry that name. The edge asserts a caller that cannot exist. That is
 * the ambiguity this whole lane measures, in a form R7's literal `unknown` test
 * does not catch: the endpoint is neither empty nor `unknown` nor a symbol — it
 * is a FILE PATH FRAGMENT wearing an endpoint's clothes.
 *
 * ## What this probe decides, and why a percentage cannot
 *
 * Two readings are indistinguishable in the aggregate and opposite in repair:
 *
 *   A. The analyzer publishes a MODULE SYMBOL for the file, and it is the module
 *      symbol's own name — then `crowdin-credentials` IS resolvable and this is
 *      an instrument artefact (the probe's universe did not include module
 *      symbols). Nothing to fix.
 *   B. No symbol carries that name — then 321 edges on this corpus have an
 *      unresolvable source, and the repair is in the analyzer.
 *
 * So this probe dumps, for the named files: every symbol the analyzer publishes,
 * and every relationship whose endpoint is that kebab string, and asks whether
 * the string is in the published universe. Reading A and reading B produce
 * different answers on the same file, which is why the file is named rather
 * than sampled.
 *
 * ## No regex
 *
 * Membership is identity against the published symbol-name set, and the shape
 * test is a per-character code-point loop. No pattern matching over source text.
 * `script/m14/no-regex-gate.sh` is the check for that claim.
 *
 * ## Usage
 *
 *   bun validation/m14/fixtures/typescript/module-source-endpoint-probe.ts [file ...]
 *
 * With no arguments it probes the files the R7 probe measured, so the population
 * is written down here only as NAMES OF REAL FILES and every claim is about what
 * the analyzer publishes for them.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { getParser } from "../../../../src/ast/engine"
import { RealTypeScriptAnalyzer } from "../../../../src/ast/real-typescript-analyzer"

const CORPUS_ROOT = process.env.BB_TS_CORPUS ?? "/home/ishaq2321/bb_tests/repositories"
const REPO = process.env.BB_TS_REPO ?? "element-plus"

/** The real files the R7 probe measured. Named, not globbed, because each one is
 *  a named claim in the report. */
const DEFAULT_FILES = [
  "docs/.vitepress/build/crowdin-credentials.ts",
  "docs/.vitepress/build/crowdin-generate.ts",
  "docs/.vitepress/build/generate-llms.ts",
  "docs/.vitepress/plugins/api-table.ts",
  "docs/.vitepress/plugins/external-link-icon.ts",
  "docs/.vitepress/plugins/markdown-transform.ts",
  "packages/components/avatar/src/avatar-group.tsx",
  "packages/components/button/src/use-button.ts",
]

const files = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_FILES

/** A character loop, not a pattern: the question is "can any TypeScript
 *  identifier contain this character", and the answer is a property of the
 *  alphabet, so the alphabet is written out. */
const IDENT_EXTRA = new Set(["_", "$"])
function isIdentifierish(s: string): boolean {
  if (s.length === 0) return false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    const alnum =
      (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || (c >= "0" && c <= "9")
    if (!alnum && !IDENT_EXTRA.has(c)) return false
  }
  return true
}

function basenameNoExt(p: string): string {
  const slash = p.lastIndexOf("/")
  const name = slash >= 0 ? p.slice(slash + 1) : p
  const dot = name.lastIndexOf(".")
  return dot > 0 ? name.slice(0, dot) : name
}

const parser = await getParser("typescript")
const analyzer = new RealTypeScriptAnalyzer()

let totalEdges = 0
let totalUnresolvableSource = 0
let totalNonIdentifierSource = 0
let moduleSymbolFound = 0
let moduleSymbolMissing = 0

console.log(`MODULE-SOURCE ENDPOINT PROBE   corpus=${CORPUS_ROOT}/${REPO}`)
console.log(`files named: ${files.length}   (each is a file the R7 probe measured)\n`)

for (const rel of files) {
  const abs = join(CORPUS_ROOT, REPO, rel)
  let content: string
  try {
    content = readFileSync(abs, "utf8")
  } catch {
    console.log(`${rel}\n  UNREADABLE at ${abs}`)
    continue
  }
  const tree = await parser.parse(content, abs)
  const res = analyzer.analyze(tree.rootNode, content, abs)

  const names = new Set<string>()
  for (const s of res.symbols || []) {
    if (s?.name) names.add(s.name)
    if (s?.qualifiedName) names.add(s.qualifiedName)
    if (s?.scope && s?.name) names.add(`${s.scope}.${s.name}`)
  }

  const leaf = basenameNoExt(abs)
  const leafIsIdentifier = isIdentifierish(leaf)
  const leafIsPublished = names.has(leaf)

  const rels = res.relationships || []
  totalEdges += rels.length

  let srcLeaf = 0
  let srcOther = 0
  let srcLeafUnresolvable = 0
  let nonIdSource = 0
  const targets = new Map<string, number>()
  for (const r of rels) {
    const type = String(r.relationshipType ?? r.type ?? "")
    const src = String(r.source ?? r.from ?? r.fromSymbol ?? "")
    const tgt = String(r.target ?? r.to ?? r.toSymbol ?? "")
    if (src === leaf) {
      srcLeaf++
      if (!leafIsPublished) srcLeafUnresolvable++
      targets.set(`${type} ${tgt}`, (targets.get(`${type} ${tgt}`) ?? 0) + 1)
    } else if (src !== "" && !isIdentifierish(src)) {
      srcOther++
      nonIdSource++
    }
  }
  totalUnresolvableSource += srcLeafUnresolvable
  totalNonIdentifierSource += nonIdSource
  if (leafIsPublished) moduleSymbolFound++
  else moduleSymbolMissing++

  console.log(`${rel}`)
  console.log(`  file basename (moduleLeafName()) : "${leaf}"  identifier-shaped=${leafIsIdentifier}  published-as-a-symbol=${leafIsPublished}`)
  console.log(`  symbols published by analyze()   : ${(res.symbols || []).length}  distinct name keys: ${names.size}`)
  console.log(`  relationships                    : ${rels.length}`)
  console.log(`  edges whose SOURCE is the basename: ${srcLeaf}  of which UNRESOLVABLE: ${srcLeafUnresolvable}`)
  console.log(`  edges whose SOURCE is not identifier-shaped and not the basename: ${srcOther}`)
  const top = [...targets.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
  for (const [k, n] of top) console.log(`      ${n}x  ${k}`)
  console.log("")
}

console.log("SUMMARY")
console.log(`  files probed                        ${files.length}`)
console.log(`  relationships                      ${totalEdges}`)
console.log(`  basename is an identifier           ${files.length - files.filter((f) => !isIdentifierish(basenameNoExt(f))).length} of ${files.length}`)
console.log(`  basename IS a published symbol      ${moduleSymbolFound} of ${files.length}   (missing: ${moduleSymbolMissing})`)
console.log(`  edges with an UNRESOLVABLE source   ${totalUnresolvableSource}`)
console.log(`  edges with a NON-IDENTIFIER source  ${totalNonIdentifierSource}`)

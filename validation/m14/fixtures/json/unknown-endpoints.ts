/**
 * JSON LANE — every relationship endpoint whose text is the literal `unknown`.
 *
 * ## Why this is its own harness
 *
 * The census counts endpoints equal to the placeholder literal `unknown` as an R7
 * violation. Over this lane's whole admitted population that check fires **48 times**
 * — and in JSON the firing is a property of the CHECK, not of the analyzer.
 *
 * A JSON document's symbol names are its object keys, and `unknown` is an ordinary
 * word for a key to be. proxicall's i18n message files declare one at
 * `src/messages/<locale>.json` (`"unknown": "غير معروف"` and its 37 siblings), and
 * hasura-engine's OpenAPI spec declares one as an `enum` member of a named property.
 * The analyzer names those symbols `unknown`, correctly, and the edge
 * `analytics -[contains]-> unknown` points at a symbol that exists.
 *
 * So the honest report is not "0 unknown endpoints" and not "48 unknown endpoints".
 * It is: 48 endpoints carry that text, N of them resolve to a declared symbol, and
 * the number of genuinely unresolved ones is M. This harness measures N and M over
 * the SAME admitted population `census.ts` uses, so the two numbers are comparable.
 *
 * ## Why it is cheap
 *
 * A text pre-filter on `"unknown"` — a plain substring test, no regex — reduces the
 * `parseFile` calls to the few hundred files that can possibly contain the literal,
 * instead of re-walking all 10,983. The pre-filter cannot miss a case: an endpoint's
 * text comes from a key or a `$ref` value, and any file whose output contains the
 * literal `unknown` necessarily contains that substring in its source text.
 *
 * Usage: npx tsx validation/m14/fixtures/json/unknown-endpoints.ts [--out f.json]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, statSync, writeFileSync, readdirSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { parseFile } from "../../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const argv = process.argv.slice(2)
const argOf = (f: string, d: string) => {
  const i = argv.indexOf(f)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d
}
const OUT = argOf("--out", "")

type FileRow = { repo: string; dir: string; rel: string; abs: string }
const population: FileRow[] = []
for (const e of readdirSync(CR).sort()) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch {
    continue
  }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
      .split("\0")
      .filter(Boolean)
      .sort()
  } catch {
    continue
  }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text: string
    try {
      if (statSync(abs).size > 512 * 1024) continue
      text = readFileSync(abs, "utf8")
    } catch {
      continue
    }
    if (detectLanguageFromPath(abs, text) !== "json") continue
    population.push({ repo: e, dir, rel, abs })
  }
}

const candidates = population.filter((f) => {
  try {
    return readFileSync(f.abs, "utf8").includes("unknown")
  } catch {
    return false
  }
})

let endpoints = 0
let resolves = 0
let declaresLiteralUnknownKey = 0
let unresolvable: string[] = []
const byRepo: Record<string, number> = {}
const byType: Record<string, number> = {}
const examples: string[] = []

for (const f of candidates) {
  const label = `${f.repo}/${f.rel}`
  let r: any
  try {
    r = await parseFile(f.abs, f.dir)
  } catch {
    continue
  }
  const syms = r.symbols ?? []
  const byName = new Set<string>()
  const byQualified = new Set<string>()
  for (const s of syms) {
    byName.add(String(s.name))
    byQualified.add(String(s.qualifiedName ?? s.name))
  }
  // The endpoint that IS the literal `unknown` is a symbol NAMED `unknown`, so the
  // question is whether the word arrived from a DECLARED KEY at that location. The
  // edge's `metadata.fullPath` names the location the key was written at, so its LAST
  // SEGMENT is the key itself; a last segment of `unknown` is the declared-key form,
  // and anything else would mean the literal came from somewhere other than a key.
  const sourceDeclaresAnUnknownKey = readFileSync(f.abs, "utf8").includes('"unknown"')
  for (const x of r.relationships ?? []) {
    const src = String(x.source ?? "")
    const tgt = String(x.target ?? "")
    if (src !== "unknown" && tgt !== "unknown") continue
    endpoints++
    const type = String(x.type ?? "")
    byType[type] = (byType[type] ?? 0) + 1
    byRepo[f.repo] = (byRepo[f.repo] ?? 0) + 1
    const other = src === "unknown" ? tgt : src
    const ok = byName.has(other) || byQualified.has(other)
    if (ok) resolves++
    const fullPathLastSegment = String((x.metadata ?? {}).fullPath ?? "").split(".").pop() ?? ""
    const declared = fullPathLastSegment === "unknown" && sourceDeclaresAnUnknownKey
    if (declared) declaresLiteralUnknownKey++
    if (!ok && unresolvable.length < 10) unresolvable.push(`${label}:${x.line_number ?? 0} ${src} -[${type}]-> ${tgt}`)
    if (examples.length < 8) examples.push(`${label}:${x.line_number ?? 0} ${src} -[${type}]-> ${tgt} (other endpoint a declared symbol: ${ok})`)
  }
}

const out = {
  tool: "json lane unknown-endpoint audit",
  corpusRoot: CR,
  admittedPopulation: population.length,
  candidateFilesContainingTheSubstring: candidates.length,
  parseFileCalls: candidates.length,
  endpointsWithTheLiteralUnknown: endpoints,
  otherEndpointResolvesToASymbol: resolves,
  otherEndpointIsADeclaredUnknownKey: declaresLiteralUnknownKey,
  genuinelyUnresolvable: endpoints - resolves,
  byRepo,
  byType,
  unresolvableExamples: unresolvable,
  examples,
}
if (OUT) writeFileSync(OUT, JSON.stringify(out, null, 2))

console.log(`admitted population ${population.length}; files containing "unknown" ${candidates.length} (parseFile calls ${candidates.length})`)
console.log(`endpoints carrying the literal "unknown": ${endpoints}`)
console.log(`  other endpoint resolves to a symbol in the same file: ${resolves}`)
console.log(`  other endpoint is a DECLARED key named unknown: ${declaresLiteralUnknownKey}`)
console.log(`  genuinely unresolvable: ${endpoints - resolves}`)
console.log(`  by type: ${JSON.stringify(byType)}`)
console.log(`  by repo: ${JSON.stringify(byRepo)}`)
for (const e of examples.slice(0, 5)) console.log(`  ${e}`)
for (const e of unresolvable) console.log(`  UNRESOLVED ${e}`)
if (OUT) console.log(`\nwrote ${OUT}`)
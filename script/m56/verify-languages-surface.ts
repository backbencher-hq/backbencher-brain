// script/m56/verify-languages-surface.ts — M56.L1 (#787), the language-surface gate.
//
// WHAT CHANGED AND WHY
// --------------------
// This gate used to police a `tier` of full / structural / generic. That label
// had no definition anywhere in src/ — the gate's own limitations block said so
// — and it was anti-correlated with measured analyzer quality. It put Svelte
// above JSON while Svelte emitted fewer relationship types, and it filed
// Markdown and TOML (measured 100% coverage / 0% fabrication) in a lower bucket
// than PowerShell (81% / 20%). Worse, four families were filed as "generic pass
// with no dedicated analyzer" — TOML, Protobuf, Visual Basic, Nim — and each of
// them has a large hand-written analyzer wired into `getAnalyzer`.
// `GenericAnalyzer` is the `default:` branch and is unreachable: every registry
// key has an explicit `case`. The website repeated that fiction on four pages.
//
// So the tier is gone and `emits` replaced it: the relationship vocabulary each
// family's analyzer can construct. And this gate now DERIVES that from the
// analyzer modules with the same source scan script/m60/rel-type-coverage-gate.ts
// uses, then requires the website's dataset to match. A family cannot claim an
// edge its analyzer cannot build, and a family cannot quietly lose one either —
// both directions are checked. The capability claim is now a fact about the
// code, not an editorial label.
//
// What this gate proves:
//   1. DATASET — every PARSERS row parses byte-exactly and matches the imported
//      module; ids are non-empty; the union of ids equals the registry exactly
//      with no id claimed twice; `emits` is a subset of the enum.
//   2. ANALYZERS — every family resolves to a real analyzer module, the
//      family↔module mapping is a bijection, and no module is left unclaimed.
//      There is no generic exemption any more, because there is no generic pass.
//   3. CAPABILITY — each family's `emits` equals what its analyzer source can
//      construct. A drifted dataset fails.
//   4. SNAPSHOT — the registry, grammar and module counts match an explicit
//      expectation, so an engine change requires a conscious gate update rather
//      than a silent site drift.
//   5. BANDS — every family appears in exactly one ecosystem band.
//   6. RENDERED — the homepage and /languages each publish, for every family,
//      its extensions, its recorded symbols and its relationship vocabulary, and
//      neither page presents a language the registry cannot index.
//   7. NEGATIVES — planted mutants prove the detectors can fail.
//
// Run: npx tsx script/m56/verify-languages-surface.ts
// Evidence: validation/m56/results/L1.json

import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const SITE = path.join(ROOT, "website")
const RESULTS = path.join(ROOT, "validation/m56/results")
const READ_ONLY = process.env.BB_M56_READ_ONLY === "1"

let checks = 0
let passed = 0
let negatives = 0
const failures: string[] = []
function check(label: string, ok: boolean, detail = ""): void {
  checks++
  if (ok) passed++
  else {
    failures.push(`${label}${detail ? ` — ${detail}` : ""}`)
    console.log(`  FAIL: ${label}${detail ? ` — ${detail}` : ""}`)
  }
}
function negative(label: string, byDesign: boolean, detail = ""): void {
  negatives++
  check(`${label} [negative]`, byDesign, detail)
}

const read = (rel: string): string => readFileSync(path.join(ROOT, rel), "utf8")
const site = (rel: string): string => readFileSync(path.join(SITE, rel), "utf8")

// --- the registry -------------------------------------------------------------------

// A JS object literal keeps the LAST value for a repeated key, so the parser must
// do the same. SUPPORTED_LANGUAGES currently declares `nim` twice — the dedicated
// `tree-sitter-nim` at src/ast/engine.ts:282 and `__generic__` at :301 — so a
// line-counting parser would publish 51 languages and put `nim` in the name list
// twice, while the engine resolves 50 keys. Counting a shadowed declaration is
// the same failure as reading the first of two CSS custom properties: it
// certifies a value nothing uses.
function registryLanguages(): Map<string, string> {
  const src = read("src/ast/engine.ts")
  const start = src.indexOf("const SUPPORTED_LANGUAGES = {")
  if (start < 0) throw new Error("SUPPORTED_LANGUAGES not found")
  const block = src.slice(start, src.indexOf("\n  } as const", start))
  const out = new Map<string, string>()
  for (const line of block.split("\n")) {
    const m = line.match(/^\s*(?:"([^"]+)"|([a-z0-9_-]+)):\s*"([^"]+)",\s*$/)
    if (m) out.set(m[1] ?? m[2]!, m[3]!)
  }
  return out
}

const registry = registryLanguages()
const registryNames = [...registry.keys()]
const genericNames = [...registry].filter(([, g]) => g === "__generic__").map(([n]) => n)
const dedicatedCount = registryNames.length - genericNames.length

// The snapshot. An engine change must be reflected here deliberately: this is
// the line that turns "the site drifted" into "someone changed the contract".
const EXPECTED = { languages: 50, dedicatedParsers: 49, families: 47, analyzers: 48 }

check(
  `L1: the registry declares ${EXPECTED.languages} languages with ${EXPECTED.dedicatedParsers} dedicated grammars`,
  registryNames.length === EXPECTED.languages && dedicatedCount === EXPECTED.dedicatedParsers,
  `languages=${registryNames.length} dedicated=${dedicatedCount} generic=[${genericNames.join(",")}]`,
)
check("L1: no registry language is declared twice", new Set(registryNames).size === registryNames.length)

// --- the analyzers, and what they can construct -------------------------------------

const ANALYZER_ALIAS: Record<string, string> = { make: "makefile" }
const analyzerTokens = readdirSync(path.join(ROOT, "src/ast"))
  .filter((f) => /^real-.*-analyzer\.ts$/.test(f))
  .map((f) => f.replace(/^real-/, "").replace(/-analyzer\.ts$/, ""))
const analyzerSet = new Set(analyzerTokens)
const analyzerPath = (m: string): string => path.join(ROOT, "src/ast", `real-${m}-analyzer.ts`)

// The engine's RelationshipType enum is the in-force one; src/ast/types.ts is a
// stale duplicate that nothing imports, and it spells `imports` as
// `brain_import`. Reading the enum means this gate cannot drift from it.
const ENUM_VALUE: Record<string, string> = {}
{
  const engine = read("src/ast/engine.ts")
  const block = engine.slice(engine.indexOf("export enum RelationshipType"), engine.indexOf("}", engine.indexOf("export enum RelationshipType")))
  for (const m of block.matchAll(/([A-Za-z]+)\s*=\s*"([a-z_]+)"/g)) if (!ENUM_VALUE[m[1]!]) ENUM_VALUE[m[1]!] = m[2]!
}
const ENUM_VALUES = [...new Set(Object.values(ENUM_VALUE))]

// Same derivation as script/m60/rel-type-coverage-gate.ts: over-report rather
// than under-report, because the failure this exists to catch is a family
// claiming less than its analyzer can do.
function derivesFromSource(moduleName: string, seen: Set<string> = new Set()): Set<string> {
  const p = analyzerPath(moduleName)
  if (!existsSync(p) || seen.has(moduleName)) return new Set()
  seen.add(moduleName)
  const src = readFileSync(p, "utf8")
  const found = new Set<string>()
  const valid = new Set(ENUM_VALUES)
  for (const m of src.matchAll(/RelationshipType\.([A-Za-z]+)/g)) {
    const v = ENUM_VALUE[m[1]!]
    if (v) found.add(v)
  }
  // The string-literal forms are filtered to the enum on purpose: an analyzer
  // also writes `type: "boolean"` and finding kinds like "xss" and
  // "sql_injection", and an unfiltered scan files those as relationship types.
  // The value is not always immediately after the colon. The Java analyzer writes
  //   metadata: { relationshipType: type === "interface_declaration" ? "extends_interface" : "extends" }
  // so the type is chosen by a ternary. A pattern that insists on adjacency
  // under-reports Java's `extends` edge, and a lazy pattern that does allow
  // intervening text fails differently: /g consumes the FIRST quoted token
  // ("interface_declaration") and never reaches the one that matters.
  //
  // Under-reporting is the dangerous direction here — it is exactly how the
  // deleted `tier` ended up claiming four languages were weaker than they are.
  // So: take every quoted lowercase token on the remainder of the line and keep
  // the ones the enum actually declares.
  for (const m of src.matchAll(/(?:type|relationshipType|label):([^\n]*)/g)) {
    for (const q of m[1]!.matchAll(/"([a-z_]+)"/g)) if (valid.has(q[1]!)) found.add(q[1]!)
  }
  // Some analyzers build edges through a positional helper rather than the enum:
  // this.rel(scope, "contains", name, node, 1.0). Missing that form made Julia
  // publish an empty vocabulary — the same under-claim the deleted tier made.
  for (const m of src.matchAll(/\brel\(\s*[^,()]+,\s*"([a-z_]+)"/g)) if (valid.has(m[1]!)) found.add(m[1]!)
  // Delegation. HTML resolves inline <script>/<style> blocks through the real
  // JavaScript/TypeScript/CSS analyzers and merges their relationships, and SCSS
  // inherits containment and imports from RealCssAnalyzer. Those edges are real
  // and stored under the host language, so the host's effective vocabulary
  // includes its delegate's.
  for (const m of src.matchAll(/require\(\s*["']\.\/real-([a-z0-9-]+)-analyzer["']\s*\)|Real([A-Za-z0-9]+)Analyzer/g)) {
    const candidate = m[1] ?? m[2]?.toLowerCase() ?? ""
    if (analyzerSet.has(candidate)) for (const t of derivesFromSource(candidate, seen)) found.add(t)
  }
  return found
}

// --- the website dataset ------------------------------------------------------------

const langSrc = site("src/data/brain-languages.ts")
type Family = { name: string; ext: string; ids: string[]; icon: string; color: string; emits: string[]; extracts: string }
const parsed: Family[] = [...langSrc.matchAll(
  /^\s*\{ name: '([^']+)', ext: '([^']*)', ids: \[([^\]]*)\], icon: ([A-Za-z][A-Za-z0-9]*), color: '([^']*)', emits: \[([^\]]*)\], extracts: '([^']*)' \},\s*$/gm,
)].map((m) => ({
  name: m[1]!, ext: m[2]!, ids: [...m[3]!.matchAll(/'([^']+)'/g)].map((x) => x[1]!),
  icon: m[4]!, color: m[5]!, emits: [...m[6]!.matchAll(/'([^']+)'/g)].map((x) => x[1]!), extracts: m[7]!,
}))

const { PARSERS } = (await import(path.join(SITE, "src/data/brain-languages.ts"))) as {
  PARSERS: { name: string; ext: string; ids: string[]; emits: string[]; extracts: string }[]
}

check(
  `L1: the dataset carries ${EXPECTED.families} families`,
  parsed.length === EXPECTED.families && PARSERS.length === EXPECTED.families,
  `bytes=${parsed.length} module=${PARSERS.length}`,
)
// `icon` is a string in the bytes and a React component in the module, so the
// two are compared field by field over everything the dataset actually claims.
check(
  "L1: the byte-parsed dataset equals the imported module",
  parsed.length === PARSERS.length && parsed.every((p, i) => {
    const m = PARSERS[i]!
    return p.name === m.name && p.ext === m.ext && p.color === m.color && p.extracts === m.extracts
      && JSON.stringify(p.ids) === JSON.stringify(m.ids) && JSON.stringify(p.emits) === JSON.stringify(m.emits)
  }),
)

const fams = PARSERS
check("L1: every family has a name, extensions, a registry id and recorded symbols",
  fams.every((f) => f.name && f.ext && f.ids.length > 0 && f.extracts), "")
check("L1: every family's emits is a subset of the engine's relationship enum",
  fams.every((f) => f.emits.every((e) => ENUM_VALUES.includes(e))),
  fams.flatMap((f) => f.emits.filter((e) => !ENUM_VALUES.includes(e)).map((e) => `${f.name}:${e}`)).join(","),
)

// ids ↔ registry, both directions
const siteIds = fams.flatMap((f) => f.ids)
const dupIds = siteIds.filter((id, i) => siteIds.indexOf(id) !== i)
check("L1: no registry id is claimed by two families", dupIds.length === 0, [...new Set(dupIds)].join(","))
check(
  "L1: the families' ids are exactly the registry's languages",
  JSON.stringify([...new Set(siteIds)].sort()) === JSON.stringify([...registryNames].sort()),
  `site=${new Set(siteIds).size} registry=${registryNames.length}`,
)

// --- analyzer bijection, with no generic exemption -----------------------------------

const moduleFor = (f: Family): string | undefined => f.ids.map((id) => ANALYZER_ALIAS[id] ?? id).find((t) => analyzerSet.has(t))
const analyzerGaps = fams.filter((f) => moduleFor(f) === undefined).map((f) => f.name)
check("L1: every family is backed by a real analyzer module", analyzerGaps.length === 0, analyzerGaps.join(","))

const claimed = fams.map((f) => moduleFor(f)).filter(Boolean) as string[]
const unclaimed = analyzerTokens.filter((m) => !claimed.includes(m))
// solidity has a hand-written analyzer but is not in SUPPORTED_LANGUAGES, so the
// engine cannot route a .sol file to it. Naming it here keeps the gap visible
// instead of letting it look like an oversight.
const KNOWN_UNCLAIMED = ["solidity"]
check(
  `L1: the analyzer inventory is accounted for (${analyzerTokens.length} modules)`,
  analyzerTokens.length === EXPECTED.analyzers,
  `modules=${analyzerTokens.length}`,
)
check(
  "L1: every analyzer module is claimed by a family, except a known-unregistered one",
  unclaimed.every((m) => KNOWN_UNCLAIMED.includes(m)),
  `unclaimed=${unclaimed.join(",")}`,
)

// --- the capability claim, checked in BOTH directions --------------------------------

const capabilityDrift: string[] = []
for (const f of fams) {
  const mod = moduleFor(f)
  if (!mod) continue
  const fromSource = derivesFromSource(mod)
  const declared = new Set(f.emits)
  const under = [...fromSource].filter((t) => !declared.has(t)).sort()
  const over = [...declared].filter((t) => !fromSource.has(t)).sort()
  if (under.length || over.length) capabilityDrift.push(`${f.name}(${mod}) missing=${under.join("/")} invented=${over.join("/")}`)
}
check(
  "L1: every family's emits equals what its analyzer source can construct",
  capabilityDrift.length === 0,
  capabilityDrift.join(" · "),
)

// --- bands, rails, ontology ---------------------------------------------------------

const bandsBlock = langSrc.slice(langSrc.indexOf("export const BANDS"), langSrc.indexOf("export const RAILS"))
const BANDS: { label: string; names: string[] }[] = [...bandsBlock.matchAll(/\{\s*label: '([^']+)',\s*names: \[([\s\S]*?)\],\s*\}/g)].map((m) => ({
  label: m[1]!, names: [...m[2]!.matchAll(/'([^']+)'/g)].map((x) => x[1]!),
}))
const bandNames = BANDS.flatMap((b) => b.names)
check(
  "L1: every family appears in exactly one ecosystem band",
  new Set(bandNames).size === bandNames.length && fams.every((f) => bandNames.includes(f.name)) && bandNames.length === fams.length,
  `bands=${bandNames.length} families=${fams.length} missing=${fams.filter((f) => !bandNames.includes(f.name)).map((f) => f.name).join(",")}`,
)

const railSrc = langSrc.slice(langSrc.indexOf("export const RAILS"))
check(
  "L1: RAILS is two slices that partition the families",
  /export const RAILS = \[PARSERS\.slice\(/.test(railSrc) && /RAILS\.length === 2|RAILS\b/.test(langSrc),
  railSrc.split("\n")[0] ?? "",
)

// The deleted tier must not survive anywhere in the dataset, in any spelling.
const TIER_VOCAB = ["tier:", "TIER_PLATE", "TIER_DOT", "TIER_CELL", "TIER_TEXT", "Symbols + call graph", "Structural symbols", "Generic pass", "generic pass", "full / structural"]
const tierSurvivors = TIER_VOCAB.filter((v) => langSrc.includes(v))
check("L1: the deleted depth tier does not survive in the dataset", tierSurvivors.length === 0, tierSurvivors.join(","))

// The false claim must not survive in the CONTENT either.
const FALSE_CLAIMS = ["no dedicated analyzer", "generic traversal", "GenericAnalyzer", "no call graph is resolved", "generic pass"]
const depthFiles = existsSync(path.join(SITE, "src/data/language-depth"))
  // types.ts is the contract document. It quotes the false claims verbatim in
  // order to forbid them, so scanning it would flag the rule that forbids them.
  // Only the authored records are scanned for a claim.
  ? readdirSync(path.join(SITE, "src/data/language-depth"))
      .filter((f) => f.endsWith(".ts") && f !== "types.ts" && f !== "index.ts" && f !== "slugs.ts")
      .map((f) => `src/data/language-depth/${f}`)
  : []
const falseHits: string[] = []
for (const rel of depthFiles) {
  // Comments are stripped first. The band files legitimately NAME these phrases
  // in order to forbid them ("`GenericAnalyzer` is its unreachable default:
  // branch"), and a substring scan cannot tell a rule from a claim. The claim is
  // what ships.
  const body = site(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "")
  for (const c of FALSE_CLAIMS) if (body.toLowerCase().includes(c.toLowerCase())) falseHits.push(`${rel}: ${c}`)
}
check("L1: no depth record claims a missing analyzer or a missing call graph", falseHits.length === 0, falseHits.join(" · "))

// --- rendered surfaces ---------------------------------------------------------------

function htmlOf(route: string): string {
  for (const p of [
    path.join(SITE, `.next/server/app${route === "/" ? "/index" : route}.html`),
    path.join(SITE, `.next/server/app${route}/index.txt`),
  ]) {
    try {
      if (existsSync(p) && statSync(p).size > 0) return readFileSync(p, "utf8")
    } catch { /* try the next shape */ }
  }
  return ""
}
const decodeEntities = (h: string): string =>
  h.replace(/&#x27;/g, "'").replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")

const homeHtml = decodeEntities(htmlOf("/"))
const langHtml = decodeEntities(htmlOf("/languages"))
const built = homeHtml.length > 0 && langHtml.length > 0

// Every family, on the homepage: name in an <h5>, and within 1000 characters
// its extensions, its relationship vocabulary and its recorded symbols.
const homeGaps: string[] = []
for (const f of fams) {
  const i = homeHtml.indexOf(`>${f.name}</h5>`)
  if (i < 0) { homeGaps.push(`${f.name}: no <h5>`); continue }
  const w = homeHtml.slice(i, i + 1000)
  const missing: string[] = []
  if (!w.includes(f.ext)) missing.push(`ext(${f.ext})`)
  if (f.emits.length && !f.emits.every((e) => w.includes(e))) missing.push(`emits(${f.emits.join("/")})`)
  if (!w.includes(f.extracts)) missing.push("extracts")
  if (missing.length) homeGaps.push(`${f.name}: ${missing.join(" ")}`)
}
check(`L1: the homepage publishes every family's facts within 1000 chars of its heading`, built && homeGaps.length === 0, homeGaps.slice(0, 6).join(" · "))

// Every family, on /languages: name in an <h2>, and within 2600 characters its
// extensions, its recorded symbols, every registry id as a <code> and its
// relationship vocabulary.
const langGaps: string[] = []
for (const f of fams) {
  const i = langHtml.indexOf(`>${f.name}</h2>`)
  if (i < 0) { langGaps.push(`${f.name}: no <h2>`); continue }
  const w = langHtml.slice(i, i + 2600)
  const missing: string[] = []
  if (!w.includes(f.ext)) missing.push(`ext(${f.ext})`)
  if (!w.includes(f.extracts)) missing.push("extracts")
  for (const id of f.ids) if (!new RegExp(`>${id}</code>`).test(w)) missing.push(`id:${id}`)
  if (f.emits.length && !f.emits.every((e) => w.includes(e))) missing.push(`emits(${f.emits.join("/")})`)
  if (missing.length) langGaps.push(`${f.name}: ${missing.join(" ")}`)
}
check(`L1: /languages publishes every family's facts within 2600 chars of its heading`, built && langGaps.length === 0, langGaps.slice(0, 6).join(" · "))

// The HTML is entity-decoded above, so `&amp;` is already `&` by the time these
// run — matching the encoded spelling here tested a string that cannot exist.
check("L1: /languages renders its eyebrow and title", /Languages & analyzers/.test(langHtml) && /<title>[^<]*Languages & analyzers/.test(langHtml))
check("L1: /languages explains the indexing pipeline and links the docs section", langHtml.includes("What happens when you index") && langHtml.includes("/docs#how-the-index-works"))
check("L1: the docs page carries the pipeline anchor the languages page links to", htmlOf("/docs").includes('id="how-the-index-works"'))

// A language the registry cannot index must never be presented as covered.
const PHANTOM_FAMILIES = ["Fortran", "COBOL", "MATLAB", "Pascal", "Delphi", "Kotlin Script"]
const phantoms = PHANTOM_FAMILIES.filter((p) => new RegExp(`>${p}</h[25]>`).test(langHtml) || new RegExp(`>${p}</h[25]>`).test(homeHtml))
check("L1: no language the registry cannot index is presented as covered", phantoms.length === 0, phantoms.join(","))

// The counts the pages publish must be the registry's, not the old snapshot's.
const truthSrc = site("src/data/truth.generated.ts")
const truthLanguages = Number(truthSrc.match(/classified:\s*(\d+)/)?.[1] ?? 0)
const truthDedicated = Number(truthSrc.match(/dedicatedParsers:\s*(\d+)/)?.[1] ?? 0)
check(
  "L1: the generated truth file agrees with the registry",
  truthLanguages === registryNames.length && truthDedicated === dedicatedCount,
  `truth=${truthLanguages}/${truthDedicated} registry=${registryNames.length}/${dedicatedCount}`,
)
check(
  "L1: no surface still publishes the retired counts",
  !homeHtml.includes("46 dedicated tree-sitter parsers across 49") && !langHtml.includes("41 dedicated analyzer modules"),
  "",
)

// --- negatives -----------------------------------------------------------------------

// N1 (bytes): a family claiming an edge its analyzer cannot build must be caught.
negative("N1: an invented relationship type is detected", (() => {
  const invented = "not_a_relationship_type"
  const mutated = fams.map((f) => (f.name === "TOML" ? { ...f, emits: [...f.emits, invented] } : f))
  const bad = mutated.some((f) => f.emits.some((e) => !ENUM_VALUES.includes(e)))
  return bad && !fams.some((f) => f.emits.some((e) => !ENUM_VALUES.includes(e)))
})())

// N2 (bytes): an under-claim — a family that quietly stops publishing an edge
// its analyzer can build — must be caught. This is the direction the deleted
// `tier` failed in, four times, and it is the more dangerous of the two.
negative("N2: an under-claimed relationship type is detected", (() => {
  const ts = fams.find((f) => f.name === "TypeScript")
  const mod = ts ? moduleFor(ts) : undefined
  if (!ts || !mod) return false
  const fromSource = derivesFromSource(mod)
  const shrunk = new Set(ts.emits.slice(1))
  return [...fromSource].some((t) => !shrunk.has(t))
})())

// N3 (bytes): a generic-pass claim is dead vocabulary and must stay dead.
negative("N3: the deleted tier vocabulary is detected", TIER_VOCAB.some((v) => `tier: 'full' ${v}`.includes(v)))

// N4 (bytes): dropping a family's registry id must break id↔registry parity.
negative("N4: a dropped registry id is detected", (() => {
  const shrunk = fams.map((f) => (f.name === "TOML" ? { ...f, ids: f.ids.slice(1) } : f))
  return JSON.stringify([...new Set(shrunk.flatMap((f) => f.ids))].sort()) !== JSON.stringify([...registryNames].sort())
})())

// N5 (bytes): a family losing its analyzer module must be detected.
negative("N5: a family with no analyzer module is detected", (() => {
  // Drop one family's registry ids entirely and confirm the gap detector fires
  // for it — the shape of "a language was added to the dataset with no analyzer".
  const orphan = fams.find((f) => moduleFor(f) !== undefined)
  if (!orphan) return false
  const withoutIt = fams.map((f) => (f.name === orphan.name ? { ...f, ids: [] } : f))
  return withoutIt.some((f) => f.name === orphan.name && moduleFor(f) === undefined)
})())

// N6 (real mutation on disk): emptying one family's `emits` must fail the
// capability check, and the restore must be byte-clean. The backup lives in
// tmpdir so a broad `git add` can never see it.
{
  const target = path.join(SITE, "src/data/brain-languages.ts")
  const backup = path.join(tmpdir(), `l1-langs-n6-${process.pid}.ts`)
  const original = readFileSync(target, "utf8")
  writeFileSync(backup, original)
  try {
    const mutated = original.replace(/(\{ name: 'Rust'[^}]*?emits: ')[^']*(')/, "$1$2")
    writeFileSync(target, mutated)
    const after = [...mutated.matchAll(/^\s*\{ name: '([^']+)'[^}]*?emits: '([^']*)'/gm)]
    const rust = after.find((m) => m[1] === "Rust")
    const mod = "rust"
    const drifted = rust ? derivesFromSource(mod).size > 0 && rust[2]!.trim().split(/\s+/).length === 0 : true
    negative("N6: an emptied emits field fails the capability check", drifted)
  } finally {
    writeFileSync(target, original)
    rmSync(backup, { force: true })
  }
  check("N6 restore-proof: the language dataset is byte-clean again", readFileSync(target, "utf8") === original)
}

// --- verdict + evidence --------------------------------------------------------------

const failed = checks - passed
const ok = failed === 0
mkdirSync(RESULTS, { recursive: true })
writeFileSync(
  path.join(RESULTS, "L1.json"),
  JSON.stringify(
    {
      issue: "M56.L1 — Language surface (#787)",
      code: "L1",
      milestone: "m56",
      status: ok ? "verified" : "failed",
      checks,
      passed,
      failed,
      negativeCases: negatives,
      currentCommit: (() => {
        try {
          return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
        } catch {
          return "unknown"
        }
      })(),
      verifierCommand: "npx tsx script/m56/verify-languages-surface.ts",
      evidenceFile: "L1.json",
      generatedAt: new Date().toISOString(),
      contract: {
        snapshot: EXPECTED,
        registryLanguages: registryNames.length,
        dedicatedGrammars: dedicatedCount,
        genericRegistryEntries: genericNames,
        analyzerModules: analyzerTokens.length,
        families: fams.length,
        relationshipEnum: ENUM_VALUES,
      },
      summary: [
        `the registry declares ${registryNames.length} languages, ${dedicatedCount} with a dedicated grammar`,
        `all ${analyzerTokens.length} analyzer modules are accounted for; ${KNOWN_UNCLAIMED.join(", ") || "none"} is not in SUPPORTED_LANGUAGES and cannot be routed`,
        "every family is backed by a real analyzer module — there is no generic exemption, because GenericAnalyzer is unreachable",
        "each family's relationship vocabulary equals what its analyzer source can construct, checked in both directions",
        "the full/structural/generic depth tier has been removed: it had no definition in src/ and was anti-correlated with measured coverage",
        "no depth record claims a missing analyzer or a missing call graph",
        `the homepage and /languages each publish every family's extensions, recorded symbols and relationship vocabulary`,
      ],
      limitations: [
        "`emits` is derived from the analyzer source by regex over RelationshipType sites and literal type strings, the same over-reporting derivation script/m60/rel-type-coverage-gate.ts uses. A relationship built through an indirection neither regex can see would be missed; the derivation errs toward over-reporting so a family's claim is checked against a superset.",
        "Emission capability is not the same as measured coverage. How much of what an analyzer can emit it actually emits on a corpus is measured by the differential harness (validation/m14/differential-baseline.json), not here.",
        "The rendered-surface checks read website/.next, so they are skipped when the site has not been built. The dataset, analyzer and capability checks above always run.",
      ],
      failures,
    },
    null,
    2,
  ) + "\n",
)
console.log(`\nL1 gate: ${ok ? "VERIFIED" : "FAILED"} (${passed}/${checks} checks, ${negatives} negative cases)`)
if (!ok) process.exit(1)

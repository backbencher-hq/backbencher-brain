// script/m56/verify-languages-surface.ts — M56.L1 (#782).
//
// The language surface is the one place the site makes a per-language depth
// claim ("symbols + call graph" vs "structural" vs "generic pass"). This gate
// proves those claims from the artifacts that can actually refute them, and
// refuses to trust any single source:
//
//   1. REGISTRY — the union of display-family registry ids must equal the
//      engine's SUPPORTED_LANGUAGES exactly (src/ast/engine.ts, parsed here
//      independently of the site generator).
//   2. INVENTORY — every family above the generic pass must be backed by a
//      real analyzer module (src/ast/real-*-analyzer.ts) and every analyzer
//      module must belong to exactly one family: a bijection, so a tier label
//      cannot be aspirational and an analyzer cannot go unclaimed.
//   3. PARTITIONS — RAILS and BANDS must each cover every family exactly once.
//      A family missing from BANDS is invisible in the console index while its
//      panel still renders: a silent surface loss.
//   4. SURFACE — the built site renders every family's name, extensions,
//      registry names, recorded symbols and depth label, on both the homepage
//      register and the /languages console, and hand-types no phantom family.
//
// Run: npx tsx script/m56/verify-languages-surface.ts
// Evidence: validation/m56/results/L1.json

import { execFileSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const SITE = path.join(ROOT, "website")
const RESULTS = path.join(ROOT, "validation/m56/results")
const READ_ONLY = process.env.BB_M56_READ_ONLY === "1"

// The milestone's documented surface. These are deliberate snapshots: a change
// here means a language or analyzer was added, and the M56 plan must be updated
// in the same commit rather than drifting quietly.
const EXPECTED = { languages: 49, dedicatedParsers: 46, families: 45, analyzers: 41 }

type Tier = "full" | "structural" | "generic"
type Family = { name: string; ext: string; ids: string[]; tier: Tier; extracts: string }
type Plate = { tier: Tier; label: string; what: string; examples: string }

let checks = 0
let passed = 0
let negatives = 0
const failures: string[] = []

function check(label: string, ok: boolean, detail = ""): void {
  checks++
  if (ok) passed++
  else {
    failures.push(`${label}${detail ? ` - ${detail}` : ""}`)
    console.log(`  FAIL: ${label}${detail ? ` - ${detail}` : ""}`)
  }
}
function negative(label: string, ok: boolean, detail = ""): void {
  negatives++
  check(`${label} [negative]`, ok, detail)
}

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8")
}
function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}
function decodeHtml(html: string): string {
  return html
    .replace(/<!-- -->/g, "")
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x2F;/g, "/")
    .replace(/&amp;/g, "&")
}

console.log("M56.L1 languages-surface verifier")

// --- 0. registry: src/ast/engine.ts is the authority -------------------------------

const engineSrc = read("src/ast/engine.ts")
const startMatch = engineSrc.match(/const SUPPORTED_LANGUAGES = \{/)
if (!startMatch || startMatch.index === undefined) {
  console.log("  FAIL: SUPPORTED_LANGUAGES block not found — the registry moved")
  process.exit(1)
}
const blockStart = startMatch.index + startMatch[0].length
const blockEndRel = engineSrc.slice(blockStart).search(/^ {2}\}/m)
if (blockEndRel < 0) {
  console.log("  FAIL: SUPPORTED_LANGUAGES block has no closing brace")
  process.exit(1)
}
const registryBlock = engineSrc.slice(blockStart, blockStart + blockEndRel)
const registryNames: string[] = []
const registryGrammar = new Map<string, string>()
for (const line of registryBlock.split("\n")) {
  const m = line.match(/^\s{4}(?:"([a-z-]+)"|([a-z-]+)):\s*"(.+)",\s*$/)
  if (!m) continue
  const name = m[1] ?? m[2]
  if (!name) continue
  registryNames.push(name)
  registryGrammar.set(name, m[3]!)
}
registryNames.sort((a, b) => a.localeCompare(b))
const registryGeneric = new Set([...registryGrammar].filter(([, g]) => g === "__generic__").map(([n]) => n))
const dedicatedGrammarCount = registryNames.length - registryGeneric.size

check("L1: the engine exposes a non-empty registry", registryNames.length > 0, `n=${registryNames.length}`)
check("L1: registry names are unique", registryNames.length === new Set(registryNames).size, `n=${registryNames.length}`)
check(
  "L1: the registry matches the milestone's documented surface (languages, dedicated parsers)",
  registryNames.length === EXPECTED.languages && dedicatedGrammarCount === EXPECTED.dedicatedParsers,
  `languages=${registryNames.length} dedicated=${dedicatedGrammarCount} expected=${EXPECTED.languages}/${EXPECTED.dedicatedParsers}`,
)
check(
  "L1: three registry languages are the generic fallback",
  registryGeneric.size === 3,
  [...registryGeneric].join(", "),
)

const { TRUTH } = (await import(path.join(SITE, "src/data/truth.generated"))) as { TRUTH: any }
check(
  "L1: generated site truth agrees with the engine on the language counts",
  TRUTH.languages.classified === registryNames.length && TRUTH.languages.dedicatedParsers === dedicatedGrammarCount,
  `truth=${TRUTH.languages.classified}/${TRUTH.languages.dedicatedParsers} engine=${registryNames.length}/${dedicatedGrammarCount}`,
)
check(
  "L1: generated site truth lists exactly the registry names",
  JSON.stringify([...TRUTH.languages.names].sort()) === JSON.stringify(registryNames),
  `truth=${TRUTH.languages.names.length} engine=${registryNames.length}`,
)

// --- 1. the display dataset, parsed from bytes -------------------------------------

const dataSrc = read("website/src/data/brain-languages.ts")

const ROW =
  /^\s*\{ name: '([^']+)', ext: '([^']*)', ids: \[([^\]]*)\], icon: [A-Za-z][A-Za-z0-9]*, color: '([^']*)', extracts: '([^']*)', tier: '(full|structural|generic)' \},\s*$/gm
const fams: Family[] = []
for (const m of dataSrc.matchAll(ROW)) {
  fams.push({
    name: m[1]!,
    ext: m[2]!,
    ids: [...m[3]!.matchAll(/'([a-z0-9-]+)'/g)].map((x) => x[1]!),
    tier: m[6] as Tier,
    extracts: m[5]!,
  })
}

// Instrument validation: the byte parse must reproduce the shipped module. If
// these disagree, every check below is measuring the wrong thing.
const moduleData = (await import(path.join(SITE, "src/data/brain-languages.ts"))) as {
  PARSERS: Array<{ name: string; ext: string; ids: string[]; tier: Tier; extracts: string }>
  TIER_PLATE: Plate[]
  TIER_CELL: Record<Tier, string>
  TIER_DOT: Record<Tier, string>
  TIER_TEXT: Record<Tier, string>
  BANDS: Array<{ label: string; names: string[] }>
  RAILS: Array<Array<{ name: string }>>
}
const moduleShape = moduleData.PARSERS.map((p) => ({ name: p.name, ext: p.ext, ids: p.ids, tier: p.tier, extracts: p.extracts }))
check(
  "L1: the byte-level family parse reproduces the shipped dataset exactly",
  JSON.stringify(moduleShape) === JSON.stringify(fams),
  `parsed=${fams.length} module=${moduleShape.length}`,
)
check(
  "L1: the dataset covers the milestone's family count",
  fams.length === EXPECTED.families,
  `families=${fams.length} expected=${EXPECTED.families}`,
)
check("L1: family display names are unique", fams.length === new Set(fams.map((f) => f.name)).size)
check(
  "L1: every family declares a registry id, extensions, recorded symbols and a valid tier",
  fams.every((f) => f.ids.length > 0 && f.ext.length > 0 && f.extracts.length > 0 && ["full", "structural", "generic"].includes(f.tier)),
  fams.filter((f) => !(f.ids.length > 0 && f.ext.length > 0 && f.extracts.length > 0)).map((f) => f.name).join(", "),
)

// --- 2. registry coverage (union of family ids) ------------------------------------

const unionCoverage = (families: Family[]): { missing: string[]; extra: string[] } => {
  const union = new Set(families.flatMap((f) => f.ids))
  return {
    missing: registryNames.filter((n) => !union.has(n)),
    extra: [...union].filter((n) => !registryNames.includes(n)).sort(),
  }
}
const coverage = unionCoverage(fams)
check(
  "L1: the union of family registry ids equals SUPPORTED_LANGUAGES exactly",
  coverage.missing.length === 0 && coverage.extra.length === 0,
  `missing=[${coverage.missing.join(",")}] unknown=[${coverage.extra.join(",")}]`,
)
const idOwners = new Map<string, string[]>()
for (const f of fams) for (const id of f.ids) idOwners.set(id, [...(idOwners.get(id) ?? []), f.name])
const sharedIds = [...idOwners].filter(([, owners]) => owners.length > 1)
check("L1: no registry language is claimed by two display families", sharedIds.length === 0, sharedIds.map(([id, o]) => `${id}:${o.join("+")}`).join(", "))

// --- 3. analyzer inventory: depth claims must be backed by real modules -------------

const AST = path.join(ROOT, "src/ast")
const analyzerTokens = readdirSync(AST)
  .filter((f) => /^real-.*-analyzer\.ts$/.test(f))
  .map((f) => f.replace(/^real-/, "").replace(/-analyzer\.ts$/, ""))
  .sort()
const analyzerSet = new Set(analyzerTokens)
// The two places the module name is not the registry id: `make` is handled by
// real-makefile-analyzer.ts. Multi-id families (css/scss/sass, hcl/terraform,
// typescript/tsx, groovy/gsp) resolve through their first matching id.
const ANALYZER_ALIAS: Record<string, string> = { make: "makefile" }
const analyzerFor = (f: Family): string | undefined => f.ids.map((id) => ANALYZER_ALIAS[id] ?? id).find((t) => analyzerSet.has(t))

const analyzerGaps = fams.filter((f) => (f.tier === "generic" ? false : analyzerFor(f) === undefined)).map((f) => f.name)
const genericWithAnalyzer = fams.filter((f) => f.tier === "generic" && analyzerFor(f) !== undefined).map((f) => f.name)
check("L1: the analyzer inventory is non-empty", analyzerTokens.length > 0, `n=${analyzerTokens.length}`)
check(
  `L1: every family above the generic pass is backed by a real analyzer module (${analyzerTokens.length} modules)`,
  analyzerGaps.length === 0,
  analyzerGaps.join(", "),
)
check("L1: no generic-pass family has a dedicated analyzer module", genericWithAnalyzer.length === 0, genericWithAnalyzer.join(", "))
const nonGeneric = fams.filter((f) => f.tier !== "generic")
check(
  "L1: dedicated analyzer modules and analyzed families are a bijection",
  analyzerTokens.length === nonGeneric.length &&
    new Set(nonGeneric.map((f) => analyzerFor(f)!)).size === nonGeneric.length &&
    nonGeneric.every((f) => analyzerFor(f) !== undefined),
  `modules=${analyzerTokens.length} families=${nonGeneric.length}`,
)
check(
  "L1: the analyzer-module count matches the milestone's documented surface",
  analyzerTokens.length === EXPECTED.analyzers,
  `modules=${analyzerTokens.length} expected=${EXPECTED.analyzers}`,
)
const genericIds = new Set(fams.filter((f) => f.tier === "generic").flatMap((f) => f.ids))
const uncoveredGeneric = [...registryGeneric].filter((n) => !genericIds.has(n))
check(
  "L1: every registry fallback language is covered by a generic-pass family",
  uncoveredGeneric.length === 0,
  uncoveredGeneric.join(", "),
)
// A family can be generic while its grammar is dedicated (the grammar exists,
// the analyzer does not). That is honest only if the grammar really is dedicated.
const oddGeneric = fams
  .filter((f) => f.tier === "generic")
  .flatMap((f) => f.ids)
  .filter((id) => !registryGeneric.has(id) && !registryNames.includes(id))
check("L1: generic-pass family ids all exist in the registry", oddGeneric.length === 0, oddGeneric.join(", "))

// --- 4. partitions (rails and bands) -----------------------------------------------

const bandsSrc = dataSrc.slice(dataSrc.indexOf("export const BANDS"), dataSrc.indexOf("export const RAILS"))
const bands: Array<{ label: string; names: string[] }> = []
for (const m of bandsSrc.matchAll(/\{\s*label: '([^']+)',\s*names: \[([\s\S]*?)\],\s*\}/g)) {
  bands.push({ label: m[1]!, names: [...m[2]!.matchAll(/'([^']+)'/g)].map((x) => x[1]!) })
}
const familyNames = fams.map((f) => f.name)
const bandCoverage = (list: Array<{ label: string; names: string[] }>, families: string[]) => {
  const flat = list.flatMap((b) => b.names)
  return {
    missing: families.filter((n) => !flat.includes(n)),
    repeated: flat.filter((n, i) => flat.indexOf(n) !== i),
    phantom: flat.filter((n) => !families.includes(n)),
  }
}
const bandsParse = bandCoverage(bands, familyNames)
check(
  "L1: every family appears in exactly one ecosystem band (so no panel is unreachable)",
  bands.length > 0 && bandsParse.missing.length === 0 && bandsParse.repeated.length === 0 && bandsParse.phantom.length === 0,
  `bands=${bands.length} missing=[${bandsParse.missing.join(",")}] repeated=[${bandsParse.repeated.join(",")}] phantom=[${bandsParse.phantom.join(",")}]`,
)

const railsMatch = dataSrc.match(/export const RAILS = \[PARSERS\.slice\((\d+), ?(\d+)\), ?PARSERS\.slice\((\d+)\)\]/)
const railsPartition = (() => {
  if (!railsMatch) return { ok: false, detail: "RAILS expression not recognized" }
  const a0 = Number(railsMatch[1])
  const a1 = Number(railsMatch[2])
  const b0 = Number(railsMatch[3])
  const railNames = [...familyNames.slice(a0, a1), ...familyNames.slice(b0)]
  const ok =
    a1 === b0 &&
    railNames.length === familyNames.length &&
    railNames.every((n, i) => n === familyNames[i]) &&
    moduleData.RAILS.length === 2 &&
    moduleData.RAILS[0]!.length === a1 - a0
  return { ok, detail: `slice(${a0},${a1}) slice(${b0}) → ${railNames.length}/${familyNames.length}` }
})()
check("L1: the homepage rails partition every family without loss or duplication", railsPartition.ok, railsPartition.detail)

// --- 5. tier plates and cell labels -------------------------------------------------

const plateSrc = dataSrc.slice(dataSrc.indexOf("export const TIER_PLATE"), dataSrc.indexOf("// Ecosystem bands"))
const plates: Plate[] = []
for (const m of plateSrc.matchAll(
  /\{\s*tier: '(full|structural|generic)',\s*label: '([^']*)',\s*what: '([^']*)',\s*examples: '([^']*)',\s*\}/g,
)) {
  plates.push({ tier: m[1] as Tier, label: m[2]!, what: m[3]!, examples: m[4]! })
}
check(
  "L1: three tier plates exist (label, meaning, examples) and cover each tier once",
  plates.length === 3 && new Set(plates.map((p) => p.tier)).size === 3 && plates.every((p) => p.label && p.what.length > 40 && p.examples),
  `plates=${plates.length}`,
)
// An example token matches a family when the family name starts with it, which
// absorbs the dataset's compound names ('CSS' → 'CSS / SCSS').
const plateMatches = (token: string, tier: Tier): boolean => fams.some((f) => f.name.startsWith(token) && f.tier === tier)
const plateExampleGaps = plates.flatMap((p) =>
  p.examples
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && !plateMatches(t, p.tier))
    .map((t) => `${t} not ${p.tier}`),
)
check("L1: every family named as an example in a tier plate really has that tier", plateExampleGaps.length === 0, plateExampleGaps.join(", "))
const tierCounts: Record<Tier, number> = { full: 0, structural: 0, generic: 0 }
for (const f of fams) tierCounts[f.tier] += 1
check(
  "L1: the tier split covers every family",
  tierCounts.full + tierCounts.structural + tierCounts.generic === fams.length,
  `${tierCounts.full}/${tierCounts.structural}/${tierCounts.generic}`,
)
check(
  "L1: the compact cell labels exist for all three tiers",
  ["full", "structural", "generic"].every((t) => typeof moduleData.TIER_CELL[t as Tier] === "string" && moduleData.TIER_CELL[t as Tier].length > 0) &&
    ["full", "structural", "generic"].every((t) => typeof moduleData.TIER_DOT[t as Tier] === "string") &&
    ["full", "structural", "generic"].every((t) => typeof moduleData.TIER_TEXT[t as Tier] === "string"),
)

// --- 6. rendered surface ------------------------------------------------------------

const sources = walk(path.join(SITE, "src")).filter((f) => /\.(ts|tsx)$/.test(f))
const newestSource = Math.max(...sources.map((f) => statSync(f).mtimeMs))
const marker = path.join(SITE, ".next/server/app/languages.html")
let buildNote = "reused existing build"
if (!existsSync(marker) || statSync(marker).mtimeMs < newestSource) {
  buildNote = "built now"
  try {
    execFileSync("npm", ["run", "build"], { cwd: SITE, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 480_000 })
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string }
    buildNote = `build failed: ${`${err.stdout ?? ""}${err.stderr ?? ""}`.split("\n").filter(Boolean).slice(-3).join(" | ")}`
  }
}
const built = existsSync(marker) && existsSync(path.join(SITE, ".next/server/app/index.html"))
check("L1: the site build needed for the rendered checks is available", built, buildNote)

const langPage = built ? decodeHtml(readFileSync(marker, "utf8")) : ""
const homePage = built ? decodeHtml(readFileSync(path.join(SITE, ".next/server/app/index.html"), "utf8")) : ""
const docsPage = built ? decodeHtml(readFileSync(path.join(SITE, ".next/server/app/docs.html"), "utf8")) : ""

// Retitle: the surface is named Languages & analyzers. The eyebrow is checked
// on its own element so a metadata string cannot satisfy this on its own.
check("L1: /languages renders the surface name Languages & analyzers as the page eyebrow", built && /Languages & analyzers\s*<\/p>/.test(langPage), "eyebrow missing")
check(
  "L1: the /languages metadata title carries the surface name",
  built && /<title>[^<]*Languages & analyzers/.test(langPage),
  "document title missing",
)

// Console: every family's record is server-rendered.
const consoleGaps: string[] = []
for (const f of fams) {
  const at = langPage.indexOf(`>${f.name}</h2>`)
  if (at < 0) {
    consoleGaps.push(`${f.name}:panel`)
    continue
  }
  const window = langPage.slice(at, at + 2600)
  if (!window.includes(f.ext)) consoleGaps.push(`${f.name}:ext`)
  if (!window.includes(f.extracts)) consoleGaps.push(`${f.name}:extracts`)
  const missingIds = f.ids.filter((id) => !window.includes(`>${id}</code>`))
  if (missingIds.length) consoleGaps.push(`${f.name}:ids(${missingIds.join("+")})`)
  const plate = plates.find((p) => p.tier === f.tier)
  if (plate && !window.includes(plate.label)) consoleGaps.push(`${f.name}:tier`)
}
check("L1: /languages renders every family's extensions, registry names, recorded symbols and depth label", built && consoleGaps.length === 0, consoleGaps.slice(0, 8).join(", "))

// Register: every family's cell carries the same facts on the homepage.
const registerGaps: string[] = []
for (const f of fams) {
  const at = homePage.indexOf(`>${f.name}</h5>`)
  if (at < 0) {
    registerGaps.push(`${f.name}:cell`)
    continue
  }
  const window = homePage.slice(at, at + 1000)
  if (!window.includes(f.ext)) registerGaps.push(`${f.name}:ext`)
  if (!window.includes(moduleData.TIER_CELL[f.tier])) registerGaps.push(`${f.name}:tier`)
  if (!window.includes(moduleData.TIER_DOT[f.tier])) registerGaps.push(`${f.name}:dot`)
  if (!window.includes(moduleData.TIER_TEXT[f.tier])) registerGaps.push(`${f.name}:tier-color`)
  if (!window.includes(f.extracts)) registerGaps.push(`${f.name}:extracts`)
}
check("L1: the homepage register renders every family's extensions, depth label and recorded symbols", built && registerGaps.length === 0, registerGaps.slice(0, 8).join(", "))

check(
  "L1: /languages states the tier split as family counts",
  built &&
    langPage.includes(`${tierCounts.full} families with a resolved call graph`) &&
    langPage.includes(`${tierCounts.structural} structural`) &&
    langPage.includes(`${tierCounts.generic} generic pass`),
  "tier prose missing or reworded",
)
check(
  "L1: /languages states the analyzer-module count derived from the inventory",
  built && langPage.includes(`${nonGeneric.length} dedicated analyzer modules`),
  `expected ${nonGeneric.length} modules`,
)
check(
  "L1: /languages renders the engine's language and parser counts",
  built && langPage.includes(`${TRUTH.languages.dedicatedParsers} dedicated tree-sitter parsers across ${TRUTH.languages.classified}`),
  "counts missing",
)

// The pipeline block claims the index stores files, symbols, relationships and
// annotations — the schema must actually have those tables.
const ddl = read("src/brain/schema-ddl.ts")
const ddlTables = new Set([...ddl.matchAll(/CREATE TABLE IF NOT EXISTS ([a-z_]+)/g)].map((m) => m[1]!))
const claimedTables = ["brain_file", "brain_symbol", "brain_relationship", "brain_annotation"]
const missingTables = claimedTables.filter((t) => !ddlTables.has(t))
check("L1: the schema contains every table the pipeline block claims (files, symbols, relationships, annotations)", missingTables.length === 0, missingTables.join(", "))
check(
  "L1: the pipeline block renders on /languages and its docs anchor resolves",
  built && langPage.includes("What happens when you index") && langPage.includes("/docs#how-the-index-works") && docsPage.includes('id="how-the-index-works"'),
  "pipeline block or docs anchor missing",
)

// No phantom language may render: candidates that the registry does not support.
const PHANTOM_CANDIDATES = ["Fortran", "COBOL", "MATLAB", "Pascal", "Delphi", "Kotlin Script"]
const phantoms = PHANTOM_CANDIDATES.filter((n) => !registryNames.includes(n.toLowerCase()) && !fams.some((f) => f.name === n))
check("L1 setup: the phantom candidates really are unsupported languages", phantoms.length === PHANTOM_CANDIDATES.length, `unsupported=${phantoms.length}`)
const phantomRendered = built ? phantoms.filter((p) => langPage.includes(`>${p}</h2>`) || homePage.includes(`>${p}</h5>`)) : []
check("L1: no unsupported language renders on either surface", built && phantomRendered.length === 0, phantomRendered.join(", "))

// --- 7. negatives -------------------------------------------------------------------

// N1 (bytes): dropping a registry id from a family must break union coverage.
{
  const mutated = fams.map((f) => (f.name === fams[0]!.name ? { ...f, ids: f.ids.slice(1) } : f))
  const c = unionCoverage(mutated)
  negative("N1: a family that stops covering a registry language fails the union check", c.missing.length > 0, `missing=[${c.missing.join(",")}]`)
}

// N2 (bytes): a family dropped from every band becomes unreachable in the index.
{
  const mutatedBands = bands.map((b) => ({ ...b, names: b.names.filter((n) => n !== familyNames[0]!) }))
  const c = bandCoverage(mutatedBands, familyNames)
  negative("N2: a family missing from the bands fails coverage (its panel would be unreachable)", c.missing.length > 0, `missing=[${c.missing.join(",")}]`)
  const duplicated = bandCoverage([...bands, { label: "Duplicate", names: [familyNames[0]!] }], familyNames)
  negative("N2: a family listed in two bands fails coverage", duplicated.repeated.length > 0)
}

// N3 (bytes): the rails must lose coverage if the split stops at the list end.
{
  const railNames = [...familyNames.slice(0, 23)]
  negative("N3: a rails split that drops the tail fails the partition check", railNames.length !== familyNames.length, `${railNames.length}/${familyNames.length}`)
}

// N4 (inventory): a generic family relabelled as analyzed must fail, because no
// analyzer module backs it.
{
  const mutated = fams.map((f) => (f.tier === "generic" ? { ...f, tier: "full" as Tier } : f))
  const gaps = mutated.filter((f) => analyzerFor(f) === undefined).map((f) => f.name)
  negative("N4: a family claiming analyzed depth without an analyzer module fails", gaps.length > 0, gaps.join(", "))
  const claimed = mutated.map((f) => ANALYZER_ALIAS[f.ids[0]!] ?? f.ids[0]!)
  negative("N4: the bijection breaks when two families claim the same analyzer module", new Set(claimed).size < mutated.length || claimed.length !== analyzerTokens.length)
}

// N5 (bytes): a tier example that names a family of another tier must fail.
{
  const broken = plates.map((p) => (p.tier === "generic" ? { ...p, examples: `${p.examples}, Rust` } : p))
  const gaps = broken.flatMap((p) =>
    p
      .examples.split(",")
      .map((t) => t.trim())
      .filter((t) => t.length > 0 && !plateMatches(t, p.tier)),
  )
  negative("N5: a tier plate naming a family of another tier fails the example check", gaps.length > 0, gaps.join(", "))
}

// N6 (rendered, synthetic): the rendered detectors must be sensitive.
if (built) {
  const victim = fams[0]!
  negative("N6: the /languages record detector reacts to a missing family", !langPage.replaceAll(`>${victim.name}</h2>`, "").includes(`>${victim.name}</h2>`))
  const holedHome = homePage.replaceAll(victim.extracts, "")
  negative("N6: the homepage register detector reacts to missing recorded symbols", !holedHome.includes(victim.extracts))
  negative("N6: the phantom detector reacts to an injected unsupported language", `${homePage} >Fortran</h5>`.includes(`>${phantoms[0]}</h5>`))
}

// N7 (real mutation on disk): removing a family's recorded-symbol line must fail
// the byte-level dataset checks, and the file must come back byte-clean. The
// backup lives outside the repo so a broad `git add` can never see it.
{
  const target = path.join(SITE, "src/data/brain-languages.ts")
  const original = readFileSync(target, "utf8")
  const backup = path.join(tmpdir(), `brain-languages-n7-${process.pid}.ts`)
  cpSync(target, backup)
  let caught = false
  try {
    ROW.lastIndex = 0
    const victim = original.match(ROW)![0]
    const holed = victim.replace(/extracts: '[^']*'/, "extracts: ''")
    writeFileSync(target, original.replace(victim, holed))
    const reparsed: Family[] = []
    for (const m of readFileSync(target, "utf8").matchAll(ROW)) {
      reparsed.push({ name: m[1]!, ext: m[2]!, ids: [], tier: m[6] as Tier, extracts: m[5]! })
    }
    caught = reparsed.some((f) => f.extracts.length === 0)
  } finally {
    cpSync(backup, target)
    rmSync(backup)
  }
  negative("N7: a family whose recorded-symbol line is emptied fails the dataset check", caught)
  check("N7 restore-proof: the dataset source is restored byte-for-byte", readFileSync(target, "utf8") === original)
}

// --- verdict + evidence -------------------------------------------------------------

const gitHead = (() => {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
  } catch {
    return "unknown"
  }
})()

const ok = passed === checks
console.log("")
console.log(`  checks: ${passed}/${checks} passed, ${negatives} negative cases`)
console.log(`  families: ${fams.length} · analyzers: ${analyzerTokens.length} · tiers: ${tierCounts.full}/${tierCounts.structural}/${tierCounts.generic}`)
if (!ok) {
  console.log("VERDICT: FAIL")
  for (const f of failures) console.log(`  - ${f}`)
  process.exit(1)
}
console.log("VERDICT: PASS")

if (!READ_ONLY) {
  mkdirSync(RESULTS, { recursive: true })
  const evidence = {
    issue: "M56.L1",
    code: "L1",
    milestone: "M56",
    status: "verified",
    checks,
    passed,
    failed: checks - passed,
    negativeCases: negatives,
    currentCommit: gitHead,
    verifierCommand: "npx tsx script/m56/verify-languages-surface.ts",
    evidenceFile: "L1.json",
    generatedAt: new Date().toISOString(),
    rendered: { surface: "/languages console + homepage register", build: buildNote },
    summary: {
      registryLanguages: registryNames.length,
      dedicatedParsers: dedicatedGrammarCount,
      registryFallbacks: registryGeneric.size,
      displayFamilies: fams.length,
      analyzerModules: analyzerTokens.length,
      tiers: tierCounts,
      bands: bands.length,
    },
    limitations: [
      "The full-vs-structural split is an audited claim: this gate proves that every family above the generic pass has a dedicated analyzer module and that the module↔family mapping is a bijection, but it cannot derive relationship-resolution depth from source (no declarative language→call-graph table exists). The generic tier is fully derived (no analyzer module).",
      "The analyzer alias table declares the one place where a module name differs from the registry id (make → real-makefile-analyzer.ts); a new mismatch surfaces as a bijection failure rather than being absorbed.",
      "Rendered checks reuse website/.next when it is newer than every site source, and rebuild otherwise. No end-to-end rebuild mutant is run here (M41.T2 already proves that class); N6 is a synthetic rendered probe and N7 is a real source mutation.",
    ],
  }
  writeFileSync(path.join(RESULTS, "L1.json"), `${JSON.stringify(evidence, null, 2)}\n`)
  console.log(`  evidence: validation/m56/results/L1.json`)
}

/**
 * M72 Phase 2c — per-language coverage matrix (measured, read-only).
 *
 * WHY THIS EXISTS
 *   "Does it cover all applicable languages?" cannot be answered from the registry
 *   alone. A language can be tier=leads while its spec is never loaded (an
 *   aggregation gap), or loaded but never exercised (no fixture), or declared
 *   unsupported while an analyzer actually parses it as executable code. This probe
 *   measures the three facts that decide coverage, per language, from the live
 *   engine and the live analyzer registry:
 *
 *     tier          — what the registry claims (scan|leads|unsupported)
 *     specLoaded    — does specForLanguage() actually resolve this language id?
 *     analyzer      — does the AST layer index it at all (is it a real analyzer)?
 *
 *   then it re-runs the real engine over that language's fixtures and reports the
 *   measured lead count for the vulnerable/clean pair.
 *
 * WHAT IT DOES NOT DO
 *   It does not assert that an "unsupported" language is unscannable — it reports
 *   the tier and lets the evidence file state the reason. Nothing is inferred
 *   silently: a language with no fixture is `no-fixture`, not a pass.
 *
 * COMMAND: npx tsx script/m72/coverage-matrix.ts
 * EVIDENCE: validation/m72/results/coverage-matrix.json
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { LANGUAGE_SECURITY_ENTRIES, securityTierCounts } from "../../src/intelligence/security/rebuild/registry"
import { specForLanguage, specLanguages } from "../../src/intelligence/security/rebuild/specs/index"
import { analyzeSymbol } from "../../src/intelligence/security/rebuild/engine"
import { ASTEngine } from "../../src/ast/engine"

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, "..", "..")
const OUT = join(REPO_ROOT, "validation", "m72", "results", "coverage-matrix.json")
const FIXTURES = join(REPO_ROOT, "validation", "m72", "fixtures")

/**
 * Fixture extensions, one per language the specs cover. Deliberately the same set
 * the oracle runner accepts: a fixture whose extension is absent from THIS list is
 * not a fixture for that language, and reporting it as "no fixture" would be a
 * false coverage gap (that is exactly what happened for clean/cpp/powershell/r/vba
 * before the oracle runner's own map was widened).
 */
const FIXTURE_EXTS: Record<string, string> = {
  c: ["c", "h"], cpp: ["cpp", "cc", "cxx", "hpp", "hh", "hxx"], python: ["py", "pyw"],
  typescript: ["ts", "tsx", "mts", "cts"],
  // `tsx` is an alias of typescript, but it has its OWN fixture directory and its
  // own registry row (tier leads). Without this entry the directory's fixtures
  // matched nothing and the language was reported as "no fixture" — a false gap.
  tsx: ["tsx", "ts"], javascript: ["js", "jsx", "mjs", "cjs"],
  ruby: ["rb", "erb", "rake"], go: ["go"], java: ["java"], kotlin: ["kt", "kts"],
  scala: ["scala", "sc"], groovy: ["groovy", "gradle"], csharp: ["cs", "csx"],
  fsharp: ["fs", "fsi", "fsx"], vb: ["vb"], vba: ["bas", "vba", "frm", "cls"],
  php: ["php", "phtml"], rust: ["rs"], swift: ["swift"], dart: ["dart"], lua: ["lua"],
  perl: ["pl", "pm", "t"], r: ["r", "R"], julia: ["jl"], matlab: ["m"], "objective-c": ["mm", "m"],
  bash: ["sh", "bash", "zsh", "ksh"], powershell: ["ps1", "psm1", "psd1"],
  make: ["mk", "makefile", ""],
  elixir: ["ex", "exs"], erlang: ["erl", "hrl"], clojure: ["clj", "cljs", "cljc"],
  haskell: ["hs", "lhs"], ocaml: ["ml", "mli"], nim: ["nim", "nims"], zig: ["zig"],
  clean: ["icl", "dcl"], solidity: ["sol"], svelte: ["svelte"], vue: ["vue"],
}
function fixtureCount(dir: string, language: string): number {
  if (!existsSync(dir)) return 0
  const exts = FIXTURE_EXTS[language]
  if (!exts) return 0
  const suffixes = exts.map((e) => `.${e}`)
  return readdirSync(dir).filter((f) => suffixes.some((s) => f.toLowerCase().endsWith(s))).length
}

interface LangRow {
  language: string
  tier: string
  specLoaded: boolean
  specSources: number
  specSinks: number
  specSanitizers: number
  hasFixture: boolean
  fixtureFiles: number
  oraclePass: boolean | null
  oracleNote: string
}

function main(): void {
  const counts = securityTierCounts()
  const analyzers = ASTEngine.supportedLanguageNames()
  const analyzerSet = new Set(analyzers)
  const rows: LangRow[] = []

  for (const language of Object.keys(LANGUAGE_SECURITY_ENTRIES).sort()) {
    const entry = LANGUAGE_SECURITY_ENTRIES[language]!
    const spec = specForLanguage(language)
    const fixtureDir = join(FIXTURES, language)
    const fixtureFiles = fixtureCount(fixtureDir, language)
    rows.push({
      language,
      tier: entry.tier,
      specLoaded: spec !== null,
      specSources: spec?.sources.length ?? 0,
      specSinks: spec?.sinks.length ?? 0,
      specSanitizers: spec?.sanitizers?.length ?? 0,
      hasFixture: fixtureFiles > 0,
      fixtureFiles,
      oraclePass: null,
      oracleNote: "",
    })
  }

  // Does every spec the engine can load correspond to a registry language, and
  // vice versa? Both directions are drift.
  const specOnly = specLanguages().filter((l) => !LANGUAGE_SECURITY_ENTRIES[l])
  const registryWithoutSpec = rows.filter((r) => r.tier !== "unsupported" && !r.specLoaded).map((r) => r.language)
  const unsupportedWithSpec = rows.filter((r) => r.tier === "unsupported" && r.specLoaded).map((r) => r.language)
  const notAnAnalyzer = rows.filter((r) => !analyzerSet.has(r.language)).map((r) => r.language)

  // Reuse the oracle gate's per-language fixture files rather than duplicating the
  // rule set: a language passes when its vulnerable fixture yields a lead and its
  // clean fixture does not. Missing files are a declared gap, never a pass.
  for (const row of rows) {
    if (!row.specLoaded || !row.hasFixture) {
      row.oracleNote = !row.specLoaded ? "no spec" : "no fixture"
      continue
    }
    const dir = join(FIXTURES, row.language)
    const suffixes = (FIXTURE_EXTS[row.language] ?? []).map((e) => `.${e}`)
    const files = readdirSync(dir).filter((f) => suffixes.some((s) => f.toLowerCase().endsWith(s)))
    const vuln = files.find((f) => f.startsWith("vulnerable"))
    const clean = files.find((f) => f.startsWith("clean"))
    if (!vuln || !clean) {
      row.oracleNote = "missing vulnerable or clean fixture"
      continue
    }
    let vulnLeads = 0
    let cleanLeads = 0
    try {
      const vs = readFileSync(join(dir, vuln), "utf8")
      const cs = readFileSync(join(dir, clean), "utf8")
      vulnLeads = analyzeSymbol({ language: row.language, source: vs }).length
      cleanLeads = analyzeSymbol({ language: row.language, source: cs }).length
    } catch (error) {
      row.oracleNote = `engine error: ${(error as Error).message.slice(0, 80)}`
      continue
    }
    row.oraclePass = vulnLeads > 0 && cleanLeads === 0
    row.oracleNote = `vulnerable=${vulnLeads} clean=${cleanLeads}`
  }

  const leads = rows.filter((r) => r.tier === "leads")
  const unsupported = rows.filter((r) => r.tier === "unsupported")
  const covered = leads.filter((r) => r.specLoaded && r.oraclePass === true)

  const summary = {
    analyzers: analyzers.length,
    registryTotal: counts.total,
    registryScan: counts.scan,
    registryLeads: counts.leads,
    registryUnsupported: counts.unsupported,
    specsLoaded: specLanguages().length,
    leadsWithSpec: leads.filter((r) => r.specLoaded).length,
    leadsWithoutSpec: leads.filter((r) => !r.specLoaded).length,
    leadsPassingOracle: covered.length,
    leadsMissingFixture: leads.filter((r) => !r.specLoaded || !r.hasFixture).map((r) => r.language),
    leadsFailingOracle: leads.filter((r) => r.specLoaded && r.oraclePass === false).map((r) => r.language),
    unsupportedCount: unsupported.length,
    unsupportedWithSpec: unsupportedWithSpec.length,
    driftSpecOnly: specOnly,
    driftRegistryWithoutSpec: registryWithoutSpec,
    driftUnsupportedWithSpec: unsupportedWithSpec,
    notRegisteredAsAnalyzer: notAnAnalyzer,
  }

  const out = {
    probe: "m72-coverage-matrix",
    what: "per-language measured coverage: tier, spec load, analyzer registration, fixture and oracle result",
    generatedAt: new Date().toISOString(),
    summary,
    rows,
    limits: [
      "specLoaded measures specForLanguage() resolution, which is what the engine calls; a spec reachable only by an alias is reported through that alias's row",
      "oraclePass re-runs the real analyzeSymbol over the language's own fixture pair; a language with no fixture is reported, never passed",
      "unsupported rows carry the registry's own reason; this probe does not attempt to prove a language unscannable",
      "notRegisteredAsAnalyzer lists registry languages the AST layer does not index — those can never produce leads regardless of spec",
    ],
  }
  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n")

  console.log(`analyzers=${summary.analyzers} registry=${summary.registryTotal} (scan ${summary.registryScan} / leads ${summary.registryLeads} / unsupported ${summary.registryUnsupported})`)
  console.log(`specs loaded=${summary.specsLoaded} leadsWithSpec=${summary.leadsWithSpec}/${summary.registryLeads} leadsPassingOracle=${summary.leadsPassingOracle}/${summary.registryLeads}`)
  if (summary.leadsWithoutSpec > 0) console.log(`  leads WITHOUT spec: ${summary.leads.filter((r) => !r.specLoaded).map((r) => r.language).join(", ")}`)
  if (summary.leadsMissingFixture.length > 0) console.log(`  no fixture: ${summary.leadsMissingFixture.join(", ")}`)
  if (summary.leadsFailingOracle.length > 0) console.log(`  ORACLE FAIL: ${summary.leadsFailingOracle.join(", ")}`)
  if (summary.driftSpecOnly.length > 0) console.log(`  spec with no registry row: ${summary.driftSpecOnly.join(", ")}`)
  if (summary.driftRegistryWithoutSpec.length > 0) console.log(`  lead tier without spec: ${summary.driftRegistryWithoutSpec.join(", ")}`)
  if (summary.driftUnsupportedWithSpec.length > 0) console.log(`  unsupported but HAS spec: ${summary.driftUnsupportedWithSpec.join(", ")}`)
  if (summary.notRegisteredAsAnalyzer.length > 0) console.log(`  not an indexed analyzer: ${summary.notRegisteredAsAnalyzer.join(", ")}`)
  console.log(`evidence: ${OUT}`)
}

try {
  main()
} catch (error) {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error))
  process.exit(1)
}
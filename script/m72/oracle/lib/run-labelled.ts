// ─────────────────────────────────────────────────────────────────────────────
// M72 Phase 2b-3a — labelled-fixture runner (crafted corpus, both classes).
//
// WHAT THIS FILE IS — the measurement harness for the labelled fixture corpus
//   under `validation/m72/oracle/fixtures/<family>/`. Each family holds
//   vulnerable files (the engine SHOULD produce a lead) and safe files (it MUST
//   NOT), plus an `expected.json` that names the expectation per file, so the
//   runner never parses prose.
//
// WHY IT EXISTS — the real corpora produced 9 leads total (PHASE-2B.md), which
//   cannot support a precision figure: there is no labelled SAFE denominator.
//   Crafted fixtures give BOTH classes, so a denominator exists for the first
//   time. THE NUMBER IT PRINTS IS A **FIXTURE** PRECISION OVER HAND-WRITTEN
//   FILES. It is NOT a corpus precision and must never be quoted as one.
//
// HOW IT RUNS THE ENGINE — two measurements per file, and it prints both:
//   1. `whole-file`: `analyzeSymbol` over the entire file body. This measures
//      the RULES (source/sink/sanitizer regexes over masked text).
//   2. `per-symbol`: the real production path — `parseFile` from
//      `src/ast/pool-worker.ts` splits the file into symbols exactly as the
//      indexer does, then `analyzeSymbol` runs over each executable symbol BODY
//      (containers skipped, `SECURITY_ENGINE_BODY_LIMIT` respected). This is the
//      measurement that predicts what the indexer would actually store.
//   A file PASSES when the per-symbol measurement meets its expectation, because
//   that is the production behaviour; the whole-file column is printed beside it
//   so a divergence between "the rules can see it" and "the indexer would store
//   it" is visible rather than hidden.
//
// WHAT THIS FILE IS NOT — it is not a gate (`script/m72/verify-*.ts` belongs to
//   gates-matrix), it does not modify the engine, any spec, or any fixture, and
//   it never treats a missing expectation as a pass: a source file with no
//   `expected.json` entry is an ERROR row.
//
// CONTRACT IT MUST NOT BREAK — exits non-zero when any family has fewer than
//   `MIN_PER_CLASS` files in either class, when any file misses its expectation,
//   or when any file cannot be evaluated. Totals are always printed.
//
// COMMAND: npx tsx script/m72/oracle/lib/run-labelled.ts [--family=<name>]
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
/** `script/m72/oracle/lib` → repo root is four levels up. */
const ROOT = resolve(HERE, "..", "..", "..", "..")
const FIXTURES = join(ROOT, "validation", "m72", "oracle", "fixtures")
const ENGINE_MODULE = resolve(ROOT, "src", "intelligence", "security", "rebuild", "engine.ts")
const POOL_WORKER_MODULE = resolve(ROOT, "src", "ast", "pool-worker.ts")

/** A family needs at least this many files in EACH class to be measurable. */
export const MIN_PER_CLASS = 8

/**
 * File extensions this runner knows how to hand to the engine.
 *
 * MEASURED DEFECT THIS MAP HAD: it listed 7 extensions, so every fixture whose
 * extension was absent (`.rs`, `.swift`, `.icl`, `.ps1`, `.R`, `.bas`, `.ex`,
 * `.erl`, `.clj`, `.hs`, `.ml`, `.fs`, `.kt`, `.cs`, `.php`, `.lua`, `.pl`,
 * `.pm`, `.dart`, `.scala`, `.groovy`, `.jl`, `.m`, `.mm`, `.sol`, `.nim`,
 * `.zig`, `.vb`, `.svelte`, `.vue`, …) was dropped by the `languageFor(f) !== ""`
  * filter BEFORE scoring — a silent exclusion that under-reported the corpus
 * (the 150-file total never contained any of them). The map is now derived from
 * the same extension set the specs and the fixture gate use, so a fixture file
 * cannot be excluded from its own family's score.
 */
const LANGUAGE_BY_EXT: Record<string, string> = {
  ".c": "c",
  ".h": "c",
  ".cpp": "cpp",
  ".cc": "cpp",
  ".cxx": "cpp",
  ".hpp": "cpp",
  ".hh": "cpp",
  ".hxx": "cpp",
  ".py": "python",
  ".pyw": "python",
  ".ts": "typescript",
  ".tsx": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".rb": "ruby",
  ".erb": "ruby",
  ".rake": "ruby",
  ".gemspec": "ruby",
  ".go": "go",
  ".java": "java",
  ".kt": "kotlin",
  ".kts": "kotlin",
  ".scala": "scala",
  ".sc": "scala",
  ".groovy": "groovy",
  ".gradle": "groovy",
  ".cs": "csharp",
  ".csx": "csharp",
  ".fs": "fsharp",
  ".fsi": "fsharp",
  ".fsx": "fsharp",
  ".vb": "vb",
  ".bas": "vba",
  ".vba": "vba",
  ".frm": "vba",
  ".cls": "vba",
  ".php": "php",
  ".phtml": "php",
  ".rs": "rust",
  ".swift": "swift",
  ".dart": "dart",
  ".lua": "lua",
  ".pl": "perl",
  ".pm": "perl",
  ".t": "perl",
  ".pod": "perl",
  ".r": "r",
  ".R": "r",
  ".jl": "julia",
  ".m": "matlab",
  ".matlab": "matlab",
  ".mm": "objective-c",
  ".objc": "objective-c",
  ".sh": "bash",
  ".bash": "bash",
  ".zsh": "bash",
  ".ksh": "bash",
  ".ps1": "powershell",
  ".psm1": "powershell",
  ".psd1": "powershell",
  ".ex": "elixir",
  ".exs": "elixir",
  ".erl": "erlang",
  ".hrl": "erlang",
  ".clj": "clojure",
  ".cljs": "clojure",
  ".cljc": "clojure",
  ".hs": "haskell",
  ".lhs": "haskell",
  ".ml": "ocaml",
  ".mli": "ocaml",
  ".nim": "nim",
  ".nims": "nim",
  ".zig": "zig",
  ".icl": "clean",
  ".dcl": "clean",
  ".sol": "solidity",
  ".svelte": "svelte",
  ".vue": "vue",
}

/** Symbol kinds the production worker skips (containers duplicate their members). */
const CONTAINER_KINDS = new Set(["class", "module", "interface", "namespace"])

interface Expectation {
  file: string
  expect: "lead" | "none"
  vulnerability?: string
  ruleHint?: string
  reason?: string
}

interface FileResult {
  family: string
  file: string
  language: string
  expect: "lead" | "none"
  /** Lead rule ids from the whole-file run. */
  wholeFileRules: string[]
  /** Lead rule ids from the per-symbol (production-path) run. */
  perSymbolRules: string[]
  status: "PASS" | "FAIL" | "ERROR"
  detail: string
}

interface FamilyTotals {
  family: string
  n: number
  vulnerable: number
  safe: number
  truePositives: number
  falsePositives: number
  falseNegatives: number
  errors: number
}

function languageFor(file: string): string {
  const dot = file.lastIndexOf(".")
  return dot < 0 ? "" : (LANGUAGE_BY_EXT[file.slice(dot).toLowerCase()] ?? "")
}

interface SymbolBody {
  name: string
  kind: string
  body: string
}

/**
 * Split one file into executable symbol bodies using the REAL production parser
 * (`parseFile` from the pool worker), then apply the same container skip and body
 * bound the indexer applies. Returns `[]` when the parser cannot read the file —
 * the caller declares that as an ERROR rather than silently scoring it as clean.
 */
async function symbolBodies(path: string, source: string): Promise<SymbolBody[]> {
  const { parseFile } = await import(POOL_WORKER_MODULE)
  let parsed: any
  try {
    parsed = await parseFile(path, ROOT)
  } catch {
    return []
  }
  const symbols: any[] = Array.isArray(parsed?.symbols) ? parsed.symbols : []
  const out: SymbolBody[] = []
  for (const symbol of symbols) {
    const kind = String(symbol?.kind ?? symbol?.type ?? "").toLowerCase()
    if (CONTAINER_KINDS.has(kind)) continue
    const start = symbol?.range?.startIndex ?? symbol?.startIndex
    const end = symbol?.range?.endIndex ?? symbol?.endIndex
    if (typeof start !== "number" || typeof end !== "number" || end <= start) continue
    if (end - start > 20000) continue // SECURITY_ENGINE_BODY_LIMIT in the worker
    const body = source.slice(start, end)
    if (!body) continue
    out.push({ name: String(symbol?.name ?? "<anonymous>"), kind, body })
  }
  return out
}

async function main(): Promise<number> {
  const { analyzeSymbol } = await import(ENGINE_MODULE)
  const onlyArg = process.argv.find((a) => a.startsWith("--family="))
  const only = onlyArg ? onlyArg.slice("--family=".length) : null

  if (!existsSync(FIXTURES)) {
    console.error(`fixtures directory is missing: ${FIXTURES}`)
    return 1
  }

  const families = readdirSync(FIXTURES, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((name) => (only ? name === only : true))
    .sort()

  if (families.length === 0) {
    console.error(`no families matched${only ? ` (family=${only})` : ""} under ${FIXTURES}`)
    return 1
  }

  const results: FileResult[] = []
  const totals: FamilyTotals[] = []

  for (const family of families) {
    const dir = join(FIXTURES, family)
    const expectedPath = join(dir, "expected.json")

    // ── expectations: a family without a machine-readable file is an error ──
    let expectations: Expectation[] = []
    if (!existsSync(expectedPath)) {
      console.error(`${family}: expected.json is MISSING — cannot score the family`)
      totals.push({ family, n: 0, vulnerable: 0, safe: 0, truePositives: 0, falsePositives: 0, falseNegatives: 0, errors: 1 })
      continue
    }
    try {
      const parsed = JSON.parse(readFileSync(expectedPath, "utf8"))
      expectations = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.files) ? parsed.files : []
    } catch (error) {
      console.error(`${family}: expected.json is not valid JSON (${(error as Error).message})`)
      totals.push({ family, n: 0, vulnerable: 0, safe: 0, truePositives: 0, falsePositives: 0, falseNegatives: 0, errors: 1 })
      continue
    }
    const byFile = new Map(expectations.map((e) => [e.file, e]))

    // An expected entry whose file is not on disk is an error, not a skip.
    for (const exp of expectations) {
      if (!existsSync(join(dir, exp.file))) {
        console.error(`${family}: expected.json names a missing file: ${exp.file}`)
      }
    }

    const allFiles = readdirSync(dir).filter((f) => !f.startsWith(".") && f !== "expected.json" && !f.endsWith(".md"))
    // Any file the runner cannot map to a language is a DECLARED error rather than
    // a silent skip: the old `.filter(languageFor != "")` dropped every
    // unrecognised extension from its own family's score.
    const unmapped = allFiles.filter((f) => languageFor(f) === "" && /\.[A-Za-z0-9]+$/.test(f))
    if (unmapped.length > 0) {
      console.error(`${family}: ${unmapped.length} fixture file(s) with an unmapped extension are EXCLUDED FROM SCORING: ${unmapped.slice(0, 6).join(", ")}`)
    }

    const files = allFiles
      .filter((f) => languageFor(f) !== "")
      .sort()

    const familyResults: FileResult[] = []
    for (const file of files) {
      const language = languageFor(file)
      const path = join(dir, file)
      const source = readFileSync(path, "utf8")
      const exp = byFile.get(file)
      if (!exp) {
        familyResults.push({ family, file, language, expect: "none", wholeFileRules: [], perSymbolRules: [], status: "ERROR", detail: "no expected.json entry" })
        continue
      }

      // 1. whole-file rule measurement.
      let wholeFileRules: string[] = []
      try {
        wholeFileRules = analyzeSymbol({ language, source, file }).map((l: any) => l.ruleId)
      } catch (error) {
        familyResults.push({ family, file, language, expect: exp.expect, wholeFileRules: [], perSymbolRules: [], status: "ERROR", detail: `engine threw (whole-file): ${(error as Error).message}` })
        continue
      }

      // 2. per-symbol production-path measurement. One pass collects the rule ids
      //    and the vulnerabilities together, so the check below needs no second run.
      const bodies = await symbolBodies(path, source)
      const perSymbolRules: string[] = []
      const perSymbolVulns = new Set<string>()
      let engineError: string | null = null
      try {
        for (const symbol of bodies) {
          for (const lead of analyzeSymbol({ language, source: symbol.body, file, symbolId: symbol.name }) as any[]) {
            perSymbolRules.push(lead.ruleId)
            perSymbolVulns.add(lead.vulnerability)
          }
        }
      } catch (error) {
        engineError = `engine threw (per-symbol): ${(error as Error).message}`
      }
      if (engineError) {
        familyResults.push({ family, file, language, expect: exp.expect, wholeFileRules, perSymbolRules: [], status: "ERROR", detail: engineError })
        continue
      }

      const unique = (xs: string[]) => [...new Set(xs)]
      const expectedLead = exp.expect === "lead"
      const gotLead = perSymbolRules.length > 0
      // The per-symbol measurement decides, because that is what the indexer stores.
      let status: FileResult["status"]
      let detail: string
      if (bodies.length === 0) {
        status = "ERROR"
        detail = "parser produced no executable symbol body"
      } else if (expectedLead !== gotLead) {
        status = "FAIL"
        detail = expectedLead
          ? `expected a lead, per-symbol run produced none (whole-file: ${unique(wholeFileRules).join(",") || "none"})`
          : `expected none, per-symbol run produced ${unique(perSymbolRules).join(",")}`
      } else if (expectedLead) {
        if (exp.vulnerability && !perSymbolVulns.has(exp.vulnerability)) {
          status = "FAIL"
          detail = `wrong vulnerability: expected ${exp.vulnerability}, got ${[...perSymbolVulns].join(",") || "none"}`
        } else if (exp.ruleHint && !perSymbolRules.includes(exp.ruleHint)) {
          status = "FAIL"
          detail = `expected rule ${exp.ruleHint}, got ${unique(perSymbolRules).join(",")}`
        } else {
          status = "PASS"
          detail = `lead ok (${unique(perSymbolRules).join(",")})`
        }
      } else {
        status = "PASS"
        detail = "correctly no lead"
      }

      familyResults.push({
        family,
        file,
        language,
        expect: exp.expect,
        wholeFileRules: unique(wholeFileRules),
        perSymbolRules: unique(perSymbolRules),
        status,
        detail,
      })
    }

    results.push(...familyResults)

    const vulnerable = familyResults.filter((r) => r.expect === "lead").length
    const safe = familyResults.filter((r) => r.expect === "none").length
    const truePositives = familyResults.filter((r) => r.expect === "lead" && r.status === "PASS").length
    const falseNegatives = familyResults.filter((r) => r.expect === "lead" && r.status === "FAIL").length
    const falsePositives = familyResults.filter((r) => r.expect === "none" && r.status === "FAIL").length
    const errors = familyResults.filter((r) => r.status === "ERROR").length
    totals.push({ family, n: familyResults.length, vulnerable, safe, truePositives, falsePositives, falseNegatives, errors })
  }

  // ── per-file table ────────────────────────────────────────────────────────
  console.log("M72 Phase 2b-3a — labelled fixture run over CRAFTED files (a FIXTURE precision, NOT a corpus precision)")
  console.log("")
  console.log("family | file | expect | whole-file rule ids | per-symbol rule ids | status | detail")
  for (const r of results) {
    console.log(
      `${r.family} | ${r.file} | ${r.expect} | ${r.wholeFileRules.join(",") || "-"} | ${r.perSymbolRules.join(",") || "-"} | ${r.status} | ${r.detail}`,
    )
  }

  // ── per-family totals ─────────────────────────────────────────────────────
  console.log("")
  console.log("family | n | vulnerable | safe | truePositives | falsePositives | falseNegatives | errors")
  for (const t of totals) {
    console.log(`${t.family} | ${t.n} | ${t.vulnerable} | ${t.safe} | ${t.truePositives} | ${t.falsePositives} | ${t.falseNegatives} | ${t.errors}`)
  }

  const sum = totals.reduce(
    (a, t) => ({
      n: a.n + t.n,
      vulnerable: a.vulnerable + t.vulnerable,
      safe: a.safe + t.safe,
      tp: a.tp + t.truePositives,
      fp: a.fp + t.falsePositives,
      fn: a.fn + t.falseNegatives,
      errors: a.errors + t.errors,
    }),
    { n: 0, vulnerable: 0, safe: 0, tp: 0, fp: 0, fn: 0, errors: 0 },
  )

  console.log("")
  console.log(
    `OVERALL n=${sum.n} vulnerable=${sum.vulnerable} safe=${sum.safe} truePositives=${sum.tp} falsePositives=${sum.fp} falseNegatives=${sum.fn} errors=${sum.errors}`,
  )
  const denom = sum.tp + sum.fp
  if (denom > 0) {
    console.log(`fixture precision = TP/(TP+FP) = ${sum.tp}/${denom} = ${((sum.tp / denom) * 100).toFixed(1)}%`)
  } else {
    console.log("fixture precision: not computable (no predicted positives)")
  }
  console.log(
    "This is a FIXTURE precision over hand-written files. It is NOT a corpus precision and must not be reported as one.",
  )

  // ── failure conditions ────────────────────────────────────────────────────
  const problems: string[] = []
  for (const t of totals) {
    if (t.n === 0 && t.errors > 0) {
      problems.push(`${t.family}: family could not be scored (see the error above)`)
      continue
    }
    if (t.vulnerable < MIN_PER_CLASS) problems.push(`${t.family}: only ${t.vulnerable} vulnerable file(s), need ${MIN_PER_CLASS}`)
    if (t.safe < MIN_PER_CLASS) problems.push(`${t.family}: only ${t.safe} safe file(s), need ${MIN_PER_CLASS}`)
    if (t.errors > 0) problems.push(`${t.family}: ${t.errors} file(s) could not be evaluated`)
  }
  for (const r of results.filter((x) => x.status === "FAIL")) {
    problems.push(`${r.family}/${r.file}: ${r.detail}`)
  }

  if (problems.length > 0) {
    console.log("")
    console.log(`LABELLED FIXTURES: FAIL (${problems.length} problem(s))`)
    for (const p of problems.slice(0, 60)) console.log(`  - ${p}`)
    return 1
  }
  console.log("")
  console.log(`LABELLED FIXTURES: PASS — ${totals.length} families, ${sum.n} files, ${sum.tp} TP / ${sum.fp} FP / ${sum.fn} FN`)
  return 0
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(error)
    process.exit(1)
  },
)
/**
 * THE PRICE OF THE TWO POPULATIONS PRODUCTION NEVER READS.
 *
 * `validation/m14/fixtures/graphql/store-binding-truth.mts` charged the 254 files that never reached the
 * store to the rules that refused them. Two of those rules are PRODUCT decisions, not this lane's, and a
 * decision needs a number rather than a feeling:
 *
 *   arm A — 97 corpus files end in `.graphqls`, and `language-detection.ts` maps `graphql` and `gql` and
 *           nothing else, so no part of the fleet routes the extension anywhere. One line in that map
 *           would admit them. What is the line worth?
 *   arm B — 156 corpus `.graphql` files sit under a `testdata/` segment and are refused by the built-in
 *           ignore glob `testData/` (with the usual leading glob wildcards), which the `ignore` package
 *           (5.3.2) matches CASE-INSENSITIVELY,
 *           so a rule written for Azure-style `testData/` swallows the far more common lowercase spelling.
 *           Narrowing the glob to the two spellings it means to catch would admit them. What is THAT worth?
 *
 * WHAT THIS MEASURES, and what it deliberately does not: it parses both populations through production
 * `parseFile` and reports symbols, relationships BY TYPE, and any degraded/fallback result. It is a PRICE,
 * not a verdict — neither change is this lane's to make, and arm A moves the arbiter's own corpus for this
 * language (the gate selects files with `detectLanguageFromPath`), so the number is what a decision needs.
 */
import { execFileSync } from "node:child_process"
import { copyFileSync, mkdtempSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { parseFile } from "../../../../src/ast/pool-worker"

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..", "..")
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const CAP = 1024 * 1024
const OUT = process.env.BB_UPP_OUT ?? `${REPO_ROOT}/validation/m14/fixtures/graphql/unrouted-population-price.json`
const TEST_SEGMENTS = ["test", "tests", "__tests__", "spec", "specs", "e2e", "testdata"]

type Row = { repo: string; rel: string; abs: string }
const rows: Row[] = []
for (const name of readdirSync(CR).sort()) {
  const dir = path.join(CR, name)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch {
    continue
  }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
  } catch {
    continue
  }
  for (const rel of tracked) {
    if (!/\.(graphql|graphqls|gql)$/i.test(rel)) continue
    const abs = path.join(dir, rel)
    try {
      if (statSync(abs).size > CAP) continue
    } catch {
      continue
    }
    rows.push({ repo: name, rel: rel.split(path.sep).join("/"), abs })
  }
}

const hasSegment = (rel: string, seg: string) => rel.split("/").some((s) => s.toLowerCase() === seg)
const arms = {
  A_unroutedExtension: rows.filter((r) => /\.graphqls$/i.test(r.rel)),
  B_testdataSegment: rows.filter((r) => !/\.graphqls$/i.test(r.rel) && hasSegment(r.rel, "testdata")),
}
const B_noTestSegment = rows.filter((r) => !/\.graphqls$/i.test(r.rel) && !TEST_SEGMENTS.some((s) => hasSegment(r.rel, s)))

type Arm = {
  files: number
  parsed: number
  degraded: number
  symbols: number
  relationships: number
  byType: Record<string, number>
  zeroYieldFiles: number
  failures: string[]
}
const measure = async (list: Row[]): Promise<Arm> => {
  const arm: Arm = { files: list.length, parsed: 0, degraded: 0, symbols: 0, relationships: 0, byType: {}, zeroYieldFiles: 0, failures: [] }
  for (const f of list) {
    try {
      const r: any = await parseFile(f.abs, path.dirname(f.abs))
      if (r?.fallback === true || r?.metadata?.analysisVersion === "2.0-basic-fallback") arm.degraded++
      else arm.parsed++
      const syms = (r?.symbols ?? []).length
      const rels = (r?.relationships ?? []) as any[]
      arm.symbols += syms
      arm.relationships += rels.length
      if (syms === 0 && rels.length === 0) arm.zeroYieldFiles++
      for (const x of rels) {
        const t = String(x?.type ?? x?.relationshipType ?? "").toLowerCase()
        arm.byType[t] = (arm.byType[t] ?? 0) + 1
      }
    } catch (e: any) {
      arm.failures.push(`${f.repo}/${f.rel}: ${e?.message ?? e}`)
    }
  }
  return arm
}

const A = await measure(arms.A_unroutedExtension)
const B = await measure(arms.B_testdataSegment)
const control = await measure(B_noTestSegment.slice(0, 250))

// ARM A CANNOT BE PRICED WHERE IT SITS, and that is the finding rather than a gap in the instrument:
// `parseFile` derives the language from the path, and an unmapped extension does not fail loudly — it
// lands in `pool-worker`'s catch, returns `extractFallback`'s REGEX result, and reports `degraded`. Measured
// above: all 97 files "degraded", 0 symbols, 0 relationships. So the map entry is not worth N edges; it is
// the PRECONDITION for those files being readable at all. What the analyzer DOES with the same content is
// measurable without touching production: copy each file to a temp dir under a `.graphql` name and parse it
// there, which is the same tree handed to the same analyzer through a routed extension.
const probeRoot = mkdtempSync(path.join(tmpdir(), "bb-gql-price-"))
const routed: Row[] = []
for (let i = 0; i < arms.A_unroutedExtension.length; i++) {
  const src = arms.A_unroutedExtension[i]
  const dest = path.join(probeRoot, `${String(i).padStart(3, "0")}.graphql`)
  copyFileSync(src.abs, dest)
  routed.push({ repo: src.repo, rel: `${src.rel} (probed as .graphql)`, abs: dest })
}
const A2 = await measure(routed)

const report = {
  schemaVersion: 1,
  kind: "m60-graphql-unrouted-population-price",
  generatedAt: new Date().toISOString(),
  producedBy: "validation/m14/fixtures/graphql/unrouted-population-price.mts",
  note: "A PRICE, not a ruling: arm A's fix is not this lane's to make, and arm A changes the arbiter's own file selection for this language. Arm B's rule was FIXED mid-session (1c530e78b) — see its `status`.",
  armA: { rule: "language-detection.ts routes no extension to the graphql analyzer for `.graphqls` (it maps `graphql` and `gql`)", fix: "one entry in that map", ...A },
  armA2_routedCopy: {
    rule: "the same 97 files copied to a `.graphql` name and parsed again — what the analyzer yields once the extension is routed",
    caveat: "a temp-dir copy is not the real run: cross-file resolution, project-relative paths and the store all differ, so this is the analyzer's yield on the CONTENT, not the store's edge count",
    ...A2,
  },
  armB: {
    rule: "built-in ignore glob `testData/` in discoverAndFilterFiles, matched case-insensitively by the `ignore` package so it swallowed lowercase `testdata/`",
    fix: "`ignorecase: false` at the four construction sites — LANDED as 1c530e78b while this lane was measuring, after this lane's 156-file measurement was published",
    status: "FIXED — the store probe's post-fix run admits these files (1,754 -> 1,909 files, 257,279 -> 261,745 relationship rows). The numbers below are what the analyzer yields on the CONTENT, which the fix does not change: they are the price that got it fixed, not a remaining refusal",
    ...B,
  },
  control: {
    rule: "corpus `.graphql`/`.gql` files under NO test-shaped segment: the population production DOES read",
    sampled: control.files,
    ...control,
  },
}
writeFileSync(OUT, JSON.stringify(report, null, 2) + "\n")

const line = (label: string, a: Arm) =>
  `${label}: ${a.files} files · parsed ${a.parsed} · degraded ${a.degraded} · ${a.symbols} symbols · ${a.relationships} relationships · ${a.zeroYieldFiles} yield nothing` +
  `\n    by type: ${JSON.stringify(Object.fromEntries(Object.entries(a.byType).sort((x, y) => y[1] - x[1])))}` +
  (a.failures.length ? `\n    failures: ${a.failures.slice(0, 3).join(" | ")}` : "")
console.log("graphql — the price of the two populations production never reads\n")
console.log(line("A  .graphqls (no extension map)", A))
console.log(line("A2 same 97 files, copied to .graphql and reparsed", A2))
console.log(line("B  .graphql under testdata/ (case-folded ignore glob)", B))
console.log(line("C  control — no test-shaped segment (production reads these)", control))
console.log(`\nartefact: ${path.relative(REPO_ROOT, OUT)}`)

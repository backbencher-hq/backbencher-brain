/**
 * PHP SILENT-TYPE CENSUS — is `exports` / `overrides` MISSING, or is the SAMPLE missing them?
 *
 * ## The claim this instrument exists to test
 *
 * `bun script/m14/firing-check.mjs PHP` prints, over a 120-file sample:
 *
 *     PHP  8 types fired  120/120 parsed
 *        calls:2150 contains:1033 extends:4 implements:87 imports:705 instantiates:72 references:441 uses:4786
 *        SILENT (constructible but produced nothing): exports overrides
 *
 * The instrument's file selection is a DEPTH-FIRST PREFIX (`pickFiles`: walk, take the first
 * N, cap 400). phpunit's first entries are `tools/.phpstan/vendor/**`, so the 400-file
 * ceiling is 300 vendored PHPStan files + 99 `src/` files and never reaches `tests/`. Both
 * silent labels are implemented in the analyzer and their emissions live in `tests/` and in
 * other repositories entirely — so "SILENT" here can mean three different things and the
 * instrument cannot tell them apart:
 *
 *   (i)  NOT IMPLEMENTED — no emission path exists;
 *   (ii) IMPLEMENTED, and the sample contains NO APPLICABLE SITE — silence is CORRECT;
 *   (iii)IMPLEMENTED, and the sample contains applicable sites the analyzer misses — a defect.
 *
 * ## What is measured, on which side
 *
 * The NUMERATOR is the instrument's own path (`getParser` -> `parse` -> `new Cls().analyze`),
 * not `parseFile`, so the number is the one the instrument would print.
 *
 * The DENOMINATOR is the TREE, through the lane's registered oracles
 * (`derivePhpExportsTruth`, `derivePhpOverridesTruth`) — independent implementations that
 * share no code with the analyzer, so "the analyzer emits what is there" is not a
 * self-agreement. For every file the tool reports: applicable sites, emitted edges, and the
 * difference in BOTH directions.
 *
 * Both are measured over (a) the instrument's own sample at NFILES and (b) the whole phpunit
 * corpus, because the difference between those two rows IS the answer.
 *
 * Run: npx tsx validation/m14/fixtures/php/silent-type-census.mts [NFILES]
 */
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { getParser } from "../../../../src/ast/engine"
import { derivePhpExportsTruth } from "../../../../script/m14/oracles/php-exports"
import { derivePhpOverridesTruth } from "../../../../script/m14/oracles/php-overrides"

const ROOT = process.cwd()
const dir = process.env.BB_PHP_CORPUS ?? "/home/ishaq2321/bb_tests/repositories/phpunit"
const NFILES = Number(process.argv[2] ?? 120)

/** The instrument's own selection, copied VERBATIM from `script/m14/firing-check.mjs:pickFiles`
 *  as it stands at this commit — a probe may not edit the arbiter, so the rule is reproduced and
 *  the sample's first/last entries are printed for a reader to check.
 *
 *  THE RULE CHANGED UNDER THIS PROBE and the change is the point: it used to return the first N
 *  files in directory order, which on this corpus is 300 vendored PHPStan files and never
 *  `tests/`; it now walks a bounded population, SORTS it and strides EVENLY, so the sample is
 *  representative of the corpus by construction. A probe that kept the old rule would be
 *  measuring a sample the arbiter no longer takes. */
function pickFiles(dir: string, exts: string[], want: number, cap = 400): string[] {
  const POP_CAP = Number(process.env.BB_SAMPLE_POP || 20000)
  const all: string[] = []
  const walk = (d: string, depth: number) => {
    if (all.length >= POP_CAP || depth > 20) return
    let ents; try { ents = readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of ents) {
      if (all.length >= POP_CAP) return
      const p = join(d, e.name)
      if (e.isDirectory()) { if (!/node_modules|\.git/.test(e.name)) walk(p, depth + 1) }
      else if (exts.some((x) => e.name.endsWith(x))) {
        try { if (statSync(p).size < 400_000) all.push(p) } catch {}
      }
    }
  }
  walk(dir, 0)
  all.sort()
  if (all.length <= want) return all.slice(0, cap)
  const stride = all.length / want
  const out: string[] = []
  for (let i = 0; i < want; i++) out.push(all[Math.floor(i * stride)])
  return [...new Set(out)].slice(0, cap)
}

/** EVERY `.php` file in the corpus, same size rule the instrument's `pickFiles` applies. */
function allFiles(d: string, exts: string[], cap = 400_000): string[] {
  const out: string[] = []
  const walk = (dd: string, depth: number) => {
    if (depth > 20) return
    let ents; try { ents = readdirSync(dd, { withFileTypes: true }) } catch { return }
    for (const e of ents) {
      const p = join(dd, e.name)
      if (e.isDirectory()) { if (!/node_modules|\.git/.test(e.name)) walk(p, depth + 1) }
      else if (exts.some((x) => e.name.endsWith(x))) {
        try { if (statSync(p).size < cap) out.push(p) } catch {}
      }
    }
  }
  walk(d, 0); return out
}

const { RelationshipType } = await import("../../../../src/ast/types")
const ALL = [...new Set(Object.values(RelationshipType))] as string[]
const mod: any = await import("../../../../src/ast/real-php-analyzer")
const Cls = Object.values(mod).find((v: any) => typeof v === "function" && /Analyzer$/.test(v.name)) as any

type Row = {
  files: number; parsed: number
  tally: Map<string, number>
  exportsTruth: number; exportsEmit: number
  overridesTruth: number; overridesEmit: number
  exportsFiles: string[]; overridesFiles: string[]
  exportsMissed: string[]; overridesMissed: string[]
}

async function sweep(files: string[], label: string): Promise<Row> {
  const row: Row = {
    files: files.length, parsed: 0, tally: new Map(),
    exportsTruth: 0, exportsEmit: 0, overridesTruth: 0, overridesEmit: 0,
    exportsFiles: [], overridesFiles: [], exportsMissed: [], overridesMissed: [],
  }
  for (const f of files) {
    let content: string
    try { content = readFileSync(f, "utf8") } catch { continue }
    const parser = await getParser("php")
    const pr: any = await parser.parse(content, f)
    const root = pr.rootNode
    const res: any = new Cls().analyze(root, content, f)
    row.parsed++
    for (const r of res.relationships ?? []) {
      const t = r.relationshipType ?? r.type
      if (t) row.tally.set(t, (row.tally.get(t) ?? 0) + 1)
    }
    const rel = (res.relationships ?? []).filter((r: any) => (r.relationshipType ?? r.type) === "exports")
    const ovr = (res.relationships ?? []).filter((r: any) => (r.relationshipType ?? r.type) === "overrides")
    const expT = derivePhpExportsTruth(root)
    const ovrT = derivePhpOverridesTruth(root)
    row.exportsTruth += expT.length
    row.exportsEmit += rel.length
    row.overridesTruth += ovrT.length
    row.overridesEmit += ovr.length
    if (expT.length) row.exportsFiles.push(`${f.replace(dir + "/", "")}(${expT.length})`)
    if (ovrT.length) row.overridesFiles.push(`${f.replace(dir + "/", "")}(${ovrT.length})`)
    // MISSED = the tree says there is a site and the analyzer emitted nothing for that target.
    const emitted = new Set(rel.map((r: any) => String(r.target)))
    for (const t of expT) if (!emitted.has(String(t.target))) row.exportsMissed.push(`${f.replace(dir + "/", "")}:${t.target}`)
    const emittedO = new Set(ovr.map((r: any) => String(`${r.source}.${r.target}`)))
    for (const t of ovrT) {
      const key = `${t.from}.${t.target}`
      if (!emittedO.has(key) && ![...emittedO].some((k) => k.endsWith(`.${t.target}`))) {
        row.overridesMissed.push(`${f.replace(dir + "/", "")}:${key}`)
      }
    }
  }
  void label
  return row
}

function report(label: string, row: Row) {
  const fired = [...row.tally.entries()].filter(([, n]) => n > 0).map(([t]) => t).sort()
  const silent = ALL.filter((t) => !fired.includes(t))
  console.log(`\n=== ${label} (${row.parsed}/${row.files} parsed) ===`)
  console.log(`fired ${fired.length} types: ${fired.map((t) => `${t}:${row.tally.get(t)}`).join("  ")}`)
  console.log(`SILENT: ${silent.join(" ") || "(none)"}`)
  console.log(`  exports    tree(applies) ${row.exportsTruth}   instrument(emits) ${row.exportsEmit}   MISSED ${row.exportsMissed.length}` +
    (row.exportsFiles.length ? `   applicable files: ${row.exportsFiles.slice(0, 6).join(" ")}${row.exportsFiles.length > 6 ? ` (+${row.exportsFiles.length - 6})` : ""}` : "   applicable files: NONE"))
  console.log(`  overrides  tree(applies) ${row.overridesTruth}   instrument(emits) ${row.overridesEmit}   MISSED ${row.overridesMissed.length}` +
    (row.overridesFiles.length ? `   applicable files: ${row.overridesFiles.slice(0, 6).join(" ")}${row.overridesFiles.length > 6 ? ` (+${row.overridesFiles.length - 6})` : ""}` : "   applicable files: NONE"))
  if (row.exportsMissed.length) console.log(`    exports MISSED: ${row.exportsMissed.slice(0, 10).join(" ")}`)
  if (row.overridesMissed.length) console.log(`    overrides MISSED: ${row.overridesMissed.slice(0, 10).join(" ")}`)
}

const sample = pickFiles(dir, [".php"], NFILES)
console.log(`corpus ${dir}`)
console.log(`instrument sample: ${sample.length} files; first ${sample[0]?.replace(dir + "/", "")}; last ${sample[sample.length - 1]?.replace(dir + "/", "")}`)
report(`INSTRUMENT SAMPLE n=${NFILES}`, await sweep(sample, "sample"))

if (process.env.WHOLE === "1") {
  const all = allFiles(dir, [".php"]).sort()
  console.log(`\nwhole-corpus .php files under 400KB: ${all.length}`)
  report("WHOLE phpunit CORPUS", await sweep(all, "whole"))
}

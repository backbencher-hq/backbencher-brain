// script/m14/tmp/m12-cross-lane-filter-check.ts — the cross-lane blast radius of
// the pool-worker leaf fix, measured the only way that matters: recompute EVERY
// language's M12 differential through the PRODUCTION entry (pool-worker.parseFile,
// which applies filterNoiseRelationships) and compare the metrics against the
// committed artifact. It does NOT write any artifact — the point is to find out
// which OTHER lanes the fix moves before touching their ground truths.
//
// Run: bun script/m14/tmp/m12-cross-lane-filter-check.ts
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs"
import { join, resolve } from "node:path"
import { parseFile } from "../../../src/ast/pool-worker"
import { mergeSymbolsIntoOverrideCompanion, mergeTypeKindsIntoCompanion, type TypeKindCompanion } from "../../../src/ast/override-context"
import { compareFacts, factKey, type ObservedFact } from "../../m11/differential-harness"

const ROOT = "<corpus-root>/mcp/backbencher-brain"

async function observedFor(lang: string): Promise<ObservedFact[] | null> {
  const dir = join(ROOT, "validation/m12/fixtures", lang)
  const truthFile = join(ROOT, "validation/m12/ground-truth", `${lang}.json`)
  if (!existsSync(dir) || !existsSync(truthFile)) return null
  const files = readdirSync(dir).filter((f) => !f.startsWith(".") && statSync(join(dir, f)).isFile()).sort()
  const companion = new Map<string, Set<string>>()
  const typeKinds: TypeKindCompanion = new Map()
  for (const f of files) {
    try {
      const p = await parseFile(resolve(dir, f), ROOT)
      mergeSymbolsIntoOverrideCompanion(companion, p.symbols ?? [])
      mergeTypeKindsIntoCompanion(typeKinds, p.symbols ?? [])
    } catch { /* fixture parse failure is the lane's own business */ }
  }
  const observed: ObservedFact[] = []
  for (const f of files) {
    let p: any
    try { p = await parseFile(resolve(dir, f), ROOT, { overrideCompanion: companion, typeKinds }) } catch { continue }
    for (const s of p.symbols ?? []) {
      const name = s.name ?? ""
      if (!name) continue
      const line = s.range?.startLine ?? s.startLine ?? 0
      observed.push({ id: `symbol:${f}:${line}:${s.kind}:${name}`, layer: "ast_extraction", kind: "symbol", file: f, line, attributes: { name, symbolKind: String(s.kind ?? "") }, state: "resolved" })
    }
    for (const r of p.relationships ?? []) {
      const type = String(r.type ?? "")
      if (!type) continue
      const source = String(r.source ?? "")
      const target = String(r.target ?? "")
      if (!source || !target) continue
      const conf = typeof r.confidence === "number" ? r.confidence : 1
      observed.push({ id: `rel:${f}:${type}:${source}:${target}`, layer: "relationships", kind: "relationship", file: f, sourceId: source, targetId: target, attributes: { type }, state: conf < 0.7 ? "unknown" : "resolved" })
    }
  }
  // verify-analyzer dedupes by comparison key before comparing; mirror it.
  return [...new Map(observed.map((f) => [factKey(f), f])).values()]
}

async function main() {
  // `--json <path>` records per-language metrics so the SAME probe can be run
  // with the fix reverted (git checkout the one file) and the two captures
  // diffed — that is the only way to isolate this change's cross-lane effect,
  // because 11 of the 12 closed lanes carry stale (pre-provenance) artifacts
  // whose 0/0 numbers are not reproducible at HEAD for reasons of their own.
  const jsonIdx = process.argv.indexOf("--json")
  const jsonOut = jsonIdx > -1 ? process.argv[jsonIdx + 1] : null
  const capture: Record<string, any> = {}
  const langs = readdirSync(join(ROOT, "validation/m12/fixtures")).filter((d) => statSync(join(ROOT, "validation/m12/fixtures", d)).isDirectory()).sort()
  let moved = 0, checked = 0, missing = 0
  for (const lang of langs) {
    const truthFile = join(ROOT, "validation/m12/ground-truth", `${lang}.json`)
    const artFile = join(ROOT, "validation/m12/results", `${lang}-differential.json`)
    if (!existsSync(truthFile)) { missing++; continue }
    const observed = await observedFor(lang)
    if (!observed) { missing++; continue }
    const truth = JSON.parse(readFileSync(truthFile, "utf8")) as any
    const result = compareFacts(truth.facts, observed)
    checked++
    const m = result.metrics
    capture[lang] = { tp: m.truePositive, fp: m.falsePositive, fn: m.falseNegative, fpIds: result.falsePositiveIds, fnIds: result.falseNegativeIds }
    const art = existsSync(artFile) ? JSON.parse(readFileSync(artFile, "utf8")) : null
    const prev = art?.passing?.metrics
    const same = prev && prev.truePositive === m.truePositive && prev.falsePositive === m.falsePositive && prev.falseNegative === m.falseNegative
    if (!same) {
      moved++
      console.log(`MOVED  ${lang.padEnd(14)} committed TP=${prev?.truePositive} FP=${prev?.falsePositive} FN=${prev?.falseNegative}  ->  now TP=${m.truePositive} FP=${m.falsePositive} FN=${m.falseNegative}`)
      const fps = result.falsePositiveIds ?? []
      for (const id of fps.slice(0, 6)) console.log(`         FP ${id}`)
      const fns = result.falseNegativeIds ?? []
      for (const id of fns.slice(0, 6)) console.log(`         FN ${id}`)
    }
  }
  console.log(`\nlanguages checked=${checked} moved=${moved} no-truth-or-fixtures=${missing}`)
  if (moved === 0) console.log("no lane's M12 differential differs from its committed artifact")
  if (jsonOut) {
    const { writeFileSync } = await import("node:fs")
    writeFileSync(jsonOut, JSON.stringify(capture, null, 1) + "\n")
    console.log(`wrote ${jsonOut}`)
  }
}
main()

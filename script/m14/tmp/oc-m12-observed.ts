// script/m14/tmp/oc-m12-observed.ts — the adjudication instrument for the objc
// M12 differential. It reproduces `script/m12/verify-analyzer.ts objective-c`
// EXACTLY (pass 1 companion over every fixture, pass 2 observed facts from the
// same per-file parse, same factKey from the M11 harness) and prints every
// observed fact with the fixture SOURCE LINE its line_number points at, marked
// TP / FP (and, with --missing, every truth fact the analyzer does not produce).
// Adjudicating a row means reading it here against the source text.
//
// Run: bun script/m14/tmp/oc-m12-observed.ts [--missing]
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs"
import { join, resolve } from "node:path"
import { parseFile } from "../../../src/ast/pool-worker"
import { mergeSymbolsIntoOverrideCompanion, mergeTypeKindsIntoCompanion, type TypeKindCompanion } from "../../../src/ast/override-context"
import { factKey, type ObservedFact } from "../../m11/differential-harness"

const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const LANG = "objective-c"

async function main() {
  const dir = join(ROOT, "validation/m12/fixtures", LANG)
  const files = readdirSync(dir).filter((f) => !f.startsWith(".") && statSync(join(dir, f)).isFile()).sort()
  const companion = new Map<string, Set<string>>()
  const typeKinds: TypeKindCompanion = new Map()
  for (const f of files) {
    const p = await parseFile(resolve(dir, f), ROOT)
    mergeSymbolsIntoOverrideCompanion(companion, p.symbols ?? [])
    mergeTypeKindsIntoCompanion(typeKinds, p.symbols ?? [])
  }

  const observed: ObservedFact[] = []
  const lines: { id: string; line: number; text: string }[] = []
  const linesByFile = new Map<string, string[]>()
  for (const f of files) {
    linesByFile.set(f, readFileSync(join(dir, f), "utf8").split("\n"))
    const p = await parseFile(resolve(dir, f), ROOT, { overrideCompanion: companion, typeKinds })
    for (const s of p.symbols ?? []) {
      const name = s.name ?? ""
      if (!name) continue
      const line = s.range?.startLine ?? (s as any).startLine ?? 0
      const fact: ObservedFact = {
        id: `symbol:${f}:${line}:${s.kind}:${name}`,
        layer: "ast_extraction", kind: "symbol", file: f, line,
        attributes: { name, symbolKind: String(s.kind ?? "") },
        state: "resolved",
      }
      observed.push(fact)
      lines.push({ id: factKey(fact), line, text: (linesByFile.get(f) ?? [])[line - 1]?.trim() ?? "" })
    }
    for (const r of p.relationships ?? []) {
      const type = String(r.type ?? "")
      if (!type) continue
      const source = String((r as any).source ?? "")
      const target = String((r as any).target ?? "")
      if (!source || !target) continue
      const conf = typeof r.confidence === "number" ? r.confidence : 1
      const fact: ObservedFact = {
        id: `rel:${f}:${type}:${source}:${target}`,
        layer: "relationships", kind: "relationship", file: f,
        sourceId: source, targetId: target, attributes: { type },
        state: conf < 0.7 ? "unknown" : "resolved",
      }
      observed.push(fact)
      const ln = typeof (r as any).line_number === "number" ? (r as any).line_number : 0
      lines.push({ id: factKey(fact), line: ln, text: (linesByFile.get(f) ?? [])[ln - 1]?.trim() ?? "" })
    }
  }
  const dedup = [...new Map(observed.map((f) => [factKey(f), f])).values()]
  const lineOf = new Map(lines.map((l) => [l.id, l]))

  const truth = JSON.parse(readFileSync(join(ROOT, "validation/m12/ground-truth", `${LANG}.json`), "utf8")) as any
  const truthByKey = new Map<string, any>()
  for (const f of truth.facts) truthByKey.set(factKey(f), f)

  const resolved = dedup.filter((f) => f.state === "resolved")
  const fps = resolved.filter((f) => !truthByKey.has(factKey(f)))
  const tps = resolved.filter((f) => truthByKey.has(factKey(f)))
  const observedKeys = new Set(resolved.map((f) => factKey(f)))
  const fns = truth.facts.filter((f: any) => !observedKeys.has(factKey(f)))

  const jsonOut = process.argv.indexOf("--json")
  if (jsonOut > -1 && process.argv[jsonOut + 1]) {
    const dump = dedup.map((f) => ({
      key: factKey(f), id: f.id, layer: f.layer, kind: f.kind, file: f.file, line: f.line ?? null,
      name: (f.attributes as any)?.name ?? null, symbolKind: (f.attributes as any)?.symbolKind ?? null,
      sourceId: f.sourceId ?? null, targetId: f.targetId ?? null, type: (f.attributes as any)?.type ?? null,
      state: f.state, lineText: (lineOf.get(factKey(f))?.text ?? ""),
    }))
    writeFileSync(process.argv[jsonOut + 1], JSON.stringify(dump, null, 2) + "\n")
    console.log(`wrote ${process.argv[jsonOut + 1]} (${dump.length} facts)`)
  }

  console.log(`files: ${files.join(", ")}`)
  console.log(`observed resolved: ${resolved.length}  truth: ${truth.facts.length}  TP=${tps.length} FP=${fps.length} FN=${fns.length}\n`)

  if (fps.length) {
    console.log("=== FALSE POSITIVES (observed, truth has no such fact) ===")
    for (const f of fps.sort((a, b) => (a.file ?? "").localeCompare(b.file ?? "") || (a.line ?? 0) - (b.line ?? 0))) {
      console.log(`  ${f.id}`)
      console.log(`      | ${(lineOf.get(factKey(f))?.text ?? "").slice(0, 96)}`)
    }
  }
  if (process.argv.includes("--missing")) {
    console.log("\n=== FALSE NEGATIVES (truth, analyzer does not claim) ===")
    for (const f of fns) console.log(`  ${f.id}\n      truth says: ${(f.evidence?.reference ?? "").slice(0, 120)}`)
  }
  if (process.argv.includes("--all")) {
    console.log("\n=== ALL OBSERVED ===")
    for (const f of [...dedup].sort((a, b) => (a.layer === b.layer ? 0 : a.layer === "ast_extraction" ? -1 : 1))) {
      const mark = f.state === "unknown" ? " UNK" : truthByKey.has(factKey(f)) ? "  TP" : "  FP"
      console.log(`${mark} ${f.id}${f.state === "unknown" ? " (conf<0.7)" : ""}\n        | ${(lineOf.get(factKey(f))?.text ?? "").slice(0, 90)}`)
    }
  }
}
main()

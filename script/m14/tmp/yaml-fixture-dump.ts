// Emit the REAL analyzer output for every yaml fixture, so each expectation file is
// authored from re-probed emission rather than from theory (reviews/LANE-AUDIT-FORMULA.md
// §2: "expectation derived from re-probed emission after a probe, never from theory").
// The dump is the EVIDENCE for the expectations; the expectations are still reviewed
// for truth before they are committed.
import * as fs from "node:fs"
import * as path from "node:path"

const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const DIR = path.join(ROOT, "validation/m14/fixtures/yaml")

async function main() {
  const wts: any = await import("web-tree-sitter")
  const ParserClass = wts.Parser ?? wts.default ?? wts
  const Language = wts.Language ?? wts.default?.Language
  await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const grammar = await Language.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-yaml.wasm")))
  const parser = new ParserClass()
  parser.setLanguage(grammar)
  const mod: any = await import(path.join(ROOT, "src/ast/real-yaml-analyzer.ts"))

  const out: Record<string, any> = {}
  for (const file of fs.readdirSync(DIR).filter((f) => f.endsWith(".yaml")).sort()) {
    const content = fs.readFileSync(path.join(DIR, file), "utf8")
    const tree = parser.parse(content)
    const res: any = await new mod.RealYamlAnalyzer().analyze(tree.rootNode, content, `fixtures/yaml/${file}`)
    out[file] = {
      symbols: (res.symbols ?? []).map((s: any) => ({
        name: s.name, kind: s.kind, id: s.id, ownerName: s.ownerName,
        line: s.range?.startLine, complexity: s.complexity, docstring: s.docstring,
        apiContractPath: s.apiContractPath, qualified_calls: s.qualified_calls,
        metadata: s.metadata,
      })),
      relationships: (res.relationships ?? []).map((r: any) => ({
        type: r.type, source: r.source, target: r.target, confidence: r.confidence,
        line_number: r.line_number, evidenceClass: r.metadata?.evidenceClass,
        relationshipType: r.metadata?.relationshipType,
        resolved: r.metadata?.resolved, unresolvedReason: r.metadata?.unresolvedReason,
        confidenceReason: r.metadata?.confidenceReason, tagUri: r.metadata?.tagUri,
      })),
      imports: (res.imports ?? []).map((i: any) => ({ module: i.module, importType: i.importType, isExternal: i.isExternal })),
      metadata: {
        detectedFrameworks: res.metadata?.detectedFrameworks,
        framework: res.metadata?.framework,
        frameworkPatterns: res.metadata?.frameworkPatterns,
        patterns: res.metadata?.patterns,
        yamlVersion: res.metadata?.yamlVersion,
        reservedDirectives: res.metadata?.reservedDirectives,
        securityScore: res.metadata?.securityScore,
        sensitiveValueCount: res.metadata?.sensitiveValueCount,
        documentCount: res.metadata?.documentCount,
      },
    }
  }
  fs.writeFileSync(path.join(ROOT, "validation/m14/results/archive/yaml-fixture-emission.json"), JSON.stringify({ at: new Date().toISOString(), note: "Re-probed emission for validation/m14/fixtures/yaml/*.yaml, from which each .expectation.json is authored. Regenerate with: bun run script/m14/tmp/yaml-fixture-dump.ts", fixtures: out }, null, 1))
  console.log("wrote validation/m14/results/archive/yaml-fixture-emission.json for", Object.keys(out).length, "fixtures")
  for (const [file, d] of Object.entries(out)) {
    console.log(`\n########## ${file} ##########`)
    console.log(`  symbols=${d.symbols.length} relationships=${d.relationships.length} imports=${d.imports.length}`)
    console.log(`  metadata=${JSON.stringify(d.metadata)}`)
    console.log("  SYMBOLS:")
    for (const s of d.symbols) {
      const extras: string[] = []
      if (s.complexity !== undefined) extras.push(`cx=${s.complexity}`)
      if (s.docstring) extras.push(`doc=${JSON.stringify(s.docstring)}`)
      if (s.apiContractPath) extras.push(`api=${s.apiContractPath}`)
      if (s.qualified_calls) extras.push(`qc=${JSON.stringify(s.qualified_calls)}`)
      if (s.metadata?.valueType) extras.push(`vt=${s.metadata.valueType}`)
      if (s.metadata?.declaredType) extras.push(`dt=${s.metadata.declaredType}/${s.metadata.tagUri}`)
      if (s.metadata?.isSensitive) extras.push(`SENS(${s.metadata.sensitivityReason})`)
      if (s.metadata?.isDuplicateKey) extras.push("DUP")
      if (s.metadata?.recovered) extras.push("RECOVERED")
      if (s.metadata?.itemCount !== undefined) extras.push(`items=${s.metadata.itemCount}`)
      console.log(`    L${String(s.line).padStart(3)} ${String(s.kind).padEnd(9)} ${s.name.padEnd(16)} owner=${(s.ownerName ?? "-").padEnd(34)} ${extras.join(" ")}`)
    }
    console.log("  RELATIONSHIPS (non-contains):")
    for (const r of d.relationships) {
      if (r.type === "contains") continue
      console.log(`    ${String(r.type).padEnd(11)} ${String(r.source).padEnd(40)} -> ${String(r.target).padEnd(30)} conf=${r.confidence} line=${r.line_number} ev=${r.evidenceClass}${r.relationshipType ? ` rt=${r.relationshipType}` : ""}${r.resolved !== undefined ? ` resolved=${r.resolved}` : ""}${r.unresolvedReason ? ` why=${r.unresolvedReason}` : ""}${r.confidenceReason ? ` creason=${r.confidenceReason}` : ""}${r.tagUri ? ` tagUri=${r.tagUri}` : ""}`)
    }
    if (d.imports.length) console.log("  IMPORTS:", JSON.stringify(d.imports))
  }
}
main()

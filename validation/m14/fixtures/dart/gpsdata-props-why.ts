/**
 * gpsdata-props-why — why does Pass 2 not publish `GpsData.props -> Equatable.props`?
 *
 * ## The chain of eliminations, each one measured rather than argued
 *
 * 1. The oracle derives the row (`dart-missing-index-scope-ab.txt`, arm B, sample
 *    list) and the analyzer does not, on a pinned 120-file draw, with the index
 *    handed to the analyzer at differential.ts:22092.
 * 2. The index DOES reach the analyzer's companion path —
 *    `analyze` -> `extractOverrideRelationships(..., (context as any).projectIndex)`
 *    (real-dart-analyzer.ts:778) -> `companionForPass2 = overrideCompanion ??
 *    dartCompanionFor(projectIndex)` (1325).
 * 3. `dartCompanionFor` and the oracle's `__closedMembers` are DIFFERENT
 *    constructions of the same closure, which is the obvious remaining suspect — and
 *    `companion-divergence.ts` measured them over 35,206 types and 757,408 member
 *    comparisons: 0 disagreements. Both expose `Equatable.props`.
 * 4. So the member is visible to both and the row is still absent. The question is
 *    therefore about the DECISION, not the knowledge: which of Pass 1 / Pass 2 /
 *    Pass 3 emits, and whether the symbol `GpsData.props` reaches the override pass
 *    at all.
 *
 * `GpsData.props` is a GETTER (`List<Object?> get props => [...]`). That is the
 * specific thing to check, because the override pass carries kind gates and a getter
 * is a different `SymbolKind` from a method — and `DART_OBJECT_INTERFACE_MEMBERS`
 * (line 202) does not contain `props`, so the deliberate `Object` retarget cannot be
 * the explanation either.
 *
 * ## What this prints, and what it does not claim
 *
 * It prints the `overrides` edges the analyzer publishes for `location_data.dart`
 * with and without a project index, and the symbol record for each `props` getter so
 * its kind is visible rather than inferred. It establishes WHERE the row is lost. It
 * does not establish that publishing it would be correct — the Pass 3 gate exists
 * because un-annotated fields fabricated external overrides, and any fix has to keep
 * that gate's measured effect.
 *
 * Population: 1 corpus file (`proxicall/lib/models/oms/location_data.dart`) plus the
 * `equatable` package's lib/ tree, which is what makes the base resolvable. Stated
 * because a one-file result is a diagnosis, not a rate.
 *
 * Run: npx tsx validation/m14/fixtures/dart/gpsdata-props-why.ts
 */
import * as fs from "node:fs"
import * as path from "node:path"

const ROOT = process.cwd()
const TARGET = "/home/ishaq2321/bb_tests/repositories/proxicall/lib/models/oms/location_data.dart"
const EQUATABLE = "/home/ishaq2321/.pub-cache/hosted/pub.dev/equatable-2.1.0/lib/equatable.dart"

const walkDart = (dir: string, out: string[] = []): string[] => {
  let es: fs.Dirent[]
  try { es = fs.readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of es) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walkDart(p, out)
    else if (e.name.endsWith(".dart")) out.push(p)
  }
  return out
}

const main = async (): Promise<void> => {
  console.log("# gpsdata-props-why\n")
  console.log(`target:  ${TARGET}`)
  console.log(`base:    ${EQUATABLE}`)
  console.log(`base present: ${fs.existsSync(EQUATABLE)}\n`)

  const wts: any = await import("web-tree-sitter")
  const ParserClass = wts.Parser ?? wts.default ?? wts
  const Language = wts.Language ?? wts.default?.Language
  await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const parser = new ParserClass()
  const grammar = await Language.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-dart.wasm")))
  parser.setLanguage(grammar)

  const content = fs.readFileSync(TARGET, "utf8")
  const tree = parser.parse(content)
  const root = tree.rootNode

  const indexFiles = [TARGET, ...walkDart(path.dirname(EQUATABLE))]
  const pmod: any = await import("../../../../src/ast/project-index")
  const index = await pmod.buildProjectIndexStreaming(
    path.join(ROOT, "wasm", "tree-sitter-dart.wasm"), indexFiles, pmod.DART_DECLARATION_SPEC,
  )
  pmod.buildResolutionTables(index)
  const closed = index.__closedMembers ?? new Map<string, Set<string>>()
  console.log(`project index: ${index.typeKinds?.size ?? 0} types over ${indexFiles.length} files`)
  console.log(`  Equatable in index.typeKinds: ${index.typeKinds?.has("Equatable") ?? false}`)
  console.log(`  __closedMembers.get("Equatable") has props: ${closed.get("Equatable")?.has("props") ?? false}\n`)

  const amod: any = await import("../../../../src/ast/real-dart-analyzer")
  const analyzer = new amod.RealDartAnalyzer()

  const legs: [string, any][] = [
    ["NO INDEX", undefined],
    ["WITH INDEX", { projectIndex: index }],
  ]
  for (const [name, ctx] of legs) {
    const res = analyzer.analyze(root, content, path.basename(TARGET), ctx)
    const ov = (res.relationships ?? []).filter((r: any) => (r.type ?? r.relationshipType) === "overrides")
    console.log(`## ${name}: ${res.symbols?.length ?? 0} symbols, ${res.relationships?.length ?? 0} relationships, ${ov.length} overrides`)
    for (const r of ov) console.log(`   ${r.source} -> ${r.target}   conf=${r.confidence}`)
    const propSyms = (res.symbols ?? []).filter((s: any) => s.name === "props")
    console.log(`   symbols named "props": ${propSyms.length}`)
    for (const s of propSyms) {
      console.log(`     name=${s.name} kind=${s.kind} owner=${(s as any).ownerName ?? (s as any).metadata?.ownerName ?? "?"} isStatic=${(s as any).isStatic ?? "?"} decorators=${JSON.stringify((s as any).decorators ?? (s as any).metadata?.decorators ?? [])}`)
    }
    console.log("")
  }

  console.log("## the oracle's answer for the same tree, with the same companion")
  const oracle = await import("../../../../script/m14/oracles/dart-overrides")
  for (const e of oracle.deriveDartOverridesTruth(root, closed)) {
    console.log(`   ${e.label}  ${e.from} -> ${e.target}`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
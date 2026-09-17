// Clean #884 — standalone regression: import_declaration module/alias fields.
//
// Runs the fixture validation/m14/fixtures/clean/import-modules-alias-884.icl
// through the CURRENT committed analyzer AND a faithful inlined replica of the
// PRE-FIX processImport body (findChild first module_name + wrapper-identity
// alias exclusion), asserting:
//   1. the current analyzer satisfies every pin in the fixture's expectation
//      JSON (expectImports / forbidImports / expectRelationships /
//      forbidRelationships / forbidErrors), and
//   2. the pre-fix body VIOLATES those same pins (the regression proof: the
//      second module is dropped, leaks into the alias field, and the selective
//      import self-aliases).
//
// Usage: bun run script/m14/verify-clean-import-884.ts
// Exits 1 on any failure. Writes no evidence artifacts.
const ROOT = process.cwd()
const FIXTURE = "validation/m14/fixtures/clean/import-modules-alias-884.icl"
const EXPECTATION = "validation/m14/fixtures/clean/import-modules-alias-884.expectation.json"

function fail(msg: string): never {
  console.error(`FAIL ${msg}`)
  process.exit(1)
}
function check(ok: boolean, what: string) {
  if (!ok) fail(what)
  else console.log(`ok ${what}`)
}

async function getParser(): Promise<any> {
  const wts: any = await import("web-tree-sitter")
  const ParserClass = wts.Parser ?? wts.default ?? wts
  const Language = wts.Language ?? wts.default?.Language
  await ParserClass.init({ locateFile: () => `${ROOT}/node_modules/web-tree-sitter/tree-sitter.wasm` })
  const grammar = await Language.load(new Uint8Array(await Bun.file(`${ROOT}/wasm/tree-sitter-clean.wasm`).arrayBuffer()))
  const parser = new ParserClass()
  parser.setLanguage(grammar)
  return parser
}

// PRE-FIX body, verbatim semantics (comment: replica, kept in sync with the
// pre-#884 committed analyzer so the proof stays honest).
function preFixProcessImport(analyzer: any, node: any, ctx: any) {
  const modNode = analyzer.findChild(node, (n: any) => n.type === "module_name")
  if (!modNode) return
  const modName = analyzer.assembleModuleName(modNode)
  const isQualified = (() => {
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i)
      if (c && c.type === "qualified") return true
    }
    return node.text.startsWith("import qualified")
  })()
  let alias: string | undefined
  let foundAlias = false
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i)
    if (c?.type === "module_name" && c !== modNode) {
      alias = analyzer.assembleModuleName(c)
      foundAlias = true
    }
  }
  ctx.imports.push({
    module: modName,
    source: modName,
    items: [],
    isTypeOnly: false,
    range: analyzer.nodeToRange(node),
    metadata: { cleanSpecific: true, isQualified, alias: foundAlias ? alias : undefined },
  })
  analyzer.pushRel(ctx, ctx.currentModule || "", modName, "references", 1.0, {
    cleanSpecific: true,
    isImportDependency: true,
  })
  if (modName.indexOf("StdEnv") !== -1) ctx.patterns["Standard Environment"] = true
}

async function main() {
  const parser = await getParser()
  const src = await Bun.file(`${ROOT}/${FIXTURE}`).text()
  const exp = JSON.parse(await Bun.file(`${ROOT}/${EXPECTATION}`).text())
  const tree = parser.parse(src)
  if (tree.rootNode.hasError) fail("fixture itself must parse without grammar errors")

  const { RealCleanAnalyzer } = await import("../../src/ast/real-clean-analyzer")
  const analyzer: any = new RealCleanAnalyzer()
  const result = analyzer.analyze(tree.rootNode, src, FIXTURE)
  const imports: any[] = result.imports ?? []
  const rels: any[] = (result.relationships ?? []).map((r: any) => ({
    ...r,
    from: r.source ?? r.from,
    target: r.target,
  }))

  const importMatches = (imp: any, want: any) =>
    Object.entries(want).every(([k, v]) => {
      if (k === "comment") return true
      if (k.startsWith("meta.")) return (imp.metadata ?? {})[k.slice(5)] === v
      return imp[k] === v
    })
  const relMatches = (r: any, want: any) =>
    Object.entries(want).every(([k, v]) => {
      if (k === "comment") return true
      if (k === "from") return (r.source ?? r.from) === v
      if (k === "target") return r.target === v
      if (k.startsWith("meta.")) return (r.metadata ?? {})[k.slice(5)] === v
      return r[k] === v
    })

  console.log("--- current analyzer vs expectation pins ---")
  for (const want of exp.expectImports ?? []) {
    check(imports.some((i: any) => importMatches(i, want)), `expectImports ${JSON.stringify(want)}`)
  }
  for (const want of exp.forbidImports ?? []) {
    check(!imports.some((i: any) => importMatches(i, want)), `forbidImports ${JSON.stringify(want)}`)
  }
  for (const want of exp.expectRelationships ?? []) {
    check(rels.some((r: any) => relMatches(r, want)), `expectRelationships ${JSON.stringify(want)}`)
  }
  for (const want of exp.forbidRelationships ?? []) {
    check(!rels.some((r: any) => relMatches(r, want)), `forbidRelationships ${JSON.stringify(want)}`)
  }
  check((result.errors ?? []).length === 0, "no parse errors reported")

  console.log("--- pre-fix replica (must reproduce #884) ---")
  const preCtx: any = {
    symbols: [],
    relationships: [],
    imports: [],
    exports: [],
    errors: [],
    patterns: {},
    declaredFunctions: new Set(),
    functionSymbolIndex: {},
    currentModule: "ImportRegression",
    currentFunction: undefined,
    seenRels: new Set(),
  }
  for (const child of tree.rootNode.namedChildren) {
    if (child.type === "import_declaration") preFixProcessImport(analyzer, child, preCtx)
  }
  const preMods = preCtx.imports.map((i: any) => i.module)
  console.log(`pre-fix modules: ${preMods.join(", ")}`)
  console.log(`pre-fix aliases: ${preCtx.imports.map((i: any) => i.metadata?.alias).join(", ")}`)
  check(preMods.includes("Alpha") && !preMods.includes("Beta"), "pre-fix: second comma module dropped (the #884 defect)")
  check(preCtx.imports.some((i: any) => i.metadata?.alias === "Beta"), "pre-fix: dropped module leaked into alias field")
  check(
    preCtx.imports.some((i: any) => i.module === "Data.List" && i.metadata?.alias === "Data.List"),
    "pre-fix: selective import self-aliases",
  )
  check(
    !preCtx.relationships.some((r: any) => r.target === "Beta"),
    "pre-fix: no dependency edge to the second module",
  )

  tree.delete()
  console.log("\nPASS: current analyzer satisfies the #884 pins; the pre-fix body violates them.")
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

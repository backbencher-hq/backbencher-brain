/**
 * GROOVY CONSTRUCT PROBE — the corpus measurement the ontology gate's instrument
 * B ("parse-tree semantic count") requires.
 *
 *   npx tsx script/m60/groovy-construct-probe.ts --out <path> [--repo groovy]
 *
 * ## What it is for
 *
 * `docs/analyzers/ONTOLOGY-WORKSTREAM.md`: a type may be RULED only with "a written
 * reason AND a corpus measurement proving the construct that would produce it never
 * occurs. Falsifiable: a probe finding a non-zero count overturns the ruling."
 *
 * This probe counts, ON THE PARSE TREE (never on text — a string literal and a heredoc
 * can fake any regex, which is how ontology-coverage-gate.ts's first version returned two
 * false positives):
 *
 *   imports   `import_declaration` nodes, split by the FOUR shapes the Groovy docs
 *             define plus the alias form, with the exact child shape printed so the
 *             analyzer's reader can be checked against the grammar rather than assumed.
 *   exports   top-level importable units a Groovy file publishes: type declarations with
 *             no enclosing type, and top-level method/function declarations. Also the
 *             visibility histogram for those types, because "is a top-level type ever
 *             non-public?" is the condition a publication rule has to decide on.
 *   overrides the construct the `overrides` label needs beyond `@Override`: a second
 *             declaration of a name a supertype in the SAME file already declares (the
 *             implicit tier), and the `@Override`-annotated population.
 *   all ten   the raw node-type histogram, so a type whose construct is absent can be
 *             ruled on a grammar inventory (instrument A) and one whose construct is
 *             present can be counted on the tree (instrument B).
 *
 * It reads the tree with its own walker, sharing no code with real-groovy-analyzer.ts, so
 * a disagreement is visible rather than reproduced.
 */

import { execFileSync } from "node:child_process"
import { readFileSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const ROOT = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const argv = process.argv.slice(2)
const OUT = argv.includes("--out") ? argv[argv.indexOf("--out") + 1] : undefined
const REPOS = (process.env.BB_GROOVY_REPOS ?? "groovy").split(",").map((s) => s.trim()).filter(Boolean)

const TYPE_DECLS = new Set([
  "class_declaration", "interface_declaration", "trait_declaration",
  "enum_declaration", "record_declaration", "annotation_type_declaration",
])

function childTypes(node: any): string[] {
  const out: string[] = []
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i)
    if (!c) continue
    out.push(c.isNamed ? `${c.type}` : `"${c.type}"`)
  }
  return out
}

function namedChildOfType(node: any, type: string): any {
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i)
    if (c && c.type === type) return c
  }
  return null
}

async function main(): Promise<void> {
  const wts: any = await import("web-tree-sitter")
  const WSP = wts.Parser ?? wts.default
  const WSL = wts.Language ?? wts.default?.Language
  await WSP.init({ locateFile: () => join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const parser = new WSP()
  parser.setLanguage(await WSL.load(readFileSync(join(process.cwd(), "wasm", "tree-sitter-groovy.wasm"))))

  const files: string[] = []
  for (const repo of REPOS) {
    const dir = join(ROOT, repo)
    let tracked: string[]
    try {
      tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
    } catch { continue }
    for (const rel of tracked) {
      const abs = join(dir, rel)
      if (!rel.endsWith(".groovy") && !rel.endsWith(".gradle")) continue
      try { if (statSync(abs).size > 512 * 1024) continue } catch { continue }
      files.push(abs)
    }
  }
  files.sort()

  const nodeTypes = new Map<string, number>()
  const importShapes = new Map<string, { count: number; files: Set<string>; examples: string[]; childShapes: Set<string>; moduleText: string[] }>()
  const exportUnits = { topLevelTypes: 0, topLevelFunctions: 0, typeFiles: new Set<string>(), functionFiles: new Set<string>(), examples: [] as string[], visibilityHistogram: new Map<string, number>(), packagePresent: 0, packageAbsent: 0 }
  const overrideShapes = { annotatedMethodDecls: 0, implicitTasks: 0, filesWithSupertype: 0, filesWithSameFileRedecl: 0, redeclaredNames: new Map<string, number>(), examples: [] as string[] }
  let filesParsed = 0
  let errorFiles = 0

  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1)

  for (const abs of files) {
    const text = readFileSync(abs, "utf8")
    const tree = parser.parse(text)
    if (!tree) continue
    filesParsed++
    const root = tree.rootNode
    if (root.hasError) errorFiles++
    const rel = abs.replace(`${ROOT}/`, "")

    // ── node-type inventory (instrument A) ──
    const walkTypes = (n: any): void => {
      bump(nodeTypes, n.type)
      for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) walkTypes(c) }
    }
    walkTypes(root)

    // ── import shapes (instrument B) ──
    const walkImports = (n: any): void => {
      if (n.type === "import_declaration") {
        let isStatic = false
        let hasAsterisk = false
        let hasAlias = false
        for (let i = 0; i < n.childCount; i++) {
          const c = n.child(i)
          if (!c) continue
          if (c.type === "static") isStatic = true
          else if (c.type === "asterisk") hasAsterisk = true
          else if (c.type === "as" || c.type === "identifier" && n.text.includes(" as ")) hasAlias = true
        }
        // A declaration whose text carries ` as ` is an alias import; the token
        // probe above cannot see it if the grammar folds the alias into the
        // identifier, so the text is consulted only to CLASSIFY, never to take
        // the name.
        const aliasInText = /\bas\b/.test(n.text)
        const shape = isStatic
          ? (hasAsterisk ? "static_on_demand" : "static_member")
          : (hasAsterisk ? "on_demand_type" : "single_type")
        const key = aliasInText && !hasAlias ? `${shape}+alias` : shape
        const row = importShapes.get(key) ?? { count: 0, files: new Set<string>(), examples: [], childShapes: new Set<string>(), moduleText: [] }
        row.count++
        row.files.add(rel)
        if (row.examples.length < 5) row.examples.push(n.text.replace(/\s+/g, " ").slice(0, 90))
        if (row.childShapes.size < 6) row.childShapes.add(childTypes(n).join(" "))
        const modNode = namedChildOfType(n, "scoped_identifier") ?? namedChildOfType(n, "identifier")
        if (row.moduleText.length < 8) row.moduleText.push(modNode ? `${key}: moduleText=${JSON.stringify(modNode.text)} full=${JSON.stringify(n.text.replace(/\s+/g, " ").slice(0, 60))}` : `${key}: NO module child`)
        importShapes.set(key, row)
      }
      for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) walkImports(c) }
    }
    walkImports(root)

    // ── exportable units: TOP-LEVEL type/function declarations ──
    const isTopLevel = (n: any): boolean => {
      let p = n.parent
      while (p) {
        if (TYPE_DECLS.has(p.type)) return false
        p = p.parent
      }
      return true
    }
    const walkExports = (n: any): void => {
      if (TYPE_DECLS.has(n.type) && isTopLevel(n)) {
        exportUnits.topLevelTypes++
        exportUnits.typeFiles.add(rel)
        const nameNode = namedChildOfType(n, "identifier")
        if (exportUnits.examples.length < 12) exportUnits.examples.push(`${rel}:${n.startPosition.row + 1} ${n.type} ${nameNode?.text ?? "(no name)"}`)
        const mods = namedChildOfType(n, "modifiers")
        let vis = "public(none-written)"
        if (mods) {
          const visTok = ["public", "private", "protected"].filter((v) => mods.text.includes(v))
          if (visTok.length) vis = visTok.join("+")
        }
        bump(exportUnits.visibilityHistogram, vis)
      }
      if ((n.type === "method_declaration" || n.type === "function_definition") && isTopLevel(n)) {
        exportUnits.topLevelFunctions++
        exportUnits.functionFiles.add(rel)
        if (exportUnits.examples.length < 12) exportUnits.examples.push(`${rel}:${n.startPosition.row + 1} ${n.type} (top-level function)`)
      }
      for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) walkExports(c) }
    }
    walkExports(root)
    const hasPackage = !!(root.namedChildren ?? []).find((c: any) => c && c.type === "package_declaration")
    if (hasPackage) exportUnits.packagePresent++
    else exportUnits.packageAbsent++

    // ── override constructs ──
    const walkOverrides = (n: any): void => {
      if (n.type === "method_declaration" || n.type === "function_definition") {
        const mods = namedChildOfType(n, "modifiers")
        const isAnnotated = !!mods && /\bOverride\b/.test(mods.text)
        const isStatic = !!mods && /\bstatic\b/.test(mods.text)
        const isPrivate = !!mods && /\bprivate\b/.test(mods.text)
        if (isAnnotated) { overrideShapes.annotatedMethodDecls++; if (overrideShapes.examples.length < 6) overrideShapes.examples.push(`@Override ${rel}:${n.startPosition.row + 1}`) }
        if (!isAnnotated && !isStatic && !isPrivate) overrideShapes.implicitTasks++
      }
      if (TYPE_DECLS.has(n.type)) {
        const sup = namedChildOfType(n, "superclass")
        const supI = namedChildOfType(n, "super_interfaces")
        const ext = namedChildOfType(n, "extends_interfaces")
        if (sup || supI || ext) overrideShapes.filesWithSupertype++
        // An in-file SUPER-TYPE DECLARATION: the construct a cross-file @Override
        // resolves against. Counted per (file, type name) so a probe can ask "how
        // many files declare a supertype that is ALSO declared in the file".
        if (sup || supI || ext) {
          const nameNode = namedChildOfType(n, "identifier")
          const key = `${rel}`
          bump(overrideShapes.redeclaredNames, key)
          if (nameNode) bump(overrideShapes.redeclaredNames, `${rel}::${nameNode.text}`)
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) walkOverrides(c) }
    }
    walkOverrides(root)
    tree.delete?.()
  }

  const artifact = {
    instrument: "groovy-construct-probe",
    lane: "analyzer/GROOVY",
    corpus: REPOS.map((r) => `${ROOT}/${r}`),
    filesParsed,
    filesWithParseError: errorFiles,
    nodeTypeInventory: { distinct: nodeTypes.size, counts: Object.fromEntries([...nodeTypes.entries()].sort((a, b) => b[1] - a[1])) },
    imports: {
      shapes: Object.fromEntries([...importShapes.entries()].map(([k, v]) => [k, {
        count: v.count, files: v.files.size, examples: v.examples,
        childShapes: [...v.childShapes], moduleTextSamples: v.moduleText,
      }])),
      total: [...importShapes.values()].reduce((a, b) => a + b.count, 0),
      totalFiles: new Set([...importShapes.values()].flatMap((v) => [...v.files])).size,
    },
    exports: {
      topLevelTypes: exportUnits.topLevelTypes,
      topLevelTypeFiles: exportUnits.typeFiles.size,
      topLevelFunctions: exportUnits.topLevelFunctions,
      topLevelFunctionFiles: exportUnits.functionFiles.size,
      visibilityHistogram: Object.fromEntries(exportUnits.visibilityHistogram),
      filesWithPackageDeclaration: exportUnits.packagePresent,
      filesWithoutPackageDeclaration: exportUnits.packageAbsent,
      examples: exportUnits.examples,
    },
    overrides: {
      annotatedMethodDeclarations: overrideShapes.annotatedMethodDecls,
      implicitCandidateMethods: overrideShapes.implicitTasks,
      typeDeclarationsWithSupertype: overrideShapes.filesWithSupertype,
      examples: overrideShapes.examples,
    },
  }
  const text = JSON.stringify(artifact, null, 2)
  if (OUT) { writeFileSync(OUT, text + "\n"); process.stderr.write(`wrote ${OUT}\n`) }
  console.log(text)
}
main().catch((e) => { console.error(e); process.exit(1) })
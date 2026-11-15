// fsharp parse-health triage (2026-09-25).
//
// The census found 133/497 of the compiler's own `src` files carrying ERROR
// nodes (26.8%) and the analyzer has NO error handling at all — it walks whatever
// tree-sitter's recovery produced. Two questions this probe answers, and neither
// is answerable from the census:
//
//   1. WHICH constructs cause the errors — clustered by the ERROR node's parent
//      type, its ancestor path, and its first token, with the source line quoted.
//   2. WHETHER the recovered regions LOSE symbols — measured as the rate of
//      tree-declared entities (function_or_value_defn / member_defn /
//      type_definition / named_module ...) that produced no emitted symbol,
//      INSIDE error regions vs OUTSIDE (locals legitimately produce none, so the
//      absolute count is meaningless; the ratio is the evidence).
//
// Usage: bun script/m14/tmp/fsharp-error-triage.ts [--out file] [roots...]
import { Parser, Language } from "web-tree-sitter"
import { RealFsharpAnalyzer } from "../../../src/ast/real-fsharp-analyzer"
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from "node:fs"
import { join, dirname, relative } from "node:path"

const CORPUS = "/home/ishaq2321/bb_tests/repositories/fsharp"
const argv = process.argv.slice(2)
const outIdx = argv.indexOf("--out")
const OUT = outIdx >= 0 ? argv[outIdx + 1] : "validation/m14/results/archive/fsharp-error-triage.json"
const roots = (() => {
  const rest = argv.filter((a, i) => !a.startsWith("--") && argv[i - 1] !== "--out")
  return rest.length ? rest : [join(CORPUS, "src")]
})()
const SKIP_DIRS = new Set([".git", "node_modules", "artifacts", "obj", "bin"])

// The declaration node types this grammar and the analyzer agree on.
const DECL_TYPES = new Set([
  "function_or_value_defn",
  "value_declaration",
  "member_defn",
  "type_definition",
  "record_type_defn",
  "union_type_defn",
  "enum_type_defn",
  "interface_type_defn",
  "anon_type_defn",
  "delegate_type_defn",
  "type_abbrev_defn",
  "exception_definition",
  "named_module",
  "module_defn",
  "module_abbrev",
  "val_property_defn",
  "additional_constr_defn",
])

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const e of entries) {
    if (SKIP_DIRS.has(e)) continue
    const p = join(dir, e)
    let st
    try {
      st = statSync(p)
    } catch {
      continue
    }
    if (st.isDirectory()) walk(p, out)
    else if (e.endsWith(".fs") || e.endsWith(".fsi") || e.endsWith(".fsx")) out.push(p)
  }
  return out
}

interface Cluster {
  key: string
  count: number
  lines: number
  examples: { file: string; line: number; text: string }[]
}

function firstToken(text: string): string {
  const t = text.replace(/\s+/g, " ").trim()
  if (!t) return "(empty)"
  // The first token, but a quoted identifier or a long identifier stays whole.
  const m = t.match(/^(``[^`]*``|\[<[^\]]*>\]|[A-Za-z_][A-Za-z0-9_']*|[^\sA-Za-z0-9_]+)/)
  return (m ? m[0] : t).slice(0, 44)
}

function ancestorPath(node: any, depth = 4): string {
  const parts: string[] = []
  let cur = node.parent
  while (cur && parts.length < depth) {
    if (cur.type !== "ERROR") parts.push(cur.type)
    cur = cur.parent
  }
  return parts.join("<")
}

function declName(node: any): string | null {
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i)
    if (!c) continue
    if (c.type === "identifier" || c.type === "long_identifier" || c.type === "identifier_pattern") return c.text
    if (c.type === "function_declaration_left" || c.type === "value_declaration_left") {
      for (let j = 0; j < c.namedChildCount; j++) {
        const g = c.namedChild(j)
        if (g && (g.type === "identifier" || g.type === "identifier_pattern")) return g.text
      }
    }
    if (c.type === "type_name" || c.type === "method_or_prop_defn") {
      const g = c.namedChild(0)
      if (g) return g.text
    }
  }
  return null
}

async function main() {
  await Parser.init()
  const parser = new Parser()
  parser.setLanguage(await Language.load(new URL("../../../wasm/tree-sitter-fsharp.wasm", import.meta.url).pathname))

  const files = roots.flatMap((r) => walk(r)).sort()
  console.log(`files=${files.length} roots=${roots.join(",")}`)

  const clusters = new Map<string, Cluster>()
  // ROOT-CAUSE clustering: the FIRST ERROR node by position in a file is the one
  // the parser actually fell over; the rest are frequently recovery cascades (the
  // minimizer proved several big clusters parse fine in isolation). Same key, so
  // root and cascade populations are comparable.
  const rootClusters = new Map<string, Cluster>()
  const declInsideError = { decls: 0, withSymbol: 0 }
  const declOutsideError = { decls: 0, withSymbol: 0 }
  // Per-declaration-type coverage, because the inside/outside ratio is otherwise
  // dominated by composition: `function_or_value_defn`/`value_declaration` include
  // locals, which legitimately carry no symbol.
  const declByType = new Map<string, { inDecls: number; inSym: number; outDecls: number; outSym: number }>()
  let filesWithHasError = 0
  const lostExamples: { file: string; line: number; type: string; name: string; context: string }[] = []
  const errorFiles: { file: string; errors: number; errorLines: number; fileLines: number }[] = []
  let errorNodes = 0
  let errorLines = 0
  let missingNodes = 0
  let filesWithError = 0

  for (const file of files) {
    let src: string
    try {
      src = readFileSync(file, "utf8")
    } catch {
      continue
    }
    const tree = parser.parse(src)
    if (!tree) continue
    const lines = src.split("\n")

    let res: any
    try {
      res = new RealFsharpAnalyzer().analyze(tree.rootNode, src, file)
    } catch {
      res = { symbols: [], relationships: [] }
    }
    const symbolNames = new Set<string>((res.symbols ?? []).map((s: any) => String(s?.name)))
    const rel = relative(CORPUS, file)

    // Collect ERROR nodes + missing nodes, and measure declaration coverage
    // inside vs outside error regions in ONE walk.
    const stack: { node: any; inError: boolean }[] = [{ node: tree.rootNode, inError: false }]
    let fileErrors = 0
    let fileErrorLines = 0
    const errorLineSet = new Set<number>()
    if (tree.rootNode.hasError) filesWithHasError++
    let firstErrorRow = Infinity
    let firstErrorKey: string | null = null
    while (stack.length) {
      const { node, inError } = stack.pop()!
      const isError = node.type === "ERROR"
      const nowInError = inError || isError
      if (isError) {
        errorNodes++
        fileErrors++
        const start = node.startPosition.row + 1
        const end = node.endPosition.row + 1
        const span = Math.max(1, end - start + 1)
        errorLines += span
        fileErrorLines += span
        for (let l = start; l <= end; l++) errorLineSet.add(l)
        const key = `${node.parent?.type ?? "(root)"} :: ${firstToken(node.text)}`
        if (start < firstErrorRow) {
          firstErrorRow = start
          firstErrorKey = key
        }
        const cl = clusters.get(key) ?? { key, count: 0, lines: 0, examples: [] }
        cl.count++
        cl.lines += span
        if (cl.examples.length < 3) {
          cl.examples.push({ file: rel, line: start, text: (lines[start - 1] ?? "").trim().slice(0, 140) })
        }
        clusters.set(key, cl)
      }
      if (node.isMissing) missingNodes++
      if (DECL_TYPES.has(node.type)) {
        // A declaration's OWN line decides which region it belongs to.
        const declLine = node.startPosition.row + 1
        const inside = inError || nowInError
        const name = declName(node)
        const has = name ? symbolNames.has(name) : false
        const t = declByType.get(node.type) ?? { inDecls: 0, inSym: 0, outDecls: 0, outSym: 0 }
        if (inside) {
          declInsideError.decls++
          if (has) declInsideError.withSymbol++
          t.inDecls++
          if (has) t.inSym++
          else if (name && lostExamples.length < 40)
            lostExamples.push({ file: rel, line: declLine, type: node.type, name, context: ancestorPath(node, 3) })
        } else {
          declOutsideError.decls++
          if (has) declOutsideError.withSymbol++
          t.outDecls++
          if (has) t.outSym++
        }
        declByType.set(node.type, t)
      }
      for (let i = 0; i < node.childCount; i++) {
        const c = node.child(i)
        if (c) stack.push({ node: c, inError: nowInError })
      }
    }

    if (fileErrors) {
      filesWithError++
      errorFiles.push({ file: rel, errors: fileErrors, errorLines: fileErrorLines, fileLines: lines.length })
    }
    if (firstErrorKey) {
      const rc = rootClusters.get(firstErrorKey) ?? { key: firstErrorKey, count: 0, lines: 0, examples: [] }
      rc.count++
      if (rc.examples.length < 2) rc.examples.push({ file: rel, line: firstErrorRow, text: "" })
      rootClusters.set(firstErrorKey, rc)
    }
    tree.delete()
  }

  const pct = (a: number, b: number) => (b ? (100 * a / b).toFixed(1) : "n/a")
  const totalFileLines = errorFiles.reduce((a, r) => a + r.fileLines, 0)
  const top = [...clusters.values()].sort((a, b) => b.count - a.count)

  console.log(`\nfiles=${files.length} filesWithError=${filesWithError} (${pct(filesWithError, files.length)}%)  filesWithHasError=${filesWithHasError} (${pct(filesWithHasError, files.length)}%)`)
  console.log(`ERROR nodes=${errorNodes}  missing nodes=${missingNodes}  error lines=${errorLines}`)
  console.log(`declaration coverage INSIDE error regions:  ${declInsideError.withSymbol}/${declInsideError.decls} carry a symbol (${pct(declInsideError.withSymbol, declInsideError.decls)}%)`)
  console.log(`declaration coverage OUTSIDE error regions: ${declOutsideError.withSymbol}/${declOutsideError.decls} carry a symbol (${pct(declOutsideError.withSymbol, declOutsideError.decls)}%)`)
  const spans = errorFiles.map((f) => f.errorLines).sort((a, b) => a - b)
  const median = spans.length ? spans[Math.floor(spans.length / 2)] : 0
  const max = spans.length ? spans[spans.length - 1] : 0
  console.log(`error-line span per file: median=${median} p90=${spans[Math.floor(spans.length * 0.9)] ?? 0} max=${max} of ${totalFileLines} total lines`)
  // NOTE: do not name this `roots` — that shadows the module-level corpus roots
  // declared at the top of the file and turns this line into a TDZ error.
  const rootList = [...rootClusters.values()].sort((a, b) => b.count - a.count)
  console.log(`\n--- ROOT error clusters (first ERROR per file; ${rootList.length} distinct) ---`)
  for (const c of rootList.slice(0, 20))
    console.log(
      `  ${String(c.count).padStart(4)} file(s)  ${c.key}${c.examples[0] ? `   e.g. ${c.examples[0].file}:${c.examples[0].line}` : ""}`,
    )
  console.log(`\n--- declaration coverage by type (inside error region vs outside) ---`)
  for (const [t, v] of [...declByType.entries()].sort((a, b) => b[1].inDecls + b[1].outDecls - (a[1].inDecls + a[1].outDecls))) {
    console.log(`  ${t.padEnd(24)} in ${String(v.inSym).padStart(4)}/${String(v.inDecls).padStart(4)} (${pct(v.inSym, v.inDecls)}%)   out ${String(v.outSym).padStart(5)}/${String(v.outDecls).padStart(5)} (${pct(v.outSym, v.outDecls)}%)`)
  }
  console.log(`\n--- top error clusters (parent :: first token) ---`)
  for (const c of top.slice(0, 40)) {
    const path = c.examples[0]?.file ?? ""
    console.log(`  ${String(c.count).padStart(5)} x  lines=${String(c.lines).padStart(5)}  ${c.key}`)
    for (const e of c.examples.slice(0, 2)) console.log(`         e.g. ${e.file}:${e.line}  ${e.text}`)
  }
  if (lostExamples.length) {
    console.log(`\n--- declarations inside error regions that produced NO symbol (first ${lostExamples.length}) ---`)
    for (const l of lostExamples.slice(0, 20)) console.log(`  ${l.file}:${l.line}  ${l.type} ${l.name}  [ancestors: ${l.context}]`)
  }

  const artifact = {
    schemaVersion: 1,
    kind: "m60-fsharp-error-triage",
    generatedAt: new Date().toISOString(),
    roots,
    note: "Triage of the ERROR nodes the fsharp census counted (133/497 src files). Two measurements, neither derivable from the census: the construct clusters (ERROR node parent + first token + ancestor path) and the declaration-coverage ratio inside vs outside error regions — the ratio is the evidence, because locals legitimately carry no symbol, so an absolute count would be noise.",
    totals: {
      files: files.length,
      filesWithError,
      errorNodes,
      missingNodes,
      errorLines,
      errorLineSpan: { median, p90: spans[Math.floor(spans.length * 0.9)] ?? 0, max, totalFileLines },
      declInsideError,
      declOutsideError,
    },
    clusters: top.slice(0, 60).map((c) => ({ key: c.key, count: c.count, lines: c.lines, examples: c.examples })),
    rootClusters: rootList.slice(0, 30).map((c) => ({ key: c.key, count: c.count, examples: c.examples })),
    declByType: Object.fromEntries([...declByType.entries()].sort((a, b) => b[1].inDecls - a[1].inDecls)),
    filesWithHasError,
    lostDeclarations: lostExamples,
    errorFiles: errorFiles.sort((a, b) => b.errorLines - a.errorLines).slice(0, 60),
  }
  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(OUT, JSON.stringify(artifact, null, 2) + "\n")
  console.log(`\nwrote ${OUT}`)
  parser.delete()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

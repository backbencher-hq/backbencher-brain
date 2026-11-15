// Round-7 `imports` oracle for the Go lane.
//
// WHY THIS FILE EXISTS. The go analyzer EMITS `imports` for every import_spec
// (real-go-analyzer.ts, PHASE 3b) and go's own `requiredKinds` has named
// `imports` since the wave, but there was NO oracle for the label and it was
// absent from the compared-label set. That is the identical shape of hole round
// 6 closed for `uses`, `references` and `contains`, and it is the one that
// matters most downstream: `imports` is what framework detection reads.
//
// The contract being audited, read off the analyzer's own emission:
//   source  the file's package-clause name, else the file path
//   target  the import PATH with its surrounding quotes stripped
//   line    the import_spec's start line
//   meta    isGoImportDep:true, isImport:true, packageName:<path basename>
//
// Derived from the GRAMMAR, not by copying the pass: the oracle walks the tree
// for `import_spec` nodes, reads the `path` FIELD, and strips the quotes with a
// first/last-character check. It is deliberately written so it CAN disagree —
// the shapes it is most likely to get wrong (grouped imports, aliases, dot and
// blank imports, a spec recovered out of an ERROR region, a duplicate path) are
// exactly the ones the corpus should exercise.
import * as fs from "node:fs"
import * as path from "node:path"

const ROOT = "/home/ishaq2321/mcp/backbencher-brain"

const arg = (k: string, d: string): string => {
  const i = process.argv.indexOf(k)
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : d
}

/** Strip one pair of surrounding double quotes. First/last char, no regex. */
function unquote(text: string): string {
  const t = String(text ?? "")
  if (t.length >= 2 && t[0] === '"' && t[t.length - 1] === '"') return t.slice(1, -1)
  return t
}

/** The package name a path implies: the last `/`-separated segment. */
function baseName(p: string): string {
  const i = p.lastIndexOf("/")
  return i === -1 ? p : p.slice(i + 1)
}

export type ImportsTruth = {
  label: "imports"
  from: string
  target: string
  packageName: string
  line: number
  /** Which import shape produced the row — a diagnostic, not a match key. */
  shape: "single" | "grouped" | "aliased" | "dot" | "blank" | "grouped_aliased"
}

export function deriveGoImports(root: any, filePath: string): ImportsTruth[] {
  const out: ImportsTruth[] = []
  const seen = new Set<string>()

  // SOURCE: the package clause's own name, else the file path.
  let pkg = ""
  {
    const stack: any[] = [root]
    while (stack.length) {
      const n = stack.pop()!
      if (n.type === "package_clause") {
        const nameNode = n.childForFieldName?.("name")
        if (nameNode) { pkg = String(nameNode.text ?? ""); break }
      }
      for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) stack.push(c) }
    }
  }
  const source = pkg || filePath

  const walk = (n: any, grouped: boolean): void => {
    if (n.type === "import_declaration") {
      // `import ( ... )` is parenthesised; a bare `import "x"` is not. The test
      // is the PARENTHESIS, not the presence of a spec child — an unparenthesised
      // import still has an import_spec child, so testing for one classified
      // every import in the corpus as `grouped` (the first full-extent read
      // reported 6,456 `grouped` in etcd and no `single` anywhere, which is how
      // the bug was caught).
      let isGrouped = grouped
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i)
        if (c && c.type === "(") { isGrouped = true; break }
        if (c && c.type === "import_spec_list") { isGrouped = true; break }
      }
      for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) walk(c, isGrouped) }
      return
    }
    if (n.type === "import_spec") {
      const p = n.childForFieldName?.("path")
      if (p) {
        const raw = unquote(String(p.text ?? ""))
        const nameNode = n.childForFieldName?.("name")
        const alias = nameNode ? String(nameNode.text ?? "") : ""
        const shape: ImportsTruth["shape"] =
          alias === "." ? "dot"
          : alias === "_" ? "blank"
          : alias ? (grouped ? "grouped_aliased" : "aliased")
          : (grouped ? "grouped" : "single")
        const line = (p.startPosition?.row ?? 0) + 1
        // One edge per DISTINCT path per file: the analyzer pushes one per spec,
        // and the harness dedupes the analyzer side by label|target, so a truth
        // that counted duplicates would report a phantom surplus.
        const key = `${raw}|${line}`
        if (!seen.has(key)) {
          seen.add(key)
          out.push({ label: "imports", from: source, target: raw, packageName: baseName(raw), line, shape })
        }
      }
      return
    }
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) walk(c, grouped) }
  }
  walk(root, false)
  return out
}

async function main() {
  // Skip flags AND their values, or `--files 150` makes `150` a corpus name.
  const argv = process.argv.slice(2)
  const repos: string[] = []
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) { if (argv[i + 1] && !argv[i + 1].startsWith("--")) i++; continue }
    repos.push(argv[i])
  }
  const want = Number(arg("--files", "0"))
  const wts: any = await import("web-tree-sitter")
  const ParserClass = wts.Parser ?? wts.default ?? wts
  const Language = wts.Language ?? wts.default?.Language
  await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const grammar = await Language.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-go.wasm")))
  const mod: any = await import(path.join(ROOT, "src/ast/real-go-analyzer.ts"))

  for (const repo of repos) {
    const dir = path.join("/home/ishaq2321/bb_tests/repositories", repo)
    if (!fs.existsSync(dir)) { console.log(`[SKIP] ${repo} (absent)`); continue }
    const files: string[] = []
    const walk = (d: string): void => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (e.name === "vendor" || e.name === ".git") continue
        const p = path.join(d, e.name)
        if (e.isDirectory()) walk(p)
        else if (e.name.endsWith(".go")) files.push(p)
      }
    }
    walk(dir)
    files.sort()
    const take = want > 0 ? files.slice(0, want) : files

    const parser = new ParserClass()
    parser.setLanguage(grammar)
    const truth = new Set<string>()
    const truthRows: ImportsTruth[] = []
    const analyzer = new Set<string>()
    const perShape: Record<string, number> = {}
    const bySource: Record<string, { t: number; a: number }> = {}
    let read = 0
    let parseSkips = 0
    let analyzerRaw = 0
    const dupSeen = new Map<string, number>()
    const dups: string[] = []
    const missing: string[] = []
    const extra: string[] = []
    const lineBad: string[] = []

    for (const abs of take) {
      const content = fs.readFileSync(abs, "utf8")
      const rel = path.relative(dir, abs)
      let tree: any
      try { tree = parser.parse(content) } catch { parseSkips++; continue }
      read++
      let res: any
      try { res = await new mod.RealGoAnalyzer().analyze(tree.rootNode, content, rel) } catch { continue }

      const perFileTruth = deriveGoImports(tree.rootNode, rel)
      const perFileAnalyzer: any[] = (res.relationships ?? []).filter((r: any) => String(r.type) === "imports")

      for (const t of perFileTruth) {
        truth.add(t.target)
        truthRows.push(t)
        perShape[t.shape] = (perShape[t.shape] ?? 0) + 1
        bySource[t.from] ??= { t: 0, a: 0 }
        bySource[t.from].t++
      }
      // DUPLICATE detector. The F5 matcher dedupes the analyzer side by
      // label|target, so a row published TWICE is indistinguishable from one
      // published once — the whole surface is blind to it. GOD10's first cut
      // emitted every import in a normal file twice and read 0 MISSING /
      // 0 UNEXPLAINED throughout. This counts the raw edges.
      for (const a of perFileAnalyzer) {
        const tgt = String(a.target ?? "")
        analyzer.add(tgt)
        analyzerRaw++
        // The FILE must be in the key. Keying on source|target|line alone made
        // `main|fmt|9` collide across every file of package main that imports fmt
        // on line 9, and reported 5,703 "duplicate edges" of which none were
        // duplicates — 14 identical rows in go-tools were 14 DIFFERENT files.
        const k = `${rel}|${String(a.source ?? "")}|${tgt}|${a.line_number ?? 0}`
        dupSeen.set(k, (dupSeen.get(k) ?? 0) + 1)
        bySource[String(a.source ?? "")] ??= { t: 0, a: 0 }
        bySource[String(a.source ?? "")].a++
        if (!truth.has(tgt)) extra.push(`${repo}/${rel} | ${tgt}`)
      }
      // LINE audit: for every truth row, the analyzer must have an edge to that
      // path on that same line. The F5 matcher never reads a line.
      const lines = new Map<string, Set<number>>()
      for (const a of perFileAnalyzer) {
        const t = String(a.target ?? "")
        if (!lines.has(t)) lines.set(t, new Set())
        if (typeof a.line_number === "number") lines.get(t)!.add(a.line_number)
      }
      for (const t of perFileTruth) {
        const got = lines.get(t.target)
        if (!got || !got.has(t.line)) {
          lineBad.push(`${repo}/${rel} | ${t.target} | truth line ${t.line} | analyzer ${got ? [...got].join("/") : "(none)"}`)
        }
      }
    }
    for (const t of truth) if (!analyzer.has(t)) missing.push(String(t))
    for (const [k, n] of dupSeen) if (n > 1) dups.push(`${k} x${n}`)

    console.log(`===== ${repo} =====`)
    console.log(JSON.stringify({
      repo,
      filesListed: files.length,
      filesRead: read,
      parseSkips,
      truthRows: truthRows.length,
      truthDistinctTargets: truth.size,
      analyzerEdges: analyzer.size,
      analyzerEdgesRaw: analyzerRaw,
      duplicateEdges: dups.length,
      MISSING: missing.length,
      UNEXPLAINED: extra.length,
      coveragePct: Number((100 * (truth.size - missing.length) / Math.max(1, truth.size)).toFixed(4)),
      byShape: perShape,
      lineMismatches: lineBad.length,
      missingSamples: missing.slice(0, 8),
      extraSamples: extra.slice(0, 8),
      lineSamples: lineBad.slice(0, 8),
      duplicateSamples: dups.slice(0, 8),
    }, null, 2))
  }
}
if (import.meta.main) main()

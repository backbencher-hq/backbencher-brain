// CLJ-DEEP (M60 clojure lane): the FULL-SURFACE census.
//
// WHY IT EXISTS. The F5 differential compares the analyzer against
// `deriveClojureEdges`, and the two MIRROR each other's rules rule for rule
// (every CLJ-Dx ruling is implemented twice, deliberately, so a divergence
// shows up). That makes F5 structurally blind to a defect present in BOTH —
// which is the class the lane's own history says keeps hiding: W23's `case`
// default and W24's letfn shadow were mirrored drops, invisible to a
// differential whose truth side dropped the same edges.
//
// This instrument does not ask "do the two sides agree?". It asks four
// questions neither side can answer about itself:
//
//   A. NODE COVERAGE   — every node TYPE the corpus actually produces,
//                        classified against the spec's handled/silent sets.
//                        Anything unclassified is an UNKNOWN (F1's subject).
//   B. FORM COVERAGE   — every (head-form) shape in the corpus, and whether
//                        the analyzer gave it a symbol/edge or walked it
//                        generically. A non-builtin head with neither is a
//                        candidate unexplained form.
//   C. TARGET RESOLUTION — every emitted `calls`/`instantiates`/`implements`
//                        target: does an in-file symbol own that name? An
//                        unresolvable target is not automatically wrong (it
//                        can be a `:refer`/alias/global) but the residue after
//                        resolution is where real dangling edges live.
//   D. IDENTITY        — duplicate (scope, owner, name, kind) tuples, "unknown"
//                        placeholder names, empty names, private-name leaks.
//
// It runs over the whole corpus in bounded shards so 4,000+ files fit in the
// wasm heap (the W11 lesson: one module cannot hold every lane).
import { readFileSync, readdirSync, statSync, existsSync, writeFileSync } from "node:fs"
import { execSync } from "node:child_process"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../../..")
const CORPUS_ROOT = process.env.BB_CORPUS_ROOT ?? "/home/sano/ishaq/bb_tests/repositories"

const SPEC: any = JSON.parse(readFileSync(path.join(ROOT, "script/m14/spec/clojure-completeness.json"), "utf8"))
const HANDLED = new Set<string>(SPEC.handled_verified.types)
const SILENT = new Set<string>(SPEC.internal_silent.types)

function listFiles(repo: string): string[] {
  const dir = path.join(CORPUS_ROOT, repo)
  if (!existsSync(dir)) return []
  let tracked: string[] = []
  try {
    tracked = execSync(`git -C ${JSON.stringify(dir)} ls-files`, { encoding: "utf8", maxBuffer: 1 << 28 })
      .split("\n").filter(Boolean)
  } catch { tracked = [] }
  if (tracked.length === 0) {
    const walk = (d: string, acc: string[] = []): string[] => {
      for (const e of readdirSync(d)) {
        if (e === ".git" || e === "target" || e === "node_modules") continue
        const p = path.join(d, e)
        const st = statSync(p)
        if (st.isDirectory()) walk(p, acc)
        else if (/\.(clj|cljc|cljs)$/i.test(e)) acc.push(p)
      }
      return acc
    }
    tracked = walk(dir).map(p => path.relative(dir, p))
  }
  return tracked
    .filter(f => /\.(clj|cljc|cljs)$/i.test(f))
    .map(f => path.join(dir, f))
    .sort()
}

async function main() {
  const repo = process.argv[2] ?? "clojure"
  const shard = process.argv[3] ? parseInt(process.argv[3]) : 0
  const nshards = process.argv[4] ? parseInt(process.argv[4]) : 1
  // `--out <path>` / `--limit <n>`, NOT positional: a positional 5th argument
  // is read as the limit, and `parseInt("/tmp/x.json")` is NaN — which slices
  // the file list to nothing and reports a clean 0-file run. That bug hid here
  // for a whole wave and is why the shard argument is spelled out below.
  const argOf = (flag: string): string | undefined => { const i = process.argv.indexOf(flag); return i >= 0 ? process.argv[i + 1] : undefined }
  const limit = argOf("--limit") ? parseInt(argOf("--limit")!) : Infinity
  const outPath = argOf("--out")

  const engine: any = await import(path.join(ROOT, "src/ast/engine.ts"))
  const parser = await engine.ASTEngine.getParser("clojure")
  const mod: any = await import(path.join(ROOT, "src/ast/real-clojure-analyzer.ts"))
  const analyzer = new mod.RealClojureAnalyzer()

  const allFiles = listFiles(repo)
  if (process.env.BB_DEBUG_LIST) console.error(`[list] ${repo}: ${allFiles.length} files, first=${allFiles[0] ?? "(none)"}`)
  let files = allFiles
  if (limit !== Infinity) files = files.slice(0, limit)
  files = files.filter((_, i) => i % nshards === shard)

  const nodeTypes = new Map<string, number>()
  const unknownNodes = new Map<string, { count: number; sample: string }>()
  const headForms = new Map<string, { count: number; symbol: number; edge: number; sample: string }>()
  const dangling = new Map<string, { count: number; kind: string; files: Set<string> }>()
  const dupIdentity = new Map<string, { count: number; sample: string }>()
  const placeholderNames: string[] = []
  const emptyNames: string[] = []
  const parseErrorFiles: string[] = []
  const errNodeFiles: string[] = []
  const CORE: Record<string, boolean> = mod.CLOJURE_CORE_BUILTINS

  let fileCount = 0, symbolCount = 0, relCount = 0

  const skips = { read: 0, big: 0, parse: 0, analyze: 0 }
  const firstError = (() => { try { return "" } catch { return "" } })()
  let parseErrSample = ""
  for (const file of files) {
    let content: string
    try { content = readFileSync(file, "utf8") } catch { skips.read++; continue }
    if (content.length > 400_000) { skips.big++; continue }
    let root: any
    try { root = parser.parse(content).rootNode } catch (e) { skips.parse++; if (!parseErrSample) parseErrSample = `${file}: ${(e as Error).message}`; continue }
    fileCount++

    // A. node-type census (walk the RAW tree, the analyzer's skips included —
    // the point is to see the corpus's real vocabulary).
    const stack: any[] = [root]
    const walk = (n: any): void => {
      nodeTypes.set(n.type, (nodeTypes.get(n.type) ?? 0) + 1)
      if (n.type === "ERROR") errNodeFiles.push(file)
      if (!HANDLED.has(n.type) && !SILENT.has(n.type)) {
        const e = unknownNodes.get(n.type)
        if (e) { e.count++; if (e.sample === "") e.sample = `${path.basename(file)}:${n.startPosition.row + 1}` }
        else unknownNodes.set(n.type, { count: 1, sample: `${path.basename(file)}:${n.startPosition.row + 1}` })
      }
      for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) walk(c) }
    }
    walk(root)

    // Analyzer emission.
    let res: any
    try { res = analyzer.analyze(root, content, file) } catch (e) {
      skips.analyze++
      parseErrorFiles.push(`${file}: THREW ${(e as Error).message}`)
      continue
    }
    if ((res.errors ?? []).length > 0) parseErrorFiles.push(file)
    const symbols = res.symbols ?? []
    const rels = res.relationships ?? []
    symbolCount += symbols.length
    relCount += rels.length

    // D. identity census.
    const ids = new Map<string, string>()
    for (const s of symbols) {
      if (!s.name) emptyNames.push(`${path.basename(file)}:${s.range?.startLine} kind=${s.kind}`)
      if (s.name === "unknown" || s.name === "test_undefined") placeholderNames.push(`${path.basename(file)}:${s.range?.startLine} kind=${s.kind}`)
      const k = `${s.scope}|${s.ownerName}|${s.name}|${s.kind}`
      const prev = ids.get(k)
      if (prev) {
        const e = dupIdentity.get(k)
        if (e) e.count++
        else dupIdentity.set(k, { count: 2, sample: `${path.basename(file)} ${prev} + L${s.range?.startLine}` })
      } else ids.set(k, `L${s.range?.startLine}`)
    }

    // in-file declared names (for C.)
    const declared = new Set<string>()
    for (const s of symbols) {
      declared.add(s.name)
      if (s.ownerName) declared.add(s.ownerName)
    }
    // B. form coverage: every list_lit's head form name, and whether the
    // analyzer produced a symbol or edge anywhere in the file attributable to
    // that shape. A head that is neither a builtin nor present in `declared`
    // is the candidate unexplained set — reported with counts, then adjudicated.
    const forms: string[] = []
    const st2: any[] = [root]
    while (st2.length > 0) {
      const n = st2.pop()!
      if (n.type === "list_lit") {
        let head: any = null
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (c && c.type !== "comment" && c.type !== "dis_expr" && c.type !== "meta_lit") { head = c; break }
        }
        if (head && head.type === "sym_lit") {
          let nm = head.text
          const f = head.childForFieldName("name")
          if (f) nm = f.text
          forms.push(nm)
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) st2.push(c) }
    }
    const emittedNames = new Set<string>(symbols.map((s: any) => s.name))
    for (const f of forms) {
      const e = headForms.get(f)
      const has = emittedNames.has(f) || declared.has(f)
      if (e) { e.count++; if (has) e.symbol++ }
      else headForms.set(f, { count: 1, symbol: has ? 1 : 0, edge: 0, sample: `${path.basename(file)}` })
    }

    // C. target resolution.
    for (const r of rels) {
      if (r.type !== "calls" && r.type !== "instantiates" && r.type !== "implements" && r.type !== "references") continue
      const t = String(r.target)
      const bare = !t.includes("/") && !t.includes(".")
      if (!bare) continue
      if (declared.has(t) || CORE[t]) continue
      if (r.type === "references") continue
      const key = `${r.type}->${t}`
      const e = dangling.get(key)
      if (e) { e.count++; e.files.add(path.basename(file)) }
      else dangling.set(key, { count: 1, kind: r.type, files: new Set([path.basename(file)]) })
    }
  }

  const out = {
    repo, shard, nshards, fileCount, symbolCount, relCount,
    nodeTypes: Object.fromEntries([...nodeTypes.entries()].sort((a, b) => b[1] - a[1])),
    unknownNodes: Object.fromEntries([...unknownNodes.entries()].sort((a, b) => b[1].count - a[1].count)),
    headForms: Object.fromEntries([...headForms.entries()].sort((a, b) => b[1].count - a[1].count)),
    dangling: Object.fromEntries([...dangling.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 400)),
    dupIdentity: Object.fromEntries([...dupIdentity.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 200)),
    placeholderNames: placeholderNames.slice(0, 100),
    emptyNames: emptyNames.slice(0, 100),
    errNodeFiles: [...new Set(errNodeFiles)].slice(0, 200),
    parseErrorFiles: parseErrorFiles.slice(0, 50),
  }
  if (outPath) writeFileSync(outPath, JSON.stringify(out, null, 1))
  if (process.env.BB_DEBUG_LIST) console.error(`[skips] ${JSON.stringify(skips)} firstParseError=${parseErrSample}`)
  void firstError
  const brief = { repo, shard, nshards, fileCount, symbolCount, relCount, unknownNodeTypes: Object.keys(out.unknownNodes), errNodeFiles: out.errNodeFiles.length, parseErrorFiles: out.parseErrorFiles.length, placeholders: out.placeholderNames.length, emptyNames: out.emptyNames.length, distinctNodeTypes: Object.keys(out.nodeTypes).length }
  console.log(JSON.stringify(brief, null, 1))
}

main().catch((e) => { console.error(e); process.exit(1) })

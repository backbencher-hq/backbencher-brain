// Haskell local-identity probe (M60 functional lane, 2026-09-26).
//
// The HSD6/HSD19 contract attributes a where/let-local's body calls to the
// LOCAL and lets locals resolve as call targets — but with BARE names. A file
// that also has a module-level symbol of the same name (a shadowing binder,
// e.g. `pure`/`fmap`/`show` shadowed by a where-binder) then carries one graph
// node for two callables: the edge is ambiguous.
//
// This probe measures, on a FULL corpus extent (not a sample):
//   - files with a shadowing binder (binder name == a module-level symbol name)
//   - calls/instantiates edges whose endpoint is such a name   (the ambiguity)
//   - local-chain endpoints (`owner.local`) — the post-fix identity
//   - bare undeclared call sources — the pre-fix local-body attribution
// Endpoint classification is rule-agnostic (it only reads emitted text +
// the file's symbol names + the tree's binder names), so the SAME probe runs
// before and after the analyzer change and the two artifacts are comparable.
//
// Usage: bun script/m14/tmp/hs-local-identity.ts <repoRoot> [...] [--out file] [--shard N/M]
import { Parser, Language } from "web-tree-sitter"
import { RealHaskellAnalyzer } from "../../../src/ast/real-haskell-analyzer"
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const argv = process.argv.slice(2)
const roots: string[] = []
let outPath = ""
let mergeWith = ""
let phase = ""
let shard = 0
let shards = 1
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (a === "--out") outPath = argv[++i]
  else if (a === "--merge-with") mergeWith = argv[++i]
  else if (a === "--phase") phase = argv[++i]
  else if (a === "--shard") {
    const [n, m] = argv[++i].split("/").map(Number)
    shard = n
    shards = m
  } else roots.push(a)
}
if (!roots.length) roots.push("<corpus-root>/bb_tests/repositories/hledger")

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const e of entries) {
    if (e === ".git" || e === "dist-newstyle" || e === "node_modules" || e === ".stack-work") continue
    const p = join(dir, e)
    let st
    try {
      st = statSync(p)
    } catch {
      continue
    }
    if (st.isDirectory()) walk(p, out)
    else if (e.endsWith(".hs") || e.endsWith(".lhs")) out.push(p)
  }
  return out
}

interface EndpointStat {
  resolved: number
  bareShadowed: number
  bareBinder: number
  bareUndeclared: number
  localChain: number
}



async function main() {
  await Parser.init()
  const parser = new Parser()
  parser.setLanguage(await Language.load(new URL("../../../wasm/tree-sitter-haskell.wasm", import.meta.url).pathname))

  const all = roots.flatMap((r) => walk(r)).sort()
  const files = all.filter((_, i) => i % shards === shard)
  console.log(`files=${files.length} (of ${all.length}) roots=${roots.join(",")}`)

  const srcStat: EndpointStat = { resolved: 0, bareShadowed: 0, bareBinder: 0, bareUndeclared: 0, localChain: 0 }
  const tgtStat: EndpointStat = { resolved: 0, bareShadowed: 0, bareBinder: 0, bareUndeclared: 0, localChain: 0 }
  let filesWithLocalAttributedEdges = 0
  const binderEndpointHistogram = new Map<string, number>()
  let filesWithShadow = 0
  let shadowPairs = 0
  let edgesCalls = 0
  let edgesInst = 0
  let parseFailed = 0
  let filesWithLocalBinders = 0
  let localBinderCount = 0
  const undeclaredSourceHistogram = new Map<string, number>()
  const undeclaredTargetHistogram = new Map<string, number>()
  const shadowExamples: { file: string; names: string[] }[] = []
  const chainExamples: { file: string; edges: string[] }[] = []
  const shadowEdgeExamples: { file: string; edges: string[] }[] = []
  const nameHistogram = new Map<string, number>()

  // A local binder: a callable node (function/bind, not arrow-bind, not a
  // type-position function) that is a DIRECT child of a local_binds / let node.
  const collectBinders = (block: any, out: string[]) => {
    for (let i = 0; i < block.namedChildCount; i++) {
      const c = block.namedChild(i)
      if (!c || (c.type !== "function" && c.type !== "bind")) continue
      if (c.type === "function" && (c.childForFieldName?.("parameter") || c.childForFieldName?.("result"))) continue
      if (c.type === "bind" && c.children.some((x: any) => x.type === "<-")) continue
      const head = c.namedChildCount > 0 ? c.namedChild(0) : null
      if (!head) continue
      if (head.type === "variable") out.push(head.text)
      else if (head.type === "infix" || head.type === "prefix_id") {
        const op = head.namedChildren.find((x: any) => x.type === "operator")
        if (op?.text) out.push(op.text)
        else {
          const infixId = head.namedChildren.find((x: any) => x.type === "infix_id")
          const tv = infixId?.namedChildren.find((x: any) => x.type === "variable")
          if (tv?.text) out.push(tv.text)
        }
      }
    }
  }

  const started = Date.now()
  for (const file of files) {
    let src: string
    try {
      src = readFileSync(file, "utf8")
    } catch {
      continue
    }
    const tree = parser.parse(src)
    if (!tree) {
      parseFailed++
      continue
    }
    let res: any
    try {
      res = new RealHaskellAnalyzer().analyze(tree.rootNode, src, file)
    } catch {
      parseFailed++
      tree.delete()
      continue
    }
    // Binder names: direct children of every local_binds / let block.
    const binders = new Set<string>()
    const stack: any[] = [tree.rootNode]
    while (stack.length) {
      const n = stack.pop()
      if (n.type === "local_binds" || n.type === "let" || n.type === "let_in") {
        const tmp: string[] = []
        collectBinders(n, tmp)
        for (const t of tmp) binders.add(t)
      }
      for (let i = 0; i < n.namedChildCount; i++) stack.push(n.namedChild(i))
    }
    tree.delete()

    const symbolNames = new Set<string>()
    const symbolKinds = new Map<string, Set<string>>()
    for (const s of res.symbols ?? []) {
      if (!s?.name) continue
      symbolNames.add(String(s.name))
      const k = symbolKinds.get(String(s.name)) ?? new Set<string>()
      k.add(String(s.kind))
      symbolKinds.set(String(s.name), k)
    }
    // Module-level symbol names only: locals are never symbols, so symbolNames
    // IS the module-level set by contract. A local's OWNER is always a
    // function/method — constructors and types sharing the head text (e.g.
    // `data Side = L | R` vs the module alias `L.span_`) must not be mistaken
    // for an owner chain (recorded refinement, 2026-09-26).
    const isOwner = (n: string) => {
      const ks = symbolKinds.get(n)
      return ks !== undefined && (ks.has("function") || ks.has("method"))
    }
    if (binders.size) {
      filesWithLocalBinders++
      localBinderCount += binders.size
    }
    const shadow = [...binders].filter((b) => symbolNames.has(b)).sort()
    if (shadow.length) {
      filesWithShadow++
      shadowPairs += shadow.length
      if (shadowExamples.length < 15) shadowExamples.push({ file, names: shadow })
    }

    let hadLocalAttribution = false
    for (const r of res.relationships ?? []) {
      const t = String(r.type)
      if (t !== "calls" && t !== "instantiates") continue
      if (t === "calls") edgesCalls++
      else edgesInst++
      const s = String(r.source ?? "")
      const g = String(r.target ?? "")
      const classify = (name: string, stat: EndpointStat) => {
        if (!name) return
        if (symbolNames.has(name)) {
          stat.resolved++
          return
        }
        if (name.includes(".")) {
          // `owner.local` shape: head segment is a function/method symbol (the
          // only kinds that can own a local), tail segment is a binder name.
          // The kind test replaced an earlier `CALLABLE_ENDPOINT` regex — a
          // constructor-headed qualified target (`T.unpack` with `data … = T`)
          // was never a chain, and the kind test says so directly.
          const head = name.slice(0, name.indexOf("."))
          const tail = name.slice(name.lastIndexOf(".") + 1)
          if (isOwner(head) && binders.has(tail)) {
            stat.localChain++
            if (chainExamples.length < 15) {
              const bucket = chainExamples.find((e) => e.file === file)
              if (bucket) bucket.edges.push(`${s} -> ${g} (${name})`)
              else chainExamples.push({ file, edges: [`${s} -> ${g} (${name})`] })
            }
            return
          }
        }
        if (name.includes(".")) return // qualified module target (M.lookup)
        if (binders.has(name)) stat.bareBinder++
        if (shadow.includes(name)) {
          stat.bareShadowed++
          const bucket = shadowEdgeExamples.find((e) => e.file === file)
          const line = r.line_number !== undefined ? `@${r.line_number}` : ""
          if (bucket) bucket.edges.push(`${t} ${s} -> ${g} ${line}`)
          else if (shadowEdgeExamples.length < 15) shadowEdgeExamples.push({ file, edges: [`${t} ${s} -> ${g} ${line}`] })
          nameHistogram.set(name, (nameHistogram.get(name) ?? 0) + 1)
        } else stat.bareUndeclared++
      }
      const sBefore = srcStat.bareUndeclared
      const gBefore = tgtStat.bareUndeclared
      const sBinder = srcStat.bareBinder
      const gBinder = tgtStat.bareBinder
      classify(s, srcStat)
      classify(g, tgtStat)
      if (srcStat.bareBinder > sBinder) {
        hadLocalAttribution = true
        if (!s.includes(".")) binderEndpointHistogram.set(s, (binderEndpointHistogram.get(s) ?? 0) + 1)
      }
      if (tgtStat.bareBinder > gBinder) hadLocalAttribution = true
      if (srcStat.bareUndeclared > sBefore && !s.includes(".")) undeclaredSourceHistogram.set(s, (undeclaredSourceHistogram.get(s) ?? 0) + 1)
      if (tgtStat.bareUndeclared > gBefore && !g.includes(".")) undeclaredTargetHistogram.set(g, (undeclaredTargetHistogram.get(g) ?? 0) + 1)
    }
    if (hadLocalAttribution) filesWithLocalAttributedEdges++
  }

  const elapsed = ((Date.now() - started) / 1000).toFixed(1)
  const summary = {
    probe: "hs-local-identity",
    basis: "script/m14/tmp/hs-local-identity.ts on the same draw; before = analyzer @35e80314 (bare local endpoints), after = scoped local identity",
    roots,
    files: files.length,
    parseFailed,
    filesWithShadowingBinder: filesWithShadow,
    shadowingBinderNames: shadowPairs,
    filesWithLocalBinders,
    localBinderNames: localBinderCount,
    binderEndpointTop: [...binderEndpointHistogram.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30),
    filesWithLocalAttributedEdges,
    localAttributedEdgesSeen: filesWithLocalAttributedEdges,
    undeclaredSourceTop: [...undeclaredSourceHistogram.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30),
    undeclaredTargetTop: [...undeclaredTargetHistogram.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30),
    callsEdges: edgesCalls,
    instantiatesEdges: edgesInst,
    sources: srcStat,
    targets: tgtStat,
    elapsedSeconds: Number(elapsed),
    shadowEdgeHistogram: [...nameHistogram.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30),
    shadowExamples: shadowExamples.slice(0, 15),
    shadowEdgeExamples,
    localChainExamples: chainExamples,
  }

  console.log(`files=${files.length} parseFailed=${parseFailed} elapsed=${elapsed}s`)
  console.log(`files with local binders: ${filesWithLocalBinders}  (binder names ${localBinderCount}); with shadowing binder: ${filesWithShadow} (names ${shadowPairs})`)
  console.log(`top undeclared SOURCE names: ${[...undeclaredSourceHistogram.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([n, c]) => `${n}:${c}`).join(" ")}`)
  console.log(`top undeclared TARGET names: ${[...undeclaredTargetHistogram.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([n, c]) => `${n}:${c}`).join(" ")}`)
  console.log(`calls edges: ${edgesCalls}   instantiates edges: ${edgesInst}`)
  console.log(`SOURCES: resolved=${srcStat.resolved} bareShadowed=${srcStat.bareShadowed} bareBinder=${srcStat.bareBinder} bareUndeclared=${srcStat.bareUndeclared} localChain=${srcStat.localChain}`)
  console.log(`TARGETS: resolved=${tgtStat.resolved} bareShadowed=${tgtStat.bareShadowed} bareBinder=${tgtStat.bareBinder} bareUndeclared=${tgtStat.bareUndeclared} localChain=${tgtStat.localChain}`)
  console.log(`\n--- shadowing binders (up to 15) ---`)
  for (const e of shadowExamples) console.log(`  ${e.file.replace(/^.*repositories\//, "")}  ${e.names.join(", ")}`)
  console.log(`\n--- ambiguous (bare shadowed) endpoint edges (up to 15) ---`)
  for (const e of shadowEdgeExamples) console.log(`  ${e.file.replace(/^.*repositories\//, "")}  ${e.edges.slice(0, 6).join(" | ")}`)
  console.log(`\n--- local-chain endpoints (up to 15) ---`)
  for (const e of chainExamples) console.log(`  ${e.file.replace(/^.*repositories\//, "")}  ${e.edges.slice(0, 6).join(" | ")}`)

  if (outPath) {
    if (mergeWith) {
      const before = JSON.parse(readFileSync(mergeWith, "utf8"))
      writeFileSync(
        outPath,
        JSON.stringify(
          {
            schemaVersion: 1,
            kind: "m60-haskell-local-identity",
            basis:
              "script/m14/tmp/hs-local-identity.ts, one instrument, both runs, same draw (hledger 186 .hs + cabal 2,150 .hs): `before` = the analyzer at 35e80314 (bare local endpoints), `after` = the scoped-local identity round. `bareBinder` = an endpoint whose name equals a local binder name in the same file (the pre-fix local attribution); `localChain` = an endpoint whose head is a function/method symbol and whose tail is a local binder name (the scoped `owner.local` identity); `resolved` = endpoint is a file symbol; `bareUndeclared` = any other bare endpoint (constructors, imported names). Endpoint classification is rule-agnostic — it reads only emitted text, the symbol table and the tree's binder names — so both runs are comparable. Recorded refinement: the local-chain head test was tightened mid-round from `head is any symbol` to `head is a function/method symbol` after the first after-run let single-uppercase CONSTRUCTOR symbols (`data Side = L | R`) masquerade as owners; the before-side bucket is unaffected (its local-chain count was 0 by measurement, and dotted non-chain endpoints were unclassified under both spellings).",
            before,
            after: summary,
          },
          null,
          1,
        ),
      )
    } else {
      writeFileSync(outPath, JSON.stringify({ ...summary, phase }, null, 1))
    }
  }
  parser.delete()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

// Functional-family surface probe (M60 family report, 2026-09-26).
//
// The family's per-lane artifacts answer "is the lane's own claim true" (M12
// truth, F5 oracle row, fixtures, mutants). They do NOT answer two questions a
// consumer of the graph asks: WHICH relationship types does each analyzer emit
// at all, and DO THE EMITTED EDGES RESOLVE (endpoint names that exist as
// entities in the same file) or dangle. This probe measures both, one ruler for
// all six lanes, over each lane's pinned corpus repos.
//
// Usage: bun script/m14/tmp/functional-family-surface.ts [--lane <name>] [--cap N] [--out file]
import * as fs from "node:fs"
import * as path from "node:path"

const REPOS = "/home/ishaq2321/bb_tests/repositories"
const WASM = "/home/ishaq2321/mcp/backbencher-brain/wasm"

interface LaneSpec {
  lane: string
  mod: string
  cls: string
  wasm: string
  exts: string[]
  roots: string[]
  note?: string
}

const LANES: LaneSpec[] = [
  { lane: "haskell", mod: "real-haskell-analyzer", cls: "RealHaskellAnalyzer", wasm: "tree-sitter-haskell.wasm", exts: [".hs", ".lhs"], roots: ["hledger", "cabal"] },
  { lane: "elixir", mod: "real-elixir-analyzer", cls: "RealElixirAnalyzer", wasm: "tree-sitter-elixir.wasm", exts: [".ex", ".exs"], roots: ["elixir"] },
  { lane: "erlang", mod: "real-erlang-analyzer", cls: "RealErlangAnalyzer", wasm: "tree-sitter-erlang.wasm", exts: [".erl"], roots: ["otp", "rebar3"] },
  { lane: "clojure", mod: "real-clojure-analyzer", cls: "RealClojureAnalyzer", wasm: "tree-sitter-clojure.wasm", exts: [".clj", ".cljc", ".cljs"], roots: ["clj-kondo", "clojure"] },
  { lane: "clean", mod: "real-clean-analyzer", cls: "RealCleanAnalyzer", wasm: "tree-sitter-clean.wasm", exts: [".icl", ".dcl"], roots: ["clean-stdlib", "Clyde"] },
  { lane: "fsharp", mod: "real-fsharp-analyzer", cls: "RealFsharpAnalyzer", wasm: "tree-sitter-fsharp.wasm", exts: [".fs", ".fsi", ".fsx"], roots: ["fsharp"] },
]

const argv = process.argv.slice(2)
const only = argv.includes("--lane") ? argv[argv.indexOf("--lane") + 1] : ""
const cap = argv.includes("--cap") ? Number(argv[argv.indexOf("--cap") + 1]) : 4000
const outPath = argv.includes("--out") ? argv[argv.indexOf("--out") + 1] : ""

function walk(dir: string, exts: string[], out: string[] = []): string[] {
  let entries: string[]
  try {
    entries = fs.readdirSync(dir)
  } catch {
    return out
  }
  for (const e of entries) {
    if (e === ".git" || e === "node_modules" || e === "dist-newstyle" || e === ".stack-work" || e === "_build" || e === "deps" || e === "obj") continue
    const p = path.join(dir, e)
    let st: any
    try {
      st = fs.statSync(p)
    } catch {
      continue
    }
    if (st.isDirectory()) walk(p, exts, out)
    else if (exts.some((x) => e.endsWith(x))) out.push(p)
  }
  return out
}

const REL_ORDER = ["calls", "references", "contains", "instantiates", "implements", "extends", "overrides", "uses", "imports", "exports"]

async function main() {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join("/home/ishaq2321/mcp/backbencher-brain/node_modules/web-tree-sitter/tree-sitter.wasm") })

  const combined: any[] = []
  for (const spec of LANES) {
    if (only && only !== spec.lane) continue
    const lang: any = await L.load(path.join(WASM, spec.wasm))
    const parser = new P()
    parser.setLanguage(lang)
    const mod: any = await import(path.join("/home/ishaq2321/mcp/backbencher-brain/src/ast", spec.mod))
    const Analyzer = mod[spec.cls]
    const files = spec.roots.flatMap((r) => walk(path.join(REPOS, r), spec.exts)).sort().slice(0, cap)

    const relTypes = new Map<string, number>()
    const symbolKinds = new Map<string, number>()
    const endpoint = { symbol: 0, scoped: 0, qualified: 0, externalLeaf: 0, empty: 0 }
    const endpointSource = { symbol: 0, scoped: 0, qualified: 0, externalLeaf: 0, empty: 0 }
    const endpointTarget = { symbol: 0, scoped: 0, qualified: 0, externalLeaf: 0, empty: 0 }
    // Per-type end classification: source ends and target ends separately, so
    // "does this analyzer RESOLVE its <type> edges" is answerable per type.
    const byType = new Map<string, { srcR: number; srcQ: number; srcX: number; tgtR: number; tgtQ: number; tgtX: number }>()
    let throws = 0
    let errorTreeFiles = 0
    let symbols = 0
    let rels = 0
    let edgesWithLine = 0
    let symbolsWithLine = 0
    const started = Date.now()

    for (const file of files) {
      let src: string
      try {
        src = fs.readFileSync(file, "utf8")
      } catch {
        continue
      }
      const tree = parser.parse(src)
      if (!tree) {
        throws++
        continue
      }
      if (tree.rootNode.hasError) errorTreeFiles++
      let r: any
      try {
        r = new Analyzer().analyze(tree.rootNode, src, file)
      } catch {
        throws++
        tree.delete()
        continue
      }
      tree.delete()
      const names = new Set<string>()
      const owners = new Set<string>()
      for (const s of r.symbols ?? []) {
        if (!s?.name) continue
        names.add(String(s.name))
        symbols++
        if (typeof s.range?.startLine === "number" && s.range.startLine > 0) symbolsWithLine++
        const k = String(s.kind)
        symbolKinds.set(k, (symbolKinds.get(k) ?? 0) + 1)
        if (k === "function" || k === "method") owners.add(String(s.name))
      }
      const classify = (name: string) => {
        if (!name) return "empty"
        if (names.has(name)) return "symbol"
        if (name.includes(".") || name.includes(":")) {
          const head = name.split(/[.:]/)[0]
          if (owners.has(head)) return "scoped"
          return "qualified"
        }
        return "externalLeaf"
      }
      for (const rel of r.relationships ?? []) {
        const t = String(rel.type ?? rel.relationshipType)
        relTypes.set(t, (relTypes.get(t) ?? 0) + 1)
        rels++
        if (typeof rel.line_number === "number" && rel.line_number > 0) edgesWithLine++
        const sCls = classify(String(rel.source ?? ""))
        const tCls = classify(String(rel.target ?? ""))
        endpoint[sCls as keyof typeof endpoint]++
        endpoint[tCls as keyof typeof endpoint]++
        endpointSource[sCls as keyof typeof endpointSource]++
        endpointTarget[tCls as keyof typeof endpointTarget]++
        const row = byType.get(t) ?? { srcR: 0, srcQ: 0, srcX: 0, tgtR: 0, tgtQ: 0, tgtX: 0 }
        // R = resolved in-file (symbol or scoped), Q = qualified module call,
        // X = dangling leaf / empty.
        if (sCls === "symbol" || sCls === "scoped") row.srcR++
        else if (sCls === "qualified") row.srcQ++
        else row.srcX++
        if (tCls === "symbol" || tCls === "scoped") row.tgtR++
        else if (tCls === "qualified") row.tgtQ++
        else row.tgtX++
        byType.set(t, row)
      }
    }
    const elapsed = ((Date.now() - started) / 1000).toFixed(1)
    const laneSummary = {
      lane: spec.lane,
      roots: spec.roots,
      filesSampled: files.length,
      cap,
      parseThrows: throws,
      filesWithErrorNodes: errorTreeFiles,
      symbols,
      symbolsWithPositiveLine: symbolsWithLine,
      relationships: rels,
      edgesWithPositiveLine: edgesWithLine,
      edgeLineShare: rels > 0 ? Number((edgesWithLine / rels).toFixed(4)) : null,
      symbolKinds: Object.fromEntries([...symbolKinds.entries()].sort((a, b) => b[1] - a[1])),
      relationshipTypes: Object.fromEntries([...relTypes.entries()].sort((a, b) => b[1] - a[1])),
      relationshipTypesAbsent: REL_ORDER.filter((t) => !relTypes.has(t)),
      endpointTotals: endpoint,
      endpointSource,
      endpointTarget,
      byTypeResolution: Object.fromEntries([...byType.entries()].sort((a, b) => (b[1].srcR + b[1].tgtR) - (a[1].srcR + a[1].tgtR))),
      // Shares of ONE side (each side has `rels` ends).
      sourceResolvedShare: rels > 0 ? Number(((endpointSource.symbol + endpointSource.scoped) / rels).toFixed(4)) : null,
      targetResolvedShare: rels > 0 ? Number(((endpointTarget.symbol + endpointTarget.scoped) / rels).toFixed(4)) : null,
      targetStrictSymbolShare: rels > 0 ? Number((endpointTarget.symbol / rels).toFixed(4)) : null,
      elapsedSeconds: Number(elapsed),
    }
    combined.push(laneSummary)
    console.log(
      `${spec.lane.padEnd(9)} files=${String(files.length).padStart(5)} throws=${throws} errTree=${errorTreeFiles} ` +
        `symbols=${String(symbols).padStart(6)} rels=${String(rels).padStart(7)} lines=${String(edgesWithLine).padStart(7)}(${rels > 0 ? ((edgesWithLine / rels) * 100).toFixed(1) : "-"}%) ` +
        `types=${Object.keys(laneSummary.relationshipTypes).length} absent=[${laneSummary.relationshipTypesAbsent.join(",")}] ` +
        `src-resolved=${laneSummary.sourceResolvedShare} tgt-resolved=${laneSummary.targetResolvedShare} (strict=${laneSummary.targetStrictSymbolShare}) ${elapsed}s`,
    )
    for (const [t, row] of Object.entries(laneSummary.byTypeResolution) as [string, any][]) {
      console.log(`           ${t.padEnd(13)} src resolved=${row.srcR} qualified=${row.srcQ} dangling=${row.srcX} | tgt resolved=${row.tgtR} qualified=${row.tgtQ} dangling=${row.tgtX}`)
    }
    console.log(`           rels: ${Object.entries(laneSummary.relationshipTypes).map(([k, v]) => `${k}:${v}`).join(" ")}`)
    console.log(`           ends: ${JSON.stringify(endpoint)}`)
  }

  if (outPath) {
    fs.mkdirSync(path.dirname(outPath), { recursive: true })
    fs.writeFileSync(
      outPath,
      JSON.stringify(
        {
          schemaVersion: 1,
          kind: "m60-functional-family-surface",
          generatedAt: new Date().toISOString(),
          basis:
            "script/m14/tmp/functional-family-surface.ts — one ruler for all six family lanes over their pinned corpus repos (per-lane cap recorded per row). `relationshipTypes` is what the analyzer actually emits; `relationshipTypesAbsent` is measured against the engine's ten names (calls, references, contains, instantiates, implements, extends, overrides, uses, imports, exports). `endpointTotals` classifies every edge END: `symbol` = the name is a symbol in the same file, `scoped` = head is a function/method symbol and the rest is a qualified/lexical suffix (lane-local scoping), `qualified` = dotted/colon-qualified target whose head is not a file callable (module/import call), `externalLeaf` = bare name that is no entity in the file (imported/Prelude/builtin leaf), `empty` = empty endpoint. `endpointEndsResolved` counts symbol+scoped; `endpointResolvedStrict` counts symbol only.",
          lanes: combined,
        },
        null,
        1,
      ) + "\n",
    )
    console.log(`wrote ${outPath}`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

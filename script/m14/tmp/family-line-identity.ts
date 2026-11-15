// Family line-identity probe (M60 report, 2026-09-26).
//
// The LCM `lines` cell is "line_number alive (M59.A7)" and is currently
// `fail` for erlang (and, stale, for clean/haskell where the contract landed).
// The field being present and the line being part of the EDGE IDENTITY are two
// different claims: a per-set key keeps the first site and swallows the rest.
// This probe answers the identity half directly, with a two-site snippet per
// lane: the SAME callee called from two different lines must produce TWO
// `calls` edges with the two own lines.
//
// Usage: bun script/m14/tmp/family-line-identity.ts
import * as fs from "node:fs"
import * as path from "node:path"

const ROOT = "/home/ishaq2321/mcp/backbencher-brain"

const CASES: { lane: string; mod: string; cls: string; wasm: string; ext: string; src: string; callee: string; caller: string }[] = [
  {
    lane: "erlang",
    mod: "real-erlang-analyzer",
    cls: "RealErlangAnalyzer",
    wasm: "tree-sitter-erlang.wasm",
    ext: "erl",
    callee: "g",
    caller: "f",
    src: "-module(probe).\n-export([f/1]).\n\ng(X) -> X.\n\nf(X) ->\n    A = g(X),\n    B = g(X),\n    A + B.\n",
  },
  {
    lane: "elixir",
    mod: "real-elixir-analyzer",
    cls: "RealElixirAnalyzer",
    wasm: "tree-sitter-elixir.wasm",
    ext: "ex",
    callee: "g",
    caller: "f",
    src: "defmodule Probe do\n  defp g(x), do: x\n\n  def f(x) do\n    a = g(x)\n    b = g(x)\n    a + b\n  end\nend\n",
  },
  {
    lane: "clojure",
    mod: "real-clojure-analyzer",
    cls: "RealClojureAnalyzer",
    wasm: "tree-sitter-clojure.wasm",
    ext: "clj",
    callee: "g",
    caller: "f",
    src: "(ns probe)\n\n(defn g [x] x)\n\n(defn f [x]\n  (let [a (g x)\n        b (g x)]\n    (+ a b)))\n",
  },
  {
    lane: "haskell",
    mod: "real-haskell-analyzer",
    cls: "RealHaskellAnalyzer",
    wasm: "tree-sitter-haskell.wasm",
    ext: "hs",
    callee: "g",
    caller: "f",
    src: "module Probe where\n\ng :: Int -> Int\ng x = x\n\nf :: Int -> Int\nf x\n  | x > 0 = g x\n  | otherwise = g (x + 1)\n",
  },
]

async function main() {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
  const rows: any[] = []
  for (const c of CASES) {
    const lang: any = await L.load(path.join(ROOT, "wasm", c.wasm))
    const parser = new P()
    parser.setLanguage(lang)
    const mod: any = await import(path.join(ROOT, "src/ast", c.mod))
    const file = `/tmp/probe-line-identity.${c.ext}`
    const tree = parser.parse(c.src)
    const r: any = new mod[c.cls]().analyze(tree.rootNode, c.src, file)
    // Lane-local sources are spelled differently (elixir `Probe.f/1`), so the
    // caller match is a segment match, not a prefix match.
    const hits = (r.relationships ?? []).filter((x: any) => {
      if (String(x.type) !== "calls") return false
      const src = String(x.source)
      const tgt = String(x.target)
      return (src === c.caller || src.includes(`.${c.caller}`)) && (tgt === c.callee || tgt.includes(`.${c.callee}`) || tgt.startsWith(c.callee + "/"))
    })
    const lines = hits.map((x: any) => x.line_number ?? null).sort()
    const verdict = hits.length >= 2 && new Set(lines).size === hits.length ? "per-site" : hits.length === 1 ? "per-set (second site swallowed)" : "other"
    console.log(
      `${c.lane.padEnd(9)} calls ${c.caller}->${c.callee}: edges=${hits.length} lines=[${lines.join(",")}] -> ${verdict}`,
    )
    rows.push({ lane: c.lane, edges: hits.length, lines, verdict, snippetLines: c.src.split("\n").length })
    tree.delete()
  }
  const out = path.join(ROOT, "validation/m14/results/archive/family-line-identity.json")
  fs.writeFileSync(
    out,
    JSON.stringify(
      {
        schemaVersion: 1,
        kind: "m60-family-line-identity",
        generatedAt: new Date().toISOString(),
        basis:
          "script/m14/tmp/family-line-identity.ts — one two-site snippet per lane (same callee, two lines, one caller). `per-site` means the line is part of the edge identity key (two edges, each with its own line); `per-set` means the key collapses them (the pre-M59.A7 shape). Complements M60.P1/LCM `lines` field-presence with the identity half.",
        rows,
      },
      null,
      1,
    ) + "\n",
  )
  console.log(`wrote ${out}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

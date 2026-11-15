// Elixir oracle vs analyzer — the alias table is not ORDER-faithful.
//
// Minimal repro of the two elixir hard masks of run 1z7l-muhm9vrp: `alias_test.exs` line 25
// `Nested.value()` answered as `List.value` (the `alias(List, as: Nested)` is at line 29), and
// `enum_test.exs` line 849 `Map.to_list` answered as `EnumTest.Map.to_list` (the
// `defmodule EnumTest.Map` is at line 2595).
//
// Mechanism: the oracle resolves references in a SECOND pass over a table built by the first, and
// pass 2's lookups (`aliasLookup` in `emitCall`, `resolveAliasO` on targets) read the FINAL table —
// so a definition written AFTER a reference applies to it, and a `defmodule` that closes later
// registers its implied alias for references that came before. The analyzer walks in order.
//
// Every case prints BOTH sides: the analyzer is the contract this oracle has to mirror, so an
// expectation written in a label is worth less than the analyzer's own answer. Case 7 exists to
// settle a contract question the first version of this probe only assumed: does an alias written
// inside a macro do-block stay inside it (block-scoped) or leak to the rest of the module?
//
// Run: bun script/m14/tmp/elx-alias-order-repro.ts
import fs from "node:fs"
import path from "node:path"
import { deriveElixirEdges } from "../differential"
import { RealElixirAnalyzer } from "../../../src/ast/real-elixir-analyzer"

const ROOT = path.resolve(import.meta.dirname ?? ".", "..", "..", "..")
const ws: any = await import("web-tree-sitter")
const P: any = ws.Parser ?? ws.default ?? ws
const L: any = ws.Language ?? ws.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const grammar = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-elixir.wasm")))

const CASES: [string, string][] = [
  ["later alias must not reach an earlier call", `defmodule Kernel.AliasTest do
  alias Kernel.AliasTest.Nested, as: Nested

  def a, do: Nested.value()

  def b do
    alias List, as: Nested
    Nested.flatten([1])
  end
end
`],
  ["later nested defmodule must not reach an earlier call", `defmodule EnumTest do
  def a, do: Map.to_list(%{b: 2})

  defmodule Map do
    def to_list(m), do: m
  end
end
`],
  ["control: the alias BEFORE the call resolves", `defmodule Kernel.AliasTest do
  alias Kernel.AliasTest.Nested, as: Nested
  def a, do: Nested.value()
end
`],
  ["control: the nested defmodule BEFORE the call resolves", `defmodule EnumTest do
  defmodule Map do
    def to_list(m), do: m
  end

  def a, do: Map.to_list(%{b: 2})
end
`],
  ["the real shape of mask 2: later alias in a macro do-block", `defmodule Kernel.AliasTest do
  alias Kernel.AliasTest.Nested, as: Nested

  test "double alias" do
    assert Nested.value() == 1
  end

  test "overwritten alias" do
    assert alias(List, as: Nested) == List
    assert Nested.flatten([1]) == [1]
  end
end
`],
  ["control: the macro-block alias serves its own block", `defmodule Kernel.AliasTest do
  test "overwritten alias" do
    assert alias(List, as: Nested) == List
    assert Nested.flatten([1]) == [1]
  end
end
`],
  // Contract question, measured rather than assumed: after the block closes, does the block's
  // alias still resolve a reference in the enclosing module?
  ["after a block's alias closes, does it still resolve outside?", `defmodule Kernel.AliasTest do
  test "overwritten alias" do
    assert alias(List, as: Nested) == List
  end

  def a, do: Nested.flatten([1])
end
`],
]

const parser = new P()
parser.setLanguage(grammar)
let disagreements = 0
for (const [label, src] of CASES) {
  const root = parser.parse(src)!.rootNode
  // The comparison is on the TARGET, which is the contract the differential itself uses
  // (label+target, site-agnostic): the analyzer's `source` carries an arity suffix
  // (`Kernel.AliasTest.a/0`) that the oracle is not asked to reproduce, and comparing the two
  // spellings would report a disagreement on every correct row.
  const callsOf = (edges: any[]) => edges.filter((e: any) => e.label === "calls").map((e: any) => `${e.target}`).sort()
  const oracle = callsOf(deriveElixirEdges(root))
  const analyzed: any = await new RealElixirAnalyzer().analyze(root, src, "x.exs")
  const analyzer = (analyzed.relationships ?? [])
    .filter((r: any) => String(r.type).toLowerCase() === "calls")
    .map((r: any) => `${r.target}`).sort()
  const agree = JSON.stringify(oracle) === JSON.stringify(analyzer)
  if (!agree) disagreements++
  console.log(`\n=== ${label}\n  analyzer targets: ${analyzer.length ? analyzer.join(" | ") : "(none)"}\n  oracle   targets: ${oracle.length ? oracle.join(" | ") : "(none)"}\n  → ${agree ? "AGREE" : "DISAGREE"}`)
}
console.log(`\n${disagreements} of ${CASES.length} case(s) disagree on targets.`)

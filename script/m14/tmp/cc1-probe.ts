/**
 * CC1 pins probe — captures the exact emission shapes for the three elixir
 * transparencies (guard-skips, use-option-source, struct-update) so the
 * fixtures pin the REAL behavior, not a guess. Deploys to script/m14/tmp/.
 *
 * Run: bun script/m14/tmp/cc1-probe.ts [caseId]
 */
import { getParser } from "../run-fixtures"

const mod: any = await import("../../../src/ast/real-elixir-analyzer")
const analyzer = new mod.RealElixirAnalyzer()
const parser = await getParser("elixir")

const CASES: { id: string; code: string }[] = [
  {
    id: "guard-skips",
    code: `defmodule Cc1.Guards do
  def guarded(x) when is_integer(x) do
    x
  end

  def multi_guard(x) when is_integer(x) and is_big(x) do
    x
  end

  defguard is_big(x) when is_integer(x) and x > 2
end`,
  },
  {
    id: "use-option-source",
    code: `defmodule Cc1.UseOpts do
  use Cc1.Injectable, opt: helper_fn()

  def helper_fn, do: :ok
end`,
  },
  {
    id: "struct-update",
    code: `defmodule Cc1.StructUpdate do
  def bump(p) do
    %Cc1.Point{p | x: p.x + 1}
  end
end`,
  },
]

const only = process.argv[2]
for (const c of CASES) {
  if (only && c.id !== only) continue
  const tree = parser.parse(c.code)
  const r = analyzer.analyze(tree.rootNode, c.code, `probe/${c.id}.ex`)
  console.log(`\n########## ${c.id} ##########`)
  console.log(`symbols:`)
  for (const s of r.symbols ?? []) {
    console.log(`  ${s.kind}: ${s.ownerName ? s.ownerName + "." : ""}${s.name} @L${s.range?.start?.line ?? "?"}${s.visibility ? ` ${s.visibility}` : ""}`)
  }
  console.log(`rels:`)
  for (const rel of r.relationships ?? []) {
    console.log(`  ${rel.type}: ${rel.source} -> ${rel.target}${rel.line_number ? ` @L${rel.line_number}` : ""}${rel.metadata?.callArity !== undefined ? ` arity=${rel.metadata.callArity}` : ""}`)
  }
  if (r.errors?.length) console.log(`errors: ${r.errors.map((e: any) => e.message).join(" ; ")}`)
}
console.log("\ndone")

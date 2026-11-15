/**
 * Elixir master-review probe (M49 formula pass — reviews/elixir/master-review.md).
 * Runs candidate shapes through the REAL analyzer on the pinned grammar and
 * prints symbols / relationships / docs / patterns for eyeball adjudication.
 *
 * Run: bun script/m14/tmp/elixir-review-probe.ts [caseId]
 */
import { getParser } from "../run-fixtures"

const mod: any = await import("../../../src/ast/real-elixir-analyzer")
const analyzer = new mod.RealElixirAnalyzer()
const parser = await getParser("elixir")

const CASES: { id: string; code: string }[] = [
  {
    id: "chain-forms",
    code: `defmodule Chain do
  def run do
    Mix.shell().error("x")
    a.b().c()
    Foo.bar().baz()
  end
end`,
  },
  {
    id: "default-arg-call",
    code: `defmodule DefArg do
  def f(x \\\\ calc(), y \\\\ 2) do
    x + y
  end

  defp calc, do: 1
end`,
  },
  {
    id: "guard-complexity",
    code: `defmodule Guard do
  def f(x) when is_integer(x) and x > 0 do
    x
  end

  defguard is_odd(x) when rem(x, 2) == 1
end`,
  },
  {
    id: "with-for",
    code: `defmodule W do
  def run(xs) do
    with {:ok, a} <- fetch(), {:ok, b} <- load(a) do
      a + b
    end

    for x <- xs, y <- xs do
      {x, y}
    end
  end

  defp fetch, do: {:ok, 1}
  defp load(a), do: {:ok, a}
end`,
  },
  {
    id: "use-options",
    code: `defmodule U do
  use GenServer, option: Foo.bar()

  def init(_), do: {:ok, %{}}
end`,
  },
  {
    id: "anon-fn-calls",
    code: `defmodule AF do
  def run(xs) do
    Enum.map(xs, fn x -> helper(x) end)
  end

  defp helper(v), do: v
end`,
  },
  {
    id: "capture-qualified",
    code: `defmodule Cap do
  def run do
    &String.length/1
    &local/0
  end

  defp local, do: 1
end`,
  },
  {
    id: "meta-and-patterns",
    code: `defmodule Meta do
  @moduledoc """
  Heredoc docs.
  """

  def f(%{a: a} = m), do: a

  def g([h | t]) when is_list(t), do: h
end`,
  },
  {
    id: "import-except",
    code: `defmodule IE do
  import Enum, except: [map: 2]

  def run(xs), do: map(xs, & &1)
end`,
  },
  {
    id: "sigils",
    code: `defmodule Sig do
  def run do
    ~r/foo/
    ~s(bar)
    ~H"<div>{@x}</div>"
  end
end`,
  },
  {
    id: "defdelegate-as",
    code: `defmodule Del do
  defdelegate rstrip(b), to: String, as: :trim_trailing
end`,
  },
  {
    id: "operator-defs",
    code: `defmodule Oper do
  def a + b, do: a

  def +value, do: value
end`,
  },
  {
    id: "struct-update-guard-call",
    code: `defmodule SUG do
  defstruct a: 1, b: 2

  def bump(%SUG{} = s), do: %SUG{s | a: s.a + 1}

  def guarded(x) when valid?(x), do: x

  defp valid?(_), do: true
end`,
  },
  {
    id: "multiclause",
    code: `defmodule MC do
  def f(1), do: :one
  def f(x), do: x

  def g(x, y) when x > y, do: x
  def g(x, y), do: y
end`,
  },
]

const only = process.argv[2]
for (const c of CASES) {
  if (only && c.id !== only) continue
  const tree = parser.parse(c.code)
  const r = analyzer.analyze(tree.rootNode, c.code, `probe/${c.id}.ex`)
  console.log(`\n══════════ ${c.id} ══════════`)
  console.log(`symbols: ${(r.symbols ?? []).map((s: any) => `${s.kind}:${s.ownerName ? s.ownerName + "." : ""}${s.name}${s.metadata?.arity !== undefined ? "/" + s.metadata.arity : ""}@L${s.range?.start?.line ?? s.range?.start?.row ?? "?"}${s.metadata?.heads > 1 ? ` heads=${s.metadata.heads}` : ""}${s.metadata?.complexity > 1 ? ` cx=${s.metadata.complexity}` : ""}${s.complexity > 1 ? ` cx=${s.complexity}` : ""}${s.visibility === "private" ? " priv" : ""}`).join(" | ")}`)
  console.log(`rels:`)
  for (const rel of r.relationships ?? []) {
    console.log(`  ${rel.type}: ${rel.source} -> ${rel.target}${rel.line_number ? ` @L${rel.line_number}` : ""}${rel.metadata?.callArity ? ` arity=${rel.metadata.callArity}` : ""}${rel.metadata?.isCapture ? " capture" : ""}${rel.metadata?.isDelegate ? " delegate" : ""}`)
  }
  if (r.errors?.length) console.log(`errors: ${r.errors.map((e: any) => e.message).join(" ; ")}`)
}
console.log("\ndone")

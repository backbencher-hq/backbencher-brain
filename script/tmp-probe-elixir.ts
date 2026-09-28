// tmp-probe-elixir.ts — adversarial probe of the Elixir analyzer (2 fixtures).
// Prints exactly what the analyzer emits, with correct field names.
import { parseFile } from "../src/ast/pool-worker"
import { writeFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"

const dir = "/tmp/bb-elixir-probe"
mkdirSync(dir, { recursive: true })

const A = `defmodule Adversarial do
  alias Foo.Bar, as: Local
  import Enum, only: [map: 2, filter: 2]

  @derive [JSON.Encoder, String.Chars]
  defstruct [id: nil, user_name: "x"]

  @behaviour GenServer

  def plain(user_name) do
    helper()
    helper()
    Local.run()
  end

  defp helper, do: :ok

  def classify(x) do
    case x do
      1 -> :one
      2 -> :two
      _ -> :other
    end
  end
end
`

const B = `defprotocol Size do
  def size(data)
end

defimpl Size, for: MyStruct do
  def size(_), do: 0
end

defmodule Lib do
  @moduledoc "Lib docs"

  @type t :: %__MODULE__{x: integer()}

  defmodule Nested do
    defstruct a: 1
  end

  defdelegate call(x), to: Foo

  def multi(1), do: :one
  def multi(2), do: :two

  def build do
    %Lib.Nested{a: 2}
    struct(Foo.Bar, a: 1)
    try do
      risky()
    rescue
      e -> handle(e)
    end
  end

  def with_case(x) do
    with {:ok, v} <- fetch(x) do
      v
    end
  end

  def loop(list) do
    for x <- list, do: x
  end

  defmacro my_macro(ast) do
    quote do
      unquote(ast) + 1
    end
  end

  def captured, do: Enum.map([1], &double/1)
  defp double(x), do: x * 2
end
`

async function probe(name: string, src: string) {
  const p = join(dir, `${name}.ex`)
  writeFileSync(p, src)
  const r: any = await parseFile(p)
  console.log(`\n████ FIXTURE ${name} ████`)
  console.log("-- symbols (kind name owner scope line complexity params) --")
  for (const s of r.symbols) {
    const line = s.startLine ?? s.range?.startLine
    console.log(`  [${s.kind}] ${s.name} owner=${s.ownerName ?? "-"} scope=${s.scope ?? "-"} line=${line} cplx=${s.complexity ?? "-"} params=${(s.parameters ?? []).map((x: any) => x.name).join(",")}`)
  }
  console.log("-- relationships (src -[type]-> tgt line conf) --")
  for (const x of r.relationships as any[]) {
    console.log(`  ${x.source} -[${x.type}]-> ${x.target}  line=${x.line_number ?? x.lineNumber ?? "NULL"} conf=${x.confidence}`)
  }
  console.log("-- imports --")
  for (const i of r.imports as any[]) console.log(`  ${JSON.stringify(i)}`)
  console.log("-- exports --")
  for (const e of r.exports ?? r.exportedSymbols ?? []) console.log(`  ${JSON.stringify(e)}`)
  console.log("-- metadata --")
  console.log("  cyclomatic:", r.metadata?.cyclomaticComplexity, "| complexity:", r.metadata?.complexity)
  console.log("  patterns:", JSON.stringify(r.metadata?.patterns))
  console.log("  frameworks:", JSON.stringify(r.metadata?.detectedFrameworks ?? r.metadata?.framework))
  console.log("  errors:", JSON.stringify(r.errors ?? r.metadata?.errors ?? []))
}
await probe("adversarial", A)
await probe("constructs", B)
process.exit(0)

import { parseFile } from "../src/ast/pool-worker"
import { writeFileSync, mkdirSync } from "node:fs"
mkdirSync("/tmp/bb-elixir-probe", { recursive: true })
writeFileSync("/tmp/bb-elixir-probe/doc.ex", `defmodule D do
  @moduledoc "Module docs here"

  @doc "Returns one"
  def one, do: 1

  @doc """
  Multi line
  """
  def two, do: 2
end
`)
const r: any = await parseFile("/tmp/bb-elixir-probe/doc.ex")
for (const s of r.symbols) {
  const doc = s.docstring ?? s.comments ?? null
  console.log(`${s.kind} ${s.name}: keys=[${Object.keys(s).join(",")}] docstring=${JSON.stringify(s.docstring ?? null)} comments=${JSON.stringify(s.comments ?? null)}`)
}
process.exit(0)

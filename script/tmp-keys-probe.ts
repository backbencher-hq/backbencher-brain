import { parseFile } from "../src/ast/pool-worker"
import { writeFileSync, mkdirSync } from "node:fs"
mkdirSync("/tmp/bb-elixir-probe", { recursive: true })
writeFileSync("/tmp/bb-elixir-probe/k.ex", `defmodule K do
  use GenServer
  @moduledoc "docs"
  def go(x), do: case x do
    1 -> :a
    _ -> :b
  end
end
`)
const r: any = await parseFile("/tmp/bb-elixir-probe/k.ex")
console.log("FileResult keys:", Object.keys(r))
for (const k of Object.keys(r)) {
  const v = (r as any)[k]
  if (Array.isArray(v)) console.log(`  ${k}: array(${v.length})`)
  else if (v && typeof v === "object") console.log(`  ${k}: object{${Object.keys(v).join(",")}}`)
  else console.log(`  ${k}: ${String(v).slice(0,60)}`)
}
process.exit(0)

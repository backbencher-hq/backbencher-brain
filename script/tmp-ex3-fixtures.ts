// tmp-ex3-fixtures.ts — EX3 F3 fixtures: M59 call-site lines + per-site
// identity (+arity), derive list forms, literal-pattern params, captures,
// defmodule-implied aliases, contains self-loop suppression.
import * as fs from "node:fs"
import * as path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "..")
const DIR = path.join(ROOT, "validation", "m14", "fixtures", "elixir")

function write(base: string, src: string, expectation: any) {
  fs.writeFileSync(path.join(DIR, `${base}.ex`), src)
  fs.writeFileSync(path.join(DIR, `${base}.expectation.json`), JSON.stringify(expectation, null, 2) + "\n")
  console.log(`wrote ${base}`)
}

// ── EX-L1/L2: call-site lines, per-site edges, per-arity edges ──────────────
write("ex3-callsite-lines", `defmodule Lines do
  def run do
    helper()
    helper()
    pick(1)
    pick(1, 2)
  end

  defp helper, do: :ok

  defp pick(_), do: :one
  defp pick(_, _), do: :two
end
`, {
  expectRelationships: [
    { type: "calls", from: "Lines.run", target: "helper", line_number: 3 },
    { type: "calls", from: "Lines.run", target: "helper", line_number: 4 },
    { type: "calls", from: "Lines.run", target: "pick", line_number: 5, "meta.callArity": 1 },
    { type: "calls", from: "Lines.run", target: "pick", line_number: 6, "meta.callArity": 2 },
    { type: "contains", from: "Lines", target: "run", line_number: 2 },
  ],
},)

// ── EX-L4: @derive list forms ───────────────────────────────────────────────
write("ex3-derive-list", `defmodule Deriver do
  @derive [JSON.Encoder, String.Chars]
  defstruct [:a]
end

defmodule DeriverOpts do
  @derive [{Collectable, :ok}]
  defstruct [:b]
end
`, {
  expectRelationships: [
    { type: "implements", from: "Deriver", target: "JSON.Encoder", line_number: 2 },
    { type: "implements", from: "Deriver", target: "String.Chars", line_number: 2 },
    { type: "implements", from: "DeriverOpts", target: "Collectable", line_number: 7 },
  ],
})

// ── EX-L6: literal-pattern parameters are unnamed ───────────────────────────
write("ex3-literal-params", `defmodule LitParams do
  def multi(1), do: :one
end
`, {
  expectSymbols: [{ name: "multi", kind: "function", ownerName: "LitParams" }],
  expectParameters: [
    { symbol: "multi", parameters: [{ name: "_" }] },
  ],
})

// ── EX-L7: named-function captures emit call edges ──────────────────────────
write("ex3-captures", `defmodule Caps do
  def run, do: Enum.map([1], &double/1)
  def remote, do: Enum.map([1], &Caps.double/1)
  defp double(x), do: x * 2
end
`, {
  expectRelationships: [
    { type: "calls", from: "Caps.run", target: "double", line_number: 2, "meta.callArity": 1 },
    { type: "calls", from: "Caps.remote", target: "Caps.double", line_number: 3, "meta.callArity": 1 },
  ],
})

// ── EX-L3 + EX-L5: no self-loop contains; defmodule-implied aliases ─────────
write("ex3-no-self-and-implied", `defmodule NoSelf do
  defstruct [:v]
  def build, do: %NoSelf{v: 1}
end

defmodule Wrap do
  defmodule Inner do
    defstruct [:x]
  end

  def make, do: %Inner{x: 1}
end
`, {
  expectSymbols: [
    { name: "NoSelf", kind: "module" },
    { name: "NoSelf", kind: "struct", ownerName: "NoSelf" },
    { name: "Wrap", kind: "module" },
    { name: "Wrap.Inner", kind: "module" },
    { name: "Wrap.Inner", kind: "struct", ownerName: "Wrap.Inner" },
  ],
  expectRelationships: [
    { type: "instantiates", from: "NoSelf.build", target: "NoSelf", line_number: 3 },
    { type: "instantiates", from: "Wrap.make", target: "Wrap.Inner", line_number: 11 },
    { type: "contains", from: "Wrap", target: "Wrap.Inner", line_number: 7 },
  ],
  forbidRelationships: [
    { type: "contains", from: "NoSelf", target: "NoSelf" },
    { type: "contains", from: "Wrap.Inner", target: "Wrap.Inner" },
  ],
})

console.log("done")

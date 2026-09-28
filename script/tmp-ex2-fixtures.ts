// tmp-ex2-fixtures.ts — writes the EX2 F3 fixtures + expectations into
// validation/m14/fixtures/elixir/. Contents are the verified probe inputs;
// expectations pin the POST-FIX contract (authored from the probes' evidence).
import * as fs from "node:fs"
import * as path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "..")
const DIR = path.join(ROOT, "validation", "m14", "fixtures", "elixir")

function write(base: string, src: string, expectation: any) {
  fs.writeFileSync(path.join(DIR, `${base}.ex`), src)
  fs.writeFileSync(path.join(DIR, `${base}.expectation.json`), JSON.stringify(expectation, null, 2) + "\n")
  console.log(`wrote ${base}.ex + ${base}.expectation.json`)
}

// ── U1: alias resolution on every type-name site ────────────────────────────
write("ex2-alias-resolution", `defmodule MyApp.OrderBook do
  defstruct [:id]
end

defmodule MyApp.Audit do
  def check(_), do: :ok
end

defmodule MyApp.Encodable do
  def enc(_), do: :ok
end

defmodule MyApp.Thing do
  defstruct [:v]
end

defmodule AliasCases do
  alias MyApp.OrderBook
  alias MyApp.Audit

  @behaviour Audit

  def build do
    %OrderBook{id: 1}
    struct(OrderBook, id: 2)
    OrderBook.build()
  end
end

defmodule AliasDerive do
  alias MyApp.Encodable
  @derive Encodable
  defstruct [:a]
end

defmodule AliasImpl do
  alias MyApp.Encodable
  alias MyApp.Thing
  defimpl Encodable, for: Thing do
    def enc(_), do: :ok
  end
end

defmodule AliasUse do
  alias MyApp.Audit
  use Audit
end
`, {
  expectSymbols: [
    { name: "MyApp.OrderBook", kind: "module" },
    { name: "MyApp.Thing", kind: "module" },
  ],
  expectRelationships: [
    { type: "instantiates", from: "AliasCases.build", target: "MyApp.OrderBook" },
    { type: "implements", from: "AliasCases", target: "MyApp.Audit" },
    { type: "implements", from: "AliasDerive", target: "MyApp.Encodable" },
    { type: "implements", from: "MyApp.Thing", target: "MyApp.Encodable" },
    { type: "references", from: "AliasUse", target: "MyApp.Audit" },
    { type: "calls", from: "AliasCases.build", target: "MyApp.OrderBook.build" },
  ],
  forbidRelationships: [
    { type: "instantiates", target: "OrderBook" },
    { type: "implements", target: "Audit" },
    { type: "implements", target: "Encodable" },
  ],
})

// ── U2: scope identity across same-named functions ──────────────────────────
write("ex2-scope-identity", `defmodule ScopeA do
  def run, do: common()
  defp common, do: :a
end

defmodule ScopeB do
  def run, do: common()
  defp common, do: :b
end
`, {
  expectRelationships: [
    { type: "calls", from: "ScopeA.run", target: "common" },
    { type: "calls", from: "ScopeB.run", target: "common" },
  ],
  forbidRelationships: [
    { type: "calls", from: "run", target: "common" },
  ],
})

// ── U3: OTP detection is root-segment based (fake) ──────────────────────────
write("ex2-otp-fake", `defmodule FakeOtp do
  use MyApp.SupervisorTree
  use MyApp.GenServerPool
end
`, {
  expectSymbols: [{ name: "FakeOtp", kind: "module" }],
  expectRelationships: [
    { type: "references", from: "FakeOtp", target: "MyApp.SupervisorTree" },
    { type: "references", from: "FakeOtp", target: "MyApp.GenServerPool" },
  ],
  forbidPatterns: ["Supervision Trees", "Actor Model (OTP)"],
})

// ── U3: real OTP still detected ─────────────────────────────────────────────
write("ex2-otp-real", `defmodule RealOtp do
  use Supervisor
  use GenServer
end
`, {
  expectSymbols: [{ name: "RealOtp", kind: "module" }],
  expectRelationships: [
    { type: "references", from: "RealOtp", target: "Supervisor" },
    { type: "references", from: "RealOtp", target: "GenServer" },
  ],
  expectPatterns: ["Supervision Trees", "Actor Model (OTP)"],
})

// ── U4: parameterized type declarations ─────────────────────────────────────
write("ex2-generic-types", `defmodule GenericTypes do
  @type plain :: integer()
  @type t(a) :: {:ok, a}
  @typep pt(b) :: b
  @opaque o(c) :: c
end
`, {
  expectSymbols: [
    { name: "plain", kind: "type" },
    { name: "t", kind: "type" },
    { name: "pt", kind: "type" },
    { name: "o", kind: "type" },
  ],
  forbidSymbols: [
    { name: "b", kind: "type" },
    { name: "c", kind: "type" },
  ],
})

// ── U5: function-scoped import resolution ───────────────────────────────────
write("ex2-import-scope", `defmodule ImpFun do
  def run do
    import Enum, only: [map: 2]
    map([1], &(&1 + 1))
  end
end

defmodule ImpMod do
  import Enum, only: [map: 2]
  def run, do: map([1], &(&1 + 1))
end
`, {
  expectRelationships: [
    { type: "calls", from: "ImpFun.run", target: "Enum.map" },
    { type: "calls", from: "ImpMod.run", target: "Enum.map" },
  ],
})

// ── U6: default-argument calls are executable ───────────────────────────────
write("ex2-signature-defaults", `defmodule DefaultsRemote do
  def fetch(url, opts \\\\ Builder.build_opts()) do
    request(url, opts)
  end
  defp request(_u, _o), do: :ok
end

defmodule DefaultsLocal do
  def fetch(url, opts \\\\ build_opts()) do
    request(url, opts)
  end
  defp build_opts, do: []
  defp request(_u, _o), do: :ok
end
`, {
  expectRelationships: [
    { type: "calls", from: "DefaultsRemote.fetch", target: "Builder.build_opts" },
    { type: "calls", from: "DefaultsLocal.fetch", target: "build_opts" },
    { type: "calls", from: "DefaultsRemote.fetch", target: "request" },
    { type: "calls", from: "DefaultsLocal.fetch", target: "request" },
  ],
})

// ── U7: sigil documentation chunks ──────────────────────────────────────────
write("ex2-sigil-docs", `defmodule DocSig do
  @moduledoc ~S"""
  Module sigil docs.
  """

  @doc ~s(Inline sigil doc)
  def f, do: :ok
end

defmodule DocCtl do
  @moduledoc """
  Module string docs.
  """

  @doc "Plain doc"
  def g, do: :ok
end
`, {
  expectComments: [
    { symbol: "DocSig", contains: "Module sigil docs." },
    { symbol: "f", contains: "Inline sigil doc" },
    { symbol: "DocCtl", contains: "Module string docs." },
    { symbol: "g", contains: "Plain doc" },
  ],
})

console.log("done")

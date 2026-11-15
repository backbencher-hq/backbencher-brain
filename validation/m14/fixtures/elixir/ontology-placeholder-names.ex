# EX-EX11 — a member name is a NAME, and the placeholder guard is case-sensitive.
#
# Two rules, both found by the lane's own second reader
# (script/m14/tmp/elixir-new-label-oracles.ts), which derives `exports` from
# definition KEYWORDS rather than from the symbol's `visibility` field:
#
#   EX-EX11   `def unquote(x)` is a macro-GENERATED definition. `unquote` is
#             reserved — it cannot be called outside a quote, so it can never be
#             a member's name — and the real name is computed at expansion time.
#             Measured on the corpus: `def unquote(member?)` in
#             elixir/lib/elixir/lib/calendar/date_range.ex:73 published
#             `contains Date.Range -> unquote` and `exports Date.Range -> unquote`
#             for a callback that is really `member?/2`. The declaration takes the
#             documented EX-D9 placeholder and the R7 guard keeps it off every edge.
#
#   EX-EX11b  The placeholder is the literal this analyzer writes, `"Unknown"`.
#             The guard used to accept `"unknown"` too, which silently dropped a
#             REAL public function: `def unknown, do: :unknown` in
#             elixir/lib/eex/test/eex_test.exs:29 is `EExTest.Compiled.unknown/0`
#             and its `contains` + `exports` edges were never published.
defmodule OntoPlaceholder do
  @moduledoc "placeholder-name fixture"

  def unknown, do: :unknown
  def named, do: :named
end

defmodule OntoGenerated do
  @moduledoc "a macro-generated definition is not nameable"

  def generated(x), do: x
  def unquote(name), do: name
  def unquote_splicing(args), do: args
end

defmodule R7EndpointNames do
  # ELX-EXPORTS D6/D7/D8 — the last three endpoint-spelling defects.
  alias R7EndpointNames.Helper
  require Logger

  # D6: a definition whose NAME the analyzer cannot read is a placeholder. The
  # symbol stays (the declaration is real — Elixir generates a function named
  # at runtime) and is marked `metadata.unresolvedName`, and NO EDGE is
  # published for it: `contains Mod -> Unknown` names nothing. Measured on 559
  # corpus files: 19 symbols named `Unknown`, each with a `contains -> Unknown`
  # endpoint (base.ex:443/447/746, bitwise.ex:69/163, io/ansi.ex:117,
  # special_forms.ex:66/147, and 11 more). Every one of the 19 is genuinely
  # dynamic — `def unquote(name)(byte)`, `defmacro unquote(level)(msg)`.
  def unquote(make_name())(payload), do: payload

  # A LOWERCASE `unknown` is a REAL function name, not the placeholder: the
  # placeholder vocabulary is capitalised, so `contains -> unknown` is a
  # legitimate edge (eex_test.exs:29 is `def unknown do`).
  def unknown, do: :real

  # D7: EX-A15's operator-name fix was DEAD — three lines sat OUTSIDE its `if`
  # and overwrote the name with the first NON-NAMED child, which for
  # `arguments > block > operator_identifier` is the opening `(`. Measured:
  # elixir's own kernel.ex:4347 `defmacro (..)` published a macro named `(`,
  # a `contains -> "("` edge and a call edge sourced at `Kernel.(/3`. This lane's
  # own fixture `paren-operator-forms` has been FAILING since a7368a806
  # (2026-09-27) while `fixture-baseline.json` records 0 failures for elixir.
  defmacro (..) do
    quote(do: :ok)
  end

  # A real operator definition is named by its operator token, and `{`/`}` are
  # not in an Elixir callee name — which is why the D8 test is exactly those two
  # characters and not a broader "looks like an expression" guess. (The grammar
  # spells an operator definition with its OPERANDS: `def left -- right do` —
  # `def -->(l, r)` is an ERROR node in tree-sitter-elixir 0.3.5, measured.)
  def left -- right do
    {right, left}
  end

  # D8: a receiver that is a STRUCT or MAP EXPRESSION is a value, not a module;
  # what follows the dot is a field read or a call on the result. Measured 3
  # sites: `%Point{}.foo_bar` (module/types/expr_test.exs:1595) and
  # `%URI{uri | path: "/bar"}.path` (ex_unit/assertions_test.exs:259, :263).
  def read_after_struct_literal, do: %Helper{}.helper_field

  def call_after_struct_literal do
    %Helper{}.helper_fun()
  end

  def call_on_bound_receiver(receiver), do: receiver.helper_fun()

  # A quoted-atom callee is a REAL Elixir name and keeps its edge: `:erlang."=<"`
  # (4 sites in kernel.ex), `Inspect.OthersTest."weirdly named/fun-"` (2),
  # `TypeSample."?"` (1). A broader "strip spaces and quotes" test deleted all
  # of them, which is why this lane's test is `{` and `}` only.
  def quoted_callee(list), do: Enum."count"(list)
end
defmodule Cc1.Host do
  # ELIXIR_FIX2-P6 — a module whose NAME is not an alias owns nothing.
  #
  # `declarationName` reads a module name from an `alias`/`dot` node only, because
  # Elixir's `defmodule` takes an EXPRESSION: `defmodule name do` names a module
  # after a VARIABLE and `defmodule Module.concat(A, B) do` names it after a
  # computed value. The analyzer publishes no module symbol for either, which is
  # correct. What it used to do afterwards was keep the ENCLOSING module in scope,
  # so every declaration inside the un-nameable module was attributed to the
  # enclosing module.
  #
  # Measured on the corpus before the fix: 10 declarations in 5 files
  # (exception_test.exs, map_test.exs, module_test.exs, logger_test.exs,
  # compile.erlang_test.exs) and the wrong edges it published —
  #   contains ExceptionTest -> foo   exports ExceptionTest -> foo
  #   contains MapTest -> name / age / hello / world
  #   contains ModuleTest -> hello
  # — for functions that belong to a module the corpus never names. That is the
  # expensive mistake: a fabricated edge is counted as unexplained and poisons
  # bb_graph / bb_impact.
  #
  # Cc1.VarName and Cc1.Computed below are exactly those shapes, and
  # `real_member` is the shape that must STILL work.
  @moduledoc "the enclosing module"

  # A VARIABLE as the module name. The declaration `def real_member` below is
  # still a real declaration and is still published as a symbol — it simply has
  # no owner, so `contains` and `exports` cannot name one.
  defmodule name do
    def inside_variable_module, do: :ok
  end

  # A COMPUTED module name. Same rule, and the member here is a TYPE, which is
  # the second symbol kind the fix covers.
  defmodule Module.concat(Cc1, Computed) do
    @type inside_type :: :ok
  end

  # A defstruct inside an un-nameable module has no name either — a struct's
  # name IS its module's name — so neither the struct nor its fields are
  # published. Naming them after Cc1.Host would forge a struct Cc1.Host does not
  # define.
  defmodule String.to_atom("dynamic") do
    defstruct [:field_one, :field_two]
  end

  # A declaration AFTER the un-nameable modules, still directly in Cc1.Host. If
  # the unnamed scope were pushed and never popped, this one would lose its
  # owner too and both edges below would vanish — which is the only way the
  # fixture can see a leaked scope (mutant elixir/unnamed-module-scope-leaked).
  def after_unnamed_modules, do: :ok

  # POSITIVE CONTROL. A NAMED nested module keeps the EX-A10 contract: it is
  # owned by the enclosing declaration, its members are owned by it, and both
  # `contains` and `exports` publish. If the unnamed-scope push leaked past the
  # scope's end, this is the edge that disappears.
  defmodule Named do
    def real_member, do: :ok
    defstruct [:named_field]
  end
end
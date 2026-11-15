defmodule Cc1.ExportSurface do
  # ELIXIR_FIX2-X2 — `exports`: the edge that says what this module PUBLISHES.
  #
  # Elixir has no `export` keyword. That is the point: the language draws the
  # export surface with the DEFINITION FORM itself. `def`, `defmacro`,
  # `defguard`, `defdelegate`, `@type`, `@opaque`, `@callback` and `defstruct`
  # are reachable from outside the file. `defp`, `defmacrop`, `defguardp` and
  # `@typep` are not callable by name from another module, so publishing them
  # would put a name in the target surface that no importer can bind — the rule
  # R7 class of defect, at 7,918 corpus sites.
  #
  # The private rows are therefore the point of this fixture, not the public
  # ones. An implementation keyed on "is it a function" instead of "is it
  # public" passes every positive row below.
  @moduledoc "Export surface fixture."
  @type pub_alias :: integer()
  @typep priv_alias :: integer()
  @opaque opaque_alias :: integer()

  @callback on_start(term()) :: :ok

  def pub_fun(x), do: x
  defp priv_fun(x), do: x
  defdelegate pub_delegate(x), to: Kernel, as: :abs

  defmacro pub_macro(x), do: x
  defmacrop priv_macro(x), do: x

  defguard pub_guard(x) when is_integer(x)
  defguardp priv_guard(x) when is_integer(x)

  defstruct [:pub_field, priv_field: 1]

  # NESTED modules are addressable from outside their file whatever their
  # nesting (EX-A10), so a nested `defmodule` is itself exported.
  defmodule Inner do
    def inner_fun, do: :ok
    defp inner_priv, do: :ok
  end
end

# An OWNERLESS definition (the .exs script shape) has no owner to publish from,
# so it gets no `exports` edge — same reason `contains` skips it and the same
# reason the `Global` pseudo-source is not a publishable endpoint.
def top_fun(x), do: x
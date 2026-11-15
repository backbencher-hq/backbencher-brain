defmodule ExportsSurface do
  # ELX-EXPORTS `exports`: the module's PUBLIC CALLABLE surface. Elixir has no
  # export-list statement, so the surface is read off the declarations:
  # `def`/`defmacro`/`defguard`/`defdelegate` publish, `defp`/`defmacrop`/
  # `defguardp` do not (Kernel's own docs). `exports` is a DIFFERENT statement
  # from `contains` — "another module can call this as `Mod.f(…)`" — which is
  # what bb_migrate's cross-language mapping and the go/java/kotlin exports
  # edges carry. Measured on 559 corpus files: 4,031 exports edges in 411 files
  # against 5,687 public definition forms (the difference is multi-clause
  # merging, file-level definitions with no module owner, and defs whose name
  # could not be read).
  def public_fun, do: :ok
  def second_fun(a, b), do: {a, b}

  defmacro public_macro(a), do: a

  defguard public_guard(x) when is_integer(x)

  defdelegate public_delegate(list), to: List, as: :flatten

  # Private forms publish nothing: `defp`, `defmacrop`, `defguardp`.
  defp private_fun, do: :ok
  defmacrop private_macro(a), do: a
  defguardp private_guard(x) when is_integer(x)

  # Visibility, not the name, is what the edge reads: a `defmacrop` publishes
  # nothing even though its name says public.
  defmacrop looks_public(a), do: a

  # A struct FIELD is not callable, and a type alias is not callable: neither is
  # an export.
  defstruct [exported_field: 1]

  @type handle :: reference()
  @typep secret :: binary()
end

defprotocol ExportsProtocol do
  # A protocol callback IS public surface — it is callable as `Mod.f(…)` on
  # every implementation.
  def to_elixir_value(term)
end

defimpl ExportsProtocol, for: BitString do
  def to_elixir_value(term), do: term
end

defmodule ExportsCallbackOnly do
  # A behaviour surface declared with @callback and no `def` at all is still
  # part of the module's public callable surface.
  @callback load(path :: binary()) :: {:ok, term()} | {:error, term()}
end
# The `.exs` script shape: a file-level definition has NO module owner, so it has
# no export surface to publish from. It is still in the analyzer's `exports[]`
# channel (ownerless public symbols are the other half of that contract), but the
# RELATIONSHIP has no owner to run from.
def script_level_fun(x), do: x

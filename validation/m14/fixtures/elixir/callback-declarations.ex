defmodule Callback.Probe do
  @moduledoc """
  A behaviour surface: `@callback` declares a function this module expects
  without defining it. The declaration is a published fact (it has a name, an
  arity and a typespec) and was emitting nothing at all.
  """

  @callback load(term) :: {:ok, map} | {:error, term}
  @macrocallback build(term) :: Macro.t()

  # The callback and this definition are the SAME function: one symbol, and the
  # definition (which has a body) is not a declaration.
  def load(x), do: {:ok, x}
end

defprotocol Callback.Sized do
  @doc "Measures."
  def size(item)
  # The bodiless protocol head and its typed spec are one method — and a head
  # with no body IS a declaration, so it says so.
  @callback size(item) :: non_neg_integer()
  @optional_callbacks size: 1
end

defimpl Callback.Sized, for: Tuple do
  def size(_), do: 2
end

defmodule Callback.HeadThen do
  # A bodiless head that a later clause implements: the symbol is a definition.
  def twice(y)
  def twice(y), do: y * 2
end

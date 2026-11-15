# EX-EX6 — `exports`: the module's EXTERNAL interface.
#
# Elixir has no export declaration. The rule is the visibility of the defining
# keyword: `def`/`defmacro`/`defdelegate`/`defguard` are callable from outside,
# `defp`/`defmacrop`/`defguardp` are not, `@typep` is a PRIVATE type and
# `@opaque` is a public type with a hidden structure. `contains` says who owns a
# member; `exports` says who can reach it.
defmodule ExpSurface do
  @moduledoc "export surface fixture"

  defstruct [:id, :name]

  @type t :: %__MODULE__{}
  @typep secret() :: binary()
  @opaque handle() :: reference()

  def new(id), do: %ExpSurface{id: id}
  defp internal(x), do: x
  defmacro mac(x), do: x
  defmacrop priv_mac(x), do: x
  defguard is_thing(x) when is_atom(x)
  defguardp is_priv(x) when is_atom(x)
  defdelegate delegated(a), to: ExpTarget, as: :target

  defmacro __using__(_opts) do
    quote do
      def injected, do: :ok
    end
  end
end

defmodule ExpSurface.Nested do
  def inner, do: :ok
  defp hidden, do: :no
end

defmodule ExpSurface.Other do
  @doc false
  def documented_away, do: :ok
end

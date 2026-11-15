defmodule AttrValueCode do
  # EX-A17: the VALUE of a module attribute is compile-time code. A DSL section
  # is a real struct built while the module compiles, and a computed attribute
  # names real remote calls. Both were silent.
  @section %Spark.Dsl.Section{name: :thing, build: Spark.Dsl.build(:thing)}
  @deferred fn -> Helper.later() end
  @raised raise Helper.Error, reason: :bad

  # EX-A17 negative half: these attribute VALUES are DECLARATIONS, and keep
  # their declared silence — a typespec's `%Duration{}` is a TYPE reference, a
  # behaviour/derive list is a compile-time contract, and a docstring is text.
  @type t :: %Duration{second: integer}
  @behaviour GenServer
  @derive {JSON.Encoder, only: [:a]}
  @doc """
  A docstring mentioning %Not.A.Struct{} and Helper.gone() — text, not code.
  """
  @moduledoc false
  defstruct [:a]

  @impl true
  def go(%Duration{} = d) do
    {d, @section, @deferred}
  end
end

defmodule LowerMultiAlias do
  # EX-A18: multi-alias members may be LOWERCASE (function/atom aliases). The
  # expander accepted only `alias`/`dot` members, so these two named nothing.
  alias Helper.{make, name}
  alias Helpers.{Other, yet_another}

  def go, do: {make(), name(), Other, yet_another()}
end

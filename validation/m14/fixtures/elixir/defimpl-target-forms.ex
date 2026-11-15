defmodule SingleArgImpl do
  defimpl String.Chars do
    def to_string(_), do: "single"
  end
end

defimpl Collectable, for: SingleArgImpl do
  def into(_), do: :ok
end

defmodule SelfAlias do
  alias SelfAlias
  def who, do: SelfAlias.who()
end

defmodule ImplMacroHead do
  defmacro defimpl(name, opts) do
    quote do: {unquote(name), unquote(opts)}
  end
end

# W23 (review finding): multi-type implementation — one Implements edge per
# type; the raw list text is never a target.
defimpl W23Multi, for: [Integer, Float] do
  def into(_), do: :ok
end

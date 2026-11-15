defmodule Deriver do
  @derive [JSON.Encoder, String.Chars]
  defstruct [:a]
end

defmodule DeriverOpts do
  @derive [{Collectable, :ok}]
  defstruct [:b]
end

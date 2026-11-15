defmodule Derived do
  @derive JSON.Encoder
  defstruct [:a]
end

defmodule DerivedOpts do
  @derive {JSON.Encoder, only: [:a]}
  defstruct [:a]
end

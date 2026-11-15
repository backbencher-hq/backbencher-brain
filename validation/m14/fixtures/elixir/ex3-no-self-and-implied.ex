defmodule NoSelf do
  defstruct [:v]
  def build, do: %NoSelf{v: 1}
end

defmodule Wrap do
  defmodule Inner do
    defstruct [:x]
  end

  def make, do: %Inner{x: 1}
end

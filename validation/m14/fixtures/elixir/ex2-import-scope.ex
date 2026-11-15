defmodule ImpFun do
  def run do
    import Enum, only: [map: 2]
    map([1], &(&1 + 1))
  end
end

defmodule ImpMod do
  import Enum, only: [map: 2]
  def run, do: map([1], &(&1 + 1))
end

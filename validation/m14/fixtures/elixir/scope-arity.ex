defmodule ScopeArity do
  def call_one(x) do
    one_hop(x)
  end

  def call_two(x, y) do
    two_hop(x, y)
  end

  defp one_hop(v) do
    v
  end

  defp two_hop(x, y) do
    x
  end
end

defmodule ScopeDeleg do
  defdelegate fetch(k), to: Store
end

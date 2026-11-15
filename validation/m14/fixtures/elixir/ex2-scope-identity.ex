defmodule ScopeA do
  def run, do: common()
  defp common, do: :a
end

defmodule ScopeB do
  def run, do: common()
  defp common, do: :b
end

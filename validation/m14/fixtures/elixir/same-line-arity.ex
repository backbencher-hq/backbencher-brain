defmodule ES do
  def run do
    {f(1), f(2, 3)}
  end

  defp f(a), do: a

  defp f(a, b), do: {a, b}
end

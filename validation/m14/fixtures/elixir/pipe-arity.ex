defmodule EPipe do
  def run(x) do
    x |> f(1)
  end

  def run2(x) do
    x |> g
  end

  def f(a, b), do: {a, b}

  def g(a), do: a
end

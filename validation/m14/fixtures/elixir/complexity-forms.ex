defmodule Branchy do
  def add(a, b) when is_number(a) do
    if b > 0, do: a + b, else: a
  end

  def plain(x), do: x
end

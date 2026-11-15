defmodule Caps do
  def run, do: Enum.map([1], &double/1)
  def remote, do: Enum.map([1], &Caps.double/1)
  defp double(x), do: x * 2
end

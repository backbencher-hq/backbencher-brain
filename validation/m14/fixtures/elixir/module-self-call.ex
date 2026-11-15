defmodule ESelf do
  def run(x) do
    __MODULE__.raise(x)
  end

  defp raise(x), do: x
end

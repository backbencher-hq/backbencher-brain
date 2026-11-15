defmodule Lines do
  def run do
    helper()
    helper()
    pick(1)
    pick(1, 2)
  end

  defp helper, do: :ok

  defp pick(_), do: :one
  defp pick(_, _), do: :two
end

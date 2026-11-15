defmodule ETry do
  def run(x) do
    try do
      attempt(x)
    rescue
      e in RuntimeError -> handle_rescue(e)
    catch
      :exit, _ -> handle_catch()
    else
      ok -> handle_else(ok)
    after
      cleanup()
    end
  end

  defp attempt(x), do: x

  defp handle_rescue(e), do: e

  defp handle_catch, do: :ok

  defp handle_else(x), do: x

  defp cleanup, do: :ok
end

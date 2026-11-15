defmodule ControlFlow do
  def classify(x) do
    case x do
      {:ok, v} -> v
      _ -> cond do
        is_nil(x) -> :nil
        true -> :other
      end
    end
  end

  def guarded(x) when is_atom(x) or is_binary(x), do: x

  def rescued(f) do
    try do
      f.()
    rescue
      _ -> :rescued
    end
  end
end

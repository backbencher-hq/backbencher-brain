defmodule KernelCalls do
  def check(x) do
    match?({:ok, _}, x) and is_nil(x)
  end

  def piped(x) do
    x |> tap(&IO.inspect/1) |> then(&elem(&1, 0))
  end
end

dbg("top")

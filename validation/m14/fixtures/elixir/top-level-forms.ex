ExUnit.start()

test "adds" do
  assert 1 + 1 == 2
end

defmodule Guarded do
  defguard is_even(x) when rem(x, 2) == 0
  defmacrop helper(x), do: x
end

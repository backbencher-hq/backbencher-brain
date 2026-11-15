defmodule ED1 do
  @derive [A, B]
  defstruct [:x]
end

defmodule ED2 do
  @derive [{C, :ok}]
  defstruct [:x]
end

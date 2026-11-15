defmodule GenericTypes do
  @type plain :: integer()
  @type t(a) :: {:ok, a}
  @typep pt(b) :: b
  @opaque o(c) :: c
end

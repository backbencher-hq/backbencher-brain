defmodule EQ do
  @behaviour RealB

  defmacro m do
    quote do
      @behaviour SomeB
      @type t :: term()
    end
  end
end

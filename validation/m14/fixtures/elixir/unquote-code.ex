defmodule EU do
  defmacro m do
    quote do
      hidden()
      unquote(compute())
    end
  end

  def compute, do: 1
end

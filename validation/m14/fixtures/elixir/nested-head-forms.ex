defmodule HeadNest do
  defmacro def(sig) do
    quote do: unquote(sig)
  end

  defmacro defmacro(name) do
    quote do: unquote(name)
  end
end

defmodule QuotedData do
  defmacro wrapper(block) do
    quote do
      def injected, do: unquote(block)
    end
  end

  def real(x), do: x
end

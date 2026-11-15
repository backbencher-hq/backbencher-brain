defmodule ELX4.UnnamedDyn do
  def unquote(name)(x), do: x

  defmacro unquote(verb)(msg), do: msg
end

defmodule ELX4.BadModuleName do
  defmodule :"foo/bar", do: :ok
end

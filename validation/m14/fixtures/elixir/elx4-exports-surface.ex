defmodule ELX4.ExportsSurface do
  defstruct [:id, :name]

  def new(id), do: %__MODULE__{id: id}

  defp secret(id), do: id

  defmacrop helper(x), do: x

  defmacrop hidden(x), do: x
end

defmodule ELX4.Nested do
  defmodule Inner do
    def visible, do: :ok

    defp invisible, do: :no
  end
end

defmodule ELX4.Unnamed do
  def file_level, do: :ok
end

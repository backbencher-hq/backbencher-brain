defmodule ELX4.R7Host do
  @spec require([Path.t()], require_opts()) :: :ok
  @spec import(t) :: t
  @spec alias() :: atom

  alias :lists, as: MyList

  def head, do: MyList.flatten([1])

  def field_read(x), do: x.foo

  def on_struct, do: %URI{uri | path: "/bar"}.path

  defmacro (..) do
    range(__CALLER__.context, 0, -1, 1)
  end
end

defmodule ELX4.R7Host.Computed do
  defmodule Module.concat(ELX4, R7Host) do
    defstruct [:name]

    def sample, do: %__MODULE__{}
  end
end

defmodule ELX4.R7Host.Absolute do
  defmodule :"Elixir.ELX4.Abs" do
    def hello, do: :world
  end
end

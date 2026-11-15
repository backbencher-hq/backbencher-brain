defmodule ELX4.UsesMixin do
  use GenServer

  @impl true
  def init(state), do: {:ok, state}
end

defmodule ELX4.UsesMulti do
  use Supervisor

  alias ELX4.Opts
  import Enum, only: [map: 2]
  require Logger, as: L
end

defmodule ELX4.UsesSelf do
  use ELX4.UsesMixin
end

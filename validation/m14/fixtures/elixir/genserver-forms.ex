defmodule MyServer do
  use GenServer

  def start_link(arg), do: GenServer.start_link(__MODULE__, arg)

  @impl true
  def init(arg), do: {:ok, arg}

  @impl true
  def handle_call(:get, _from, state), do: {:reply, state, state}
end

defmodule MySup do
  use Supervisor

  def start_link(arg), do: Supervisor.start_link(__MODULE__, arg)

  @impl true
  def init(arg), do: {:ok, arg}
end

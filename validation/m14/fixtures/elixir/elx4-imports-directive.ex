defmodule ELX4.ImportsDirective do
  import Enum
  import Enum, only: [map: 2]
  import String, as: S
  alias ELX4.Opts
  require Logger
  use GenServer

  def run(list), do: list |> map(& &1)
end

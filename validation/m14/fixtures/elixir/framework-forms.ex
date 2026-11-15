defmodule PlugUsage do
  import Plug.Conn
  def call(conn), do: conn
end

defmodule PhoenixUsage do
  use Phoenix.Router
  def routes, do: :ok
end

defmodule EctoUsage do
  use Ecto.Schema
  def table, do: "users"
end

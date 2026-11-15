defmodule MyApp do
  defmodule User do
    @moduledoc "User domain model"
    @behaviour MyApp.Behaviour

    @type t :: %__MODULE__{id: integer}
    @type email :: String.t()

    defstruct id: nil, email: ""

    @spec new(integer, String.t()) :: t
    def new(id, email) do
      %MyApp.User{id: id, email: email}
    end

    def update(user, attrs) do
      user
      |> Map.merge(attrs)
      |> validate()
    end

    defp validate(user), do: user

    def count_down(n), do: count_down(n - 1)

    def macro_example, do: :ok
  end
end

defprotocol Serializable do
  def to_map(value)
end

defimpl Serializable, for: MyApp.User do
  def to_map(user) do
    %{id: user.id}
  end
end

defmodule MyApp.UserStore do
  alias MyApp.User
  import MyApp.Helpers
  require Logger
  use GenServer

  def find(id) do
    User.new(id, "")
    |> serialize()
    |> Logger.info()
  end

  defp serialize(user), do: user

  def handle_call({:get, id}, _from, state) do
    {:reply, find(id), state}
  end
end

defmodule MyApp.Helpers do
  def helper(x), do: x
end

defmodule MyApp.Behaviour do
  defmacro __using__(_opts) do
    quote do
      def impl_marker, do: :ok
    end
  end
end

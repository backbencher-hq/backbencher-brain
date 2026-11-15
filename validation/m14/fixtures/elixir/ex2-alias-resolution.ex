defmodule MyApp.OrderBook do
  defstruct [:id]
end

defmodule MyApp.Audit do
  def check(_), do: :ok
end

defmodule MyApp.Encodable do
  def enc(_), do: :ok
end

defmodule MyApp.Thing do
  defstruct [:v]
end

defmodule AliasCases do
  alias MyApp.OrderBook
  alias MyApp.Audit

  @behaviour Audit

  def build do
    %OrderBook{id: 1}
    struct(OrderBook, id: 2)
    OrderBook.build()
  end
end

defmodule AliasDerive do
  alias MyApp.Encodable
  @derive Encodable
  defstruct [:a]
end

defmodule AliasImpl do
  alias MyApp.Encodable
  alias MyApp.Thing
  defimpl Encodable, for: Thing do
    def enc(_), do: :ok
  end
end

defmodule AliasUse do
  alias MyApp.Audit
  use Audit
end

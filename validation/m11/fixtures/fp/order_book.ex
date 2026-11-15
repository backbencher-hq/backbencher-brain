defmodule OrderBook do
  @moduledoc "Order book matching engine"
  @default_depth 10

  @type order :: %{id: integer, side: :buy | :sell, price: float, qty: integer}
  @type t :: %__MODULE__{bids: list, asks: list}

  defstruct bids: [], asks: []

  @spec new(integer) :: t
  def new(depth \\ @default_depth) do
    %OrderBook{bids: [], asks: []}
  end

  @spec insert(t, order) :: t
  def insert(book, order) do
    case order.side do
      :buy -> add_bid(book, order)
      :sell -> add_ask(book, order)
    end
  end

  defp add_bid(book, order), do: Map.put(book, :bids, [order | book.bids])

  defp add_ask(book, order), do: Map.put(book, :asks, [order | book.asks])

  def best_bid(%OrderBook{bids: [head | _]}), do: head
  def best_bid(_), do: nil

  defmacro assert_depth(book, n) do
    quote do
      length(unquote(book).bids) >= unquote(n)
    end
  end
end

defprotocol Serializable do
  def serialize(term)
end

defimpl Serializable, for: OrderBook do
  def serialize(%OrderBook{} = book), do: {:ok, book.bids}
end

defmodule PriceFormatter do
  @behaviour OrderBook

  def format(price) when is_float(price), do: Float.round(price, 2)
  def format(price) when is_integer(price), do: price
end

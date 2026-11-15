defmodule RefForms do
  def read(order), do: order.side
  def mapper, do: &Enum.map/2
  def bare, do: Enum.reverse
end

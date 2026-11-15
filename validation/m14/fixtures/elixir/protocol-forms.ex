defprotocol Sized do
  @doc "Measures."
  def size(item)
end

defimpl Sized, for: Tuple do
  def size(_), do: 2
end

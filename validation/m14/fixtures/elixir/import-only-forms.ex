defmodule OnlyUser do
  import Enum, only: [map: 2]
  import Other, except: [map: 2]
  def run(l), do: map(l, fn x -> x end)
end

defmodule LastWins do
  import Alpha, only: [go: 1]
  import Beta, only: [go: 1]
  def run(x), do: go(x)
end

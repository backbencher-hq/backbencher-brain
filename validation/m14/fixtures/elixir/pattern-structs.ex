defmodule EP do
  def run(x) do
    case x do
      %Pong{a: a} -> a
      _ -> 0
    end
    fn %Ping{} -> 1 end
    %Pong{} = y
    z = %Pong{}
    z
  end
end

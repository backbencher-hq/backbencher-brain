defmodule EK do
  def run(x) do
    Kernel.raise(x)
    Kernel.length([1])
    MyApp.check(x)
  end
end

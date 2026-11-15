defmodule SelfAliasMod do
  alias __MODULE__.Sub
  alias __MODULE__.{Alpha, Beta}
  def run, do: {Sub.go(), Alpha.go()}
end

defmodule MultiAlias do
  alias Foo.{Bar, Baz}
  def run, do: {Bar.go(), Baz.go()}
end

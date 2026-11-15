defmodule StructFn do
  def build(attrs), do: struct(User, attrs)
  def build_self(attrs), do: struct!(__MODULE__, attrs)
  def build_dyn(mod, attrs), do: struct(mod, attrs)
end

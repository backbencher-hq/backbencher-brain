defmodule ELX4.Overridable do
  def sample, do: :original

  def with_args(a, b), do: a + b

  def never_replaced, do: :kept

  defoverridable sample: 0, with_args: 2

  def sample, do: :replaced

  def with_args(a, b), do: super(a, b) * 2
end

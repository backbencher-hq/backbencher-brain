defmodule ExtentFixture do
  # EX-A8: three clauses of ONE function. The symbol's extent is the whole
  # function (first clause start .. last clause end) and metadata.clauseRanges
  # carries each clause. The middle clause is a DIFFERENT function on purpose:
  # measured on elixir@024beb1b, 8.4% of merged groups have declarations
  # between their first and last clause, so this is the shape that makes the
  # clause list necessary rather than decorative.
  def classify(:error), do: :error
  def helper_of(classify), do: classify
  def classify({:ok, v}), do: v

  # EX-A8: a two-clause def whose clauses are adjacent.
  def total([]), do: 0
  def total([h | t]), do: h + total(t)

  def exception_paths do
    # EX-A9: raise constructs the exception struct — same edge class as
    # struct/2 and a %Struct{} literal.
    raise ExtentFixture.Missing, "no value"
    # EX-A9 negative: a bare string / a bound exception names no type.
    raise "plain message"
  end

  defmodule Nested do
    # EX-A10: a nested defmodule is owned by its enclosing declaration.
    def ping, do: :pong
  end
end

defmodule ExtentFixture.Raiser do
  alias ExtentFixture.Missing

  def explode(reason) do
    reraise Missing, __STACKTRACE__
  end
end

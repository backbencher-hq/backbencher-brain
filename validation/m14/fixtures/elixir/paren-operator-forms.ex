defmodule ParenOp do
  # EX-A15: a PARENTHESIZED operator definition with no argument list is how
  # Elixir defines a zero-arity operator macro — `defmacro (..) do … end` is
  # Kernel's own range operator (elixir/lib/elixir/lib/kernel.ex:4347). The
  # grammar shapes the name as `arguments > block > operator_identifier`, which
  # no earlier branch recognised, so it fell through to the EX-D9 placeholder:
  # the definition published as a macro named `Unknown`, and a SECOND
  # parenthesized operator in the same module merged into that one row (both
  # arity 0), so one real definition was invisible and a single row stood for
  # two. The operator token is statically nameable, so it is named.
  defmacro (..) do
    quote(do: :ok)
  end

  defmacro (---)(left, right) do
    quote(do: {left, right})
  end

  def (++)(left, right), do: {left, right}

  # A genuinely dynamic name stays a placeholder: the unquoted name is the
  # macro's own parameter, so nothing is nameable at compile time.
  def unquote(name)(operand), do: {name, operand}
end

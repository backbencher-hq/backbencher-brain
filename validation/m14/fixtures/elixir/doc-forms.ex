defmodule Documented do
  @moduledoc "Module docs."

  @doc "Adds things."
  def add(a, b), do: a + b

  @doc "Stale?"
  @doc false
  def hidden(x), do: x

  @doc "First."
  def multi(0), do: :zero
  def multi(_), do: :many
end

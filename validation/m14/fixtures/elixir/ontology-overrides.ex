# EX-EX5 — `overrides`. Two language constructs, both read by the lane's
# omission: `@impl`, which is Elixir's `@Override`, and `defoverridable`, which
# publishes a function as replaceable. The contract is RESOLVED, never guessed —
# an `@impl` whose contract cannot be named stays silent.
defmodule OntoBehaviour do
  @callback fetch(id :: term()) :: {:ok, term()} | :error
  @callback push(item :: term()) :: :ok
end

defmodule OntoImpl do
  @behaviour OntoBehaviour

  @impl true
  def fetch(id), do: {:ok, id}

  # `@impl false` explicitly DENIES the implementation.
  @impl false
  def not_a_callback(id), do: id

  # No `@impl` at all — a behaviour member without the annotation is not
  # published as an override.
  def push(item), do: :ok

  defp secret_helper(x), do: x
end

defmodule OntoExplicit do
  @behaviour OntoBehaviour
  @other_behaviour :ignored

  @impl OntoBehaviour
  def push(item), do: :ok
end

defmodule OntoUnnamed do
  @impl true
  def size(x), do: x
end

defmodule OntoDefer do
  def over(a), do: a
  defoverridable over: 1

  # This definition REPLACES the defoverridable one.
  def over(a), do: {a}

  def unrelated(a), do: a
end

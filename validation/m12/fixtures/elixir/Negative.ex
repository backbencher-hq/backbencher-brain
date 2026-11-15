defmodule Negative do
  @doc "module doc — attributes are not calls"
  @default_limit 100

  @type bad_type :: %{unused: integer}

  def builtin_only(list) do
    length(list)
    is_list(list)
    elem(list, 0)
    hd(list)
  end

  def member_access(user) do
    user.id
    user.name
  end

  def pattern_struct(%Negative{} = n), do: n

  def closure() do
    fn x -> x + 1 end
  end

  def quoted() do
    quote do
      def fake_symbol, do: :ok
    end
  end

  def guard_call(x) when is_integer(x), do: x
end

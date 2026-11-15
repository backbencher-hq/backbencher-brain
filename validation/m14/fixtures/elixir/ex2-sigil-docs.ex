defmodule DocSig do
  @moduledoc ~S"""
  Module sigil docs.
  """

  @doc ~s(Inline sigil doc)
  def f, do: :ok
end

defmodule DocCtl do
  @moduledoc """
  Module string docs.
  """

  @doc "Plain doc"
  def g, do: :ok
end

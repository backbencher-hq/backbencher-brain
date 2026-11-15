defmodule StructFields do
  defstruct [:id, :name, :email]
  def build, do: %StructFields{id: 1}
end

defmodule KeywordFields do
  defstruct alpha: 1
end

defmodule MixedFields do
  defstruct [:file, params: %{}, tags: %{}]
  def values, do: [:not_a_field, %{not_a_property: 1}]
end

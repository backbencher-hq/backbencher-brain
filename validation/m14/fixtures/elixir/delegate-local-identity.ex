defmodule DelegateIdentity do
  alias Target.Module, as: Remote
  defdelegate local_name(value), to: Remote, as: :remote_name
  defdelegate unchanged(value), to: Remote
  def run(value) do
    local_name(value)
    unchanged(value)
    Remote.remote_name(value)
  end
end

defmodule DelegateCollision do
  defdelegate rstrip(value), to: Target, as: :trim_trailing
  def trim_trailing(value), do: value
  def run(value) do
    rstrip(value)
    trim_trailing(value)
  end
end

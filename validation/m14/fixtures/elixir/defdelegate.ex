defmodule ED do
  alias MyApp.Repo

  defdelegate fetch(uri), to: Repo

  defdelegate get(uri), to: Repo, as: :find
end

defmodule DefaultsRemote do
  def fetch(url, opts \\ Builder.build_opts()) do
    request(url, opts)
  end
  defp request(_u, _o), do: :ok
end

defmodule DefaultsLocal do
  def fetch(url, opts \\ build_opts()) do
    request(url, opts)
  end
  defp build_opts, do: []
  defp request(_u, _o), do: :ok
end

defmodule ELX14.CaptureAndOperators do
  @behaviour ELX14.Contract

  # X14/X15 ruling: a capture placeholder's field/member access and a special-variable field
  # read are NOT calls (they name no symbol), and an operator after the Kernel qualifier is a
  # macro spelling, not a callable name. All were emitted at HEAD as `calls` targets like
  # `&1.status`, `__ENV__.lexical_tracker`, `Kernel.<>` — fake edges. Compiled Kernel builtins
  # remain skipped by the pre-existing EX-D2 rule (`Kernel.length` is noise, not a dependency).
  @impl true
  def init(x), do: x

  def capture_field(list), do: Enum.map(list, & &1.status)

  def capture_dynamic(list), do: Enum.map(list, & &1.fetch!())

  def env_field, do: __ENV__.lexical_tracker

  def operator_pipe(a, b), do: a |> Kernel.<>(b)

  def operator_or(a, b), do: Kernel.||(a, b)

  def kernel_builtin(x), do: Kernel.length(x)

  def atom_remote(x), do: :lists.reverse(x)

  def genuine_capture(x), do: Enum.map(x, &String.trim/1)
end

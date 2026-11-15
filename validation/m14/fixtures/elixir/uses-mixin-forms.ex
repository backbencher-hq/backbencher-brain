defmodule UsesMixin do
  # ELX-EXPORTS `uses`: `use Mod` is Elixir's MIXIN APPLICATION —
  # `Mod.__using__(opts)` runs inside this module and injects code into it. It
  # is the same claim dart records for `class A extends B with M1, M2`
  # (real-dart-analyzer.ts:2133, `metadata: { isMixin: true }`). Measured: 509
  # `use` sites in 324 of 559 corpus files, 504 `uses` edges in 321 files.
  #
  # It is NOT a relabelling of the module dependency: `references` is a separate
  # true statement that brain_dependency and the graph's module view read, so
  # both edges are emitted from the same directive.
  use UsesMixin.Genserverish
  use UsesMixin.Other, otp: :enabled
  use UsesMixin.{Grouped, AlsoGrouped}
  use GenServer

  @behaviour UsesMixin.Genserverish

  def child, do: :ok
end

defmodule UsesSelf do
  # The self-directive case: `use UsesSelf` inside `defmodule UsesSelf` is the
  # ELXD8 self-loop guard — the directive registers the alias but publishes
  # neither `uses` nor `references` (a structural self-loop is not a
  # relationship).
  use UsesSelf

  def start_link(opts), do: GenServer.start_link(__MODULE__, opts)
end
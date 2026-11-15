defmodule Cc1.UseOpts do
  # CC1-d: a call inside a `use` option is compile-time directive context —
  # sourced at the MODULE. Pinned so consumers can rely on the source.
  use Cc1.Injectable, opt: helper_fn()

  def helper_fn, do: :ok
end

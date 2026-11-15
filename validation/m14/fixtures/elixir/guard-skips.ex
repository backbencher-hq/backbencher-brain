defmodule Cc1.Guards do
  # CC1-b: a `when` guard is captured as text for pattern metadata; the guard
  # subtree is NEVER walked (analyzer + oracle agree — declared exclusion).
  # The forbid entries in the expectation are the pin: if a future refactor
  # walks guards, these calls appear and the fixture fails.
  def guarded(x) when is_integer(x) do
    x
  end

  def multi_guard(x) when is_integer(x) and is_big(x) do
    x
  end

  defguard is_big(x) when is_integer(x) and x > 2
end

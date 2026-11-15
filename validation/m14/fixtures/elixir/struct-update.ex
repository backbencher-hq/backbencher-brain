defmodule Cc1.StructUpdate do
  # CC1-e: `%S{base | …}` is a construction expression — same instantiates
  # rule as the literal form. Pin: the update form emits instantiates S.
  def bump(p) do
    %Cc1.Point{p | x: p.x + 1}
  end
end

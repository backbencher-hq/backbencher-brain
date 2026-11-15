defmodule Collide.Supervisor do
  use Supervisor
end

defmodule Collide.Thing do
end

defmodule UsesAfter do
  def make do
    %Thing{}
  end
end

defmodule Collide.Inner do
  def make do
    %Inner{}
  end
end

# W23-E1 (review wave): alias LEXICAL scoping — an explicit alias lives in
# its module's frame (never leaks to a later sibling); a nested module's
# implied last-segment alias lives in its ENCLOSING module's frame (never
# escapes to the file root).
defmodule Leak.Source do
  alias Deep.Bar

  def make do
    %Bar{}
  end
end

defmodule Leak.After do
  def make do
    %Bar{}
  end
end

defmodule Nest.Outer do
  defmodule Sup do
  end

  defmodule Nest.Next do
    def make do
      %Sup{}
    end
  end
end

defmodule Nest.After do
  def make do
    %Sup{}
  end
end

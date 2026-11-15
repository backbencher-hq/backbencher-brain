# EX-EX7 — the four module directives and their labels. `import` IS the ontology
# word, so it publishes `imports`. `use` injects a module's code, `require`
# permits its macros to expand and `alias` renames a module: none of those brings
# a name into unqualified scope, and all three stay `references`.
defmodule OntoDirectives do
  use Onto.Framework
  import Onto.Helper
  import Onto.Narrow, only: [thing: 1]
  alias Onto.Alias, as: A
  require Onto.Macros

  def run(x), do: thing(x)
end

# EX-EX13 — a directive-SHAPED call inside a declaration HEAD is the head.
# `defmacro import(module, opts)` is Kernel's own import/2 macro
# (lib/elixir/lib/kernel/special_forms.ex:680); before the guard it published
# `imports <Module>.import/2 -> module`, a dependency on its own parameter name.
defmodule OntoHeadDirective do
  defmacro import(module, opts), do: {module, opts}
  defmacro require(module), do: module
end

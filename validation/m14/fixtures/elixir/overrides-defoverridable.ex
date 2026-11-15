defmodule OverridesSurface do
  # ELX-EXPORTS `overrides`: `defoverridable` is Elixir's override construct and
  # the only one the language has. It marks definitions the module ALREADY
  # published as extension points; a later definition of the same name/arity
  # replaces them and reaches the previous one through `super/1`.
  #
  # Measured: 26 `defoverridable` forms in 14 of 559 corpus files, 65
  # name/arity pairs. The corpus's own ground truth for the semantics is one
  # file — overridable_test.exs: def at :46, defoverridable at :51, a
  # redefinition calling `super()` at :105, defoverridable again at :122, and a
  # second redefinition at :124. This fixture is that shape, distilled.
  def sample, do: :original
  def with_default(a, b), do: {a, b}
  def never_redefined, do: :kept

  defoverridable sample: 0, with_default: 2, never_redefined: 0

  # An override of `sample/0`.
  def sample, do: :overridden

  # An override of `with_default/2` — the arity is part of the identity, so
  # `with_default/1` would NOT be an override of `with_default/2`.
  def with_default(a, b), do: {a, b, :extra}

  # `never_redefined/0` was marked and never redefined: a mark with nothing
  # after it describes an extension POINT, not an override.
end

defmodule OverridesRepeated do
  # Two successive overrides of one name: the second overrides the FIRST
  # redefinition, so `overridesLine` advances.
  def counter, do: 0

  defoverridable counter: 0

  def counter, do: 1

  defoverridable counter: 0

  def counter, do: 2
end

defmodule OverridesAritySplit do
  # Arity identity: only the matching arity is an override.
  def pick(x), do: x
  def pick(x, y), do: {x, y}

  defoverridable pick: 1

  def pick(x), do: {x}
  def pick(x, y), do: {y, x}
end

defmodule OverridesMacro do
  # A MACRO can be overridable too — `defoverridable overridable_macro: 1`
  # appears in the corpus (overridable_test.exs:137).
  defmacrop overridable_macro(x), do: x

  defoverridable overridable_macro: 1

  defmacrop overridable_macro(x), do: x
end

defmodule OverridesModuleForm do
  # The MODULE form: `defoverridable Other.Mod` marks every public definition
  # of ANOTHER module as extension points. It is recorded on the symbol and
  # publishes NO edge, because the definitions it marks live in another file
  # and "who points at me" is a subsystem that does not exist yet. The corpus
  # has 3 such sites (eex/lib/eex/engine.ex:108, application.ex:416,
  # overridable_test.exs:490).
  def local_fun, do: :ok

  defoverridable OverridesModuleForm.Other
end

defmodule OverridesNoPrior do
  # A mark with NO prior declaration describes nothing: an extension point that
  # has not been overridden yet.
  defoverridable never_declared: 1
end
defmodule OverridesMarkFirst do
  # A mark BEFORE the declaration it names describes nothing that has been
  # overridden yet: there is no prior definition, so this is an extension
  # POINT, not an override. (Elixir requires `defoverridable` to FOLLOW the
  # definitions it marks; the shape is written here because a reader must be
  # able to see the analyzer does not invent an override out of the mark.)
  defoverridable marked_first: 1

  def marked_first(a), do: a
end

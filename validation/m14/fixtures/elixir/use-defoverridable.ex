defmodule Cc1.Base do
  # ELIXIR_FIX2-O1/O2 — `overrides`.
  #
  # Elixir HAS the construct: `defoverridable` marks a default implementation as
  # replaceable, and `super(...)` inside a replacement calls it. Corpus: 26
  # defoverridable sites in 14 files, 17 `super(...)` sites in 4 files. Before
  # this lane's change the analyzer read NEITHER.
  #
  # This fixture is the shape that makes the type emit with two DISTINCT
  # endpoints: one file that both DECLARES the provider and `use`s it. That is
  # the only shape a per-file analyzer can name, because the overriding module in
  # the ordinary case lives in ANOTHER file (510 `use` sites across 325 corpus
  # files) and this analyzer publishes OUTGOING edges only.
  #
  # Measured on the corpus: that shape is **0 sites in 601 files** (probe E8).
  # So this fixture is the only place the branch fires, and that is stated rather
  # than hidden: the type does not fire on bb_tests/repositories/{elixir,otp}.
  def base_fun(a), do: a
  def base_fun(a, b), do: {a, b}

  defoverridable base_fun: 1, base_fun: 2
end

defmodule Cc1.Derived do
  use Cc1.Base

  # Overrides Cc1.Base.base_fun/1 — the name is in the provider's overridable
  # set, so this definition REPLACES the default rather than adding a sibling.
  def base_fun(a), do: {:wrapped, a}

  # A NEW function. `use` injects the provider's defaults; a definition whose
  # name is not in the overridable set is not an override, and publishing one
  # would be the fabrication this whole ruling turns on.
  def derived_only(a), do: a
end

defmodule Cc1.WholeModule do
  # `defoverridable SomeModule` marks EVERY function of that module as an
  # override point, so a `use`ing module's matching definitions override all of
  # them without naming any.
  def overridable_fun, do: :ok
  def another_fun, do: :ok

  defoverridable Cc1.WholeModule
end

defmodule Cc1.WholeUser do
  use Cc1.WholeModule

  def overridable_fun, do: :overridden

  # NOT an override: Cc1.WholeModule declares overridable_fun and another_fun,
  # and `defoverridable Cc1.WholeModule` makes THOSE overridable. A definition
  # the provider does not declare is a new function, and the arm that reads the
  # provider's list requires that the provider be declared in this file — drop
  # that requirement and this becomes `overrides -> Cc1.WholeModule.extra_fun`
  # for a function the module does not have.
  def extra_fun, do: :new
end

# A `defoverridable` inside a `__using__` TEMPLATE is quoted code: the mark
# applies to the module that USES the template, not to the module that defines
# it, so crediting it to the template's own module is wrong. 14 of the 26 corpus
# `defoverridable` sites are in this shape — agent.ex:231 (`defoverridable
# child_spec: 1` inside Agent's __using__), dict.ex:218, eex/engine.ex:108
# (`defoverridable EEx.Engine`), application.ex:416, gen_server.ex:920 — and
# reading them as the declaring module's own override points is how a template
# would claim to override itself.
defmodule Cc1.WithTemplate do
  defmacro __using__(_opts) do
    quote do
      def template_default(a), do: a
      def template_other(a), do: a
      def template_only(a), do: a

      # `template_only` is marked ONLY here, inside the quote. It is not marked
      # at Cc1.WithTemplate's own module level, so crediting this mark to
      # Cc1.WithTemplate would make Cc1.TemplateUser.template_only look like an
      # override of a function Cc1.WithTemplate never declared.
      defoverridable template_default: 1, template_only: 1
    end
  end

  def template_default(a), do: a
  def template_other(a), do: a

  defoverridable template_default: 1, template_other: 1
end

defmodule Cc1.TemplateUser do
  use Cc1.WithTemplate

  def template_default(a), do: {:wrapped, a}
  def template_only(a), do: a
end

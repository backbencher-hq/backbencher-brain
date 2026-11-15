defmodule R7Names.Parent do
  # ELX-EXPORTS D4/D5 — a `defmodule` name the analyzer cannot read.
  #
  # D4: the extractor fell back to the whole `arguments` TEXT, so a computed or
  # literal head published its own source line as the module's name. Measured on
  # 559 corpus files: `KernelTest.1 + 2, do: :ok` (kernel_test.exs:906),
  # `KernelTest.:"foo/bar", do: :ok` (:924), `KernelTest.:"foo\\bar", do: :ok`
  # (:928), `MapTest.Module.concatMapTest, DynamicUser` (map_test.exs:355) and
  # `IEx.AutocompleteTest.:"Elixir.IEx.AutocompleteTest.Unicodé", do: nil`
  # (autocomplete_test.exs:564). Each also became a `contains` target, and the
  # BODY of the computed module attached to the enclosing scope — publishing
  # `contains MapTest -> name` and `contains MapTest -> age` for fields declared
  # inside it (map_test.exs:356, :358). A name the language computes at runtime
  # cannot be spelled statically, so the module publishes nothing and its body
  # is not walked.
  defmodule 1 + 2 do
    def inside_computed, do: :never_attributed
  end

  defmodule Module.concat(R7Names, Computed) do
    defstruct [name: nil, age: nil]
  end

  # D5: a quoted-atom name that IS a real module is published under its own
  # ABSOLUTE name, once — not doubled by the enclosing scope and not carrying
  # the atom's quotes. Measured `ModuleTest.:"Elixir.ModuleTest.RawModule"`
  # (module_test.exs:287).
  defmodule :"Elixir.R7Names.RawModule" do
    def hello, do: :world
  end

  # A `__MODULE__`-relative name resolves against the enclosing module.
  defmodule __MODULE__.Relative do
    def here, do: :ok
  end

  # An ATOM module name is real and readable: `defmodule :purge_test`
  # (mix/tasks/compile.erlang_test.exs:71) creates the module `:purge_test`.
  defmodule :atom_named do
    def from_atom, do: :ok
  end

  def readable, do: :ok
end
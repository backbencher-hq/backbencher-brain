defmodule R7DirectiveNames do
  # ELX-EXPORTS D1/D2/D3 — the three places a directive name was fabricated.
  #
  # D1: a directive may name an ATOM module WITH OPTIONS (`alias :lists, as:
  # MyList`). The module name is the ATOM's own text; the options are options.
  # Measured on 559 corpus files before the fix: 15 `references` and 4 `calls`
  # endpoints carried the options, e.g. `references -> ":lists, as: MyList"`
  # (kernel/alias_test.exs:17) and, through the alias the directive registers,
  # `calls -> ":lists, only: [append: 2].append"` (kernel/import_test.exs:86).
  alias :lists, as: R7Alias
  import :lists, except: [flatten: 1]
  require :gen_server, warn: false

  # The registered alias resolves through the ATOM name, not the option text.
  def via_alias(list), do: R7Alias.flatten(list)

  # D2: a TYPESPEC may name a function `require/2`, `alias/1` or `import/1` on
  # its LEFT side. That is a typespec, not a directive: measured
  # `references -> "[Path.t], require_opts"` (kernel/parallel_compiler.ex:278),
  # `references -> "[alias_opt]"` (process.ex:960) and
  # `references -> "%Regex{re_pattern: re_pattern} = regex"` (regex.ex:296).
  @spec require([R7Alias.t()], keyword()) :: {:ok, [atom()]} | {:error, term()}
  @spec alias([R7Alias.alias_opt()]) :: atom()
  @spec import(R7Alias.t()) :: R7Alias.t()

  # D3: a DEFINITION HEAD whose name is `import` is a definition, not a
  # directive. Measured `references -> "%Regex{…} = regex"` (regex.ex:296).
  def import(%R7Alias{} = value), do: value

  # D2/D3 with a STATICALLY READABLE first argument, so the gate is isolated:
  # a typespec naming `require/2` and a definition head named `import/1` both
  # name a module they merely MENTION. Without the gate these two publish
  # `references` edges for a type and a parameter respectively.
  @spec require(R7Alias) :: :ok
  def import(R7Alias.other), do: R7Alias.other
end

defmodule R7UnreadableDirective do
  # A COMPUTED module name cannot be spelled statically: `alias
  # Module.concat(A, B)` publishes nothing at all — not the expression, not a
  # prefix. The alias registration is skipped with it.
  alias Module.concat(R7UnreadableDirective, Computed)
  require R7UnreadableDirective.Helpers.helper()

  def here, do: :ok
end
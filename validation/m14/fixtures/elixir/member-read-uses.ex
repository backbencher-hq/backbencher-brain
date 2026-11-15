defmodule Cc1.MemberRead do
  # ELIXIR_FIX2-U1 — `uses`: a MEMBER FIELD READ.
  #
  # Measured tree shape (tree-sitter-elixir 0.3.5, and the same under the pinned
  # wasm/tree-sitter-elixir.wasm): `user.name` is a `call` node whose target is a
  # `dot` and which has NO `arguments` child — the SAME node shape as a
  # zero-arity remote call. `isMemberAccess` (ELXD18) separates the two by the
  # receiver's first character and silenced the field read entirely, so before
  # this lane's change the three reads below published nothing at all.
  # Corpus: 2,244 sites / 182 files.
  #
  # The family contract for `uses` is exactly this edge. Go publishes selector
  # field access at 0.7 and states the skip rule verbatim ("Selectors that are
  # the callee of a call_expression are skipped — the calls edge handles them");
  # Erlang publishes a record member read; Clojure publishes `.-field` and never
  # `calls`.
  #
  # Falsifiers, one per row below:
  #   mutant elixir/member-read-dropped         — the uses edge stops firing
  #   mutant elixir/member-read-as-call         — it is relabelled `calls`
  #   mutant elixir/member-read-callee-included — the remote callee is double-labelled
  #   mutant elixir/member-read-quoted          — a quoted field read emits
  #   mutant elixir/member-read-pattern         — a `->` pattern emits
  def read(user, opts) do
    a = user.name
    b = user.address.city
    c = Enum.map(opts, fn o -> o.id end)
    {a, b, c}
  end

  # A CAPITALIZED receiver is a module, so the SAME tree shape is a real remote
  # reference and stays a `calls` edge. `uses` must never take it — that is the
  # exact line the Go analyzer drew, and getting it wrong publishes every
  # remote call twice under two labels.
  #
  # Note the form: a remote reference with NO parentheses. `System.argv()` carries
  # an `arguments` child and so never reaches memberReadLeaf at all — it cannot
  # discriminate anything. The shape that actually collides with a field read is
  # the BARE one, a module attribute or zero-arity reference used as a value,
  # which the corpus carries 724 times in 172 files.
  def remote(opts) do
    argv = System.argv
    {argv, Map.keys(opts)}
  end

  # Pattern position: a `->` clause that matches on a field binds it but does
  # not EVALUATE it — `%{name: user.name}` in a case clause is a match, not a
  # read. ER-D7's rule ("a head pattern emits nothing") and a pattern is not a
  # use. This row is the ONLY thing that catches a mutant that drops
  # isPatternPosition from the guard, and it was written after that mutant
  # survived the first version of this fixture.
  def pattern_read(list, map) do
    case list do
      [%{name: map.name} | _] -> :matched
      _ -> :none
    end
  end

  # Quoted code is DATA (the M12.23 quote-as-data contract, Clojure parity).
  # A field read inside `quote do ... end` is AST the macro builds, not a read
  # this module performs.
  def quoted(user) do
    quote do
      unquote(user).injected
    end
  end

  # `recv[:key]` is an `access_call` node and dispatches through the `Access`
  # protocol. Deliberately NOT a `uses`: publishing it would label a protocol
  # dispatch as a field read, which is the `implements` relation's job. Measured
  # 1,378 `access_call` sites in 184 corpus files, all silent.
  def access(map), do: map[:key]
end
# #924 — the name surface, measured on the live analyzers

**Status: diagnosis. No analyzer was edited** (two sweeps were in flight — the co-agent's merge
verification and the armed M60 sharpness sweep — and analyzer edits would dirty whichever lane they
touch in both). This note is the fix surface and the falsifier plan, ready to land.

Instrument: `script/m14/tmp/c924-name-surface-probe.ts` (read-only; parses through the production
entry `parseFile`). It reads the R10 census's own sample files
(`validation/m60/results/target-spelling.json`), re-derives every flagged string from the live
analyzer, prints the source line behind it, and classifies:

- **Q** — quoting syntax is part of the published string (kotlin/scala backticks, zig's `@"…"`).
- **E** — an expression / payload / bracket construct published where a name belongs.
- **R** — a ruled naming form (cpp's `operator char*`), owned by the register's `operatorMember`
  subclass; printed, never counted as #924 work.

Run: `bun script/m14/tmp/c924-name-surface-probe.ts` (add `--lang kotlin,scala`, `--json`).

## Measured (live analyzers, census sample files only)

| lane | Q (quoting syntax) | E (expression/payload as name) | census samples re-derived |
| --- | --- | --- | --- |
| kotlin | 6 occ / 3 distinct | 27 occ / 20 distinct | 33/33 |
| scala | **104 occ / 52 distinct** | 5 occ / 3 distinct | 15/15 (1 by truncation) |
| zig | 5 occ / 3 distinct | 0 | 4/4 |
| haskell | 0 | 8 occ / 2 distinct | 4/4 |
| elixir | 0 | 3 occ / 2 distinct | 5/5 |

**The routed handoff understates the defect by ~10×.** The register routes `payloadSigil` and
`matchesOwnSymbol` to #924 from the census's **whitespace** subclass, so a quoted identifier only
counts if it happens to contain a space. Scala's backticked names mostly do not — `` `object` ``,
`` `apply` ``, `` `case-class-apply` ``, `` `dep-no-source-jar` `` — so 52 distinct names (104
occurrences, each published as a symbol AND as a `contains` target) were invisible to the routing.
kotlin's 3 distinct quoted test names are the whitespace-visible tip of the same class. A name-surface
rule keyed on whitespace cannot see quoting syntax; the rule has to key on the language's quoting
characters.

## Per-lane mechanism (source line → published string)

**kotlin** — Q: `` fun `test char column read and write`() { `` publishes
`` `test char column read and write` `` (backticks included) as a `method` symbol and as a `contains`
target. E: the callee/use descent stops on a call or index node and publishes its TEXT —
`getMap(f)[id.value] as T?` → `getMap(f)`; `cityCount.single()[…]` → `cityCount.single()`;
`currentCoroutineContext()[…]`; a whole multi-line `Users.insert { … }` block. This is the SAME class
the systems gate F14 was written for ("a call's TARGET was whatever node the callee descent stopped
on"), applied to kotlin's descent.

**scala** — Q: `` @Test def `popAll preserves iteration order`: Unit = { `` publishes the backticked
name; `` @Test def `object` = ``, `` `i7256-3` ``, `` `do-not-point-at ::` `` likewise (52 distinct).
E: `A, B` (a type-parameter list), and `remarkably` the anonymous-class synthesis
`anonymous_ScalaRandom(Applicative.pure(new JavaSecureRandom())) with SecureRando…` plus the
`instantiates` target `ScalaRandom(…) with SecureRandom` — an anonymous class whose synthetic name is
raw source text.

**zig** — Q: `fn @"zls env"(` and `fn @"weird function name"()` publish the `@"…"` sigil as the
`function` name AND as the `calls` target; the field access `@TypeOf(S.foo)).@"fn"` publishes
`@"fn"` as a `uses` target. In zig `@"…"` is quoting syntax around an identifier that cannot be
spelled plainly — the name is the content.

**haskell** — E: `instance (GArbitrarySum f, i ~ D) => GArbitrary (M1 i c f) where` publishes
`M1 i c` as a `class` symbol and a `contains` target; `GArbitraryProd (K1 i a)` publishes `K1 i`.
The INSTANCE HEAD's type application (a payload) is read as the declared name.

**elixir** — E: the definition head is split across lines by a comment —

```elixir
defp ascii_printable_guarded?([char | rest], counter)
     # 7..13 is the range '\a\b\t\n\v\f\r'. 32..126 are ASCII printables.
     when is_integer(char) and …
```

— and the analyzer publishes the COMMENT as the `function` name (list.ex:784) plus a `contains`
target. Separately, `import Module.Types.{Helpers, Descr}` publishes the module-group expression as a
`references` target.

## Node-level mechanism (measured — `script/m14/tmp/c924-node-types.ts`)

Five minimal snippets (`c924-node-shapes.ts`) reproduce all five mechanisms through the production
entry, and the raw grammar walk (`c924-node-types.ts`) gives the node that carries the name. This is
the whole fix surface, node by node:

| lane | offending string | the node that carries it | shape |
| --- | --- | --- | --- |
| kotlin | `` `test char column read and write` `` | `simple_identifier` | a single token whose `.text` INCLUDES the backticks (0 children) — the quoting is inside the identifier token |
| kotlin | `dest.selectAll().where {…}.single()` | `navigation_expression` / `call_expression` chain | the callee descent returned a chain node, not an identifier |
| scala | `` `object` `` | `identifier:name` of `function_definition` | one token, `.text` includes the backticks |
| scala | `ScalaRandom(Applicative.…()) with SecureRandom` | `applied_constructor_type:base` inside `compound_type` | the anonymous class's name was read from the CONSTRUCTOR TYPE (with arguments + `with`), not its `type_identifier` (`ScalaRandom`) |
| zig | `@"weird function name"` / `@"fn"` | `identifier:name` / `identifier:member` | the identifier's children are `@` + `string` — the sigil is two tokens, and `.text` takes both |
| haskell | `M1 i c` | `apply:constructor` inside `apply:type` inside `parens` inside `type_patterns:patterns` of `instance` | the instance head's TYPE APPLICATION was published as the class name |
| elixir | the comment as the function name | `comment` inside `binary_operator` (the `when` guard) inside `arguments` of the `call` | the name was read from inside the guard arguments, and a `comment` node was accepted as a name |

Two consequences the fix inherits: (a) the kotlin/scala/zig quote-stripping is a text operation on an
IDENTIFIER node that already exists — the descent is right, the spelling is wrong; (b) the kotlin
call-chain, scala anonymous class, haskell instance head and elixir comment cases are all the OPPOSITE
— the spelling is the source's own, and the DESCENT landed on the wrong node. One rule cannot fix
both; the two rules are the numbered pair below.

## The shared rule shape (what a fix must implement)

1. **Descend to an identifier node** for every published name/target: never a call, index, list,
   payload or expression node (kotlin's E, haskell's E, elixir's comment, scala's `A, B`).
2. **Strip the language's quoting syntax** from the published identifier: kotlin/scala backticks,
   zig's `@"…"` (kotlin's Q, scala's Q, zig's Q). The name is the content, not the spelling.
3. **Synthetic names must be canonical**, never source text (scala's anonymous class); a
   deterministic form (e.g. the first type name or an offset) is a name, a parenthesised expression is
   not.

## Falsifier plan (a fix is not believed until this can fail)

- `bun script/m14/tmp/c924-name-surface-probe.ts` must report **Q=0 and E=0** for all five lanes, and
  still re-derive every census sample (the samples change their SPELLING, so the check is that the
  same files and sites are still read — a disappearing sample is a missing site, not a fix).
- The R10 register re-run at the same phase (`script/m60/target-spelling-register.ts --phase …`) must
  move the routed counts to zeroed handoffs, and the census re-run must not move any OTHER lane's
  subclass counts.
- Per-lane fixtures: kotlin `` `name with space` `` and `getMap(f)`; scala `` `object` `` / `A, B`;
  zig `fn @"zls env"`; haskell `instance … (M1 i c f) where`; elixir the split-head comment. Each
  fixture must fail before the fix and pass after, and the truth/oracle side must move with it (these
  classes are self-consistent, which is why the differential could not see them — the fixture and the
  probe are the gate, not F5).
- The `hard`-mask rule of M60.SHARP is unaffected: this is a name-surface change, and the lanes'
  diff cells are re-measured after it (kotlin/scala/zig are minutes each).

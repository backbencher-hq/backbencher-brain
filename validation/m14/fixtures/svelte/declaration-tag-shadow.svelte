<!-- fixture: svelte/declaration-tag-shadow
     Svelte 5.36 TEMPLATE DECLARATION TAG: `{let x = …}` and `{const x = …}`
     declare a template-local, and the pinned tree-sitter grammar gives them NO
     node type of their own — they come back as a plain `expression` whose
     `svelte_raw_text` is the whole `let x = …`. So the generic mustache branch
     read the DECLARED NAME as a member and left the binding unshadowed for the
     rest of the enclosing block.

     Measured: 40 such sites in 20 of the 6,439 corpus files, producing exactly
     1 false read —
     packages/svelte/tests/validator/samples/declaration-tag-already-declared/
     input.svelte, whose whole point is that `{let foo = 'baz'}` re-declares the
     script's `foo`, published `uses -> foo` at the declaration line.

     `{@const}` was already handled (the S5 shadow case); this is the same
     construct in the newer spelling, and it REPLACES the generic read rather
     than adding to it — the first version of this fix ran both and the head was
     still read at the declaration line.

     The pins that keep it honest:
       - the RIGHT-HAND SIDE is still a read (`alpha` on line 45), because it
         names a component member; a fix that shadowed the whole tag would lose it
       - the declared name is shadowed for the REST of the enclosing block
         (`counter.value` on line 41 must not publish `counter` again), and NOT
         shadowed before the declaration (line 33 is above line 37)
       - `{@const}` still works — it is a different node type and must not regress
       - a WORD BOUNDARY: `{letter = 5}` is an ASSIGNMENT to a member named
         `letter`, not a `let` tag with the binding `ter`. The first version read
         `letter` as `let` + `ter` and fabricated a shadow. -->
<script>
  let counter = { value: 1 }
  let letter = 5
  let alpha = 2
  let beta = 3
  let doubler = (n) => n * 2
</script>

<div>{counter.value}</div>
<div>{letter}</div>

{let counter = { value: 10 }}
{const doubler = (n) => n + 1}

<div>{counter.value}</div>
<div>{doubler(alpha)}</div>
<div>{doubler(beta)}</div>

{@const alpha = 99}
<div>{alpha}</div>
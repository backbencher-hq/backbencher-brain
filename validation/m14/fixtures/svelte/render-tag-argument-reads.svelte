<!-- fixture: svelte/render-tag-argument-reads
     A `{@render}` tag carries TWO facts: the snippet it CALLS, and the arguments
     it READS. Only the call was published, so a component's own graph could not
     show that `{@render row(users)}` reads `users` — while the same name in a
     mustache in the same file does publish a `uses` edge. That is an
     inconsistency with every other carrier (D12's argument for `use:action={p}`
     publishing both), not a position.

     Measured before this fix over the 6,439-file corpus (svelte 4,561 +
     shadcn-svelte 1,878 .svelte files): 126 argumented render tags in 83 files,
     0 of them publishing an argument read.

     The four shapes pinned here are the ones the corpus actually has
     (parser-modern/samples/snippets, print/samples/render-tag,
     migrate/samples/slots, compiler-errors/samples/render-tag-invalid-call):
       {@render row(alpha)}         bare argument
       a multiline argument list    the LINE must be the identifier's own
       {@render row(pick(delta))}   nested call: both names read
       {@render row(obj.eps)}       member LEAF skipped, receiver read
     Every argument gets its OWN member, because the collector keys its read map
     by NAME and two reads of one name collapse to the last site — so a line pin
     on a name read twice would be asserting a property this lane does not have.
     That is stated here rather than left for the next fixture author to find.

     The callee is never re-published as a read — `calls row` owns it — and the
     snippet's own parameter is a template-local binding, never a member read. -->
<script>
  let alpha = 1
  let beta = 2
  let gamma = 3
  let delta = 4
  let obj = { eps: 5 }
  function pick(x) { return x }
</script>

{#snippet row(u)}<li>{u}</li>{/snippet}

{@render row(alpha)}

{@render row(
  beta,
  gamma
)}

{@render row(pick(delta))}

{@render row(obj.eps)}
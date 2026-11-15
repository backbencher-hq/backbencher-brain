<!-- fixture: svelte/keyed-each-key-reads
     The KEYED each form. tree-sitter-svelte puts the key INSIDE the second
     `each_start` fragment, so `{#each rows as row}` yields `row` and
     `{#each rows as row (row.id)}` yields `row (row.id)` — one fragment, not two.

     The old rule handed that whole fragment to the shadow collector, which
     registered the KEY's property leaves as TEMPLATE-LOCAL BINDINGS. Two
     consequences, both measured over the 6,439-file corpus where the keyed form
     occurs 699 times in 486 files:

       1. A FALSE SHADOW. `{#each todos as todo (todo.id)}` silenced a member
          named `id` for the whole block — `id` was registered as a binding it
          never was. Block `keyed-shadow` below pins the member read that the old
          rule swallowed.
       2. THE KEY PUBLISHED NO READ, while the collection on the same line does.
          `{#each rows as row (keyOf(row))}` published `uses rows` and nothing
          for `keyOf`.

     The head is the binding list; the parenthesised tail is a READ, on the same
     S1 argument as the collection. The collector's own dot rule then skips
     `row.id`'s leaves, so the ordinary keyed block `{#each rows as row (row.id)}`
     contributes nothing new — pinned, because a widening that published `id`
     there would be a new false edge in the most common keyed shape there is.

     `keyed-plain` is the unkeyed control: `{#each rows as row, i}` must be
     unchanged by this fixture, so a rule that simply collected the whole
     fragment as reads (bindings included) would fail here. -->
<script>
  let rows = []
  let keyOf = (r) => r.id
  let sortKey = "a"
  let id = "a-member-named-id"
</script>

{#snippet list()}
  {#each rows as row (keyOf(row))}
    <li>{row.n}</li>
  {/each}
  {#each rows as row (sortKey)}
    <li>{row.n}</li>
  {/each}
  {#each rows as row, i (keyOf(row))}
    <li>{row.n}{i}</li>
  {/each}
{/snippet}

{@render list()}

{#each rows as row (row.id)}
  <li>{id}</li>
{/each}

{#each rows as row, i}
  <li>{row.n}{i}</li>
{/each}
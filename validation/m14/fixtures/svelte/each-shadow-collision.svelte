<script lang="ts">
  const rows = [{ id: 1, label: 'a' }, { id: 2, label: 'b' }];
  const nested = [{ children: [3, 4] }];
  // Members that collide with the {@const} / loop-var names below.
  function row(id: number) { return id * 2; }
  function item(x: number) { return x + 1; }
  function total(n: number) { return n; }
</script>

<!-- #each loop var `row` SHADOWS the member function `row`:
     `{row}` and `{row.id}` read the ELEMENT, not the member. No uses -> row. -->
{#each rows as row}
  <p>{row.id} {row.label}</p>
{/each}

<!-- Nested each: inner `item` shadows the member `item`. -->
{#each nested as group}
  {#each group.children as item}
    <span>{item}</span>
  {/each}
{/each}

<!-- {@const total} shadows the member function `total` within the block. -->
{#each rows as r}
  {@const total = r.id}
  <em>{total}</em>
{/each}

<script lang="ts">
  type Item = { id: number; label: string };
  let items: Item[] = [];
</script>

{#each items as item (item.id)}
  <li>{item.label}</li>
{/each}

{#each items.slice(0, 5) as item, index}
  <span>{index}: {item.label}</span>
{/each}

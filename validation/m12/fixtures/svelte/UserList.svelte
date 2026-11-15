<script>
  import { derived, readable } from 'svelte/store'
  import Card from './Card.svelte'

  export let items = []

  const count = readable(0)
  const doubled = derived(count, ($count) => $count * 2)

  function select(item) {
    console.log('selected', item)
  }
</script>

<slot name="header">
  <h2>Users</h2>
</slot>

{#each items as item (item.id)}
  <Card title={item.name} on:greet={() => select(item)} />
{:else}
  <p>No users</p>
{/each}

<p>{$doubled} users</p>

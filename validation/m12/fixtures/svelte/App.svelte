<script lang="ts">
  import Button from './Button.svelte'
  import Card from './Card.svelte'
  import UserList from './UserList.svelte'

  let page = $state(1)
  let loading = $state(false)

  function nextPage() {
    page += 1
  }
</script>

<svelte:head>
  <title>App</title>
</svelte:head>

<header>
  <h1>My App</h1>
</header>

<main>
  <Card title="Welcome" on:greet={nextPage} />
  <UserList items={items} on:load={() => nextPage()} />
  <Button disabled={loading}>Load</Button>
  <slot />
</main>

{#if loading}
  <p>Loading…</p>
{:else}
  <p>Page {page}</p>
{/if}

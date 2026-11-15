<script lang="ts">
  import { writable } from 'svelte/store'
  import { api } from './api'

  let { title, items = [] }: { title: string; items?: string[] } = $props()

  let count = $state(0)
  let doubled = $derived(count * 2)

  function increment() {
    count += 1
    api.log(count)
  }
</script>

<h1>{title}</h1>
<p>Count: {count}</p>
<button onclick={increment}>+</button>
<ChildList {items} />

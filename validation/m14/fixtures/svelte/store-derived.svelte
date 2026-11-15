<script lang="ts">
  import { writable } from 'svelte/store'

  const count = writable(0)
  const doubled = derived(count, (n) => n * 2)

  function reset() {
    count.set(0)
  }
</script>
<p>{doubled}</p>
<button on:click={reset}>Reset</button>

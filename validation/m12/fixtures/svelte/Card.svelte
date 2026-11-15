<script>
  import { writable } from 'svelte/store'

  export let title = 'Card'
  export let body = ''

  const theme = writable('light')
  let count = 0

  export function reset() {
    count = 0
  }

  $: header = title.toUpperCase()
  $: if (count > 10) {
    reset()
  }
</script>

<article>
  <h2>{header}</h2>
  <p>{body}</p>
  <p>Theme: {$theme}</p>
</article>

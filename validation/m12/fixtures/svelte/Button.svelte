<script lang="ts">
  let { label = 'Submit', disabled = false, onSelect } = $props()
  let count = $state(0)
  let doubled = $derived(count * 2)

  $effect(() => {
    console.log('count changed', count)
  })

  function bump() {
    count += 1
  }
</script>

<button class="btn" disabled={disabled} on:click={() => bump()}>
  {label} ({doubled})
</button>

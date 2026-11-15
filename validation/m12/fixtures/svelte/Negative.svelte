<script>
  export let query = ''

  let local = 5
  let stateVal = $state(0)

  function handleInput(event) {
    const tmp = event.target.value
    stateVal = tmp.length
  }

  $: filtered = local > 10 ? 'big' : 'small'
</script>

<input bind:value={query} on:input={(e) => e.target.value} class:active={stateVal > 0} />
<button transition:fade>Go</button>
<span>{filtered}</span>

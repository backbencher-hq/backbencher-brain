<!-- fixture: svelte/template-lines-825
     M59 (#825): svelte carried no line on 526 of 526 relationships on the
     round's pinned 40-file sample, and its own template edges had the same
     problem as vue's for a different reason: svelte's template expressions are
     opaque `svelte_raw_text` leaves, so the identifier scan is a pure-string
     walk with no node — and the collector kept only a Set of names, throwing the
     fragment's line away. This fixture pins the template contracts plus the SFC
     seam (the script block is delegated to the js/ts analyzer and its lines are
     script-relative until the merge shifts them).
-->
<script>
  import Child from "./Child.svelte"

  let { label = "x" } = $props()
  let count = $state(0)

  function bump() {
    count = count + 1
  }
</script>

<div class="wrap">
  <Child />
  <button on:click={bump}>{count}</button>
  {#if label}
    <span>{label}</span>
  {/if}
</div>

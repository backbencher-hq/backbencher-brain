<script>
  import Child from "./Child.svelte"

  let bound = $state(0)
  let element = $state(null)
  let isActive = $state(false)
  let tint = $state("red")
  let params = $state({})
  let timing = $state({})
  function doAction() {}
  function doTooltip() {}
  function doSlide() {}
  function doFly() {}
  function doFade() {}
  function doFlip() {}
  function doClick() {}
</script>

<button
  bind:value={bound}
  bind:this={element}
  class:active={isActive}
  style:color={tint}
  use:doAction={params}
  use:doTooltip
  transition:doSlide={timing}
  in:doFly
  out:doFade
  animate:doFlip
  on:click={doClick}
  let:item
>x</button>

<div class="md:grid-cols-2 dark:bg-background after:absolute" style="color:red"></div>
<Child on:click={doClick} />

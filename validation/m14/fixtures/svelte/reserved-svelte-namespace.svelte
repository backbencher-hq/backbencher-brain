<script>
  import Child from "./Child.svelte"
  import Panel from "./Panel.svelte"
  let a = $state(true)
</script>

<Child />
<Panel />
<Custom />
<div>plain intrinsic</div>

<svelte:self />
<svelte:component this={Child} />
<svelte:element this={"div"} />
<svelte:head><title>t</title></svelte:head>
<svelte:boundary onerror={() => {}}><p>x</p></svelte:boundary>

<svelte:bogus />
<svelte:selfdestructive x="{a - 1}" />

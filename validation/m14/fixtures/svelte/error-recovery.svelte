<script>
  import Alpha from "./Alpha.svelte"
  import Beta from "./Beta.svelte"
  let shared = 1
</script>

<Alpha a={shared} />

{#if shared}
  <span>inside the unclosed block</span>

<Beta b={shared} />

<div>
	<Comp.
</div>

<p>after everything</p>

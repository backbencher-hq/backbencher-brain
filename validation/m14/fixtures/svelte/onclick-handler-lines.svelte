<!-- fixture: svelte/onclick-handler-lines
     Master review (recall): Svelte 5 `onclick`-style attributes are the same
     calls edge as `on:` through the modern spelling — but ONLY on intrinsic
     tags. On a component, `onclick` is a *prop* (never a call); short words
     (`once`, `only`) are never events. Lines name the handler's expression. -->
<script>
  import Comp from "./Comp.svelte";

  function save() {}
  function del(id) {}
  function focus() {}
</script>

<button onclick={save}>
  <span onclick={(e) => del(e)}>x</span>
</button>
<Comp onclick={save} once="x" />
<div onfocus={focus} />
<form onsubmit={(event) => {
  event.preventDefault();
}} />

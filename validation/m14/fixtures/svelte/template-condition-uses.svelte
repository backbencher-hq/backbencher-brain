<script>
let shown = true;
let fallback = false;
let k = 1;
let label = "x";
</script>

{#if shown}
<p>{label}</p>
{:else if fallback}
<p>other</p>
{/if}
{#key k}<span>fixed</span>{/key}

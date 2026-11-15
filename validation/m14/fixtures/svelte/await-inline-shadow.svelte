<script>
let promise = Promise.resolve(1);
let value = 0;
let data = null;
let d = 1;
let x = 1;
</script>

{#await promise then value}
<p>{value} {x}</p>
{/await}
{#await data as d}
<p>{d}</p>
{/await}

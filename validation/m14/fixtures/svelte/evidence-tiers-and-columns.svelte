<script>
export let title = "x"
let count = 0
function inc() {
  if (count > 9) count = 0
}
</script>

<button on:click={inc}>{title}</button>
<Card title={count} />

<script>
let { a, b, c = 5 } = $props();
let extra = 1;
</script>

<template>
  <div>{a} {b}</div>
</template>
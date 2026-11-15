<script>
// The pair to ts-type-inference: a plain block is dispatched to the
// JavaScript analyzer, so NO type inference was available and saying `true`
// would be as false as the old constant said `false`.
const plain = 1
</script>

<template>
  <div>{{ plain }}</div>
</template>
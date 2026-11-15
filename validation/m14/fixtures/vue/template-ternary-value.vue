<script>
export default {
  name: 'W',
  data: () => ({ show: true, flag: false, count: 0, total: 1, label: 'x', items: [], row: null, n: 1, other: 2 }),
  methods: { go(v) { return v } },
}
</script>

<template>
  <div>
    <!-- THE TRAP for F10. The obvious rule — an identifier followed by a colon is
         an object key — is WRONG here: in `show ? count : total` the `count` is a
         VALUE and the colon is the ternary's. A fix that reads the colon without
         tracking the `?` silently deletes every ternary-branch member read, and a
         fixture that only forbade things would score that as a pass. Every row
         below is a real member read and must survive. -->
    <p>{{ show ? count : total }}</p>
    <p>{{ flag ? label : count }}</p>
    <p>{{ count ?? total }}</p>
    <p>{{ { count } }}</p>
    <p>{{ items.map(x => x) }}</p>
    <p>{{ row?.name }}</p>
    <p :x="{ count: count }">{{ n }}</p>
    <!-- a COMPUTED key: `[count]` names no property, so its content is a real
         read of `count`. A key rule that skipped the whole bracket instead of the
         key POSITION would silently lose it. -->
    <p>{{ { [count]: other } }}</p>
    <p>{{ { ['count']: other } }}</p>
  </div>
</template>

<template>
  <ul>
    <!-- V4/M49 characterizations. Every one of these parses through
         `parseVForDirective`, which replaced two regexes. The behaviours pinned
         here are the ones a naive hand-written parser gets wrong, and all of them
         are OBSERVABLE, so they are worth a fixture rather than a comment. -->
    <li v-for="shadowed in items">{{ shadowed }}</li>
    <li v-for="(row, i) in grid">{{ row }}{{ i }}</li>
    <li v-for="(v, k) of map">{{ v }}{{ k }}</li>
    <li v-for="alias of records">{{ alias }}</li>
    <li v-for="x in fn(a, b)">{{ x }}</li>
    <li v-for="multiline in
         spread">{{ multiline }}</li>
    <li v-for="nested in outer(inner(deep))">{{ nested }}</li>
    <li v-for="sibling in plainList">{{ sibling }}</li>
    <Scoped v-slot="{ scoped, other: renamed }">{{ scoped }}{{ renamed }}</Scoped>
  </ul>
</template>

<script>
export default {
  name: 'VForDirectiveShapes',
  props: ['items', 'grid', 'map', 'records', 'fn', 'a', 'b', 'spread', 'outer', 'inner', 'deep', 'plainList'],
  methods: {
    shadowed() { return 1 }, row() { return 2 }, i() { return 3 }, v() { return 4 },
    k() { return 5 }, alias() { return 6 }, x() { return 7 }, multiline() { return 8 },
    nested() { return 9 }, sibling() { return 10 }, scoped() { return 11 }, renamed() { return 12 },
  },
}
</script>

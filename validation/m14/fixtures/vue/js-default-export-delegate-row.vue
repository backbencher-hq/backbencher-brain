<!-- fixture: vue/js-default-export-delegate-row
     F19's other side. The SAME component written in a plain `<script>` block is
     handled by the JavaScript delegate, which already emits the default-export
     edge. The seam must NOT add a second row beside it: the store keys a
     relationship on (source, target, type, line) with `INSERT OR IGNORE`, so a
     near-duplicate is a row that silently loses, carrying whatever the winner's
     metadata said. The `meta.sfcDefaultExport` marker is how a reader tells the
     two producers apart, and this fixture pins its ABSENCE on the delegate's
     row by forbidding the marker — an affirmative forbid, because a `meta.x:
     null` forbid cannot be written today (script/m14/run-fixtures.ts resolves
     the top-level `field: null` convention before its `meta.` branch, so
     `meta.x: null` matches every row; see the vue/decorator-metadata-868
     failure, which is that bug and not an analyzer defect). -->
<template>
  <div class="panel">{{ title }}</div>
</template>
<script>
import { defineComponent } from 'vue'

export default defineComponent({
  name: 'PlainPanel',
  props: {
    title: { type: String, default: 'x' },
  },
})
</script>
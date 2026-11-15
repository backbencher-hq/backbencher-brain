<!-- fixture: vue/ts-default-export
     F19 (vue ontology wave). A `<script lang="ts">` component declares itself
     with `export default defineComponent({ ... })` — the dominant Vue 3 + TS
     component shape. The seam must publish that declaration as an `exports`
     edge, because for a `.vue` file the default export IS the component and
     this file already publishes the component as a Class symbol under one
     identity. Written with a `name:` option as well, so the fixture pins the
     F8 re-point too: the edge's source is the DECLARED name, not the file stem.

     Two `<script>` blocks are NOT used here — a dual-block SFC would conflate
     this with vue/dual-script-blocks, which pins the multi-block contract. -->
<template>
  <div class="panel">{{ title }}</div>
</template>
<script lang="ts">
import { defineComponent } from 'vue'

export default defineComponent({
  name: 'TypedPanel',
  props: {
    title: { type: String, default: 'x' },
  },
})
</script>
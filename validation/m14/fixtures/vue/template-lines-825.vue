<!-- fixture: vue/template-lines-825
     M59 (#825): vue carried NO line on any of its 3,940 relationships on the
     round's pinned 40-file sample, for two independent reasons, and this fixture
     pins both. (1) The SFC SEAM: the script block is handed to the js/ts analyzer,
     whose lines are SCRIPT-relative — every script artifact the wrapper merges
     (symbols, imports, exports, errors) is shifted to file lines, and the
     relationships were pushed raw, so the moment the delegate emitted lines every
     delegated edge claimed a line above the file's own end (measured: 562 of 585
     line-bearing vue edges INCONSISTENT). (2) The TEMPLATE: an interpolation's
     read is written in the template fragment, a component usage is written as its
     TAG, and a prop's declaration line is its KEY's line — not the `props: {`
     pair's, which is what the prop symbols were stamped with (Account.vue:17).
-->
<template>
  <div class="wrap">
    <ChildPanel :label="label" />
    <span>{{ count }}</span>
    <TabPane>
      {{ title }}
    </TabPane>
  </div>
</template>

<script>
import ChildPanel from "./ChildPanel.vue"

export default {
  name: "Panel",
  components: { ChildPanel, TabPane },
  props: {
    label: { type: String, default: "" },
    count: { type: Number, default: 0 },
  },
  data() {
    return { title: "x" }
  },
  methods: {
    onSave() {
      this.title = this.title + "!"
      return this.label
    },
  },
}
</script>

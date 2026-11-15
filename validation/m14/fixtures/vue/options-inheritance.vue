<script lang="ts">
import BasePanel from './BasePanel.vue'
import { useMixin } from './mixins'
import LegacyMixin from './LegacyMixin.vue'

export default {
  name: 'Child',

  // Vue 2: "This option allows us to extend another component … this is like
  // class inheritance in other languages." A real inheritance edge.
  extends: BasePanel,

  // Options-API inheritance can also be an ARRAY, and the inline-OBJECT form
  // merges another component's options in wholesale — so its members become
  // this component's members.
  mixins: [useMixin, LegacyMixin],

  methods: {
    own() { return 1 },
  },
}
</script>

<template>
  <div />
</template>
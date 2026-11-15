<script lang="ts">
  // F18 (2026-10-31): what a `provide()` publishes is not only its `key: value`
  // PAIRS. Vue hands the injector whatever object the call was given, so every
  // shape that object can be written in names a member a consumer reads:
  //
  //   provide(k, { triggerRef })               a SHORTHAND shares a local
  //   provide(k, { size: computed(() => 1) })  a PAIR names a property
  //   provide(k, { close() {} })               a SHORTHAND METHOD is a member
  //   provide(k, reactive({ nodes, index }))   the object is WRAPPED
  //
  // The old walk read the direct second argument and required it to be an
  // `object`, then accepted only `pair` children. So it published the pairs and
  // dropped the rest: dropdown.vue lost contentRef / triggerId / isUsingKeyboard /
  // onItemEnter / onItemLeave / handleClose, form.vue lost every member of its
  // `reactive({ ... })` including emit / resetFields / clearValidate /
  // validateField, and cascader-panel's menu.vue lost the `Pick<>` key literals.
  // Twelve and two rows respectively, all real provided contracts, none of them
  // derived by any fixture. Found by the `contains` oracle deriving rows the
  // analyzer never emitted.
  //
  // A provided member the file does not declare elsewhere has no symbol to
  // annotate, so it is SYNTHESIZED with `metadata.synthesized` — the same
  // declaration the stem fallback uses, which keeps the m60 surface audit
  // governing it rather than leaving it invisible.
  import { defineComponent, provide, reactive, computed } from 'vue'
  import { PANEL_KEY } from './panel-tokens'

  export default defineComponent({
    name: 'PanelGroup',

    setup() {
      const contentRef = ref()
      const size = computed(() => 1)
      const nodes = []
      const index = 0

      provide(PANEL_KEY, { contentRef })
      provide(PANEL_KEY, { size })
      provide(PANEL_KEY, {
        close() {
          return 1
        },
      })
      provide(PANEL_KEY, reactive({ nodes, index }))

      return { contentRef, size, close: () => 1 }
    },
  })
</script>

<template><div ref="contentRef">{{ size }}</div></template>

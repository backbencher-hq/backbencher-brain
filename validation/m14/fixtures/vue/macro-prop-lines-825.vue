<!-- fixture: vue/macro-prop-lines-825
     M59 (#825) follow-up, measured on element-plus split-bar.vue: macro prop
     and event symbols range at their own KEY lines — the old
     nodeToRange(call) stamped `defineProps({` for every member. Covers both
     macro spellings: the runtime object form and the generic type-literal
     form (property identifiers for props, string literals for emits). -->
<template>
  <div>{{ title }}</div>
</template>

<script lang="ts" setup>
const props = defineProps({
  title: {
    type: String,
    required: true,
  },
  count: Number,
});

const emit = defineEmits<{
  (e: 'save'): void;
  (e: 'close' | 'cancel'): void;
}>();
</script>

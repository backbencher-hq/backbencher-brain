<script setup lang="ts">
// F13: `defineEmits([ … ])` accepted ONLY string elements, so an IDENTIFIER
// element — which names a declaration, not an event — was dropped on the floor:
// no symbol and no edge. Measured at the 829-file corpus draw: 13 files whose
// event set silently loses a member, e.g. time-select.vue's
//   defineEmits([CHANGE_EVENT, 'blur', 'focus', 'clear', UPDATE_MODEL_EVENT])
// published only blur / focus / clear and referenced neither constant, so the
// graph claimed the component emits three events when it emits five. These
// constants are IMPORTED from '@element-plus/constants', so resolving their
// values is cross-file work this lane does not do — but the DECLARATION is
// nameable right here, exactly as `defineProps(binding)` names one, and F12
// already established that a named declaration becomes a contract edge.
const LOCAL = 'local'
defineEmits([CHANGE_EVENT, 'blur', LOCAL])
</script>

<template><div /></template>

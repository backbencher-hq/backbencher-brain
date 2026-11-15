<script setup lang="ts">
// ── A NAMED type argument declared in this same SFC ────────────────────────
// The sub-analyzer already publishes this interface's members with the
// INTERFACE as their owner (`contains LocalProps -> localA`). The component's
// gap is the missing link to it, not the missing members — and the store's
// symbol key is `${fileId}:${name}:${startLine}` with owner NOT in it, so a
// component-owned copy of `localA` at the same line would silently REPLACE the
// interface's own row (measured, f12-keyproof.ts). Hence an EDGE here.
interface LocalProps {
  /** the doc comment must not become part of the name */
  localA: string
  localB?: number
}
type LocalEmits = {
  (e: 'local-save', id: string): void
  (e: 'local-close'): void
}

// ── A same-file BINDING. Its object-literal keys are published by NOTHING
// else, so component-owned symbols are safe and match the inline runtime form.
const boundProps = { boundA: String, boundB: { type: Number, default: 0 } }
const boundEmits = ['bound-save', 'bound-close']

// ── An IMPORTED declaration. The member names are not knowable from this file
// without reading another one, and the production indexer passes no cross-file
// companion, so this is also an edge.
import { RemoteProps, remoteEmits } from './remote-contract'

const local = defineProps<LocalProps>()
const localEmit = defineEmits<LocalEmits>()
const b1 = defineProps(boundProps)
const b2 = defineEmits(boundEmits)
const remote = defineProps<RemoteProps>()
const remoteEmit = defineEmits(remoteEmits)
</script>

<template>
  <div>{{ boundA }}<span @click="b2('bound-save')" /></div>
</template>

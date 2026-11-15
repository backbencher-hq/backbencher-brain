<script lang="ts">
// ── Options API: the contract hoisted to a same-file `const` ────────────────
// Same spelling as the script-setup binding and the same loss before F12:
// `props: boundProps` extracted nothing, so a component that declares its
// contract in one place and names it in another had no contract at all.
const optionProps = { optionA: String, optionB: { type: Number, default: 0 } }
const optionEmits = ['option-save', 'option-close']

// ── a cast wrapper, and an array of constant REFERENCES ─────────────────────
type Wrapped = { (e: 'wrapped-event'): void }
const localEmits = { localA: null }

export default {
  name: 'NamedContractOptions',
  props: optionProps,
  emits: optionEmits,
  methods: {
    casted() { return 1 },
  },
}
</script>

<script setup lang="ts">
// ── F12 shape: a cast around a binding ──────────────────────────────────────
const castProps = { castA: String } as const
const cast = defineProps(castProps)

// ── F12 shape: an array of constant references, resolved to a local const ────
const LOCAL_EVENT = 'local-event'
const arrEmit = defineEmits([LOCAL_EVENT])

// ── F12 shape: an intersection type argument ────────────────────────────────
type LeftProps = { leftA: string }
const inter = defineProps<LeftProps & { rightB: number }>()

// ── F12 shape: a NAMED emits type, same file ────────────────────────────────
const namedEmit = defineEmits<Wrapped>()
</script>

<template>
  <div>{{ optionA }}{{ castA }}{{ leftA }}</div>
</template>

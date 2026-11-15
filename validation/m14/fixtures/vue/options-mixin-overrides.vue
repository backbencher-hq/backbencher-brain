<template>
  <div @click="shared">{{ shared }}</div>
</template>

<script>
// ONTOLOGY (2026-10-03; CORRECTED 2026-10-05 against Vue's own merge table).
// `overrides` for the Options-API merge, in the ONE shape an SFC parse can read
// without leaving the tree.
//
// Vue's own merge rule is NOT "the component's value for an option wins" —
// `internalOptionMergeStrats` (vuejs@4ab865a,
// packages/runtime-core/src/componentOptions.ts:1005-1035) splits the option kinds
// in two, and the label may only be emitted for the half that REPLACES:
//
//   methods, computed, props, emits, inject  -> extend(base, own)   child wins  YES
//   data (colliding RETURNED keys)            -> extend(to(), from())         YES
//   beforeCreate … serverPrefetch (14 hooks)  -> mergeAsArray      BOTH RUN    no
//   watch (per key)                           -> mergeWatchOptions BOTH RUN   no
//   data itself, provide                      -> mergeDataFn      BOTH RUN    no
//
// So this fixture pins BOTH halves: the four true rows above are asserted, and
// the merge half is pinned as `forbidRelationships` so a reimplementation that
// widens the rule cannot pass on the true rows alone.
//
// The endpoint convention is the delegate's, unchanged:
// `${component}.${member}` -> `${base}.${member}` (javascript:1503,
// typescript:5236), so one consumer's join works on both producers' rows.
const localMixin = {
  methods: {
    shared() { return 0 },
    onlyInBase() { return 0 },
  },
  emits: {
    // The PAIR form (`save: handler`), because that is the only form this lane
    // publishes an `Event` symbol for: `propEntries` reads `pair` children of the
    // emits object, so a shorthand `save() {}` declares an event nobody publishes
    // and the collision below would be unjoinable for want of a symbol rather than
    // for want of a rule.
    save: (e) => { void e },
  },
  data() {
    return { count: 0, onlyInBaseState: 1 }
  },
  watch: {
    shared() {},
  },
}

const lifecycleMixin = {
  // A lifecycle hook is a SHORTHAND METHOD of the options object, not a `pair`
  // key — which is exactly why the first version read them and got them wrong.
  // `mergeAsArray` concatenates and `injectHook` pushes, so BOTH hooks run and
  // the component's `mounted` is not an override of the base's.
  mounted() {},
  beforeDestroy() {},
}

const unrelatedMixin = {
  methods: {
    nothingInCommon() { return 0 },
  },
}

export default {
  name: 'MixinOverrides',

  mixins: [localMixin, lifecycleMixin, unrelatedMixin],

  extends: BasePanel,

  emits: {
    save: (e) => { void e },
  },

  methods: {
    shared() { return 1 },
  },

  data() {
    return { count: 1 }
  },

  watch: {
    shared() {},
  },

  mounted() {},

  beforeDestroy() {},
}
</script>

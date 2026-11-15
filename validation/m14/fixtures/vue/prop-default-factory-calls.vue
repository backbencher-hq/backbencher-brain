<script>
// M49 W2 (#769) regression fixture — the CORPUS shape, not an adjacent one.
// Corpus: vue-element-admin/src/components/MarkdownEditor/index.vue.
//
// #762 pinned this contract with a SINGLE factory — a shape whose assertions
// pass whether or not the collision exists, so the gate went green while the
// corpus stayed broken. The real shape needs TWO `default()` factories in
// sibling prop objects plus plain `default:` data members: pre-fix the shared
// `module:default` dedup slot made the LAST factory win and dead-spanned the
// earlier one, so the `id` factory's random/toFixed calls were never emitted
// (lane-visible: truth derived them, the analyzer did not).
export default {
  props: {
    value: { type: String, default: '' },
    id: {
      type: String,
      required: false,
      default() { return 'markdown-editor-' + ((Math.random() * 1000).toFixed(0) + ''); }
    },
    options: { type: Object, default() { return { a: propHelper() }; } },
    mode: { type: String, default: 'markdown' },
    height: { type: String, default: '300px' }
  },
  methods: {
    ping() { return helper(this.id); }
  }
}
</script>

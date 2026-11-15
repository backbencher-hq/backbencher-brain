<script>
export default {
  props: {
    id: {
      type: String,
      default() { return 'markdown-editor-' + ((Math.random() * 1000).toFixed(0) + ''); }
    },
    plain: { type: Boolean, default: false }
  },
  methods: {
    ping() { return helper(this.id); }
  }
}
</script>

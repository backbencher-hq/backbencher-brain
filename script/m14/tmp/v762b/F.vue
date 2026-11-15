<script>
export default {
  props: {
    value: { type: String, default: '' },
    id: {
      type: String,
      required: false,
      default() {
        return 'markdown-editor-' + +new Date() + ((Math.random() * 1000).toFixed(0) + '')
      }
    },
    options: { type: Object, default() { return {} } },
    mode: { type: String, default: 'markdown' },
    height: { type: String, default: '300px' }
  }
}
</script>

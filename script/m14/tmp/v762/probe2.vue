<script>
export default {
  props: {
    id: {
      type: String,
      default() { return 'markdown-editor-' + +new Date() + ((Math.random() * 1000).toFixed(0) + ''); }
    }
  }
}
</script>

<script>
export default {
  props: {
    id: {
      type: String,
      default() {
        return 'slug-' + +new Date() + ((Math.random() * 1000).toFixed(0) + '')
      }
    }
  }
}
</script>

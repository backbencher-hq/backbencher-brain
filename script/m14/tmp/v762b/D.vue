<script>
export default {
  props: {
    value: { type: String, default: '' },
    id: {
      type: String,
      default() { return 'slug-' + ((Math.random() * 1000).toFixed(0) + '') }
    }
  }
}
</script>

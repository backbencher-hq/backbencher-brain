<script>
export default {
  props: {
    isEdit: { type: Boolean, default: false },
    id: {
      type: String,
      required: false,
      default() { return 'slug-' + ((Math.random() * 1000).toFixed(0) + '') }
    },
    options: {
      type: Object,
      default() { return { a: helper() } }
    }
  }
}
</script>

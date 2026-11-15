<script>
let count = $state(0)
let doubled = $derived.by(() => count * 2)
$effect.root(() => {})
</script>

<span>{doubled}</span>

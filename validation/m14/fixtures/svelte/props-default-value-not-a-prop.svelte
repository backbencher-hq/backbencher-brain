<script lang="ts">
	// A DEFAULT VALUE in a `$props()` destructure is not a binding. Corpus shape:
	// shadcn-svelte's `docs/src/lib/registry/ui/chart/chart-container.svelte`
	// opens with `const uid = $props.id()` and then destructures
	// `let { ref = $bindable(null), id = uid, … } = $props()`. `objectPatternPairs`
	// used to walk `object_assignment_pattern` as a CONTAINER and take both
	// children, so the module-level `uid` was published as a component Property
	// (`isSvelteProp: true`, ownerName = the component, a `contains` edge), and
	// because the same name list drives the merge dedupe the delegate's correct
	// `uid` Constant was dropped from the graph.
	const uid = $props.id()
	let {
		id = uid,
		label = "x",
		size = 3,
		renamed: local = 1,
	} = $props()
</script>

<span>{id}{label}{size}{local}{uid}</span>
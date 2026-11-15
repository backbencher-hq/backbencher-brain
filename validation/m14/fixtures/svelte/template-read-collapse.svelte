<script lang="ts">
	let count = $state(0);
	let label = 'x';

	function inc() {
		count++;
	}
</script>

<p>{count}</p>
<span>{label}</span>
<span>{count}</span>
<div>{count + 1}</div>
<button onclick={inc}>+1</button>
<p>{label}</p>
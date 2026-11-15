<script>
	import Widget from './Widget.svelte';
	export let logs = [];

	function realHandler() {
		logs.push('real');
	}

	let box = { open: () => {} };
</script>

<!-- The two corpus shapes that produced `calls -> null` and `calls -> undefined`:
     svelte/packages/svelte/tests/runtime-legacy/samples/component-events-nullish/main.svelte
     writes `on:click={null}`, and
     svelte/packages/svelte/tests/runtime-runes/samples/undefined-event-handler/main.svelte
     writes `onmouseenter={undefined}`. -->
<Widget on:click={null} {logs} />
<button onmouseenter={undefined}></button>

<!-- The same literals through the other two spellings the analyzer accepts, so the
     filter is pinned on all of them and not only on the corpus shape that exposed it. -->
<button onclick={null}></button>
<div on:click={null}></div>
<div use:null></div>
<div use:action={null}></div>
<div on:click={box.null}></div>
<div on:click={null.open}></div>
<div on:click={true}></div>
<div on:click={NaN}></div>
<div on:click={Infinity}></div>
<div on:click={this}></div>

<!-- And the controls: a handler that IS a name still emits, including one that happens
     to be spelled like a literal in no way, and a dotted leaf whose LEAF is a literal
     does not, while a dotted leaf with a real leaf does. -->
<button on:click={realHandler}>a</button>
<button on:click={() => realHandler()}>b</button>
<button on:click={box.open}>c</button>
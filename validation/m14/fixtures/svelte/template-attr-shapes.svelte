<script>
import Comp from "./comp";
import DynComp from "./dyn";
let value = 1;
let props = {};
function currentView() { return null; }
</script>

<Comp {value} {...props} />
<svelte:component this={DynComp} />
<svelte:component this={currentView} />

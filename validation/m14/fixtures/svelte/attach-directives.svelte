<script>
  import { myAttachment } from "./attach.js"
  const arrow = () => {}
  function makeAttach(arg: string) {
    return () => {}
  }
</script>

<div {@attach myAttachment}>a</div>
<div {@attach (node) => {}}></div>
<div {@attach arrow}></div>
<div {@attach makeAttach("x")}></div>
<Child {@attach myAttachment} />

<template>
  <!-- (a) a NAMESPACED builtin is not a component: the vue grammar's `tag_name`
       node spells `svg:circle`, the filter only knew `HTML_BUILTIN_TAGS` and
       `VUE_BUILTIN_TAGS`, and neither set contains a colon, so every namespaced
       tag became an `instantiates` to a name no registry holds. -->
  <svg:circle cx="1" />
  <math:mi>x</math:mi>

  <!-- (b) a DOTTED tag loses its leaf: `<Form.Input />` in Vue resolves the
       sub-component `Input` OF `Form`. The tag_name node spells only `Form`, so
       the usage was recorded against the root and the leaf vanished — the graph
       said "instantiates all of Form" for a template that uses one button of it.
       The fix keeps `Form` as the RESOLVABLE target (that is the name the
       components registry holds) and records the leaf in metadata, rather than
       inventing an unresolvable `Form.Input` target. -->
  <Form.Input />
  <Ui.Table />
  <el-button />
</template>

<script>
import Form from './Form.vue'
import Ui from './Ui.vue'
export default { name: 'TagNamespaced', components: { Form, Ui } }
</script>

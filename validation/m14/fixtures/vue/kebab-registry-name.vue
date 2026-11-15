<template>
  <!-- F31 (2026-10-12): Vue resolves a component by its REGISTERED name, and the
       template may write it three ways — `resolveAsset` tries the written tag,
       then `camelize`, then `capitalize(camelize)`. So all of these are one
       component each, and the registry name is the one a graph must match. -->

  <!-- kebab -> Pascal -->
  <el-button />
  <el-form-item />
  <svg-icon />

  <!-- camel -> Pascal (rule-completeness; every camel-shaped tag on the draw is an
       SVG native filtered as markup, so this branch has no live corpus instance) -->
  <cardWidget />

  <!-- THE ONE DEVIATION, and the corpus forces it: a single all-lowercase word
       stays AS WRITTEN. Vue tries the written spelling FIRST, and capitalizing one
       word is measured to GAIN 8 edges and LOSE 20 over the 53 such edges on the
       draw, because `<loading/>`, `<message/>`, `<calendar/>` name the components
       whose FILES are `loading.vue`, `message.vue`, `calendar.vue`. -->
  <loading />
  <message />

  <!-- already the registry name: no normalization, no metadata -->
  <MyLibWidget />

  <!-- a DOTTED kebab tag: the root is normalized (el-form -> ElForm) and the leaf
       stays in metadata, exactly as `<Form.Input/>` does -->
  <el-form.Item />

  <!-- THREE spellings of ONE component, in one template. One component is one
       `instantiates` edge; what the edge records is the set of spellings that
       reached it (metadata.tagSpellingsWritten). -->
  <el-button></el-button>
  <ElButton />
  <elButton />

  <!-- a component from a DEPENDENCY (vue-router): the registry name is derived the
       same way and is still a target the admitted corpus does not declare. The
       normalization makes the NAME right; it does not invent a declaration. -->
  <router-link to="/home" />

  <!-- native markup: filtered by the builtin set BEFORE any of the above -->
  <div />
  <linearGradient />
</template>

<script>
import Form from './Form.vue'
import cardWidget from './CardWidget.vue'
export default { name: 'KebabRegistry', components: { Form, cardWidget } }
</script>

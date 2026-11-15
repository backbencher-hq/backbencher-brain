<!-- fixture: vue/decorator-metadata-868
     M49 (#868). The SFC SEAM half of the javascript decorator contract. A
     decorated class inside a script block is analyzed by the JS delegate, so
     every row it produces is SCRIPT-relative and the container must shift it to
     file lines. `line_number` was shifted; the metadata LINE MIRRORS were not —
     measured here, `references Service -> sealed` said line_number=6 (the line
     `@sealed` is written on) while its own metadata said decoratorLine=5, i.e.
     the payload contradicted itself and the file, with `sfcLineOffset: 1`
     recorded on the very row that disagreed. The template above the script is
     what makes the offset non-zero: with the script on line 1 the two agree by
     accident, which is how this survived the #861 round. -->
<template>
  <div>{{ label }}</div>
</template>
<script>
function sealed(target) {
  return target
}

function inject(name) {
  return () => undefined
}

@sealed
class Service {
  @inject("db")
  pool = 1

  @sealed
  method() {}
}

export default {
  name: "Wrapper",
  components: { Service },
  data() {
    return { label: "x" }
  },
}
</script>

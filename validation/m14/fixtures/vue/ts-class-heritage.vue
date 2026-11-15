<script lang="ts">
// ONTOLOGY (VERIFY_VUE8): `implements` and the class `extends` clause ARE
// expressible inside a Vue SFC, and the seam dispatches them. This fixture is
// what makes that a measured statement instead of a ruling.
//
// The RULING for `implements` on this lane's corpus is a corpus fact, not a
// language fact. Instrument A (a grammar inventory over every script block of
// 1,151 admitted `.vue` files — element-plus 1009, vue-element-admin 131, vuejs
// 11 — through the production wasm) counted 174 distinct script node types and
// found `implements_clause` 0, `class_declaration` 0, `extends_clause` 0,
// `interface_declaration` 0. So no corpus file can produce the row, and a
// verdict of "the language cannot say it" would be a false reason for a true
// observation.
//
// This fixture is the other half: the construct is expressible, and production
// `ASTEngine.parseFile` emits the row when a file uses it. A `lang="ts"` block is
// dispatched to the TypeScript analyzer (engine.ts:1587-1619 builds the seam;
// real-vue-analyzer.ts's `isTs` reads the block's own `lang`), and the TS
// analyzer owns both labels. So the correct verdict is RULED FOR THE CORPUS with
// this as the falsifier — a probe that finds a class in a Vue script block
// overturns the ruling immediately.
//
// `ProbeCard extends Base implements Store` is also the shape that produces an
// `overrides` row through the DELEGATE (`ProbeCard.open -> Base.open`), which is
// a different producer from this lane's Options-API merge branch and is pinned
// here so the two are never confused.
import { Component, Vue } from 'vue-property-decorator'

interface Store { readonly size: number }
abstract class Base { abstract open(): void }

@Component({ name: 'ProbeCard' })
export default class ProbeCard extends Base implements Store {
  readonly size = 1
  label = 'hi'

  constructor(private dep: LoggerMixin) { super() }

  open(): void { this.dep.log(this.label) }

  get upper(): string { return this.label.toUpperCase() }
}
</script>

<template>
  <div>{{ label }}</div>
</template>

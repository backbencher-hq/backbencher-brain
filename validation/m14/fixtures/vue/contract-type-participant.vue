<script lang="ts">
import type { NodeShape } from './types'
import type { CommonProps } from './common'

// F14: what counts as a CONTRACT PARTICIPANT in `defineProps<…>()`. The rule was
// "walk to the first `type_identifier` ANYWHERE in the type arguments", which
// descends into the object literal's property signatures — and a property's type
// is not a participant. Two corpus files disagreed with that, at the 829-file
// draw, in OPPOSITE directions, which is what made it obvious:
//
//   node.vue  defineProps<{ node: NodeShape; menuId?: string }>()
//     -> no participant. The props are component symbols and `NodeShape` is the
//        TYPE OF ONE PROP, already published by the delegate as a declared_type
//        row. The oracle derived a contract row for it: a MISSING.
//
//   menu.vue  defineProps<{ … } & Pick<CommonProps, 'height'> & { other: N }>()
//     -> the participant is `Pick`. The analyzer took `NodeShape` (nested, wrong)
//        and the oracle took `Pick` (right), so they each manufactured a
//        disagreement on the same line: one unexplained and one MISSING.
//
// So: descend through INTERSECTION and UNION constituents and through wrappers,
// read a GENERIC's own name, and STOP at an object literal — its members are the
// props, and their types belong to the props, not to the contract.
const intersect = defineProps<{ nodes: NodeShape[]; index: number } & Pick<CommonProps, 'height'>>()
const plainLiteral = defineProps<{ node: NodeShape; menuId?: string }>()
const wrapped = defineProps<Pick<CommonProps, 'height'>>()
const unioned = defineProps<Pick<CommonProps, 'a'> | Pick<CommonProps, 'b'>>()
const namedControl = defineProps<CommonProps>()

export default { name: 'ContractTypeParticipant' }
</script>

<template><div /></template>

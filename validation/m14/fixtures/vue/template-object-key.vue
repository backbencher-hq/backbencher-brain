<script>
export default {
  name: 'W',
  // `count` and `label` are REAL members here. That is the whole point: the
  // pre-fix tokenizer emitted the identifier unconditionally, so a member with
  // that name existing is exactly what turned an object KEY into a Uses edge —
  // measured at 432 of 1,150 corpus files. An earlier version of this fixture
  // deliberately declared NO count/label, which made it incapable of failing:
  // the mutant that restores the defect SURVIVED it, because with no such member
  // there was nothing to emit before the fix or after.
  data: () => ({ count: 0, label: 'x', total: 1, other: 2 }),
  methods: { go(v) { return v }, render(k) { return k } },
}
</script>

<template>
  <div>
    <!-- count and label appear ONLY as object keys in this template. -->
    <p>{{ { count: 1 } }}</p>
    <p>{{ { count: total } }}</p>
    <p>{{ { a: { count: 1 } } }}</p>
    <p>{{ go({ count: 1 }) }}</p>
    <p>{{ render({ label: 1 }) }}</p>
    <!-- the quoted form, which was already correct, as a control -->
    <p>{{ { 'count': other } }}</p>
  </div>
</template>

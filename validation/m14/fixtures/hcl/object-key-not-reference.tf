# H8: an object key is DATA, not a reference. The exclusion is read through the
# grammar's own `key` FIELD. The pre-fix code paired a NAMED-child index with
# `fieldNameForChild`, which indexes over ALL children — correct by luck, because
# every `object_elem` is `[key, "=", val]` and only indices 0 and 1 were probed.
locals {
  plain    = { alpha = var.a, beta = var.b }
  quoted   = { "my key" = var.c }
  paren    = { (var.d) = var.e }
  nested   = { outer = { inner_key = var.f } }
  computed = { (format("%s", var.g)) = var.h }
  listy    = [{ list_key = var.i }]
}

// #841: the assert MESSAGE separator is `:` OR `,`. Verified against a real
// Groovy 3.0.24 toolchain (script/m14/tmp/assert-comma-validity.groovy) — both
// forms parse and run, and the comma form raises `AssertionError: <message>`.
// Before the grammar accepted the comma form, a file containing one did not
// merely lose the statement: recovery swallowed the ENCLOSING CLASS, so the
// census reported the first error on the `class` line and every member of the
// file went unextracted. Measured on grails-core: 34 of the 322 residual files
// carried the form, and 22 of them parse clean at the rebuilt wasm (0 regressed).
class AssertComma {
    def check(def items, def limit) {
        assert items, 'items must not be empty'
        assert items.size() <= limit, 'too many items: use "limit" to raise the cap'
        assert items.isEmpty() : 'the colon form still parses'
        return items
    }
}

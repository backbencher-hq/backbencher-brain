# SQL — remedy R2 inherits review

Reviewed 2026-11-22 against the whole admitted SQL population
(**1,964 parsed / 1,964 admitted**; `sql-ruling-census.json`).

`CREATE TABLE ... INHERITS` and the table-inheritance clause were re-examined as
a possible source for `extends`. The measured construct is **column/table
inheritance**: the child relation takes columns from a parent table. It is not a
type declaring a supertype, and the served grammar exposes no interface,
superclass or conformance node for it. Relabelling it `extends` would assert a
type relation the language does not declare, and `bb_impact` would then report
that editing a parent table changes the child's type conformance.

Remedy R2 (patch the grammar to invent a conformance production) was **refused**:
the language has no such production, and an invented one would make the analyzer
disagree with the language. The inheritance clause remains a measured near miss;
`extends` stays ruled as the table-level relation it actually is.

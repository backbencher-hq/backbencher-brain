# SQL — grammar-047 refusal review

Reviewed 2026-11-22 against the whole admitted SQL population
(**1,964 parsed / 1,964 admitted**, 20 repositories, 0 parse failures;
`validation/m14/measurements/sql-ruling-census.json`).

The five candidates raised for grammar-047 were each measured as a **near miss**,
not as the ontology relation:

| candidate | sites | files | why refused |
|---|---:|---:|---|
| `CREATE TABLE ... PARTITION OF` as `part_of` | 50 | 29 | a table-level storage division, not a part **file** sharing a unit's scope |
| `CREATE VIEW` as `renders` | 755 | 141 | the target is a query, not a rendered component |
| `COMMENT ON` as `decorates` | 1,398 | 343 | text attached after the fact; it names no applied decorator |
| routine body as `mixes_in` | 2,349 | 297 | no supertype chain and no mixin composition |
| `RETURNS TABLE` as `exports` | 2,511 | 297 | a result over a call, not a named module export |
| domain/base type as `implements` | 23 | 6 | a value restriction, not a conformance declaration |

The served build carries no export/interface/super node type for these shapes.
The ruling stays `exclusion`; the counts above are the refusal's evidence.

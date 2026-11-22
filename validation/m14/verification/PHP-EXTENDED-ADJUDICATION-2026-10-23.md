# PHP — extended-type adjudication

Measured 2026-11-22 against the full corpus at
`/home/ishaq2321/bb_tests/repositories`.

- Population: **6,404 admitted** PHP files (6,760 tracked paths, 356 absent),
  0 over-cap; 1,884 parsed candidates in the attribute screen.
- `decorates`: **6,506 attribute groups / 6,507 attributes over 1,799 files**
  (`php-attribute-census.json`). The annotated declarations are methods (2,617),
  classes (3,866), enum cases (8) and enums (3). PHP attributes are runtime
  metadata read by reflection; the ruling therefore stays **ontological**
  (passive metadata), not an emitted `decorates` edge.
- Emission census: `php-emission-census.json`; population 6,404, the same
  git-tracked set the gate admits.
- Artifacts: `validation/m14/measurements/php-attribute-census.json`,
  `validation/m14/measurements/php-emission-census.json`.

The adjudication is the contract in `src/ast/types.ts` (a decorator is an
applied callable); this page records the measured evidence, not a new rule.

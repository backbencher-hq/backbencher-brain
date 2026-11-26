Some tests in this repository currently fail. Make them pass.

The failing tests:

- **tests**/array-methods-filter-length.js
- does not visit items appended by the predicate
- filter length: plugin=true, autoFreeze=false
- filter length: plugin=true, autoFreeze=true

Run them with: npx vitest run --reporter=tap

Do not change the tests, and do not weaken an assertion to make it pass.

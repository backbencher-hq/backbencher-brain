Some tests in this repository currently fail. Make them pass.

The failing tests:

- **tests**/base.js
- array drafts
- mutating array methods
- patches for elements moved by shifting or reordering
- unshift, write to an element moved past the base length
- unshift, write to a nested object of an element moved past the base length
- unshift of two items, write to the last element
- splice insert, write to an element moved past the base length
- base functionality - array-plugin=true:auto-freeze=true:shallow-copy=false:use-listener=false

Run them with: npx vitest run --reporter=tap

Do not change the tests, and do not weaken an assertion to make it pass.

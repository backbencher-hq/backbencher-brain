Some tests in this repository currently fail. Make them pass.

The failing tests:

- **tests**/base.js
- base functionality - auto-freeze=true:shallow-copy=true:use-listener=true
- map drafts
- visits added entries and skips deleted entries during forEach
- keeps keys iterators live across mutations
- keeps values iterators live across mutations
- keeps entries iterators live across mutations
- keeps Symbol(Symbol.iterator) iterators live across mutations
- base functionality - auto-freeze=true:shallow-copy=true:use-listener=false
- base functionality - auto-freeze=true:shallow-copy=false:use-listener=true
- base functionality - auto-freeze=true:shallow-copy=false:use-listener=false
- base functionality - auto-freeze=false:shallow-copy=true:use-listener=true
- base functionality - auto-freeze=false:shallow-copy=true:use-listener=false
- base functionality - auto-freeze=false:shallow-copy=false:use-listener=true
- base functionality - auto-freeze=false:shallow-copy=false:use-listener=false
- base functionality - array-plugin=true:auto-freeze=true:shallow-copy=false:use-listener=false

Run them with: npx vitest run --reporter=tap

Do not change the tests, and do not weaken an assertion to make it pass.

Some tests in this repository currently fail. Make them pass.

The failing tests:

- **tests**/patch.js
- produces the correct patches
- patches are replayable
- assigning a base value back over a modified draft
- object
- nested drafts
- array
- map

Run them with: npx vitest run --reporter=tap

Do not change the tests, and do not weaken an assertion to make it pass.

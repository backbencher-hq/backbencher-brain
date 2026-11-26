Some tests in this repository currently fail. Make them pass.

The failing tests:

- **tests**/not-strict-copy.ts
- honors the constructor class_only shallow copy mode

Run them with: npx vitest run --reporter=tap

Do not change the tests, and do not weaken an assertion to make it pass.

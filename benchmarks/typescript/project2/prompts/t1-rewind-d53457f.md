Some tests in this repository currently fail. Make them pass.

The failing tests:

- **tests**/current.js
- current Set snapshots - autoFreeze=true
- snapshots modified objects in insertion order without leaking drafts
- snapshots object Sets nested in a parent
- keeps membership snapshots independent of later additions and deletions
- snapshots arrays stored as Set values
- keeps unchanged frozen objects exactly once when adding a primitive
- current Set snapshots - autoFreeze=false

Run them with: npx vitest run --reporter=tap

Do not change the tests, and do not weaken an assertion to make it pass.

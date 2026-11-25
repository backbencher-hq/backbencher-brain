Some tests in this repository currently fail. Make them pass.

The failing tests:
  - timeout up to the maximum timer delay is accepted, and a larger one is rejected instead of timing out at once
  - setting an invalid `timeout` on the queue throws and keeps the previous value

Run them with:  node --import=tsx/esm --test --test-timeout=60000 test/*.ts

Do not change the tests, and do not weaken an assertion to make it pass.

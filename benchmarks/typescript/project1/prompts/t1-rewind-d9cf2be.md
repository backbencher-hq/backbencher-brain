Some tests in this repository currently fail. Make them pass.

The failing tests:

- .onSizeLessThan() resolves when start() drains the queue
- .onSizeLessThan() resolves when concurrency is raised at runtime
- .onSizeLessThan() resolves when a rate-limit interval tick drains the queue
- .onSizeLessThan() resolves multiple waiters with different limits on a single drain

Run them with: node --import=tsx/esm --test test/\*.ts

Do not change the tests, and do not weaken an assertion to make it pass.

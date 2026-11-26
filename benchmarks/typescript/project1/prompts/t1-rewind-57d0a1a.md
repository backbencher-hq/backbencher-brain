Some tests in this repository currently fail. Make them pass.

The failing tests:

- runningTasks includes timeoutRemaining for tasks with timeout
- runningTasks timeoutRemaining decreases over time

Run them with: node --import=tsx/esm --test test/\*.ts

Do not change the tests, and do not weaken an assertion to make it pass.

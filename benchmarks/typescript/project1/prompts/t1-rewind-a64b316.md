Some tests in this repository currently fail. Make them pass.

The failing tests:

- should reject when signal is aborted while task is waiting in queue
- should reject immediately when signal is already aborted and task is queued
- abort with custom reason forwards the reason
- abort works on a paused queue without unpausing
- aborting multiple queued tasks with same AbortController
- aborting a queued task with explicit id removes the correct task
- aborting a queued task with duplicate id removes the correct task
- abort listener for queued task is cleaned up when the task starts running
- aborting a queued task emits correct events
- onError does not reject when a queued task is aborted
- clear() removes queued abort listeners
- clear() removes queued abort listeners for shared signals
- clear() lets the same signal be reused without stale queued listeners
- clear() keeps the running task abort listener while removing queued ones
- clear() only leaves the running task affected when a shared signal aborts later
- clear() does not accumulate abort listeners across repeated discard cycles
- should pass AbortSignal instance to job
- aborted jobs do not use interval cap
- aborting multiple jobs at the same time
- abort listener is removed when job is completed
- pending promises counted fast enough
- pending promises with abortions counted fast enough
- intervalCap
- consumed interval is remembered between idle states
- consumed interval is updated on time, even between idle states
- .setPriority() - execute a promise before planned
- interval should be maintained when using await between adds (issue #182)
- interval maintained when queue becomes empty multiple times
- interval reset after long idle period
- interval with carryoverIntervalCount after queue empty
- .setPriority() - execute a promise after planned
- .setPriority() - execute a promise before planned - concurrency 2
- .setPriority() - execute a promise before planned - concurrency 3
- .setPriority() - execute a multiple promise before planned, with variable priority
- .setPriority() - execute a promise before planned - concurrency 3 and unspecified `id`
- process exits cleanly after interval tasks complete
- intervalCap should be respected with high concurrency (issue #126)
- isRateLimited property
- rate-limit event emission
- onRateLimit() promise helper
- onRateLimitCleared() promise helper
- rate-limit works with pause/start
- rate-limit with high concurrency
- rate-limit with queue.clear() while rate-limited
- rate-limit events fire only once per transition
- rate-limit with interval boundary conditions
- should not cause stack overflow with many aborted tasks
- rate-limit with carryoverIntervalCount behavior
- rate-limit with aborted tasks
- rate-limit with error-throwing tasks
- rate-limit state remains stable within intervals
- rate-limit microtask batching - multiple events in same tick
- rate-limit clear() racing with scheduled update
- rate-limit with dynamic concurrency changes
- rate-limit with setPriority() while rate-limited
- rate-limit multiple concurrent onRateLimit() calls
- rate-limit when all queued tasks are aborted
- strict mode multiple complete intervals

Run them with: node --import=tsx/esm --test test/\*.ts

Do not change the tests, and do not weaken an assertion to make it pass.

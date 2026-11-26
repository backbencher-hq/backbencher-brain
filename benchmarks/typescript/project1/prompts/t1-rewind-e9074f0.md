Some tests in this repository currently fail. Make them pass.

The failing tests:

- abort listener is removed when job is completed

Run them with: node --import=tsx/esm --test test/\*.ts

Do not change the tests, and do not weaken an assertion to make it pass.

Some tests in this repository currently fail. Make them pass.

The failing tests:

- timeout validation in add

Run them with: node --import=tsx/esm --test test/\*.ts

Do not change the tests, and do not weaken an assertion to make it pass.

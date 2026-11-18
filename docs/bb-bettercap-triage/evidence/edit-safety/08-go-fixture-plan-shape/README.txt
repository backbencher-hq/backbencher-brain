Fixture: minimal two-package Go module replaying the plan SHAPE that bb_edit produced for
bettercap LoadModules (plan touched declaration + same-package test call, left the
package-qualified caller). Files here are POST-rename (the state the plan would commit).

Baseline (pristine fixture): `go build ./...` => BASELINE BUILD OK
After plan-shaped rename:    `go build ./...` =>
  # example.com/refactor-demo
  ./main.go:13:10: undefined: modules.LoadModules
Transformation applied by hand (same sites bb's plan named):
  modules/modules.go:        func LoadModules(  -> func LoadModulesRenamed(
  modules/modules_test.go:   LoadModules(nil)   -> LoadModulesRenamed(nil)
  main.go:                   modules.LoadModules(sess)  UNTOUCHED  (= missed caller)
Full build output: ../06-fixture-build-error.txt
Note: this fixture could not be indexed by bb in this session (fresh-index creation is
blocked in the sandbox); it isolates the compiler consequence of the measured plan shape.

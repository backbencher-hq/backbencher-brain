package modules

import "testing"

func TestLoadModulesWithNilSession(t *testing.T) {
	LoadModulesRenamed(nil)
}

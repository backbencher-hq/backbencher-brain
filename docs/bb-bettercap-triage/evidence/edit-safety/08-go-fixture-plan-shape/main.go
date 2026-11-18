package main

import (
	"fmt"

	"example.com/refactor-demo/modules"
	"example.com/refactor-demo/session"
)

func main() {
	sess := &session.Session{}
	// Load all modules
	modules.LoadModules(sess)
	fmt.Println("started")
}

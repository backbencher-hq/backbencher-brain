package main

import "fmt"

type Greeter struct {
	prefix string
}

func NewGreeter(prefix string) *Greeter {
	return &Greeter{prefix: prefix}
}

func (g *Greeter) Greet(name string) string {
	return fmt.Sprintf("%s, %s!", g.prefix, name)
}

func main() {
	g := NewGreeter("hello")
	fmt.Println(g.Greet("world"))
}

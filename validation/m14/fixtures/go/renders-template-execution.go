// go/renders-template-execution — THE RENDER HOST IS THE TEMPLATE EXECUTION, AND THE
// RENDERED COMPONENT MUST BE A PUBLISHED SYMBOL.
//
// `renders` (extended vocabulary, contract: source = the rendering symbol, target = the
// rendered component) has one honest construct in Go: a symbol whose body EXECUTES an
// html/template, where the template is a PUBLISHED symbol. The template is the component;
// the executing symbol is the renderer. The `calls` row for the Execute invocation is a
// different and also-true fact, so this fixture forbids nothing about `calls`.
//
// THE FIRES:
//   Handler -> pageTemplate          `pageTemplate.Execute(w, nil)` — a package-level
//                                    template var constructed by template.Must/New.
//   Handler -> indexTemplate         `indexTemplate.ExecuteTemplate(w, "index", nil)` —
//                                    a template SET; the sub-template's own name rides in
//                                    metadata.templateName, never as the edge target.
//
// THE FORBIDS, each one a MEASURED impostor class:
//   constructedOnly                  a template that is never executed — construction is
//                                    not a render.
//   localRender -> local template    a local var is not a published symbol
//                                    (LocalsAreNotSymbols).
//   paramsOnly                       a template PARAMETER is not a published symbol.
//   valueReceiver                    an expression receiver (the call result) is not one.
//   textOnlyPage                     `text/template` is the impostor class this lane
//                                    measured (151 corpus files, almost all code
//                                    generators); the file aliases it as a second import
//                                    and the constructor qualifier is resolved against the
//                                    html/template import's OWN local name, so it cannot
//                                    be smuggled in.
//   cmdRunner                        a package-level value whose Execute method is not a
//                                    template execution.
//   Handler -> Execute / -> index    the METHOD name and the sub-template NAME are not the
//                                    rendered component; the template SYMBOL is.
//   the wrapped-selector LINE        `pageTemplate.` is on one line and `Execute(...)` on
//                                    the next; the row's line is the OPERAND's line (the
//                                    name-bearing node), so the Execute line is forbidden.
package renderstemplate

import (
	"html/template"
	"io"
	"net/http"
	texttmpl "text/template"
)

// pageTemplate is the published component Handler renders.
var pageTemplate = template.Must(template.New("page").Parse(`<html><body>{{.Title}}</body></html>`))

// indexTemplate is a template SET: ExecuteTemplate names the sub-template to render.
var (
	indexTemplate = template.Must(template.New("index").ParseFiles("templates/index.gohtml"))
)

// textOnlyPage is constructed by TEXT/template through an aliased import — the measured
// impostor class (code generation, not an HTML render host).
var textOnlyPage = texttmpl.Must(texttmpl.New("gen").Parse("package main\n"))

// constructedOnly is a real html/template that is NEVER executed: construction is not a
// render, so no row may name it.
var constructedOnly = template.Must(template.New("unused").Parse("n"))

// runner's Execute is not a template execution.
type runner struct{}

func (runner) Execute() error { return nil }

var cmdRunner = runner{}

// Handler renders pageTemplate; the WRAPPED selector pins the line convention — the row's
// line is the template symbol's line, not the Execute token's line.
func Handler(w http.ResponseWriter, r *http.Request) {
	pageTemplate.
		Execute(w, nil)
	_ = indexTemplate.ExecuteTemplate(w, "index", nil)
	_ = cmdRunner.Execute()
}

// localRender executes a LOCAL template: not a published symbol, so no row.
func localRender(w io.Writer) {
	tpl := template.Must(template.New("local").Parse("x"))
	_ = tpl.Execute(w, nil)
}

// paramsOnly executes a template passed to it: a parameter is not a published symbol.
func paramsOnly(w io.Writer, t *template.Template) {
	_ = t.Execute(w, nil)
}

// valueReceiver executes an expression receiver: not a published symbol.
func valueReceiver(w io.Writer) {
	_ = template.Must(template.New("expr").Parse("x")).Execute(w, nil)
}

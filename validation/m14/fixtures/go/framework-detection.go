// PINS framework detection (M37 #604, RSD7 lesson: rust wave-6 found
// detectedFrameworks was differential-invisible — deriveGoEdges derives no
// framework truth — so it MUST be fixture-gated). Go detects frameworks from
// canonical import paths only (deterministic, no string-matching on code):
// gin, echo, fiber, net/http, gorilla/mux, grpc, testify. The fixture imports
// four of them and asserts the exact detected set (no false positives from
// the plain net/http-free stdlib imports).
package main

import (
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/mux"
	"google.golang.org/grpc"
)

func newRouter() *mux.Router {
	return mux.NewRouter()
}

func newGin() *gin.Engine {
	return gin.New()
}

func newServer(reg *grpc.Server) *http.Server {
	return &http.Server{Addr: ":8080"}
}

func main() {
	fmt.Println(newRouter(), newGin(), newServer(nil))
}

// validation/m12/fixtures/cpp/Negative.cpp
// M12.17 C++ negative fixture: include guards are NOT symbols; function-local
// variables are NOT symbols; nullptr/NULL/0 literals produce no edges; a
// forward-declared class creates NO symbol; a plain value identifier inside a
// function (file-scope static usage) produces NO edge (no identifier walk);
// template parameters are not symbols.
#ifndef NEGATIVE_CPP_H
#define NEGATIVE_CPP_H

#include <cstddef>
#include <string>

class ForwardOnly;   // forward declaration — NO symbol (no body)

namespace internal {

static int counter = 0;   // file-scope static — variable symbol

double compute(double input) {
  double local = input * 2.0;   // function-local — NO symbol
  if (local == 0.0) return 0.0; // 0.0 literal — no use edges
  counter++;                    // file-scope static usage — no identifier-walk edge
  return local;
}

} // namespace internal

#endif // NEGATIVE_CPP_H

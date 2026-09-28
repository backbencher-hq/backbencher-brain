# Systems-Language Fixture Limitations (C, C++, Rust, Objective-C, Zig)

This fixture validates declaration extraction for C, C++, Rust, Objective-C, and
Zig through the shared indexing pipeline. The symbol truth is manually audited
from the fixture source and stored in `validation/m11/ground-truth/systems-symbols.json`.

The fixture exercises headers/modules, declarations and definitions, namespaces,
templates/generics, structs/classes/traits/protocols, unions, impl blocks,
enums, macros and preprocessor guards, function pointers/closures, struct/class
fields, ObjC categories/protocols/properties, and out-of-line method
definitions. All 5 languages resolve at 1.000 precision / 1.000 recall against
ground truth (`validation/m11/probe-systems.ts`).

Dynamic dispatch, template instantiation, macro expansion results, and
compiler-generated symbols are outside source-AST truth. Preprocessor
configuration (conditional compilation) is treated as uncertainty rather than
declaration misses, matching the M11.10 acceptance criteria ("explicit
macro/configuration uncertainty").

## Language detection for ambiguous headers

`.h` files are content-sniffed: C++ (classes/namespaces/templates), C
(plain structs/enums/typedefs), and Objective-C (`@interface`/`@implementation`
/`@protocol`) are distinguished by content so headers land on the correct
analyzer. This is the first milestone where ambiguous header detection is
validated end-to-end (Service.h → cpp, CoreApi.h → c, Logger.h → objective-c).

## Real-corpus observations (systems-corpus-observed.json)

| Repo | Language(s) | Files | Symbols | Relationships | Wall | Peak RSS | Errors |
|---|---|---|---|---|---|---|---|
| cargo | Rust | 1,328 | 16,088 | 91,741 | 38.6s | 203 MB | 0 |
| zig | Zig | 2,950 | 164,506 | 102,494 | 211s | 287 MB | 0 (1 transient timeout, recovered) |
| swift-nio | C | 21 | 753 | 901 | 4.7s | 260 MB | 0 |
| dplyr | C++ | 14 | 212 | 648 | 1.2s | 77 MB | 0 |
| cython | C | 95 | 3,191 | 3,387 | 9.1s | 216 MB | 0 |
| clyde | Objective-C | 7 | 100 | 244 | 0.8s | 72 MB | 0 |

- **cargo (1,328 Rust files)** and **zig (2,950 Zig files)** are the
  large-repository evidence for Rust and Zig extraction: 17.7–34.4 files/sec,
  ~180K total symbols, 0 persistent errors.
- **C** is measured on two real corpora (swift-nio + cython) and **C++** on
  dplyr; **Objective-C** is measured on clyde (7 real .m/.h files — the only
  clean, eligible ObjC corpus available; flutter's ObjC files are in an
  ineligible dirty repo).
- All files indexed in every repo; the single zig timeout was a worker-side
  45s self-timeout under heavy parallel load and was recovered via the retry
  path (all 2,950 files indexed; standalone parse of the same corpus is clean).

## Coverage gaps

- **Objective-C corpus breadth**: only one small clean repo (clyde, 135 tracked
  files). The fixture covers categories, protocols, properties, and ivars, but
  a larger real ObjC corpus is planned once a clean repo with more `.m`/`.mm`
  files is available.
- **C++ headers in mixed repos**: `.h` files in dplyr resolve to C++ via
  content sniffing; template-heavy real-world C++ (e.g. STL-style headers) is
  represented only in the fixture, not yet in a large clean C++ corpus.
- **C preprocessor**: `#ifdef`-dependent declarations are not resolved as
  multiple configurations; the active configuration is extracted and
  conditional alternatives are not double-counted.

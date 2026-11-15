// Band B — Functional & declarative (9 families).
//
// Every record below was written by reading the family's own analyzer in
// src/ast/ — the file name is `real-<lang>-analyzer.ts` — and, where one
// exists, its contract in docs/analyzers/. The claims are checked against the
// module's SymbolKind and RelationshipType sites, not against anything the
// website said about the language before.
//
// `limitations` is the most valuable field here. Each line names a specific
// construct the analyzer declines, filters or bounds, because that boundary is
// what a reader actually needs and no dataset can supply it.
//
// TWO RULES THAT CHANGED THE SHAPE OF EVERY RECORD BELOW:
//
// 1. A missing relationship type is a fact about the FORMAT, not about analyzer
//    quality. Erlang has no inheritance. Haskell's instances are not method
//    overrides on a base type. Julia has multiple dispatch rather than
//    overriding, and its analyzer declines `overrides` for exactly that reason.
//    Those are written as what the format expresses, and the absence is stated
//    as the format fact it is. Elixir and Clojure do resolve calls — through a
//    Kernel filter and a core-name filter respectively, and both filters are
//    named below with their sizes.
//
// 2. Every family here has a hand-written analyzer. `GenericAnalyzer` is the
//    unreachable `default:` branch of getAnalyzer and describes code that never
//    runs, so no record below may claim a family is missing one.
//
// (Where the word "tier" appears further down it means a CONFIDENCE tier inside
// an analyzer's override resolver, which is the engine's own vocabulary. It is
// not the removed `LangFamily.tier` label.)

import type { LanguageDepth } from "./types"

export const BAND_DEPTH: Record<string, LanguageDepth> = {
  Elixir: {
    headline:
      "Elixir modules are indexed with the protocol and behaviour machinery intact: defimpl and @derive become implements edges, @behaviour marks the module it sits on, and a macro or a guard is recorded as a macro rather than as a function.",
    agentAsks: [
      "Which modules implement this protocol?",
      "Which callbacks does this behaviour declare?",
      "Is this module a GenServer, and which of its functions are the callbacks?",
      "Which fields does this struct carry?",
    ],
    limitations: [
      "Kernel builtins are excluded from the call graph on purpose, and the list holds 73 names: they exist in every module and would bury every real edge underneath them. The same rule drops the qualified spelling, so Kernel.length is as silent as length.",
      "Macros are not expanded, so an unqualified call through a bare import Foo — or through an import carrying an :except list — cannot be confirmed to come from where a reader would guess. Those calls stay unresolved instead of being attributed.",
      "Everything inside a quote do block is macro-generated data, so a name appearing only there publishes no symbol and no call edge. The exception is an unquote argument, which executes at expansion time and is walked.",
    ],
    sample: {
      caption: "A GenServer module, its struct fields, a guard clause and an aliased call",
      code: `defmodule MyApp.OrderBook do          # bb records: module MyApp.OrderBook
  @behaviour GenServer               # bb records: implements GenServer

  defstruct bids: [], total: 0       # bb records: struct with fields bids, total

  def place(o, n) when n > 0 do      # bb records: function place/2, with its guard
    Acct.charge(o, n)                # bb records: a call resolved through the alias
  end
end`,
    },
    whereItShowsUp: [
      "A mix umbrella is a tree of applications, so a protocol and its implementations routinely live in different ones.",
      "A behaviour is a contract the module then satisfies, and its callbacks are ordinary defs carrying a marker.",
      "Arity is part of a function's identity, so a search for one name has to account for the clause that introduced it.",
    ],
  },

  Clojure: {
    headline:
      "Clojure namespaces are indexed with the reader's own rules: :refer and :as decide what a bare call is allowed to resolve to, a name the namespace declares itself shadows the referred one, and a macro is a function carrying a marker rather than a separate kind.",
    agentAsks: [
      "Which namespaces require this library?",
      "Which names does this namespace refer from another one?",
      "Which records implement this protocol?",
      "Which functions does this namespace declare, macros included?",
    ],
    limitations: [
      "A call to clojure.core is suppressed unless this namespace declares or refers that name, and the check is position-aware: a form above (defn map ...) really is the standard library while one below it is the file's own var. The exclusion list holds 723 names.",
      "recur is a special form that transfers control to the enclosing fn — it names no var and invokes nothing — so it produces no edge, and neither does a call whose name was minted for an anonymous function.",
      "There is no override edge, and that is a fact about Clojure: a defmethod introduces a var sharing a name with the multimethod rather than replacing a member of anything, so there is no override to record.",
    ],
    sample: {
      caption: "A namespace with an aliased require, a record type, and a call through the alias",
      code: `(ns myapp.cart
  (:require [myapp.account :as acct]))

(defrecord Cart [id total])      ; bb records: type Cart · fields id, total

(defn place [cart user]           ; bb records: function place
  (acct/charge! user (:total cart)))   ; bb records: a call through the alias`,
    },
    whereItShowsUp: [
      "A Clojure codebase is one file per namespace, and the :require form at the top is the only statement that says where anything came from.",
      "Protocols are usually defined next to the functions they dispatch on, while the implementations live wherever the concrete type does.",
      "Test namespaces use deftest, which bb records as a function, so test bodies are indexed alongside the code they exercise.",
    ],
  },

  Haskell: {
    headline:
      "Haskell is indexed with instance resolution treated as a first-class question: an instance's methods are matched against the class it implements and published as overrides, while a data type carries its constructors — GADT constructors included — and its record fields.",
    agentAsks: [
      "Which instances implement this type class?",
      "Which methods does this instance implement?",
      "Which constructors does this data type have?",
      "Which modules import this one, and what does each export?",
    ],
    limitations: [
      "A local call resolves only against names this module declares: an imported function, a Prelude name and a parameter all produce no edge, because nothing in the file says which one was meant. Forward references, self-recursion and mutual recursion inside the module do resolve.",
      "An instance method the class does not declare is not published as an override — the graph would be asserting a contract that does not exist in the source.",
      "Template Haskell is not read, so a splice's generated declarations are invisible and a module's recorded surface can be smaller than what the compiler actually exports.",
    ],
    sample: {
      caption: "A module export list, a record type, a class, and the instance that implements it",
      code: `module Data.Cart (Cart(..), place) where   -- bb records: module · exports Cart, place

data Cart = Cart { cartId :: !Int, total :: !Int }   -- bb records: type Cart · field total

class Chargeable a where
  charge :: a -> Int                          -- bb records: interface Chargeable

instance Chargeable Cart where
  charge c = cartTotal c                     -- bb records: an override of the class method`,
    },
    whereItShowsUp: [
      "A Cabal project splits a library into modules that write their export lists explicitly, so the public surface is stated in the file rather than inferred from it.",
      "Type classes and their instances are separated: the class lives with the abstraction, the instances with the concrete types.",
      "A foreign import declaration is the one place a Haskell file names a symbol that lives outside itself, and it is recorded as a reference to that external name.",
    ],
  },

  Scala: {
    headline:
      "Scala is indexed with the three shapes it keeps distinct still distinct: a trait is a symbol of its own, an object is a singleton rather than a class, and a class that implements an abstract member without writing the override keyword is still matched to it.",
    agentAsks: [
      "Which classes extend this trait?",
      "Which method implements this abstract member?",
      "Which extension method is declared for this receiver type?",
      "Which types does this declaration derive from?",
    ],
    limitations: [
      "Implicit conversions and the implicit search are not resolved, so a call that only type-checks through an implicit reads as an ordinary call and its argument conversion draws no edge.",
      "A qualified PascalCase call is never a construction: obj.Method() is a call, and only a receiver-less Type(...) is recorded as one, at a lower confidence — because in Scala 2 the qualified form is mostly module and enum-case access.",
      "Compiler-generated case-class members — copy, productElement, equals, hashCode, toString — and the enum ordinal are not materialized as symbols, because the compiler writes them rather than the programmer.",
    ],
    sample: {
      caption: "A class, a trait and an object — the three shapes Scala keeps apart",
      code: `class Column(val name: String) extends Base {   // bb records: class Column · extends Base
  def rename(to: String): Column = copy(name = to)   // bb records: method rename
}

trait Chargeable { def charge: Int }           // bb records: trait Chargeable

object Registry { val default = "column" }     // bb records: object Registry · default`,
    },
    whereItShowsUp: [
      "Scala 2 and Scala 3 share one surface, so a file may write implicit and implicit class or given and using depending on the build's source level.",
      "A case class publishes several symbols from one constructor — the class, its constructor and one property per parameter — so a model layer holds far more symbols than it has type names.",
      "Frameworks are recognised from the import root here, not from annotations: Play, Akka and Spring Boot are flagged, but no route is extracted the way the Java and Kotlin analyzers extract one.",
    ],
  },

  Erlang: {
    headline:
      "Erlang modules are indexed with the OTP contract recorded: -behaviour(gen_server) becomes an implements edge, a -callback is a method the module promises, and a -spec types the function it annotates instead of declaring a second one beside it.",
    agentAsks: [
      "Which behaviours does this module implement?",
      "Which callbacks does this module promise?",
      "Which macros does this module define?",
      "Which record fields does this state hold, and what types are they?",
    ],
    limitations: [
      "Macros are not expanded: only an object-like -define(NAME, atom) is readable without a preprocessor, and a clause headed by any other macro declares nothing rather than being guessed at.",
      "Erlang has no inheritance, so there is no extends and no override edge at all. A behaviour is a cross-module contract, and nothing in the format says one function replaces another.",
      "In type syntax a bare unquoted atom is the atom literal of that name, never a type called by that name — you must write foo() to apply a type. Only an applied name produces a type reference, which is why #state.count inside a -spec yields an edge and a bare count does not.",
    ],
    sample: {
      caption: "A module, its behaviour, a record type and a remote call",
      code: `-module(my_server).                 % bb records: module my_server
-behaviour(gen_server).             % bb records: implements gen_server
-record(state, {orders = [] :: list()}).

init([]) -> {ok, #state{}}.        % bb records: function init/1
place(Order) -> lists:sort([Order]).  % bb records: a remote call to lists:sort`,
    },
    whereItShowsUp: [
      "An OTP application is many small modules that talk by message passing, so the interesting graph is the callback contract rather than the call graph.",
      "A .hrl header holds the records and types that every module in the release shares.",
      "A function's identity is its name and arity, so pick/0 and pick/1 are two symbols and every clause of one pair merges into a single entry.",
    ],
  },

  "F#": {
    headline:
      "F# files are indexed with the signature/definition split in mind: a .fsi surface and its .fs implementation publish one symbol rather than two, a discriminated union becomes an enum carrying its cases, and a type member lands as a method on the type that owns it.",
    agentAsks: [
      "Which modules does this file open?",
      "Which union cases does this type have?",
      "Which members does this type declare, and which override its base?",
      "Where is this value bound, and is it a function or a plain value?",
    ],
    limitations: [
      "new is the only thing that distinguishes a construction in F#, so a bare Foo(...) stays a call — a capitalised name is not evidence — and the undecided calls/instantiates boundary is the largest class on both sides of the differential, 116 edges against 14.",
      "The ambiguous type X = SomeType is refused rather than guessed at: a one-case union and a type abbreviation are the same text, and script/m14 measured 114 such sites per 400 files.",
      "The member val X : int with get, set form does not parse under the pinned grammar, so such a property is recorded as a parse error rather than as a symbol, and roughly 890 occurrences of it exist in the F# compiler corpus alone.",
    ],
    sample: {
      caption: "An opened module, a record type, a discriminated union and a member",
      code: `module MyApp.Orders                  // bb records: module MyApp.Orders
open System                          // bb records: an opened module

type Order = { Id: int; Total: decimal }   // bb records: type Order · fields Id, Total
type Shape = | Circle of float | Rect of float * float   // bb records: cases Circle, Rect`,
    },
    whereItShowsUp: [
      "A library ships an .fsi surface beside its .fs implementation, so the public surface is declared once and defined once and bb merges the two into one symbol.",
      "A record and a discriminated union are the workhorses of an F# domain model, and each case or field becomes a symbol of its own.",
      "Computation expressions wrap a whole body in one call, so the work inside a let! chain reads as part of the enclosing function rather than as separate calls.",
    ],
  },

  Clean: {
    headline:
      "Clean modules are indexed with uniqueness types and type classes read as real structure: an instance is recorded against the type it is written for — resolved past the uniqueness constraint — and a where-local is a scoped symbol rather than a module-level one.",
    agentAsks: [
      "Which type class does this instance implement, and for which type?",
      "Which record fields does this type carry?",
      "Which data constructors does this algebraic type have?",
      "Which functions does this module export?",
    ],
    limitations: [
      "An uppercase applied name that this file does not declare as a data constructor produces no construction edge. The population is measured at 24,986 sites on the pinned corpus: 78.31% name something no file declares at all, and of the 5,420 the file can name, zero are data constructors, so the node type alone proves a construction in no case. The declines are counted and published rather than dropped silently.",
      "Imported operators and linker inputs produce no edge at all: an operator item cannot be written as a module-and-name pair that resolves, and a foreign code import names a build input rather than a module.",
      "A .dcl signature and its .icl implementation merge only inside one file. Across files nothing merges, because the analyzer is handed a single root node and a path and has no project context to join them with.",
    ],
    sample: {
      caption: "A module, a record type, a type class and the instance that implements it",
      code: `implementation module Data.Cart          // bb records: module Data.Cart

:: Order = { id :: !Int, total :: !Int }   // bb records: type Order · fields id, total

class Chargeable a where charge :: !a -> Int   // bb records: interface Chargeable

instance Chargeable Order where charge o = o.total   // bb records: Chargeable implemented for Order`,
    },
    whereItShowsUp: [
      "A Clean library ships .dcl interface files beside .icl implementation files, and the two halves of one declaration merge into a single symbol.",
      "Uniqueness types are how Clean expresses absence and ownership, so a uniqueness constraint sits inside the type of almost every field.",
      "The standard library is generic, so one import line can bring in a type class together with its constructor set.",
    ],
  },

  Nim: {
    headline:
      "Nim is indexed by a 3,098-line analyzer that publishes twelve symbol kinds and eight relationship types — including calls, instantiates and overrides — matching a method against the method set of every type this file declares as one of its subtypes.",
    agentAsks: [
      "Which routines does this file declare, and which keyword spelled each one?",
      "Which types and fields does this module define?",
      "Which modules does this file import from, and which names does it take?",
      "Which method on this receiver overrides which?",
    ],
    limitations: [
      "The engine's language table declares nim twice — tree-sitter-nim and then __generic__ — and the second entry shadows the first. Both the grammar and the analyzer are wired into getAnalyzer, but a .nim file is currently routed away from them.",
      "implements is structurally absent, and that is a fact about Nim: a concept is duck-typed rather than nominal, so there is no declaration for an edge to point at. The differential reports the label as vacuous rather than pretending it is covered.",
      "Cross-file override resolution reads a companion index that carries owner to member names but not each type's own base list, so the walk descends only as far as bases visible in the current file: a hierarchy three modules deep stops at the visible link.",
    ],
    sample: {
      caption: "A ref object, the method on it, and a template kept as a macro",
      code: `type
  Vec*[T] = ref object of Base   ## bb records: class Vec (a ref object) · extends Base
    x, y: T                      ## bb records: the fields x and y

method describe(d: Vec[int]): string =   ## bb records: a method on Vec
  result = $d.x

template twice(x: untyped): untyped =   ## bb records: a template, kept as a macro kind
  x; x`,
    },
    whereItShowsUp: [
      "A Nim project mixes library modules with per-project source and a .nimble package file that names its dependencies.",
      "include pastes one file into another at compile time, so a symbol can be declared in a file that never imports it.",
      "Nim spells the same idea seven different ways — proc, func, method, iterator, converter, template, macro — so a search for one name has to account for which keyword introduced it.",
    ],
  },

  Julia: {
    headline:
      "Julia is indexed with multiple dispatch taken seriously: a bare Point(1, 2) is recorded as a construction because Julia has no new(), A' and f.(v) are recorded as calls, and a type parameter's bound inside a declaration is never mistaken for a supertype of the declared type.",
    agentAsks: [
      "Which types is this one a subtype of?",
      "Which functions construct this type?",
      "Which modules does this file import, and which names does it reach through?",
      "Where is this C symbol called from, and which library is it in?",
    ],
    limitations: [
      "overrides is declined on purpose, and the reason is the language's: Julia has multiple dispatch rather than overriding, so two methods with the same name and different signatures are both live and neither replaces the other. implements is declined for the same reason — struct S <: I is a type-hierarchy edge, not protocol conformance.",
      "A parameter's upper bound is not a supertype of the declared type. In struct Circle{T<:Real} <: Shape the bound hides inside the curly expression, and a walk that descends into it would report Circle <: Real, so the parameter list is treated as a wall and only the subtype edge written outside it is published.",
      "The grammar is the boundary: 177 of the 966 files in the pinned corpus carry ERROR nodes, measured at 1,947 in total with none missing. A macro that synthesises a name never appears as source, so it is invisible whatever the analyzer does.",
    ],
    sample: {
      caption: "An abstract type, the subtype that satisfies it, and a construction of that subtype",
      code: `abstract type Shape end              # bb records: interface Shape

struct Circle <: Shape              # bb records: class Circle · extends Shape
    radius::Float64                 # bb records: property radius
end

c = Circle(2.0)                    # bb records: instantiates Circle — Julia has no new()
typeof(c) === Circle               # bb records: references Circle`,
    },
    whereItShowsUp: [
      "A Julia file is often a script with no module block — measured at 71.9% of a corpus sample — so top-level declarations carry an explicit global scope rather than an invented owner.",
      "Project.toml and Manifest.toml hold the dependency edge, not the source, so a package's reach is stated in metadata rather than in the files that use it.",
      "The scientific stack arrives through using and import at file scope, so one line at the top can pull a whole package into a file's reach.",
    ],
  },
}
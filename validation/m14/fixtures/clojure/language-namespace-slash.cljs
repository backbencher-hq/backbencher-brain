;; CLJ-EX4 (2026-10-20): the SLASH opt-in on the language-namespace claim.
;;
;; Clojure spells a namespaced var `ns/name`, which is the SAME shape Go spells a module path
;; (`encoding/json`) — and the arbiter already has an opt-in for exactly that: the
;; `languageNamespaceSlash` marker, which makes its `namespaceMatchOf` split on `/` as well as on
;; `.`/`::`/`:`. Without it, `js/require` yields ONE segment (`js/require`) under the dotted split,
;; no prefix of it is in the closed language/runtime root set, and the row is UNREACHABLE by the
;; claim — the D7 wall table called that class an INSTRUMENT GAP and said the fix was Lead-owned.
;; The opt-in already existed (added 2026-10-19 for Go), so the closure is a LANE-SIDE change.
;;
;; THE POSITIVE HALF: a `js/…` target is a member of the `js` namespace, which the ClojureScript
;; runtime provides, so it carries the claim and the slash marker.
;;
;; THE NEGATIVE HALF — and it is the half that matters: a THIRD-PARTY root is still NOT claimed.
;; `babashka.fs` is a library the project may or may not vendor, and that is a project fact a
;; single-file analyzer cannot know; the closed list is the claim's evidence, so a root outside it
;; carries no claim at all. The slash split must not widen the SET, only the way a root is found.
(ns user)

(js/require "shelljs")
(js/parseInt "42")
(js/String.fromCharCode 65)
(js/Object)
(babashka.fs/exists? "x")

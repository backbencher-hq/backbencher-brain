;; A5 (2026-10-20): `(require ns)` with an UNQUOTED, UNQUALIFIED symbol is a DYNAMIC
;; argument (a local var), not a libspec; it was read as a library and emitted an
;; `imports` edge for the local name. The quoted/dotted/vector spellings stay imports.
(ns fixture.dynamic-require)

(require 'clojure.string)

(defn load-it [ns] (require ns))

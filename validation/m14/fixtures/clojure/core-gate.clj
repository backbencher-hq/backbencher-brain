;; CLJ-D17/D2 — the core-call suppression gate.
;;
;; Every head below is a REAL clojure.core var, derived from clojure/clojure's
;; own `core.clj` by `script/m14/tmp/clj-core-derive.ts` (namespace-scoped,
;; top-level only, private-filtered). Before this wave the suppression list was
;; a 437-name hand transcription and the F5 oracle IMPORTED it by reference, so
;; every name missing from the list was a MIRRORED fabrication no gate could
;; see: 2,525 such `calls` edges in the clojure corpus alone, 999 in clj-kondo,
;; 151 in core.async. The list is now the derived surface (723 entries), and
;; three exemptions stop the expansion from trading one fabrication for another.
(ns clj.fixture.coregate
  (:require [clj.fixture.util :refer [re-find tally-up]]))

;; ── 1. plain core heads: no `calls` edge at all ──────────────────────────
(defn suppressed-heads [x]
  (list (mapcat identity x)
        (ex-info "boom" {})
        (with-meta x {:k 1})
        (transduce identity (comp) x)
        (dedupe x)
        (run! (fn [_] nil) x)
        (max 1 (count x))))

;; ── 2. the file defines `max` itself ─────────────────────────────────────
;; Clojure compiles a form when it reads it, so the shadow is ORDER-AWARE: a
;; call ABOVE the definition is the standard library, a call BELOW it is this
;; file's own var. Both directions are pinned, because a flag instead of a
;; range would pass either one alone.
(defn ^:private max [a b]
  (if (> a b) a b))

(defn below-the-def [x]
  (max 0 (max 1 x)))

;; ── 3. a PARAMETER named like a core fn shadows it for the whole form ───
(defn region-bound [map data]
  (map (fn [row] (max 1 (count row))) data))

;; ── 4. a core-SHAPED name brought in by `:refer` is a real dependency ───
;; `re-find` is a clojure.core var, so the gate would suppress it — the refer
;; exemption is what admits it, and the post-walk pass then names its lib.
(defn referred [pattern line]
  (re-find pattern line))

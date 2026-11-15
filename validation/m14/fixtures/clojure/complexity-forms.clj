(ns clj.fixture.complexityforms)

;; CC1-c / CLJ-D6: one rule — every conditional/loop CONSTRUCT counts +1.
;; Clause nodes are not counted in clojure (case children are pairs, not
;; nodes); try/catch/finally and and/or are NOT counted (declared: elixir
;; omits try as well). One defn per construct so each pin is exact.

(defn baseline [x] x)                                         ; 1

;; Long-standing family (counted before this fixture existed):
(defn f-if [x] (if x 1 2))                                    ; 2
(defn f-cond [x] (cond x 1 :else 2))                          ; 2
(defn f-when [x] (when x 1))                                  ; 2
(defn f-case [x] (case x 1 :a :b))                            ; 2
(defn f-for [xs] (for [x xs] x))                              ; 2
(defn f-loop [n] (loop [i 0] i))                              ; 2
(defn f-when-let [x] (when-let [a x] a))                      ; 2
(defn f-if-let [x] (if-let [a x] a 0))                        ; 2

;; CC1-c additions (undercounted before the extension):
(defn f-if-not [x] (if-not x 1 2))                            ; 2
(defn f-when-not [x] (when-not x 1))                          ; 2
(defn f-if-some [x] (if-some [a x] a 0))                      ; 2
(defn f-when-some [x] (when-some [a x] a))                    ; 2
(defn f-condp [x] (condp = x 1 :one :other))                  ; 2
(defn f-while [n] (while false n))                            ; 2
(defn f-cond-> [m] (cond-> m true (assoc m :a 1)))            ; 2
(defn f-cond->> [m] (cond->> m true (assoc :a 1)))            ; 2
(defn f-some-> [m] (some-> m :a))                             ; 2
(defn f-some->> [m] (some->> m :a))                           ; 2

;; Declared negatives (not counted on either lane):
(defn f-try [x] (try x (catch Exception e e) (finally nil)))  ; 1
(defn f-logic [x y] (and (or x y) true))                      ; 1

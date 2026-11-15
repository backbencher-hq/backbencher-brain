(ns clj.fixture.jsliteral)

;; CLJ-D37 — `#js` HAS AN EVALUATED PAYLOAD, EXCEPT FOR ITS KEYS.
;;
;; ClojureScript compiles `#js {:year (.year a-date)}` to a JavaScript object
;; LITERAL, and a literal's VALUES are evaluated. The blanket "payloads are data
;; either way" rule dropped every call and member access in the values — six
;; real ones in metabase's util/time/impl.cljs:313-319 alone.
;;
;; The discriminator is the tag: `#js` (and the historical `#JS`) is the one tag
;; whose payload is a literal with evaluated values; `#inst`, `#uuid` and every
;; record/class literal take DATA.
(defn day-parts [a-date]
  #js {:year  (.year  a-date)
       :month (.month a-date)})

;; A `#js` vector's ELEMENTS are values too, and each is walked in full.
;; `str/join` and `File/listFiles` are used rather than `String/valueOf` and
;; `Integer/parseInt` because the latter two are among the 69 uncurried interop
;; statics the core list DECLARES, so they are suppressed as builtins and would
;; emit nothing even here — the fixture would then prove nothing about `#js`.
(defn pair [a b] #js [(str/join "," a) (File/listFiles b)])

;; NOT `#js`: a record literal's payload is DATA, and none of these may emit.
(def rec-lit #rec[{:kind :a}])
(def uuid-lit #uuid "00000000-0000-0000-0000-000000000000")

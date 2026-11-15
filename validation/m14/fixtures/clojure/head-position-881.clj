(ns head-position-881)
;; #881: what occupies a list's HEAD. A leading #_discard, a discard inside
;; head position, and metadata do not decide the form — the first executable
;; child does. `(#_ignored quote (trivia-ghost))` is a QUOTE form, so its body
;; is data; `(^:probe meta-called)` is an ordinary call to `meta-called`.
(defn discard-head []
  (#_ignored quote (trivia-ghost))
  (live-discard))
(defn discard-head-call []
  (#_(c) commented-called)
  (live-comment))
(defn meta-head []
  (^:probe meta-called)
  (live-meta))
'(defn quoted-head [] (hidden))

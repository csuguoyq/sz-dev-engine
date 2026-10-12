;;; Two-message repro driver for a global-state-leak mislabel symptom
;;; (engine level, read-only). Symptom: after an order of one category,
;;; a subsequent ordinary order is classified with the earlier
;;; category's label downstream.
;;;
;;; Scope note (pre-fix-safe driver): this driver reproduces the leak.
;;; It never sets the message-class global the daemon dispatch sets
;;; before each message, so a POST-FIX green re-run of this exact
;;; driver exercises a fallback path the daemon never takes (and can
;;; even error on the synthetic input). For the green side of the
;;; red/green pair, emulate the daemon prologue — set the message-class
;;; global per message exactly as the dispatch entry does — and load
;;; hl7common/types.scm when the assertion inspects seg-id-derived
;;; names. See repro.md "Post-fix green checks".
;;;
;;; Caps: wrap the engine call in `timeout 60` + `ulimit -f` (an error
;;; landing in the cqlError> prompt spins and fills /tmp; see
;;; repro.md driver-runtime traps). Large quoted literals belong in
;;; files loaded via (load ...), never inline on the command line.
;;;
;;; Usage (export the vars — a VAR=... prefix before `cat` is invisible
;;; to `cql` on the right side of the pipe):
;;;   export REPRO_CONFIG=/path/to/config-under-test
;;;   cat state-leak-two-message-repro.scm | cql -b -n -e
;;;
;;; Expected observation for a state leak: the second message's
;;; classification carries the first message's category (leak-after2=t);
;;; with the defect absent, the second message classifies on its own
;;; fields (leak-after2=()).

(define HL7BASEDIR (getenv "CCRUN"))
(define cfg (getenv "REPRO_CONFIG"))
(define hl7-config-dir cfg)
(define hl7-config-path cfg)
(define hl7-dir-path "/hl7/hl7common")
(define (prepend-path dir) (set! load-path (cons dir load-path)))
(prepend-path cfg)
(prepend-path (strcat HL7BASEDIR "/cql/hl7/hl7common"))
(prepend-path (strcat HL7BASEDIR "/cql/hl7"))
(if (not (symbol-bound? 'type-use-first-nte-only))
    (define type-use-first-nte-only "f"))

;;; Load chain — order matters. See references/cql/repro.md for the rules.
(load "util.scm")
(load "hl7msg.scm")
(load "hl7local.scm")
(load "adt.cf")
(load "hl7adt.scm")
(load "hl7oru.scm")
(load "hl7dsstxorders.scm")

;;; msg1: tube-feeding order. ODS segment element 3 (0-based) is a list whose
;;; element 6 (0-based) is "99FHT" — matches the first branch of get-order-type.
(define msg-tubefeed
  (list (list "OBR" () () () "99WPX")
        (list "ODS" () () (list "99FHT" () () () () () "99FHT"))))
;;; msg2: ordinary nursing order. OBR element 4 is a string -> ordtype "99WP";
;;; no ODS / ODT / NTE -> classification falls through to "Nursing".
(define msg-nursing
  (list (list "OBR" () () () "99WPX")))

(printf "type1=%S leak-after1=%S "
        (get-order-type msg-tubefeed)
        is-tube-feeding?)
(printf "type2=%S leak-after2=%S\n"
        (get-order-type msg-nursing)
        is-tube-feeding?)

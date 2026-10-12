# Template: HL7 inbound handler script (Scripts layer — the vast majority of CQL SZs)

> Structure taken from `cql/lisp/hl7/hl7common/` (`hl7oru.scm`, `hl7adt.scm`) and
> the `starthl7.<site>.scm` framework. Before drafting, use the softzilla MCP
> prior-art search — `bugs_quicksearch(query=<SZ title keywords>, change_context: Scripts)`
> — to pull sibling SZ handlers as few-shot examples.

## Structure skeleton (copy a sibling handler + this SZ's field mapping)

```scheme
;;; cql/lisp/hl7/hl7common/hl7oru.scm — new/modified handler within this family
;;; SZxxxxx: <one-line description> (add the revision comment in the file header,
;;; copying the format of existing entries in the same file)

;; 1. Optional switch —— follow the "site-config can disable" convention throughout:
;;    in hl7common: (if (not (symbol-bound? 'my-feature?)) (define my-feature? nil))
;;    the site enables it in cql/lisp/hl7/config.<site>/hl7local.scm: (define my-feature? t)

;; 2. Message parsing —— segment/field accessors reuse the existing accessor style
;;    (HL7 segments are already parsed into S-expression lists; see the
;;    ("RXE" (com ...) ...) shape in historical TCs).
;;    Write new field mappings as small predicates/getter functions — no inline
;;    piles of magic indices.

;; 3. Business decision —— e.g. SZ27614: pick the first non-obsolete formulary entry
;;    via a C primitive (get-fluids-by-ien) instead of re-scanning the druglist in Scheme.

;; 4. Persisting —— the data-access write path: db-start-write → db-newd → db-end-write;
;;    read-only queries use the five-step pattern: db-open → db-def → db-step loop → db-undef → db-close.

;; 5. ACK —— the return value ultimately funnels into ("MSA" "AA" <control-id> "<message>");
;;    message-text conventions: success "ALL RESULTS PROCESSED" / "NO ERROR",
;;    skip "SKIPPING ...", location not found "UNKNOWN LOCATION".
;;    Note SITE-LEVEL SHADOWING: some sites' config.<site>/hl7local.scm redefines
;;    hl7-ack-reject as plain hl7-ack and overrides AR/AE codes to AA (measured on wrr,
;;    SZ34595 replay) — at such sites both success and rejection ACKs are MSA "AA",
;;    distinguishable only by the message text;
;;    when drafting cases do not assume rejection is always AE — assert each item
;;    individually with [{ctrl, msg}].
```

## Injection method (fixed TC phrasing; YAML cases reference it directly)

```
cat fixtures/<msg>.scm | .dosu $CCRUN/bin/cql.<SZ> -i$CCSYSDIR/cql/hl7/starthl7.<config>.scm
```

- The binary under test uses the **version suffix** (`cql.<SZ>`); never overwrite the production `cql`.
- Site configs (`config.dsspharm`, `hl7local.scm`'s `MED-store-units`/`skip-INP*`,
  `ccsys.UnlinkPatientStays` in `$CCSYSDIR/ccResources`, etc.) are modeled explicitly
  in the YAML case's `config:` block — patch on setup, restore on teardown.
- Common historical-SZ side-by-side entry point: `starthl7.vauga.<SZ>.scm`
  (modified version coexists with the original for comparison).
- **Version-suffixed config directory** (measured in the SZ34595 replay; use when the SZ
  changes files inside `config.<site>/`): a test host's live `config.<site>` may
  **lag behind the repository baseline** (fbch34's `config.wrr/msgdata.cf` lacks the
  `rad-visit-num` entry that exists in the repo), so the live config cannot be relied on.
  Copy the implementation side's `config.<site>` in full to
  `$CCSYSDIR/cql/hl7/config.<site>.<SZ>`, and put the entry point
  `starthl7<name>.<SZ>.scm` in any writable directory (same shape as the original, only
  `hl7-config-path` changed to `/<hl7>/config.<site>.<SZ>`); send with
  `cat <msg>.scm | .dosu cql -i<entry>`. Create directories via /tmp staging +
  `.dosu bash -c` copying in as cis; never modify the live config — teardown deletes the
  suffixed directory.

## Red lines

- `load` always uses the absolute prefix `(string-append (getenv "CCRUN") "/cql/...")` (path ambiguity).
- New .scm files must continue the `SCRTn` sequence in `cql/lisp/Makefile` (or the subdirectory Makefile).
- Read-only smoke tests run `cql -n -i <script>` first.

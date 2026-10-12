# Template: query/report script (Scripts layer, five-step pattern)

> Template `cql/lisp/dumpdb.scm` (19 lines) parameterized: db-open target, db-def fields, output format.
> Five-step data access: `db-open → db-def → db-step loop → db-undef → db-close`;
> handles: dbtd is a number (flocons); the query handle is a `tc_ptr` (ptrcons/PTR).

```scheme
(load "init.scm")

;; —— Parameterization point 1: db-open target (interactive scripts usually take it
;;    from getenv; report scripts may hard-code a conventional path) ——
(set! dbpath (getenv "DBPATH"))
(if dbpath nil (quit))

(set! dbtd (db-open dbpath))

;; —— Parameterization point 2: db-def field selection/predicates ——
;; db-def <dbtd> <item> <from-time> <all?> <pred-list>; dbh is a ptr handle object
(set! dbh (db-def dbtd 0 never t ()))
(set! dbi (db-step dbh))

;; —— Parameterization point 3: output format (print / build a string / write a report header) ——
(while dbi
       (print dbi)
       (set! dbi (db-step dbh)))

(db-undef dbh)
(db-close dbtd)
(quit)
```

## Landing checklist

1. New files go in `cql/lisp/` (or a semantic subdirectory) → continue the `SCRTn` sequence in the `Makefile`.
2. Menu entry (optional): the `choices` table in `cql/lisp/menu.scm`, and mind the
   `.template` install convention (menu changes must be mirrored in the template — the lint checks it).
3. Help/description (optional): append a "signature list + description string" entry to
   `cql/lisp/cql.hlp` (strict format; see the EXAMPLE in the file header).
4. `load` always uses the absolute prefix `(string-append (getenv "CCRUN") "/cql/...")`.
5. Testing: read-only scripts smoke-test directly with `cql -n -i <script>`;
   DB-writing cases translate the TC per the YAML in `references/cases/`
   (rsync backup/restore mandatory).

# Template: new C primitive trio (Lib layer)

> All three places must be completed in the same diff; a missing `cql.hlp` entry is the
> most common rework point in historical SZs (example: the `get-fluids-by-ien`
> implementation exists in `cclib/cqlA/cciorder.c` but `cql/lisp/cql.hlp` has no entry —
> cql_lint's help-sync check catches this kind of pre-existing debt; new code is not
> allowed to add more).

## (1) C implementation —— `cclib/cqlA/*.c`

Model after `cciGetFluidsByIEN` in `cclib/cqlA/cciorder.c` (LISP style = `tc_lsubr`;
the parameter is a single `args` list, unwrapped item by item with `car`/`cdr`):

```c
/*** HISTORY **************************************************************
 * SZxxxxx <date> <who>  <one-line description>
 *** SYNOPSIS ***
 ***              LISP my-foo(arg1 arg2)
 *** Returns:     <description>
 *** Description: C code for my-foo primitive function
 *****************************************************************************/
LISP cciMyFoo(LISP args)
{
    LISP l = args, s;
    s = car(l);
    if (NULLP(s) || (NSTRINGP(s) && NSYMBOLP(s)))
        err("my-foo: invalid arg1", s);
    string arg1 = PNAME(s);          /* string argument unwrapping: PNAME */
    l = cdr(l); s = car(l);
    if (NNULLP(s)) {                 /* optional argument: NNULLP emptiness check */
        ...
    }
    /* numbers unwrap with FLONM (flocons' double); pointer handles use PTR (tc_ptr) */

    /* WRITE PRIMITIVES must copy cciadt.c's check to protect -n read-only mode: */
    if (disable_storage) err("my-foo: permission to store data denied.", args);

    /* ... business implementation ... */
    return (flocons(result));        /* return: flocons / strcons / ptrcons / Make...List */
}
```

Key points:

- Unwrapping: string/symbol `PNAME`, float `FLONM`, pointer handle `PTR`; invalid
  arguments always `err("my-foo: ...", s)` with the primitive-name prefix.
- DB writes go through `db-start-write → db-newd → db-end-write`; the global DB `gdb-*` is read-only.
- Read-only primitives (query class) do **not** need the disable_storage check
  (the lint only flags the write path).

## (2) Registration —— `cclib/cqlA/cci.c`'s `init_ccisubrs()`

```c
  init_subr("my-foo", tc_lsubr, (obj *(*) ())cciMyFoo); //szxxxxx
```

`tc_subr_N` for fixed arity / `tc_lsubr` for a list argument (the most common);
insert registrations in alphabetical order; the trailing `//szxxxxx` comment is this
repository's convention.

## (3) Help —— `cql/lisp/cql.hlp`

Strict format: alternating "signature list + description string" (see the file-header EXAMPLE):

```
(my-foo arg1 [arg2])
	"One-line description of my-foo."
```

## (4) Build/install (Linux host)

- Rebuild cqlA (`cclib/cqlA && make`) → relink `cql/siodsgi` → full verification with `tlmake.sh`.
- The artifact under test installs into a version-suffixed directory (`$CCRUN/bin/cql.<SZ>`); never touch the production `cql`.

## Test shape

Lib-layer cases first change the precondition data with `ycql` (e.g. druglist), then
trigger the new primitive via HL7 injection; assert on ACK / `cqldump` /
`ycql select` / logs — see the SZ27614 case YAML (delivered per SZ, not stored in-repo — schema: `references/cql/testcase-schema.yaml`).

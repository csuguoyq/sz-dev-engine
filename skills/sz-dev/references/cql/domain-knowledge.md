# CQL domain knowledge — INDEX

Open this pack only after MCP-reading the SZ (category / title /
Change Context), not from the chat prompt. Read this index first,
then only the `domain/*.md` files it points at. Not ground truth —
the ccsrc repository wins.

```text
cql/
├── README.md                 capability map (framework contract)
├── domain-knowledge.md       this file — INDEX
├── routing.md                SZ diff → layer → automated actions
├── sz-history.md             git-derived changelog of CQL SZs (prior-art source)
├── domain/
│   ├── facts.md              GREP — the 8 must-know facts + authoritative sources
│   ├── scripts-layer.md      cql/lisp (Scheme scripts, HL7) + cql/scripts (shell wrappers)
│   ├── interpreter-lib.md    cclib/cqlA (interpreter + C primitives) + cql/siodsgi (main/glue)
│   └── gdb-stack.md          cclib/cql (libcql.a) + cql/gdb + gdbscripts
├── automation.md             test-harness design rationale
├── repro.md                  bug repro recipes
├── testcase-schema.yaml      declarative acceptance case format
├── templates/                generation templates
└── tools/                    cql_lint.py (static gates), repro drivers
```

## Which file to open

| You are about to... | Open |
|---|---|
| Anything at all (first read, every SZ) | `domain/facts.md` |
| Add/modify a Scheme query/report/menu/HL7 script, or a shell wrapper | `domain/scripts-layer.md` + `routing.md` (Scripts row) |
| Add/modify a C primitive or interpreter glue | `domain/interpreter-lib.md` + `routing.md` (Lib row) |
| Touch the GDB stack (libcql.a, gdb maintenance .scm, ops ksh) | `domain/gdb-stack.md` + `routing.md` (GDB row) |
| Reproduce a bug | `repro.md` |
| Search prior art (sibling SZs) | `sz-history.md` |
| Design or review acceptance cases | `testcase-schema.yaml` + `automation.md` |

Layer routing itself lives in `routing.md`; this index only picks the
domain reading.

# Deferred Items — Phase 08

## Pre-existing TypeScript errors in sibling 08-02 output

- **Found by:** 08-01 agent (parallel execution)
- **File:** `desktop/src/main/services/document/doc-cache.ts`
- **Errors:** 5 TS2322 / TS2345 around `Dirent<NonSharedBuffer>` vs `Dirent<string>` at lines 58, 65, 122, 131, 133
- **Reason:** `fs.readdir(path, { withFileTypes: true })` returns `Dirent<NonSharedBuffer>[]` by default; the code assumes `Dirent<string>[]`. Need `encoding: "utf8"` option or explicit cast.
- **Scope:** Out of scope for 08-01 (DocumentIR contract only). File belongs to Plan 08-02 (doc-cache).
- **Disposition:** Leave to 08-02 owner or Phase 08 verifier to resolve. Not blocking 08-01 contract work.

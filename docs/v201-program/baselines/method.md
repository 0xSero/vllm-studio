# Measurement Methods (frozen)

These methods are the durable specification for every baseline in `baselines/`. Regeneration beats transcription wherever a ref matters. The same methods are reused at the final head — spec stability outranks spec perfection.

## LOC — pinned cloc 2.06

**Provenance (reproducible, no product-dependency change):**
- Source: official release `https://github.com/AlDanial/cloc/releases/download/v2.06/cloc-2.06.pl` (AlDanial/cloc).
- Cached at: `/Users/sero/.local/share/v201-cloc/cloc-2.06.pl`.
- sha256: `ed9fbdd081a2ceb933ea490b3c1cfacc87d3898ae2650d0d6756439695a836c8` · size 794180 bytes · `perl 5.034` · `--version` prints `2.06`.
- Durable copy + sha256 catalog: `backups/local-studio/v201-phase0-20260813T190343Z/raw-reports/2026-08-13/` (parent bundle re-verified separately).
- Note: the repo's documented method writes `npx cloc`; the npm `cloc` wrapper version is not pinned to 2.06, so the release `.pl` is used directly for determinism. `--list-file` is a cloc-native flag. The dossier used cloc 2.06; a local brew install carries 2.10 and is **not** authoritative for this baseline.

**Pipeline (verbatim from `docs/codebase-reduction.md` measurement section; semantic authored production code across scope dirs, excluding tests/fixtures/generated):**
```
git ls-files -s \
  | awk '$1 != "120000" {print substr($0,index($0,"\t")+1)}' \
  | rg '^(controller|frontend/src|frontend/desktop|services|shared|scripts)/' \
  | rg '\.(ts|tsx|js|jsx|mjs|css|json|ya?ml|sh|py)$' \
  | rg -v '(^|/)(node_modules|\.next|dist|build|test|tests|__tests__|fixtures)(/|$)|\.(test|spec)\.' \
  > production-files.txt
cloc --list-file=production-files.txt
```
**Per-ref adaptation:** for each ref R ∈ {`eeeb3406`, `a765eb27`, `dcb790fd`}: `git archive R` exported; the non-symlink tracked list is produced with `git ls-tree -r R | awk -F'\t' '{split($1,m," "); if(m[1]!="120000") print $2}'` (equivalent to the `git ls-files -s | awk '$1 != "120000"'` filter applied to that ref); then the identical `rg` scope/extension/exclusion filters; then `perl cloc-2.06.pl --by-file --csv --list-file=production-files.txt` from the export root. Rows: `path<TAB>code`, `LC_ALL=C` sort by path, 3-line header (ref, date, tool) + `total-code`/`rows` footer. **Shard rule (R19):** by top-level scope dir; any shard >550 rows re-shards by next path segment — none exceeded the threshold at these refs (largest = `frontend-src` at 497–498 file rows).

## Routes — frozen pattern set P (R23 / G0G)

Whole-tree static scan over `controller/src/**` from the `git archive eeeb3406` export (no curated file list). **Pattern set P (frozen verbatim):** `defineRoutes(`, `mergeRoutes(`, `documentRoute(`, Hono verb calls `.get( .post( .put( .patch( .delete( .all( .on(`, mount forms `app.route(`/subapp mounts. **Inclusion rule:** one row per (method, path) where the path is a string literal; non-literal paths emit `path = <dynamic>` plus the verbatim source expression (zero instances at `eeeb3406`). **Mount composition:** record both mount + leaf; effective path only when both literals (zero mounts at this ref). **Fields:** method | path (or `<dynamic>`) | file:line | wiring chain (`app.ts` import → … | `unestablished`) | classification | notes. **Classification enum:** `static-wired` | `static-unwired` | `dynamic-unresolved` | `mount` | `library-emitted`. Honesty header mandatory (bounded static inventory, not a proven runtime route table). Cross-checks (dossier @`262f84c7`, `controller.md` §5) recorded, never silently merged.

## Pages

Filesystem-derived from `frontend/src/app`: `page.tsx`/`route.ts` inventory. Route path derived by App-Router convention; static segments exact, dynamic segments (`[param]`→`:param`, `[...slug]`→`*slug`) recorded as patterns. Bounded static inventory, not a proven runtime route table.

## Tables

Literal `CREATE TABLE` scan across `controller/src/**`. Runtime-composed DDL would classify unresolved (none found). The 9 `OBSOLETE_TABLES` are listed separately with their drop-on-open caveat (destructive-on-open; never point the controller at a real data dir).

## Size

Per ref: tracked file count + summed bytes from `git ls-tree -r -l` + top-20 largest. Installed-artifact baselines are transcribed with attribution (not measured here).

## PR census (R24 / R25′ / R26)

Canonical = durable backup `06-inventory/prs-open.json` (29 rows, 2026-08-13T19:03:43Z), hash-cataloged. Frozen append-only. The historical dossier "30" = prose arithmetic (6 maintainer + 24 fork claimed, 23 fork rows table-transcribed); the 29-number dossier list and the 29-row snapshot are an exact offline set-match; the 30th is `unresolved-historical` / `unresolved-benign` (empty 18:26–19:03Z archaeology probe). Owner-class from snapshot fields (maintainer | fork-external | internal-other | unclassified). Live queries annotate the delta only; never replace the census; no mutations.

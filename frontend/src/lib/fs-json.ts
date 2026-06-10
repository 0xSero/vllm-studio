// Canonical atomic JSON writer (mkdir -p, sibling pid+timestamp temp file,
// rename into place). The implementation lives under desktop/helpers because
// the desktop build (tsc rootDir = desktop/) cannot import from src/, and the
// projects-store shared by both builds is hosted there. src-side writers that
// still hand-roll this pattern (e.g. session-metadata-store.ts) can adopt this
// export later.
export { writeJsonAtomic } from "../../desktop/helpers/fs-json";

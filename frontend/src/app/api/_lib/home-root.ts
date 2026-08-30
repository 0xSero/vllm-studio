import os from "node:os";

// Next traces these routes with @vercel/nft, which constant-folds os.homedir() and
// then, unable to resolve what readdir or statSync is finally given, widens the call
// to "<home>/**/*". Globbing a Windows user profile walks the pre-Vista junctions
// (Application Data, Cookies) that the OS denies, and the build dies on EPERM.
// Reading the same variable Node itself reads leaves the value opaque to the tracer
// while the runtime result is unchanged.
export function homeRoot(): string {
  const fromEnv = process.platform === "win32" ? process.env["USERPROFILE"] : process.env["HOME"];
  return fromEnv && fromEnv.trim() ? fromEnv : os.homedir();
}

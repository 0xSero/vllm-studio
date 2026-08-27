import path from "node:path";

if (process.argv.some((argument) => path.basename(argument) === "browser-host.js")) {
  void import("./logic/browser-host.js").then(({ runBrowserHost }) => runBrowserHost());
} else {
  void import("./main.js");
}

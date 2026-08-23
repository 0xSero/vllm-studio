declare module "@rahularya01/pi-cursor" {
  import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

  const extension: (api: ExtensionAPI) => Promise<void>;
  export default extension;
}

import { permanentRedirect } from "next/navigation";

export default function PluginsRedirect() {
  permanentRedirect("/integrations?integration=plugins");
}

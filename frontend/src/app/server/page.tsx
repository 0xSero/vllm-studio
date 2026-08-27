import { permanentRedirect } from "next/navigation";
import { settingsHref } from "@/features/settings/settings-navigation";

export default function ServerRedirect() {
  permanentRedirect(settingsHref("machine:local:logs"));
}

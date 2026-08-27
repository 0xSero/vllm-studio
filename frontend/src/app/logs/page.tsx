import { redirect } from "next/navigation";
import { settingsHref } from "@/features/settings/settings-navigation";

export default function Page() {
  redirect(settingsHref("machine:local:logs"));
}

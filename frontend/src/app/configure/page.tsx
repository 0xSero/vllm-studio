import { redirect } from "next/navigation";
import { settingsHref } from "@/features/settings/settings-navigation";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ section?: string }>;
}) {
  const params = await searchParams;
  redirect(settingsHref(params.section === "server" ? "controller" : "machines"));
}

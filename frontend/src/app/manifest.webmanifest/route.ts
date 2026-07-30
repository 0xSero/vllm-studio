import { NextResponse } from "next/server";
import { BRAND_PROFILE } from "@/lib/brand-profile";

export function GET(): Response {
  return NextResponse.json(
    {
      id: "/",
      name: BRAND_PROFILE.appName,
      short_name: BRAND_PROFILE.shortName,
      description: BRAND_PROFILE.description,
      start_url: "/",
      scope: "/",
      display: "standalone",
      background_color: BRAND_PROFILE.themeColor,
      theme_color: BRAND_PROFILE.themeColor,
      orientation: "portrait-primary",
      icons: [
        {
          src: BRAND_PROFILE.icon192Path,
          sizes: "192x192",
          type: "image/png",
          purpose: "any",
        },
        {
          src: BRAND_PROFILE.icon512Path,
          sizes: "512x512",
          type: "image/png",
          purpose: "any",
        },
        {
          src: BRAND_PROFILE.icon192Path,
          sizes: "192x192",
          type: "image/png",
          purpose: "maskable",
        },
        {
          src: BRAND_PROFILE.icon512Path,
          sizes: "512x512",
          type: "image/png",
          purpose: "maskable",
        },
      ],
      categories: ["utilities", "developer tools"],
      screenshots: [],
      shortcuts: [
        {
          name: "Chat",
          short_name: "Chat",
          description: "Open the chat interface",
          url: "/chat",
          icons: [{ src: BRAND_PROFILE.icon192Path, sizes: "192x192" }],
        },
        {
          name: "Recipes",
          short_name: "Recipes",
          description: "Manage model recipes",
          url: "/recipes",
          icons: [{ src: BRAND_PROFILE.icon192Path, sizes: "192x192" }],
        },
      ],
    },
    {
      headers: {
        "content-type": "application/manifest+json; charset=utf-8",
        "cache-control": "public, max-age=300",
      },
    },
  );
}

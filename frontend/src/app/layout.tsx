import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Shell } from "@/features/studio";
import { Providers } from "./providers";
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#181818",
};
export const metadata: Metadata = {
  title: "Local Studio",
  description: "Private local-first model and agent workstation",
  icons: { icon: "/mocks/logo-1.svg" },
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="zai-dark">
      <body>
        <Providers>
          <Shell>{children}</Shell>
        </Providers>
      </body>
    </html>
  );
}

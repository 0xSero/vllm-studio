import type { Metadata, Viewport } from "next";
import Script from "next/script";
import "./globals.css";
import { LeftSidebar } from "@/features/shell/left-sidebar";
import { getThemeBootstrapScript } from "@/lib/theme-runtime";
import { BRAND_PROFILE } from "@/lib/brand-profile";
import { Providers } from "./providers";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: BRAND_PROFILE.themeColor,
};

export const metadata: Metadata = {
  title: BRAND_PROFILE.appName,
  description: BRAND_PROFILE.description,
  // The manifest link is written by hand in <head> below: it needs
  // crossorigin="use-credentials" (Next's `manifest` field can't set it), or an
  // access-gated deployment serves the login page instead of the manifest and
  // the installed app falls back to a letter icon.
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: BRAND_PROFILE.appName,
  },
  icons: {
    icon: [
      { url: BRAND_PROFILE.iconSvgPath, type: "image/svg+xml" },
      { url: BRAND_PROFILE.icon192Path, sizes: "192x192", type: "image/png" },
      { url: BRAND_PROFILE.icon512Path, sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: BRAND_PROFILE.appleTouchIconPath, sizes: "180x180", type: "image/png" }],
  },
};

const bootScript = `${getThemeBootstrapScript()}
  const originalFetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    const requestMethod = String(init.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const requestUrl = new URL(input instanceof Request ? input.url : String(input), window.location.href);
    if (requestUrl.origin === window.location.origin && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(requestMethod)) {
      const match = document.cookie.match(/(?:^|; )local_studio_csrf=([^;]+)/);
      const headers = new Headers(input instanceof Request ? input.headers : undefined);
      new Headers(init.headers).forEach((value, key) => headers.set(key, value));
      if (match) headers.set('x-local-studio-csrf', decodeURIComponent(match[1]));
      init = { ...init, headers };
    }
    return originalFetch(input, init);
  };
  const enableServiceWorker = ${process.env.LOCAL_STUDIO_ENABLE_SERVICE_WORKER === "true" ? "true" : "false"};
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      if (enableServiceWorker) {
        navigator.serviceWorker.register('/sw.js').catch(() => {});
        return;
      }
      navigator.serviceWorker.getRegistrations()
        .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())))
        .catch(() => {});
      if ('caches' in window) {
        caches.keys()
          .then((keys) => Promise.all(keys.filter((key) => key.startsWith('local-studio-')).map((key) => caches.delete(key))))
          .catch(() => {});
      }
    });
  }
  const setAppHeight = () => {
    document.documentElement.style.setProperty('--app-height', String(window.innerHeight) + 'px');
  };
  window.addEventListener('resize', setAppHeight);
  window.addEventListener('orientationchange', setAppHeight);
  setAppHeight();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      data-appliance={BRAND_PROFILE.applianceId}
      data-theme={BRAND_PROFILE.defaultThemeId}
      suppressHydrationWarning
    >
      <head>
        <link rel="manifest" href={BRAND_PROFILE.manifestPath} crossOrigin="use-credentials" />
        <link rel="apple-touch-icon" href={BRAND_PROFILE.appleTouchIconPath} />
        <link rel="icon" href={BRAND_PROFILE.iconSvgPath} type="image/svg+xml" />
        <meta name="mobile-web-app-capable" content="yes" />
      </head>
      <body>
        <Script
          id="boot"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: bootScript }}
        />
        <Providers>
          <LeftSidebar>{children}</LeftSidebar>
        </Providers>
      </body>
    </html>
  );
}

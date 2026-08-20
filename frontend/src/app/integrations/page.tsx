import { IntegrationsPage } from "@/features/integrations/integrations-page";

/**
 * A real page, not a redirect.
 *
 * This route used to `permanentRedirect` into `/configure?section=integrations`,
 * so the composer's `/connectors` command and every bookmark paid a round trip
 * to land on a tab of another page. No `Suspense` boundary here: the page reads
 * its section from the hash, which the server never sees, so it has no
 * `useSearchParams` to suspend on.
 */
export default function Page() {
  return <IntegrationsPage />;
}

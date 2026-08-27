import type { LocalhostSite } from "@/features/agent/ui/agent-browser-effects";

export function LocalhostStartPage({
  sites,
  loading,
  error,
  query,
  onQueryChange,
  onNavigate,
}: {
  sites: LocalhostSite[];
  loading: boolean;
  error: string | null;
  query: string;
  onQueryChange: (value: string) => void;
  onNavigate: (value: string) => void;
}) {
  const normalizedQuery = query.trim().toLowerCase();
  const filteredSites = normalizedQuery
    ? sites.filter((site) =>
        `${site.title} ${site.displayUrl} ${site.process ?? ""}`
          .toLowerCase()
          .includes(normalizedQuery),
      )
    : sites;
  const canOpenQuery = Boolean(query.trim());
  return (
    <div className="size-full overflow-y-auto bg-(--color-panel) px-6 py-6 text-(--fg)">
      <div className="mx-auto max-w-2xl">
        <div className="mb-4 flex items-end justify-between gap-3 border-b border-(--border)/70 pb-3">
          <div>
            <div className="text-[length:var(--fs-base)] font-medium text-(--fg)">Local apps</div>
            <div className="mt-0.5 text-[length:var(--fs-xs)] text-(--dim)">
              Pick a running localhost app, or type a URL/search above.
            </div>
          </div>
          <button
            type="button"
            onClick={() => onQueryChange("")}
            className="rounded px-2 py-1 text-[length:var(--fs-xs)] text-(--dim) hover:bg-(--hover) hover:text-(--fg)"
          >
            Clear
          </button>
        </div>

        {canOpenQuery && filteredSites.length === 0 ? (
          <button
            type="button"
            onClick={() => onNavigate(query)}
            className="mb-2 flex w-full items-center justify-between rounded border border-(--border) bg-(--surface)/70 px-3 py-2 text-left hover:bg-(--hover)"
          >
            <span className="min-w-0">
              <span className="block truncate text-[length:var(--fs-base)] font-medium">
                Open “{query.trim()}”
              </span>
              <span className="mt-0.5 block text-[length:var(--fs-xs)] text-(--dim)">
                Navigate in the browser
              </span>
            </span>
            <span className="text-lg text-(--dim)">↗</span>
          </button>
        ) : null}

        {loading ? (
          <div className="rounded border border-(--border) bg-black/20 px-3 py-6 text-center text-xs text-(--dim)">
            Scanning localhost…
          </div>
        ) : error ? (
          <div className="rounded border border-(--err)/30 bg-(--err)/10 px-3 py-2 text-xs text-(--err)">
            {error}
          </div>
        ) : filteredSites.length === 0 ? (
          <div className="rounded border border-(--border) bg-black/20 px-3 py-6 text-center text-xs text-(--dim)">
            No running localhost web apps found.
          </div>
        ) : (
          <div className="grid gap-3">
            {filteredSites.map((site) => (
              <LocalhostSiteRow
                key={`${site.port}:${site.url}`}
                site={site}
                onNavigate={onNavigate}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function LocalhostSiteRow({
  site,
  onNavigate,
}: {
  site: LocalhostSite;
  onNavigate: (value: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onNavigate(site.url)}
      className="group flex w-full items-center gap-3 rounded border border-(--border) bg-black/10 px-3 py-2.5 text-left transition-colors hover:bg-(--hover)"
    >
      <span className="flex h-12 w-[76px] shrink-0 flex-col justify-between rounded border border-white/20 bg-[#f4f4f4] p-1.5 shadow-inner">
        <span className="flex gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-[#ff6b5f]" />
          <span className="h-1.5 w-1.5 rounded-full bg-[#ffd166]" />
          <span className="h-1.5 w-1.5 rounded-full bg-[#3ddc84]" />
        </span>
        <span className="space-y-1">
          <span className="block h-1 w-12 rounded-full bg-black/15" />
          <span className="block h-1 w-9 rounded-full bg-black/15" />
        </span>
        <span className="truncate text-[length:var(--fs-2xs)] font-semibold text-black/70">
          {site.title}
        </span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[length:var(--fs-base)] font-semibold tracking-tight text-(--fg)">
          {site.title}
        </span>
        <span className="mt-0.5 block truncate text-[length:var(--fs-xs)] text-(--dim)">
          {site.displayUrl}
        </span>
      </span>
      {site.current ? (
        <span className="rounded border border-(--border) px-2 py-0.5 text-[length:var(--fs-2xs)] text-(--dim)">
          This chat
        </span>
      ) : null}
      <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-(--ok)" />
    </button>
  );
}

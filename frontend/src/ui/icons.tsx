/**
 * Solid, single-color icon set for the agent surface.
 *
 * Hand-rolled to keep the visual language consistent (16px viewBox,
 * `currentColor`, no strokes). Sized by the consumer with `className`
 * (e.g. `className="h-3.5 w-3.5"`).
 *
 * We only re-export `Folder` / `FolderOpen` from lucide because the user
 * explicitly asked to keep the open/close folder glyphs.
 */
import type { SVGProps } from "react";
export { Folder, FolderOpen } from "lucide-react";

type IconProps = SVGProps<SVGSVGElement>;

function Svg({ children, className, ...rest }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="1em"
      height="1em"
      fill="currentColor"
      aria-hidden
      className={className}
      {...rest}
    >
      {children}
    </svg>
  );
}

export function ChatIcon(props: IconProps) {
  // Solid square speech bubble (no rounded corners, no tail clutter).
  return (
    <Svg {...props}>
      <path d="M2 2.5h12v9H6l-3 3v-3H2v-9zm2 2v5h2.5L8 11l1.5-1.5H12v-5H4z" />
    </Svg>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M7 2h2v5h5v2H9v5H7V9H2V7h5V2z" />
    </Svg>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3.4 2 8 6.6 12.6 2 14 3.4 9.4 8 14 12.6 12.6 14 8 9.4 3.4 14 2 12.6 6.6 8 2 3.4 3.4 2z" />
    </Svg>
  );
}

export function TrashIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 1.5h4l1 1.5h3v2H2v-2h3l1-1.5zM3 6h10l-1 8.5H4L3 6zm3 1.5v6h1.2v-6H6zm2.8 0v6H10v-6H8.8z" />
    </Svg>
  );
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3.2 5.5h9.6L8 11.2 3.2 5.5z" />
    </Svg>
  );
}

export function ArrowLeftIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M7 2 1 8l6 6v-4h8V6H7V2z" />
    </Svg>
  );
}

export function ArrowRightIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M9 2v4H1v4h8v4l6-6-6-6z" />
    </Svg>
  );
}

export function ReloadIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M8 2.5a5.5 5.5 0 0 1 4.6 2.4l1.6-1.6v4.7H9.5L11.4 6A4 4 0 1 0 12 8h1.5A5.5 5.5 0 1 1 8 2.5z" />
    </Svg>
  );
}

export function StopIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 3h10v10H3z" />
    </Svg>
  );
}

export function FileIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 1.5h6.5L13 5v9.5H3v-13zm6 1v3h3l-3-3z" />
    </Svg>
  );
}

export function GitBranchIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 2a2 2 0 0 1 .8 3.8v4.4a2 2 0 1 1-1.6 0V5.8A2 2 0 0 1 4 2zm8 0a2 2 0 0 1 .8 3.8C12.6 8.5 10.5 9 8.8 9.2A2 2 0 1 1 7.4 7.7c1.5-.2 3.2-.6 3.7-2A2 2 0 0 1 12 2z" />
    </Svg>
  );
}

export function PinIcon(props: IconProps) {
  // A solid bookmark-style flag - reads far cleaner than a thumbtack at row size.
  return (
    <Svg {...props}>
      <path d="M4 2h8v12l-4-3-4 3V2z" />
    </Svg>
  );
}

export function PinOffIcon(props: IconProps) {
  // Same bookmark with a diagonal slash cut through it. The bookmark and the
  // diagonal bar are one even-odd path: where they overlap the winding cancels,
  // leaving a transparent groove that reads as the slash, while the bar's ends
  // extend past the bookmark to complete the stroke.
  return (
    <Svg {...props}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M4 2h8v12l-4-3-4 3V2zM1.8 13.1 13.1 1.8l1.1 1.1L2.9 14.2z"
      />
    </Svg>
  );
}

/* -------------------------------------------------------------------------
 * Navigation glyphs.
 *
 * The sidebar previously ran on lucide's stroked icons while everything inside
 * the agent surface used this solid set, so the two halves of the window spoke
 * different visual languages. These fill the gap: same 16px box, same solid
 * fill, distinct silhouettes so a row is identifiable at 13px without reading
 * its label.
 * ---------------------------------------------------------------------- */

/** Status — a beacon: ring plus centre dot, read as "system is reporting". */
export function StatusIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path
        fillRule="evenodd"
        d="M8 1.4a6.6 6.6 0 1 0 0 13.2A6.6 6.6 0 0 0 8 1.4Zm0 1.8a4.8 4.8 0 1 1 0 9.6 4.8 4.8 0 0 1 0-9.6Zm0 2.7a2.1 2.1 0 1 0 0 4.2 2.1 2.1 0 0 0 0-4.2Z"
      />
    </Svg>
  );
}

/** Automations — a bolt: something fires without you. */
export function AutomationsIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M9.8 1 3.4 9.2h3.4L6 15l6.6-8.6H9.2L9.8 1Z" />
    </Svg>
  );
}

/** Usage — a bar chart, the shape the page itself draws. */
export function UsageIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M2 9h3v5H2V9Zm4.5-3.5h3V14h-3V5.5ZM11 2.5h3V14h-3V2.5Z" />
    </Svg>
  );
}

/** New task — a solid tile with the plus knocked out of it. */
export function NewTaskIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path
        fillRule="evenodd"
        d="M2 2.5h12v11H2v-11Zm5.25 2.75V7.5H5V9h2.25v2.25h1.5V9H11V7.5H8.75V5.25h-1.5Z"
      />
    </Svg>
  );
}

/** Settings — a cog, the one place the machinery metaphor is still right. */
export function SettingsIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path
        fillRule="evenodd"
        d="m6.9 1 -.3 1.9-1.3.75L3.5 3l-1.6 2.8 1.5 1.2v1.5l-1.5 1.2L3.5 12.5l1.8-.65 1.3.75.3 1.9h3.2l.3-1.9 1.3-.75 1.8.65 1.6-2.8-1.5-1.2V7l1.5-1.2L13.5 3l-1.8.65-1.3-.75L10.1 1H6.9Zm1.1 4.6a2.4 2.4 0 1 0 0 4.8 2.4 2.4 0 0 0 0-4.8Z"
      />
    </Svg>
  );
}

/** Search — solid lens, matched to the nav's weight rather than lucide's hairline. */
export function SearchIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path
        fillRule="evenodd"
        d="M7 1.4a5.6 5.6 0 1 0 3.35 10.09l3.08 3.08 1.13-1.13-3.08-3.08A5.6 5.6 0 0 0 7 1.4Zm0 1.8a3.8 3.8 0 1 1 0 7.6 3.8 3.8 0 0 1 0-7.6Z"
      />
    </Svg>
  );
}

/** Notifications — solid bell. */
export function BellIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M8 1a1.1 1.1 0 0 1 1.1 1.1v.45A4.2 4.2 0 0 1 12.2 6.6v3l1.3 1.75v.9H2.5v-.9L3.8 9.6v-3a4.2 4.2 0 0 1 3.1-4.05V2.1A1.1 1.1 0 0 1 8 1Zm0 14a2 2 0 0 1-1.94-1.5h3.88A2 2 0 0 1 8 15Z" />
    </Svg>
  );
}

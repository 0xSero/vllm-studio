// CRITICAL
"use client";

import {
  useRef,
  useEffect,
  useState,
  createContext,
  useContext,
  type ComponentType,
  type ReactNode,
} from "react";
import { ChevronDown } from "lucide-react";

interface DropdownContextType {
  close: () => void;
}

const DropdownContext = createContext<DropdownContextType | null>(null);

interface ToolDropdownProps {
  icon: ComponentType<{ className?: string }>;
  label: string;
  isActive?: boolean;
  disabled?: boolean;
  showChevron?: boolean;
  buttonVariant?: "default" | "circle";
  buttonClassName?: string;
  children: ReactNode;
}

export function ToolDropdown({
  icon: Icon,
  label,
  isActive,
  disabled,
  showChevron = true,
  buttonVariant = "default",
  buttonClassName,
  children,
}: ToolDropdownProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  const close = () => setOpen(false);

  // eslint-disable-next-line no-restricted-syntax -- dropdowns need a document listener to close on outside clicks.
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;

      // Don't close if clicking on a select element or its options
      // (native select dropdowns render outside the container)
      if (
        target instanceof HTMLElement &&
        (target.tagName === "SELECT" ||
          target.tagName === "OPTION" ||
          target.closest("select") !== null)
      ) {
        return;
      }

      if (ref.current && !ref.current.contains(target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <DropdownContext.Provider value={{ close }}>
      <div ref={ref} className="relative">
        <button
          onClick={() => setOpen((prev) => !prev)}
          disabled={disabled}
          className={
            buttonVariant === "circle"
              ? [
                  "h-10 w-10 rounded-full flex items-center justify-center",
                  "bg-(--ui-fg)/[0.06] text-(--ui-muted)",
                  "hover:bg-(--ui-fg)/10 hover:text-(--ui-fg) transition-colors disabled:opacity-50",
                  isActive ? "text-(--ui-fg)" : "",
                  buttonClassName ?? "",
                ].join(" ")
              : [
                  "flex items-center gap-1 px-2 py-1.5 rounded-lg transition-all:ease-in:200ms disabled:opacity-50",
                  isActive
                    ? "bg-(--ui-fg)/[0.06] text-(--ui-fg)"
                    : "text-(--ui-muted) hover:bg-(--ui-fg)/5",
                  buttonClassName ?? "",
                ].join(" ")
          }
          title={label}
        >
          <Icon className={buttonVariant === "circle" ? "h-4 w-4" : "h-3.5 w-3.5"} />
          {showChevron && buttonVariant !== "circle" && (
            <ChevronDown
              className={`h-2.5 w-2.5 transition-transform:ease-in:150ms ${open ? "rotate-180" : ""}`}
            />
          )}
        </button>
        {open && (
          <div
            className="absolute bottom-full left-0 z-50 mb-1 min-w-[180px] rounded-xl border border-(--ui-border) bg-(--ui-surface) py-1.5"
            style={{ boxShadow: "0 12px 40px rgba(0,0,0,0.4)" }}
          >
            {children}
          </div>
        )}
      </div>
    </DropdownContext.Provider>
  );
}

interface DropdownItemProps {
  icon: ComponentType<{ className?: string }>;
  label: string;
  isActive?: boolean;
  onClick?: () => void;
  disabled?: boolean;
  closeOnClick?: boolean;
}

export function DropdownItem({
  icon: Icon,
  label,
  isActive,
  onClick,
  disabled,
  closeOnClick = false,
}: DropdownItemProps) {
  const context = useContext(DropdownContext);

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    onClick?.();
    if (closeOnClick) {
      context?.close();
    }
  };

  return (
    <button
      onClick={handleClick}
      disabled={disabled}
      className={`w-full flex items-center gap-2.5 px-3 py-2 font-sans text-[13px] transition-colors:ease-in:200ms disabled:opacity-50 ${
        isActive ? "text-(--ui-fg)" : "text-(--ui-muted) hover:bg-(--ui-fg)/5 hover:text-(--ui-fg)"
      }`}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="truncate">{label}</span>
      {isActive && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-(--ui-accent)" />}
    </button>
  );
}

export type { ToolDropdownProps, DropdownItemProps };

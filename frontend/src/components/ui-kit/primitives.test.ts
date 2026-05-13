import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement, type ReactNode } from "react";
import { UiInsetSurface, UiModal, UiModalHeader, UiPanelSurface } from "./index";

describe("ui-kit primitives", () => {
  it("renders inset surface with shared frame style", () => {
    const html = renderToStaticMarkup(
      createElement(
        UiInsetSurface as (props: { className?: string; children?: ReactNode }) => ReactNode,
        { className: "test-surface" },
        createElement("span", null, "surface content"),
      ),
    );

    expect(html).toContain("rounded-lg border border-(--border) bg-(--bg) p-4");
    expect(html).toContain("test-surface");
    expect(html).toContain("surface content");
  });

  it("does not render modal markup when closed", () => {
    const html = renderToStaticMarkup(
      createElement(
        UiModal as (props: {
          isOpen: boolean;
          onClose: () => void;
          children?: ReactNode;
        }) => ReactNode,
        { isOpen: false, onClose: () => {} },
        createElement("div", null, "hidden"),
      ),
    );
    expect(html).toBe("");
  });

  it("renders modal header with title and close button", () => {
    const html = renderToStaticMarkup(
      createElement(UiModalHeader, {
        title: "Working",
        onClose: () => {},
      }),
    );
    expect(html).toContain("Working");
    expect(html).toContain('aria-label="Close"');
    expect(html).toContain("×");
  });

  it("renders panel surface with consistent framing class", () => {
    const html = renderToStaticMarkup(
      createElement(
        UiPanelSurface as (props: { className?: string; children?: ReactNode }) => ReactNode,
        { className: "panel" },
        createElement("span", null, "content"),
      ),
    );
    expect(html).toContain("rounded-lg border border-(--border) bg-(--surface)");
    expect(html).toContain("panel");
  });
});

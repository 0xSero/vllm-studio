// Browser-side scripts injected via Runtime.evaluate. Authored as plain string
// templates (not stringified TS functions) on purpose: esbuild/tsx instruments
// nested named functions with `__name()` calls for stack traces, which are not
// defined in the page realm and would throw a ReferenceError when shipped over
// CDP. Raw strings are immune to that transform.
//
// Snapshot/click/fill approach adapted from Ghostex (MIT, maddada).

export type SnapshotElement = {
  ref: string;
  role: string;
  label: string;
  selector: string;
  value?: string;
  disabled?: boolean;
};

export type SnapshotResult = { url: string; title: string; elements: SnapshotElement[] };

// Each script is an arrow function expression; callers invoke it as
// `(${SCRIPT})(...JSON.stringify(args))`.

// Walk visible interactive elements and assign stable @e1..@eN refs with a CSS
// selector for each. Returns { url, title, elements }.
export const SNAPSHOT_SCRIPT = `(limit) => {
  const selectors = [
    "a[href]", "button", "input", "textarea", "select",
    "[role]", "[onclick]", "[contenteditable='true']",
    "[tabindex]:not([tabindex='-1'])"
  ].join(",");
  const cssPath = (element) => {
    const parts = [];
    let cursor = element;
    while (cursor && cursor.nodeType === 1 && cursor !== document.documentElement) {
      let part = cursor.nodeName.toLowerCase();
      if (cursor.id) { parts.unshift(part + "#" + CSS.escape(cursor.id)); break; }
      const parent = cursor.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter((child) => child.nodeName === cursor.nodeName);
        if (siblings.length > 1) part += ":nth-of-type(" + (siblings.indexOf(cursor) + 1) + ")";
      }
      parts.unshift(part);
      cursor = parent;
    }
    return parts.join(" > ");
  };
  const labelFor = (element) => {
    const aria = element.getAttribute("aria-label");
    if (aria) return aria.trim();
    if (element.id) {
      const label = document.querySelector('label[for="' + CSS.escape(element.id) + '"]');
      if (label && label.innerText) return label.innerText.trim();
    }
    return (element.innerText || element.value || element.placeholder || element.title || "").trim().replace(/\\s+/g, " ");
  };
  const elements = [];
  for (const element of Array.from(document.querySelectorAll(selectors))) {
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    if (rect.width <= 0 || rect.height <= 0 || style.visibility === "hidden" || style.display === "none") continue;
    elements.push({
      ref: "@e" + (elements.length + 1),
      role: element.getAttribute("role") || element.nodeName.toLowerCase(),
      label: labelFor(element).slice(0, 240),
      selector: cssPath(element),
      value: ("value" in element) ? String(element.value == null ? "" : element.value).slice(0, 240) : undefined,
      disabled: Boolean(element.disabled || element.getAttribute("aria-disabled") === "true")
    });
    if (elements.length >= limit) break;
  }
  return { url: location.href, title: document.title, elements };
}`;

// Scroll into view, focus, and click an element by selector. Returns { found }.
export const CLICK_SCRIPT = `(selector) => {
  const element = document.querySelector(selector);
  if (!element) return { found: false };
  element.scrollIntoView({ block: "center", inline: "center" });
  if (element.focus) element.focus();
  element.click();
  return { found: true };
}`;

// Fill an input/textarea/select/contenteditable by selector, dispatching the
// input + change events frameworks rely on. Returns { found }.
export const FILL_SCRIPT = `(selector, value) => {
  const element = document.querySelector(selector);
  if (!element) return { found: false };
  element.scrollIntoView({ block: "center", inline: "center" });
  if (element.focus) element.focus();
  if (element.isContentEditable) {
    element.textContent = value;
  } else if (element.tagName === "SELECT" || ("value" in element)) {
    element.value = value;
  } else {
    return { found: false };
  }
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
  return { found: true };
}`;

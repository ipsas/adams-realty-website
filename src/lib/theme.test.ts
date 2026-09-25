import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type KeyValueStorage, STORE_KEYS, subscribe } from "@/lib/local-store";
import {
  type ThemeDocument,
  applyTheme,
  markSwitching,
  parseThemePref,
  readResolvedTheme,
  readThemePref,
  resolveTheme,
  setChromeColor,
  watchTheme,
  writeThemePref,
} from "@/lib/theme";
import { THEME_COLOR_OVERRIDE_ID, THEME_COLORS, THEME_SCRIPT } from "@/lib/theme-script";

// ── Fakes ────────────────────────────────────────────────────────────────────

function mapStorage(init: Record<string, string> = {}) {
  const map = new Map(Object.entries(init));
  const storage: KeyValueStorage = {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
  return { map, storage };
}

const throwingStorage: KeyValueStorage = {
  getItem: () => {
    throw new Error("SecurityError");
  },
  setItem: () => {
    throw new Error("QuotaExceeded");
  },
  removeItem: () => {
    throw new Error("SecurityError");
  },
};

/** Just enough DOM: attributes, and a <head> whose children can be inserted and removed. */
class FakeElement {
  attrs = new Map<string, string>();
  parent: FakeHead | null = null;
  constructor(readonly tagName = "HTML") {}
  getAttribute(name: string) {
    return this.attrs.get(name) ?? null;
  }
  setAttribute(name: string, value: string) {
    this.attrs.set(name, String(value));
  }
  removeAttribute(name: string) {
    this.attrs.delete(name);
  }
  hasAttribute(name: string) {
    return this.attrs.has(name);
  }
  remove() {
    this.parent?.removeChild(this);
  }
  // The head script assigns properties, applyTheme sets attributes: both land in attrs.
  get id() {
    return this.getAttribute("id") ?? "";
  }
  set id(v: string) {
    this.setAttribute("id", v);
  }
  get name() {
    return this.getAttribute("name") ?? "";
  }
  set name(v: string) {
    this.setAttribute("name", v);
  }
  get content() {
    return this.getAttribute("content") ?? "";
  }
  set content(v: string) {
    this.setAttribute("content", v);
  }
}

class FakeHead {
  children: FakeElement[] = [];
  get firstChild() {
    return this.children[0] ?? null;
  }
  insertBefore(el: FakeElement, ref: FakeElement | null) {
    this.removeChild(el);
    const i = ref ? this.children.indexOf(ref) : -1;
    this.children.splice(i < 0 ? this.children.length : i, 0, el);
    el.parent = this;
  }
  removeChild(el: FakeElement) {
    const i = this.children.indexOf(el);
    if (i >= 0) this.children.splice(i, 1);
    el.parent = null;
  }
}

function fakeDocument() {
  const head = new FakeHead();
  // The layout's media-query pair, already in <head> when the script runs.
  for (const [scheme, color] of Object.entries(THEME_COLORS)) {
    const m = new FakeElement("META");
    m.name = "theme-color";
    m.content = color;
    m.setAttribute("media", `(prefers-color-scheme: ${scheme})`);
    head.insertBefore(m, null);
  }
  const root = new FakeElement("HTML");
  const doc = {
    documentElement: root,
    head,
    getElementById: (id: string) => head.children.find((c) => c.id === id) ?? null,
    createElement: (tag: string) => new FakeElement(tag.toUpperCase()),
  };
  return { doc, root, head, asDoc: doc as unknown as ThemeDocument };
}

/** The content of the first theme-color meta: the one browsers use when media allows. */
function firstThemeColor(head: FakeHead) {
  const m = head.children.find((c) => c.name === "theme-color");
  return m && !m.hasAttribute("media") ? m.content : `media:${m?.content}`;
}

function manualFrames() {
  const queue: (() => void)[] = [];
  return {
    frame: (cb: () => void) => void queue.push(cb),
    flush() {
      const run = queue.splice(0);
      run.forEach((cb) => cb());
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  setChromeColor(null, fakeDocument().asDoc);
});

// ── Preferences ──────────────────────────────────────────────────────────────

describe("parseThemePref", () => {
  it("accepts light and dark, and reads anything else as Match my device", () => {
    expect(parseThemePref("light")).toBe("light");
    expect(parseThemePref("dark")).toBe("dark");
    expect(parseThemePref("system")).toBe("system");
    for (const v of ["blue", "DARK", 1, 0, null, undefined, {}, ["dark"]]) {
      expect(parseThemePref(v)).toBe("system");
    }
  });
});

describe("resolveTheme", () => {
  it.each([
    ["system", false, "light"],
    ["system", true, "dark"],
    ["light", false, "light"],
    ["light", true, "light"],
    ["dark", false, "dark"],
    ["dark", true, "dark"],
  ] as const)("%s with a dark OS=%s is %s", (pref, systemDark, expected) => {
    expect(resolveTheme(pref, systemDark)).toBe(expected);
  });
});

describe("readResolvedTheme", () => {
  const os = (dark: boolean) => ({
    matchMedia: (q: string) =>
      ({ matches: dark && q === "(prefers-color-scheme: dark)" }) as MediaQueryList,
  });
  it("combines the stored choice with the OS, synchronously", () => {
    expect(readResolvedTheme(mapStorage().storage, os(true))).toBe("dark");
    expect(readResolvedTheme(mapStorage().storage, os(false))).toBe("light");
    expect(readResolvedTheme(mapStorage({ [STORE_KEYS.theme]: '"light"' }).storage, os(true))).toBe(
      "light",
    );
    expect(readResolvedTheme(mapStorage({ [STORE_KEYS.theme]: '"dark"' }).storage, os(false))).toBe(
      "dark",
    );
  });
  it("falls back to light with no matchMedia and a throwing store", () => {
    expect(readResolvedTheme(throwingStorage, {} as Pick<Window, "matchMedia">)).toBe("light");
    expect(readResolvedTheme(throwingStorage, os(true))).toBe("dark");
  });
});

describe("readThemePref / writeThemePref", () => {
  it("reads the stored JSON string, and anything malformed as system", () => {
    expect(readThemePref(mapStorage().storage)).toBe("system");
    expect(readThemePref(mapStorage({ [STORE_KEYS.theme]: '"dark"' }).storage)).toBe("dark");
    expect(readThemePref(mapStorage({ [STORE_KEYS.theme]: '"light"' }).storage)).toBe("light");
    expect(readThemePref(mapStorage({ [STORE_KEYS.theme]: "dark" }).storage)).toBe("system");
    expect(readThemePref(mapStorage({ [STORE_KEYS.theme]: '"blue"' }).storage)).toBe("system");
    expect(readThemePref(throwingStorage)).toBe("system");
    expect(readThemePref(null)).toBe("system");
  });

  it("writes JSON, removes the key for system, and notifies subscribers", () => {
    const { map, storage } = mapStorage();
    const cb = vi.fn();
    const off = subscribe(STORE_KEYS.theme, cb);
    writeThemePref("dark", storage);
    expect(map.get(STORE_KEYS.theme)).toBe('"dark"');
    writeThemePref("light", storage);
    expect(map.get(STORE_KEYS.theme)).toBe('"light"');
    writeThemePref("system", storage);
    expect(map.has(STORE_KEYS.theme)).toBe(false);
    expect(cb).toHaveBeenCalledTimes(3);
    off();
    expect(() => writeThemePref("dark", throwingStorage)).not.toThrow();
  });
});

// ── DOM ──────────────────────────────────────────────────────────────────────

describe("applyTheme", () => {
  it("sets data-theme and a first, media-less theme-color for a forced theme", () => {
    const { root, head, asDoc } = fakeDocument();
    const frames = manualFrames();
    applyTheme("dark", asDoc, frames.frame);
    expect(root.getAttribute("data-theme")).toBe("dark");
    expect(head.firstChild?.id).toBe(THEME_COLOR_OVERRIDE_ID);
    expect(firstThemeColor(head)).toBe(THEME_COLORS.dark);

    applyTheme("light", asDoc, frames.frame);
    expect(root.getAttribute("data-theme")).toBe("light");
    expect(firstThemeColor(head)).toBe(THEME_COLORS.light);
    expect(head.children.filter((c) => c.id === THEME_COLOR_OVERRIDE_ID)).toHaveLength(1);
  });

  it("system removes the attribute and the override, leaving the media-query pair", () => {
    const { root, head, asDoc } = fakeDocument();
    applyTheme("dark", asDoc, manualFrames().frame);
    applyTheme("system", asDoc, manualFrames().frame);
    expect(root.hasAttribute("data-theme")).toBe(false);
    expect(head.children.some((c) => c.id === THEME_COLOR_OVERRIDE_ID)).toBe(false);
    expect(head.children.map((c) => c.content)).toEqual([THEME_COLORS.light, THEME_COLORS.dark]);
  });

  it("marks the switch for two frames so no colour fades, only when the theme changes", () => {
    const { root, asDoc } = fakeDocument();
    const frames = manualFrames();
    applyTheme("dark", asDoc, frames.frame);
    expect(root.hasAttribute("data-theme-switching")).toBe(true);
    frames.flush();
    expect(root.hasAttribute("data-theme-switching")).toBe(true);
    frames.flush();
    expect(root.hasAttribute("data-theme-switching")).toBe(false);
    applyTheme("dark", asDoc, frames.frame);
    expect(root.hasAttribute("data-theme-switching")).toBe(false);
  });

  it("re-inserts the override first if something moved it", () => {
    const { head, asDoc } = fakeDocument();
    applyTheme("dark", asDoc, manualFrames().frame);
    const meta = head.firstChild!;
    head.insertBefore(meta, null);
    applyTheme("dark", asDoc, manualFrames().frame);
    expect(head.firstChild).toBe(meta);
  });
});

describe("setChromeColor", () => {
  it("wins over the theme until cleared, then the theme's colour returns", () => {
    const { head, asDoc } = fakeDocument();
    setChromeColor("#0f2a20", asDoc);
    expect(firstThemeColor(head)).toBe("#0f2a20");
    applyTheme("dark", asDoc, manualFrames().frame);
    expect(firstThemeColor(head)).toBe("#0f2a20");
    setChromeColor(null, asDoc);
    expect(firstThemeColor(head)).toBe(THEME_COLORS.dark);
    applyTheme("system", asDoc, manualFrames().frame);
    expect(firstThemeColor(head)).toBe(`media:${THEME_COLORS.light}`);
  });
});

describe("markSwitching", () => {
  it("clears itself after two frames", () => {
    const { root, asDoc } = fakeDocument();
    const frames = manualFrames();
    markSwitching(asDoc, frames.frame);
    frames.flush();
    frames.flush();
    expect(root.hasAttribute("data-theme-switching")).toBe(false);
  });
});

describe("watchTheme", () => {
  function fakeWindow() {
    const win = new EventTarget() as EventTarget & { matchMedia: (q: string) => unknown };
    const mql = Object.assign(new EventTarget(), { matches: false, media: "" });
    win.matchMedia = () => mql;
    vi.stubGlobal("window", win);
    return { win: win as unknown as Window, mql };
  }

  it("applies the stored preference at once", () => {
    const { win } = fakeWindow();
    const { root, asDoc } = fakeDocument();
    const off = watchTheme(win, asDoc, mapStorage({ [STORE_KEYS.theme]: '"dark"' }).storage);
    expect(root.getAttribute("data-theme")).toBe("dark");
    off();
  });

  it("follows a write in another tab (storage event)", () => {
    const { win } = fakeWindow();
    const { root, asDoc } = fakeDocument();
    const { map, storage } = mapStorage();
    const off = watchTheme(win, asDoc, storage);
    map.set(STORE_KEYS.theme, '"dark"');
    win.dispatchEvent(Object.assign(new Event("storage"), { key: STORE_KEYS.theme }));
    expect(root.getAttribute("data-theme")).toBe("dark");
    // Another tab clearing storage means Match my device.
    map.clear();
    win.dispatchEvent(Object.assign(new Event("storage"), { key: null }));
    expect(root.hasAttribute("data-theme")).toBe(false);
    off();
  });

  it("re-syncs a page restored from the back/forward cache, and only then", () => {
    const { win } = fakeWindow();
    const { root, asDoc } = fakeDocument();
    const { map, storage } = mapStorage({ [STORE_KEYS.theme]: '"light"' });
    const off = watchTheme(win, asDoc, storage);
    expect(root.getAttribute("data-theme")).toBe("light");
    // Changed while this page was frozen: no storage event reached it.
    map.set(STORE_KEYS.theme, '"dark"');
    win.dispatchEvent(Object.assign(new Event("pageshow"), { persisted: false }));
    expect(root.getAttribute("data-theme")).toBe("light");
    win.dispatchEvent(Object.assign(new Event("pageshow"), { persisted: true }));
    expect(root.getAttribute("data-theme")).toBe("dark");
    off();
    map.set(STORE_KEYS.theme, '"light"');
    win.dispatchEvent(Object.assign(new Event("pageshow"), { persisted: true }));
    win.dispatchEvent(Object.assign(new Event("storage"), { key: STORE_KEYS.theme }));
    expect(root.getAttribute("data-theme")).toBe("dark");
  });

  it("marks an OS scheme change as a switch without touching data-theme", () => {
    const { win, mql } = fakeWindow();
    const { root, asDoc } = fakeDocument();
    const off = watchTheme(win, asDoc, mapStorage().storage);
    mql.dispatchEvent(new Event("change"));
    expect(root.hasAttribute("data-theme-switching")).toBe(true);
    expect(root.hasAttribute("data-theme")).toBe(false);
    off();
  });
});

// ── The head script ──────────────────────────────────────────────────────────

describe("THEME_SCRIPT", () => {
  function run(storage: KeyValueStorage) {
    const { doc, root, head } = fakeDocument();
    new Function("localStorage", "document", THEME_SCRIPT)(storage, doc);
    return { root, head };
  }

  it("is plain ES5 (no arrows, let/const or template literals)", () => {
    expect(THEME_SCRIPT).not.toMatch(/=>|\blet\b|\bconst\b|`/);
  });

  it("forces dark: attribute plus a first theme-color of the dark canvas", () => {
    const { root, head } = run(mapStorage({ [STORE_KEYS.theme]: '"dark"' }).storage);
    expect(root.getAttribute("data-theme")).toBe("dark");
    expect(head.firstChild?.id).toBe(THEME_COLOR_OVERRIDE_ID);
    expect(firstThemeColor(head)).toBe("#0f1412");
  });

  it("forces light the same way", () => {
    const { root, head } = run(mapStorage({ [STORE_KEYS.theme]: '"light"' }).storage);
    expect(root.getAttribute("data-theme")).toBe("light");
    expect(firstThemeColor(head)).toBe("#fbfaf7");
  });

  it.each([
    ["no key", {}],
    ["garbage", { [STORE_KEYS.theme]: "{nope" }],
    ["an unknown value", { [STORE_KEYS.theme]: '"blue"' }],
    ["an unquoted value", { [STORE_KEYS.theme]: "dark" }],
  ])("leaves Match my device alone with %s", (_, init) => {
    const { root, head } = run(mapStorage(init).storage);
    expect(root.hasAttribute("data-theme")).toBe(false);
    expect(head.children).toHaveLength(2);
  });

  it("survives a throwing store", () => {
    expect(() => run(throwingStorage)).not.toThrow();
    expect(run(throwingStorage).root.hasAttribute("data-theme")).toBe(false);
  });

  it("reads the registered key", () => {
    expect(STORE_KEYS.theme).toBe("ar:theme");
    expect(THEME_SCRIPT).toContain(JSON.stringify(STORE_KEYS.theme));
  });
});

// ── Drift between CSS, script and modules ────────────────────────────────────

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");
const css = read("src/app/globals.css");

/** The body of the first `{ … }` block that starts at `from` (brace-matched). */
function block(source: string, from: number) {
  const open = source.indexOf("{", from);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) return source.slice(open + 1, i);
  }
  throw new Error("unbalanced");
}

const themeBlock = block(css, css.indexOf("@theme {"));
const darkBlock = block(css, css.indexOf("@variant dark", css.indexOf("\n:root {")));
const tokenIn = (source: string, name: string) =>
  source.match(new RegExp(`(?:^|\\s)--${name}:\\s*([^;]+);`))?.[1].trim();

describe("globals.css", () => {
  it("THEME_COLORS equal --color-canvas in light and dark", () => {
    expect(tokenIn(themeBlock, "color-canvas")).toBe(THEME_COLORS.light);
    expect(tokenIn(darkBlock, "color-canvas")).toBe(THEME_COLORS.dark);
  });

  it("the dark variant has both branches, each screen-only, and print is light", () => {
    const variant = block(css, css.indexOf("@custom-variant dark"));
    expect(variant).toMatch(
      /@media screen\s*\{\s*&:where\(\[data-theme="dark"\], \[data-theme="dark"\] \*\)/,
    );
    expect(variant).toMatch(
      /@media screen and \(prefers-color-scheme: dark\)\s*\{\s*&:where\(:root:not\(\[data-theme="light"\]\), :root:not\(\[data-theme="light"\]\) \*\)/,
    );
    expect(css).toMatch(/@media print\s*\{\s*:root\s*\{\s*color-scheme: light;/);
  });

  it("never redefines --background-color-*, which gradient stops also read", () => {
    expect(css).not.toMatch(/--background-color-[\w-]+\s*:/);
  });

  it("keeps fills fixed: brand-400…900, clay-500/600 and shade are not redefined in dark", () => {
    for (const t of ["400", "500", "600", "700", "800", "900"]) {
      expect(tokenIn(darkBlock, `color-brand-${t}`)).toBeUndefined();
    }
    expect(tokenIn(darkBlock, "color-clay-500")).toBeUndefined();
    expect(tokenIn(darkBlock, "color-clay-600")).toBeUndefined();
    expect(tokenIn(darkBlock, "color-shade")).toBeUndefined();
  });

  it("new role tokens equal today's palette in light", () => {
    const light = (n: string) => tokenIn(themeBlock, n);
    expect(light("color-shade")).toBe(light("color-ink"));
    expect(light("color-primary")).toBe(light("color-brand-700"));
    expect(light("color-primary-hover")).toBe(light("color-brand-800"));
    expect(light("color-on-ink")).toBe("#ffffff");
    for (const [ns, t] of [
      ["text-color", "brand-200"],
      ["text-color", "brand-500"],
      ["text-color", "brand-600"],
      ["text-color", "brand-700"],
      ["text-color", "brand-800"],
      ["text-color", "brass-100"],
      ["text-color", "clay-500"],
      ["text-color", "clay-600"],
      ["text-color", "status-soon"],
      ["border-color", "brand-500"],
      ["border-color", "brand-600"],
      ["border-color", "brand-700"],
      ["outline-color", "brand-500"],
      ["ring-color", "brand-100"],
      ["ring-color", "brand-500"],
      ["text-decoration-color", "brand-200"],
      ["text-decoration-color", "brand-600"],
      ["accent-color", "brand-700"],
    ]) {
      expect(light(`${ns}-${t}`), `--${ns}-${t}`).toBe(light(`color-${t}`));
    }
    expect(tokenIn(darkBlock, "color-primary")).toBe("#2f7558");
    expect(tokenIn(darkBlock, "color-primary-hover")).toBe("#1f5d45");
  });
});

describe("module boundaries", () => {
  const imports = (p: string) => [...read(p).matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);

  it("the server layout's theme modules are React-free", () => {
    expect(imports("src/lib/store-keys.ts")).toEqual([]);
    expect(imports("src/lib/theme-script.ts")).toEqual(["@/lib/store-keys"]);
  });

  it("the root layout imports no module that pulls in React hooks", () => {
    const layout = imports("src/app/layout.tsx");
    expect(layout).toContain("@/lib/theme-script");
    for (const banned of ["@/lib/theme", "@/lib/local-store", "@/components/theme/use-theme"]) {
      expect(layout).not.toContain(banned);
    }
  });
});

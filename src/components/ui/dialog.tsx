"use client";

import { X } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { cn } from "@/lib/cn";
import { PHONE_QUERY } from "@/lib/use-media-query";
import { registerToastHost } from "./toast";

/*
 * Native <dialog> wrapper: focus trapping, Escape and the backdrop come from the browser.
 *
 * Wide screens: a centered card (unchanged). Phone variant (`mobile` prop):
 * - "sheet" (default): bottom sheet with a grab handle; swipe the handle/header down to close.
 * - "fullscreen": covers the viewport (below the status bar via pt-safe).
 * - "center": the centered card, as on wide screens.
 * Sheets and full-screen dialogs sit above the on-screen keyboard (--kb-inset from visualViewport).
 *
 * History (`closeOnBack`): opening pushes a same-URL history entry, so Back / Android back closes
 * the dialog instead of leaving the page. Close through the controls, never by hand:
 * - requestClose(): what X, scrim, Escape and swipe do. Pops our entry when it's on top and
 *   resolves after popstate.
 * - close({ viaNavigation: true }): the caller already replaced our entry; close without popping.
 * - navigateFromDialog(href, { replace }): pop first, then router.push/replace. Use it for every
 *   link inside a closeOnBack dialog so one Back returns to where the dialog was opened.
 * Children get these via useDialogControls(); custom dialogs (the lightbox) use useDialogHistory().
 * Setting `open` to false from the parent also pops the entry when it's on top.
 */

export type DialogMobile = "sheet" | "fullscreen" | "center";

export type DialogControls = {
  /** Close as if dismissed by the user. Pops this dialog's history entry when it's on top. */
  requestClose: () => Promise<void>;
  /** Close now. `viaNavigation: true` = the caller already replaced the entry; don't pop. */
  close: (opts?: { viaNavigation?: boolean }) => void;
  /** Close (popping our entry first), then router.push — or router.replace with `replace`. */
  navigateFromDialog: (href: string, opts?: { replace?: boolean }) => Promise<void>;
};

/* ───────────────────────── pure helpers (unit-tested) ───────────────────────── */

/** Height of the on-screen keyboard (or anything else covering the layout viewport's bottom). */
export function keyboardInset(innerHeight: number, vvHeight: number, vvOffsetTop: number): number {
  const inset = innerHeight - vvHeight - vvOffsetTop;
  return Number.isFinite(inset) ? Math.max(0, Math.round(inset)) : 0;
}

export const SWIPE_CLOSE_DISTANCE = 96; // px
export const SWIPE_CLOSE_VELOCITY = 0.5; // px/ms

/** Whether a downward drag of `dy` px, ending at `velocity` px/ms, should dismiss a sheet. */
export function shouldDismissSwipe(dy: number, velocity: number): boolean {
  return dy > SWIPE_CLOSE_DISTANCE || (dy > 16 && velocity > SWIPE_CLOSE_VELOCITY);
}

/**
 * scrollTop that brings [top, bottom] (relative to the scroller's content) into a viewport
 * of `height` currently scrolled to `scrollTop`, moving as little as possible ("nearest").
 */
export function nearestScrollTop(
  scrollTop: number,
  height: number,
  top: number,
  bottom: number,
  margin = 12,
): number {
  if (top - margin < scrollTop) return Math.max(0, top - margin);
  if (bottom + margin > scrollTop + height) {
    // Taller than the viewport: align the top.
    return bottom - top + 2 * margin > height ? top - margin : bottom + margin - height;
  }
  return scrollTop;
}

/**
 * Like el.scrollIntoView({ block: "nearest" }), but only scrolls containers inside `root`,
 * so the locked page behind a dialog never moves.
 */
function revealWithin(root: HTMLElement, el: Element | null) {
  if (!(el instanceof HTMLElement) || el === root || !root.contains(el)) return;
  for (let box = el.parentElement; box && box !== root; box = box.parentElement) {
    const { overflowY } = getComputedStyle(box);
    if (!/(auto|scroll)/.test(overflowY) || box.scrollHeight <= box.clientHeight) continue;
    const b = box.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const top = r.top - b.top - box.clientTop + box.scrollTop;
    box.scrollTop = nearestScrollTop(box.scrollTop, box.clientHeight, top, top + r.height);
  }
}

/** The dialog keys stored on a history entry by this module (bottom → top). */
export function dialogKeysOf(state: unknown): string[] {
  const keys = (state as { __dialogs?: unknown } | null)?.__dialogs;
  return Array.isArray(keys) ? keys.filter((k): k is string => typeof k === "string") : [];
}

/* ───────────────────────── history entry manager ───────────────────────── */

type HistoryEntry = { key: string; href: string; onPop: () => void };

// Per-document prefix so entries left over from before a reload never match new dialogs.
const DOC = Math.random().toString(36).slice(2, 8);
let seq = 0;
const entries: HistoryEntry[] = [];
const popWaiters = new Set<() => void>();
let listening = false;

function onPopState(e: PopStateEvent) {
  const keep = dialogKeysOf(e.state);
  // Close every dialog whose entry the user navigated away from (top first).
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (!keep.includes(entry.key)) {
      entries.splice(i, 1);
      entry.onPop();
    }
  }
  [...popWaiters].forEach((resolve) => resolve());
}

function isOnTop(entry: HistoryEntry): boolean {
  if (entries[entries.length - 1] !== entry) return false;
  const state = window.history.state as { __dialog?: string } | null;
  // Next replaces the entry's state on router.refresh()/server actions and drops our keys;
  // the URL is still ours then.
  return state?.__dialog === entry.key || window.location.href === entry.href;
}

function pushEntry(onPop: () => void): HistoryEntry {
  if (!listening) {
    window.addEventListener("popstate", onPopState);
    listening = true;
  }
  const key = `${DOC}-${++seq}`;
  const keys = entries.map((e) => e.key);
  const top = entries[entries.length - 1];
  const state = (window.history.state ?? {}) as Record<string, unknown>;
  // Restore the parent dialog's keys if Next dropped them, so Back from us keeps it open.
  if (top && state.__dialog !== top.key && window.location.href === top.href) {
    window.history.replaceState({ ...state, __dialog: top.key, __dialogs: keys }, "");
  }
  // Spreading the current state keeps Next's __NA/tree keys, so Next treats Back as a
  // same-URL traversal (no reload, no RSC request) and its patched pushState passes through.
  window.history.pushState(
    { ...window.history.state, __dialog: key, __dialogs: [...keys, key] },
    "",
  );
  const entry = { key, href: window.location.href, onPop };
  entries.push(entry);
  return entry;
}

function forgetEntry(entry: HistoryEntry) {
  const i = entries.indexOf(entry);
  if (i !== -1) entries.splice(i, 1);
}

/** history.back() and wait for the resulting popstate (with a safety timeout). */
function popAndWait(timeoutMs = 1000): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      popWaiters.delete(done);
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(done, timeoutMs);
    popWaiters.add(done);
    window.history.back();
  });
}

/**
 * History integration for any modal UI: while `open`, Back closes it (calls `onClose`) and
 * the page stays put. Returns the controls; `onClose` must make `open` false.
 */
export function useDialogHistory(
  open: boolean,
  onClose: () => void,
  { enabled = true }: { enabled?: boolean } = {},
): DialogControls {
  const router = useRouter();
  const onCloseRef = useRef(onClose);
  const entryRef = useRef<HistoryEntry | null>(null);
  const releaseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closing = useRef<Promise<void> | null>(null);

  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open || !enabled) return;
    // A StrictMode re-mount or re-run while still open cancels the pending release.
    if (releaseTimer.current) clearTimeout(releaseTimer.current);
    releaseTimer.current = null;
    closing.current = null;
    if (!entryRef.current) {
      entryRef.current = pushEntry(() => {
        entryRef.current = null;
        onCloseRef.current();
      });
    }
    return () => {
      // Closed by the parent (or unmounted) while our entry is still on top: pop it.
      // Deferred so the StrictMode double-invoke doesn't pop and re-push.
      releaseTimer.current = setTimeout(() => {
        releaseTimer.current = null;
        const entry = entryRef.current;
        if (!entry) return;
        entryRef.current = null;
        const onTop = isOnTop(entry);
        forgetEntry(entry);
        if (onTop) void popAndWait();
      }, 0);
    };
  }, [open, enabled]);

  return useMemo<DialogControls>(() => {
    const finish = () => {
      const entry = entryRef.current;
      if (entry) forgetEntry(entry);
      entryRef.current = null;
      onCloseRef.current();
    };

    const requestClose = (): Promise<void> => {
      if (closing.current) return closing.current;
      const entry = entryRef.current;
      if (!entry || !isOnTop(entry)) {
        finish();
        return Promise.resolve();
      }
      const p = popAndWait().then(() => {
        // Normally popstate already closed us; after the timeout, close anyway.
        if (entryRef.current === entry) finish();
      });
      closing.current = p;
      void p.finally(() => {
        if (closing.current === p) closing.current = null;
      });
      return p;
    };

    return {
      requestClose,
      close: ({ viaNavigation = false } = {}) => {
        if (viaNavigation) finish();
        else void requestClose();
      },
      navigateFromDialog: async (href, { replace = false } = {}) => {
        await requestClose();
        if (replace) router.replace(href);
        else router.push(href);
      },
    };
  }, [router]);
}

const ControlsContext = createContext<DialogControls | null>(null);

/** Controls of the enclosing <Dialog> (requestClose, close, navigateFromDialog). */
export function useDialogControls(): DialogControls {
  const controls = useContext(ControlsContext);
  if (!controls) throw new Error("useDialogControls must be used inside <Dialog>");
  return controls;
}

/* ───────────────────────── component ───────────────────────── */

const mobileClasses: Record<DialogMobile, string> = {
  sheet:
    "phone:inset-x-0 phone:top-auto phone:bottom-[var(--kb-inset,0px)] phone:m-0 phone:w-full phone:max-w-none phone:max-h-[calc(100dvh-var(--kb-inset,0px)-var(--sai-top)-8px)] phone:rounded-t-3xl phone:rounded-b-none phone:pr-safe phone:pb-safe phone:pl-safe phone:data-keyboard:pb-0 phone:open:animate-sheet-up",
  fullscreen:
    "phone:inset-x-0 phone:top-0 phone:bottom-[var(--kb-inset,0px)] phone:m-0 phone:h-auto phone:max-h-none phone:w-full phone:max-w-none phone:rounded-none phone:pt-safe phone:pr-safe phone:pb-safe phone:pl-safe phone:shadow-none phone:data-keyboard:pb-0 phone:open:animate-sheet-up",
  center: "",
};

export function Dialog({
  open,
  onClose,
  title,
  children,
  className,
  footer,
  mobile = "sheet",
  closeOnBack = false,
  initialFocusRef,
  "aria-label": ariaLabel,
}: {
  open: boolean;
  /** Called whenever the dialog closes (X, scrim, Escape, swipe, Back). Must set `open` false. */
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  className?: string;
  footer?: ReactNode;
  /** Presentation in the phone variant. Wide screens always get the centered card. */
  mobile?: DialogMobile;
  /** Push a history entry while open so Back closes the dialog. */
  closeOnBack?: boolean;
  /** Focused after opening instead of the first focusable element. */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** Accessible name when there is no `title`. */
  "aria-label"?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const slotRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const openRef = useRef(open);
  const controls = useDialogHistory(open, onClose, { enabled: closeOnBack });
  const { requestClose } = controls;

  useEffect(() => {
    openRef.current = open;
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.style.removeProperty("transform");
      d.style.removeProperty("transition");
      d.showModal();
      initialFocusRef?.current?.focus();
    }
    if (!open && d.open) d.close();
  }, [open, initialFocusRef]);

  // While open: register as the toast host, and track the on-screen keyboard.
  useEffect(() => {
    const d = ref.current;
    const slot = slotRef.current;
    if (!open || !d || !slot) return;
    const unregister = registerToastHost(slot);

    let frame = 0;
    let lastInset = -1;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const reveal = (el: Element | null) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => revealWithin(d, el));
    };
    const update = () => {
      const vv = window.visualViewport;
      const inset = vv ? keyboardInset(window.innerHeight, vv.height, vv.offsetTop) : 0;
      if (inset === lastInset) return;
      lastInset = inset;
      d.style.setProperty("--kb-inset", `${inset}px`);
      d.toggleAttribute("data-keyboard", inset > 0);
      if (inset > 0) reveal(document.activeElement);
    };
    const onFocusIn = (e: FocusEvent) => {
      reveal(e.target as Element | null);
      // Keyboards animate in; measure again once they have (also covers stubbed viewports).
      timers.push(setTimeout(update, 150), setTimeout(update, 400));
    };
    const vv = window.visualViewport;
    update();
    vv?.addEventListener("resize", update);
    vv?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    d.addEventListener("focusin", onFocusIn);
    return () => {
      unregister();
      cancelAnimationFrame(frame);
      timers.forEach(clearTimeout);
      vv?.removeEventListener("resize", update);
      vv?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      d.removeEventListener("focusin", onFocusIn);
      d.style.removeProperty("--kb-inset");
      d.removeAttribute("data-keyboard");
    };
  }, [open]);

  // Swipe down on the handle/header (phone sheet only).
  const drag = useRef<{ id: number; y0: number; y: number; t: number; v: number } | null>(null);
  const swipeEnabled = mobile === "sheet";
  const onDragStart = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = ref.current;
    if (!swipeEnabled || !d || !e.isPrimary || e.button !== 0) return;
    if (!window.matchMedia(PHONE_QUERY).matches) return;
    if ((e.target as Element).closest("button, a, input, select, textarea")) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { id: e.pointerId, y0: e.clientY, y: e.clientY, t: e.timeStamp, v: 0 };
    d.style.transition = "none";
  };
  const onDragMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const s = drag.current;
    const d = ref.current;
    if (!s || !d || s.id !== e.pointerId) return;
    const dt = Math.max(1, e.timeStamp - s.t);
    s.v = 0.8 * ((e.clientY - s.y) / dt) + 0.2 * s.v;
    s.y = e.clientY;
    s.t = e.timeStamp;
    const dy = e.clientY - s.y0;
    // Follow the finger down; resist upward drags.
    d.style.transform = `translateY(${dy > 0 ? dy : dy / 6}px)`;
  };
  const onDragEnd = (e: ReactPointerEvent<HTMLDivElement>) => {
    const s = drag.current;
    const d = ref.current;
    if (!s || !d || s.id !== e.pointerId) return;
    drag.current = null;
    const dy = e.clientY - s.y0;
    if (e.type === "pointerup" && shouldDismissSwipe(dy, s.v)) {
      d.style.transition = "transform 180ms ease-in";
      d.style.transform = "translateY(100%)";
      setTimeout(() => void requestClose(), 170);
    } else {
      d.style.transition = "transform 220ms cubic-bezier(0.22, 1, 0.36, 1)";
      d.style.transform = "";
    }
  };
  const dragHandlers = swipeEnabled
    ? {
        onPointerDown: onDragStart,
        onPointerMove: onDragMove,
        onPointerUp: onDragEnd,
        onPointerCancel: onDragEnd,
      }
    : {};

  // Backdrop taps: only when the press both started and ended outside the dialog box.
  const pressedOutside = useRef(false);
  const isOutside = (e: { clientX: number; clientY: number; target: EventTarget | null }) => {
    const d = ref.current;
    if (!d || e.target !== d) return false;
    const r = d.getBoundingClientRect();
    return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
  };

  return (
    <dialog
      ref={ref}
      data-mobile={mobile}
      aria-labelledby={title !== undefined ? titleId : undefined}
      aria-label={title === undefined ? ariaLabel : undefined}
      // React bubbles cancel/close from nested dialogs through the tree: only handle our own.
      onCancel={(e) => {
        if (e.target !== e.currentTarget) return;
        // Escape / Android back: route through requestClose so our history entry is popped.
        e.preventDefault();
        void requestClose();
      }}
      onClose={(e) => {
        if (e.target !== e.currentTarget) return;
        // The browser closed it on its own (e.g. a non-cancelable Escape): sync up.
        if (openRef.current) void requestClose();
      }}
      onPointerDown={(e) => {
        pressedOutside.current = isOutside(e);
      }}
      onClick={(e) => {
        if (pressedOutside.current && isOutside(e)) void requestClose();
        pressedOutside.current = false;
      }}
      className={cn(
        "m-auto max-h-[90dvh] w-[min(40rem,calc(100vw-2rem))] overflow-hidden rounded-3xl bg-surface p-0 text-ink shadow-pop backdrop:animate-fade-in open:flex open:animate-rise open:flex-col",
        mobileClasses[mobile],
        className,
      )}
    >
      <ControlsContext.Provider value={controls}>
        <div className={cn("shrink-0", swipeEnabled && "phone:touch-none")} {...dragHandlers}>
          {swipeEnabled && (
            <div
              data-dialog-handle
              aria-hidden
              className="hidden h-6 cursor-grab items-center justify-center phone:flex"
            >
              <span className="h-1.5 w-10 rounded-full bg-line-strong" />
            </div>
          )}
          {title !== undefined && (
            <header
              className={cn(
                "flex items-center justify-between border-b border-line px-6 py-4 phone:py-2",
                swipeEnabled && "phone:pt-0",
              )}
            >
              <h2 id={titleId} className="text-base font-semibold">
                {title}
              </h2>
              <button
                type="button"
                onClick={() => void requestClose()}
                className="-mr-2 flex items-center justify-center rounded-full p-2 text-muted hover:bg-sunken hover:text-ink pointer-coarse:size-11 phone:size-11"
                aria-label="Close"
              >
                <X className="size-5" />
              </button>
            </header>
          )}
        </div>
        <div className="flex-1 overflow-y-auto overscroll-contain">{children}</div>
        <div ref={slotRef} data-toast-slot className="relative h-0 shrink-0" />
        {footer && <footer className="shrink-0 border-t border-line px-6 py-4">{footer}</footer>}
      </ControlsContext.Provider>
    </dialog>
  );
}

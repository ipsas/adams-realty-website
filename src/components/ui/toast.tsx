"use client";

import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";

/*
 * App-wide toasts: a tiny module store plus one <Toaster /> in the root layout.
 *
 *   toast("Removed from saved", { action: { label: "Undo", onClick: undo }, duration: 5000 });
 *
 * One toast is visible at a time; a new one replaces the current one. The timer pauses while
 * the toast is hovered or focused. While a modal <Dialog> is open the toast renders inside
 * that dialog's [data-toast-slot] (outside it would be inert, so "Undo" couldn't be tapped);
 * otherwise it floats above the bottom chrome (--bottom-overlay-h).
 *
 * The region uses role="status" and deliberately no explicit aria-live attribute: e2e expects
 * exactly one [aria-live=polite] on /homes (the results count).
 */

export type ToastTone = "default" | "error";
export type ToastAction = { label: string; onClick: () => void };
export type ToastOptions = {
  action?: ToastAction;
  tone?: ToastTone;
  /** Milliseconds before auto-dismiss (default 4000). Infinity keeps it until dismissed. */
  duration?: number;
};
export type ToastItem = {
  id: number;
  message: string;
  action?: ToastAction;
  tone: ToastTone;
  duration: number;
};
export type ToastState = {
  toast: ToastItem | null;
  /** Open dialogs' toast slots, bottom → top. The last one hosts the toast. */
  hosts: readonly HTMLElement[];
};

export const DEFAULT_TOAST_DURATION = 4000;

/** Creates an isolated store. The app uses the `toastStore` singleton; tests make their own. */
export function createToastStore() {
  let state: ToastState = { toast: null, hosts: [] };
  let nextId = 1;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let deadline = 0;
  let remaining = 0;
  let paused = false;
  const listeners = new Set<() => void>();

  const set = (patch: Partial<ToastState>) => {
    state = { ...state, ...patch };
    listeners.forEach((l) => l());
  };
  const clearTimer = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const schedule = (id: number, ms: number) => {
    clearTimer();
    if (!Number.isFinite(ms)) return;
    deadline = Date.now() + ms;
    timer = setTimeout(() => dismiss(id), ms);
  };

  function show(message: string, opts: ToastOptions = {}): number {
    const id = nextId++;
    const duration = opts.duration ?? DEFAULT_TOAST_DURATION;
    set({ toast: { id, message, action: opts.action, tone: opts.tone ?? "default", duration } });
    paused = false;
    schedule(id, duration);
    return id;
  }

  /** Dismisses the current toast, or only toast `id` when given and still showing. */
  function dismiss(id?: number) {
    if (!state.toast || (id !== undefined && state.toast.id !== id)) return;
    clearTimer();
    paused = false;
    set({ toast: null });
  }

  function pause() {
    if (!state.toast || paused) return;
    paused = true;
    remaining = Math.max(0, deadline - Date.now());
    clearTimer();
  }

  function resume() {
    if (!state.toast || !paused) return;
    paused = false;
    schedule(state.toast.id, Number.isFinite(state.toast.duration) ? remaining : Infinity);
  }

  /** Registers an open dialog's toast slot; returns the unregister function. */
  function registerHost(el: HTMLElement): () => void {
    set({ hosts: [...state.hosts.filter((h) => h !== el), el] });
    return () => {
      if (state.hosts.includes(el)) set({ hosts: state.hosts.filter((h) => h !== el) });
    };
  }

  return {
    show,
    dismiss,
    pause,
    resume,
    registerHost,
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export const toastStore = createToastStore();

/** Shows a toast (replacing any current one). Returns its id for `dismissToast(id)`. */
export function toast(message: string, opts?: ToastOptions): number {
  return toastStore.show(message, opts);
}

/** Dismisses the current toast, or only toast `id` if it is still the one showing. */
export function dismissToast(id?: number): void {
  toastStore.dismiss(id);
}

/**
 * Makes `slot` (inside an open modal dialog) the place toasts render until the returned
 * function is called. <Dialog> does this automatically; custom dialogs (the lightbox) can
 * render their own `<div data-toast-slot className="relative h-0" />` and register it.
 */
export function registerToastHost(slot: HTMLElement): () => void {
  return toastStore.registerHost(slot);
}

const serverSnapshot: ToastState = { toast: null, hosts: [] };

export function Toaster() {
  const { toast: current, hosts } = useSyncExternalStore(
    toastStore.subscribe,
    toastStore.getSnapshot,
    () => serverSnapshot,
  );
  const host = hosts.at(-1) ?? null;
  const card = current ? <ToastCard key={current.id} item={current} /> : null;
  return (
    <>
      <div
        role="status"
        className="pointer-events-none fixed inset-x-0 bottom-[calc(var(--bottom-overlay-h)+12px)] z-70 flex justify-center pr-safe-4 pl-safe-4"
      >
        {!host && card}
      </div>
      {host &&
        createPortal(
          <div
            role="status"
            className="pointer-events-none absolute inset-x-3 bottom-3 z-10 flex justify-center"
          >
            {card}
          </div>,
          host,
        )}
    </>
  );
}

function ToastCard({ item }: { item: ToastItem }) {
  return (
    <div
      data-toast
      data-tone={item.tone}
      onPointerEnter={toastStore.pause}
      onPointerLeave={toastStore.resume}
      onFocus={toastStore.pause}
      onBlur={toastStore.resume}
      className={cn(
        "pointer-events-auto flex min-h-12 w-full max-w-md animate-rise items-center gap-2 rounded-2xl py-1 pr-1 pl-4 text-sm font-medium text-white shadow-pop",
        item.tone === "error" ? "bg-clay-600" : "bg-shade dark:ring-1 dark:ring-white/10",
      )}
    >
      <p className="min-w-0 flex-1 py-2">{item.message}</p>
      {item.action && (
        <button
          type="button"
          onClick={() => {
            item.action?.onClick();
            toastStore.dismiss(item.id);
          }}
          className={cn(
            "h-11 min-w-11 shrink-0 rounded-xl px-3 font-semibold transition-colors hover:bg-white/10",
            item.tone === "error" ? "text-white underline" : "text-brand-200",
          )}
        >
          {item.action.label}
        </button>
      )}
      {!item.action && <span className="w-3" aria-hidden />}
    </div>
  );
}

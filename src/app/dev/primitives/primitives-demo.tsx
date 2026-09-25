"use client";

import { Bell, Heart } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { SaveButton, SaveIntercept } from "@/components/listings/save-button";
import { useSavedHomes } from "@/components/listings/saved-homes-provider";
import { Button } from "@/components/ui/button";
import { Dialog, useDialogControls } from "@/components/ui/dialog";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/form";
import { Popover } from "@/components/ui/popover";
import { Container } from "@/components/ui/section";
import { toast } from "@/components/ui/toast";

type DialogName = "sheet" | "fullscreen" | "nested" | "toast" | "center" | null;

/*
 * Test hooks (data-testid) used by e2e/mobile/foundation.spec.ts:
 *   open-sheet → closeOnBack sheet: sheet-done (requestClose), sheet-input (text input at the bottom)
 *   open-fullscreen → closeOnBack full-screen dialog:
 *     dialog-nav-link (navigateFromDialog → /dev/primitives?navigated=1),
 *     dialog-nav-sell (→ /sell), dialog-nav-replace (replace → ?navigated=replace),
 *     open-nested (a second closeOnBack sheet on top: nested-done)
 *   open-toast-dialog → sheet with a footer: dialog-toast-button shows a toast with an
 *     "Undo" action; undo-count counts action clicks
 *   open-center → centered dialog without history (legacy behaviour)
 *   popover (wrapper) + scrim-target (a link under the scrim; must not navigate)
 *   page-toast, page-toast-error, page-toast-action
 *   save-overlay, save-outline, save-plain, save-intercept (wrappers around SaveButton)
 *   navigated-banner (shown when ?navigated= is present)
 */
export function PrimitivesDemo({
  listingId,
  navigated,
}: {
  listingId: string;
  navigated: string | null;
}) {
  const [dialog, setDialog] = useState<DialogName>(null);
  const [nested, setNested] = useState(false);
  const [undoCount, setUndoCount] = useState(0);
  const close = () => setDialog(null);

  return (
    <Container className="space-y-10 py-8">
      <header>
        <p className="text-xs font-semibold tracking-[0.18em] text-brass-500 uppercase">Dev only</p>
        <h1 className="font-display-tight text-3xl font-medium text-ink">UI primitives</h1>
        <p className="mt-1 text-sm text-muted">
          Resize to a phone (or use device emulation) to see sheets, scrims and touch sizing.
        </p>
        {navigated && (
          <p
            data-testid="navigated-banner"
            className="mt-4 rounded-xl bg-brand-50 px-4 py-3 text-sm text-brand-800"
          >
            Arrived via navigateFromDialog ({navigated}). One Back returns to the page without the
            parameter.
          </p>
        )}
      </header>

      <Demo title="Popover with scrim">
        <div className="flex flex-col gap-3">
          <div data-testid="popover">
            <Popover label="Open popover">
              <p className="text-sm text-ink-soft">
                Below lg this is a bottom card over a scrim. Tapping the scrim closes it without
                activating what&apos;s underneath.
              </p>
            </Popover>
          </div>
          <Link
            href="/sell"
            data-testid="scrim-target"
            className="flex h-40 items-center justify-center rounded-2xl border border-dashed border-line-strong bg-sunken text-sm text-muted"
          >
            Scrim target: a dismissing tap must not open this link
          </Link>
        </div>
      </Demo>

      <Demo title="Dialogs">
        <div className="flex flex-wrap gap-2">
          <Button data-testid="open-sheet" onClick={() => setDialog("sheet")}>
            Open sheet
          </Button>
          <Button
            data-testid="open-fullscreen"
            variant="secondary"
            onClick={() => setDialog("fullscreen")}
          >
            Open full screen
          </Button>
          <Button
            data-testid="open-toast-dialog"
            variant="secondary"
            onClick={() => setDialog("toast")}
          >
            Toast in dialog
          </Button>
          <Button data-testid="open-center" variant="ghost" onClick={() => setDialog("center")}>
            Centered, no history
          </Button>
        </div>
      </Demo>

      <Demo title="Toasts">
        <div className="flex flex-wrap gap-2">
          <Button data-testid="page-toast" variant="secondary" onClick={() => toast("Link copied")}>
            Toast
          </Button>
          <Button
            data-testid="page-toast-error"
            variant="secondary"
            onClick={() => toast("Couldn't update the lead. Try again.", { tone: "error" })}
          >
            Error toast
          </Button>
          <Button
            data-testid="page-toast-action"
            variant="secondary"
            onClick={() =>
              toast("Marked contacted", {
                action: { label: "Undo", onClick: () => toast("Undone") },
              })
            }
          >
            Toast with action
          </Button>
        </div>
      </Demo>

      <Demo title="Save buttons">
        <div className="flex flex-wrap items-center gap-6">
          <div
            data-testid="save-overlay"
            className="relative flex h-28 w-44 items-start justify-end rounded-2xl bg-linear-to-br from-brand-300 to-brand-700 p-2 dark:from-brand-400"
          >
            <SaveButton listingId={listingId} />
          </div>
          <div data-testid="save-outline">
            <SaveButton listingId={listingId} variant="outline" />
          </div>
          <div data-testid="save-plain">
            <SaveButton listingId={listingId} variant="plain" />
          </div>
          <InterceptDemo listingId={listingId} />
        </div>
      </Demo>

      <Demo title="Controls">
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm">Small</Button>
            <Button size="md" variant="secondary">
              Medium
            </Button>
            <Button size="lg" variant="subtle">
              Large
            </Button>
            <Button size="icon" variant="ghost" aria-label="Alerts">
              <Bell />
            </Button>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Text input" htmlFor="demo-input">
              <Input id="demo-input" placeholder="16px on touch devices" />
            </Field>
            <Field label="Select" htmlFor="demo-select">
              <Select id="demo-select" defaultValue="daily">
                <option value="instant">Instantly</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
              </Select>
            </Field>
            <Field label="Textarea" htmlFor="demo-textarea" className="sm:col-span-2">
              <Textarea id="demo-textarea" placeholder="Notes" />
            </Field>
          </div>
          <Checkbox label="Checkbox rows are 44px tall on touch" defaultChecked />
        </div>
      </Demo>

      <Dialog open={dialog === "sheet"} onClose={close} title="Sheet" closeOnBack>
        <SheetBody />
      </Dialog>

      <Dialog
        open={dialog === "fullscreen"}
        onClose={close}
        title="Full screen"
        mobile="fullscreen"
        closeOnBack
      >
        <FullscreenBody onOpenNested={() => setNested(true)} />
        <Dialog open={nested} onClose={() => setNested(false)} title="Nested sheet" closeOnBack>
          <div className="space-y-4 px-6 py-6">
            <p className="text-sm text-muted">
              Back closes only this sheet; the full-screen dialog stays open.
            </p>
            <DoneButton testId="nested-done" />
          </div>
        </Dialog>
      </Dialog>

      <Dialog
        open={dialog === "toast"}
        onClose={close}
        title="Toast inside a dialog"
        closeOnBack
        footer={
          <div className="flex justify-end">
            <DoneButton testId="toast-dialog-done" />
          </div>
        }
      >
        <div className="space-y-4 px-6 py-6">
          <p className="text-sm text-muted">
            Outside a modal dialog everything is inert, so the toast renders inside this dialog,
            just above the footer.
          </p>
          <Button
            data-testid="dialog-toast-button"
            onClick={() =>
              toast("Removed from saved", {
                action: { label: "Undo", onClick: () => setUndoCount((n) => n + 1) },
                duration: 8000,
              })
            }
          >
            Show toast
          </Button>
          <p data-testid="undo-count" className="text-sm text-ink-soft">
            Undo clicked: {undoCount}
          </p>
        </div>
      </Dialog>

      <Dialog open={dialog === "center"} onClose={close} title="Centered" mobile="center">
        <p className="px-6 py-6 text-sm text-muted">
          mobile=&quot;center&quot; without closeOnBack: the pre-mobile behaviour.
        </p>
      </Dialog>
    </Container>
  );
}

function Demo({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-card border border-line bg-surface p-5 shadow-card">
      <h2 className="mb-4 text-sm font-semibold text-ink">{title}</h2>
      {children}
    </section>
  );
}

function DoneButton({ testId }: { testId: string }) {
  const { requestClose } = useDialogControls();
  return (
    <Button data-testid={testId} onClick={() => void requestClose()}>
      Done
    </Button>
  );
}

function SheetBody() {
  return (
    <div className="space-y-5 px-6 py-6">
      <p className="text-sm text-muted">
        Swipe the handle down, tap the scrim, press Escape or go Back to close. The URL doesn&apos;t
        change.
      </p>
      <DoneButton testId="sheet-done" />
      <ul className="space-y-2 text-sm text-ink-soft">
        {["Tour times", "Commute", "Schools", "HOA details", "Tax history", "Price history"].map(
          (item) => (
            <li key={item} className="rounded-xl bg-sunken px-4 py-3">
              {item}
            </li>
          ),
        )}
      </ul>
      <Field label="Your name" htmlFor="sheet-input" hint="Focus me with the keyboard up.">
        <Input id="sheet-input" data-testid="sheet-input" autoComplete="name" />
      </Field>
    </div>
  );
}

function FullscreenBody({ onOpenNested }: { onOpenNested: () => void }) {
  const { navigateFromDialog } = useDialogControls();
  const link = "flex h-12 items-center rounded-xl px-4 text-base font-medium hover:bg-sunken";
  return (
    <div className="space-y-6 px-6 py-6">
      <p className="text-sm text-muted">
        Links use navigateFromDialog: the dialog&apos;s history entry is popped first, so one Back
        returns here, not to an open dialog.
      </p>
      <nav className="flex flex-col" aria-label="Demo links">
        <a
          href="/dev/primitives?navigated=1"
          data-testid="dialog-nav-link"
          className={link}
          onClick={(e) => {
            e.preventDefault();
            void navigateFromDialog("/dev/primitives?navigated=1");
          }}
        >
          This page with ?navigated=1
        </a>
        <a
          href="/sell"
          data-testid="dialog-nav-sell"
          className={link}
          onClick={(e) => {
            e.preventDefault();
            void navigateFromDialog("/sell");
          }}
        >
          Sell page
        </a>
        <a
          href="/dev/primitives?navigated=replace"
          data-testid="dialog-nav-replace"
          className={link}
          onClick={(e) => {
            e.preventDefault();
            void navigateFromDialog("/dev/primitives?navigated=replace", { replace: true });
          }}
        >
          Replace with ?navigated=replace
        </a>
      </nav>
      <Button data-testid="open-nested" variant="secondary" onClick={onOpenNested}>
        Open nested sheet
      </Button>
    </div>
  );
}

/** A heart wired to SaveIntercept: unsaving is deferred behind an Undo toast (like /saved). */
function InterceptDemo({ listingId }: { listingId: string }) {
  const { setLocal } = useSavedHomes();
  return (
    <SaveIntercept.Provider
      value={(id) => {
        setLocal(id, false);
        toast("Removed from saved (not committed)", {
          action: { label: "Undo", onClick: () => setLocal(id, true) },
        });
      }}
    >
      <div data-testid="save-intercept" className="flex items-center gap-1 text-xs text-muted">
        <SaveButton listingId={listingId} variant="plain" />
        <Heart className="size-3" aria-hidden /> intercepted
      </div>
    </SaveIntercept.Provider>
  );
}

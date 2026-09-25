"use client";

import { Lock, Trash2 } from "lucide-react";
import {
  startTransition,
  useActionState,
  useOptimistic,
  useRef,
  useState,
  useTransition,
  type FormEvent,
} from "react";
import { MAX_NOTE_LENGTH } from "@/app/dashboard/leads/[id]/note-policy";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Checkbox, FormMessage, Textarea } from "@/components/ui/form";
import { site } from "@/config/site";
import { cn } from "@/lib/cn";
import { addLeadNote, deleteLeadNote, type LeadNoteState } from "@/server/actions/leads";

/** A note with its labels pre-formatted on the server (market time zone). */
export type LeadNoteItem = {
  id: string;
  body: string;
  authorName: string | null;
  /** ISO timestamp, for <time dateTime>. */
  createdAt: string;
  /** "2h ago" */
  relative: string;
  /** "Thu, Sep 24 · 3:12 PM EDT" */
  absolute: string;
  canDelete: boolean;
  /** Set on the optimistic copy shown while a new note saves. */
  pending?: boolean;
};

type OptimisticChange = { add: LeadNoteItem } | { remove: string };

/**
 * The notes timeline on a lead: newest first, with an add-note form. On submit
 * the box clears and the note appears at the top straight away; a deleted note
 * disappears at once; the server's revalidated list then replaces them. If a
 * save fails for any reason (validation, a refusal, the network), the text goes
 * back in the box. While the lead is still "new" the
 * form offers to mark it contacted (see `addLeadNote` in
 * src/server/actions/leads.ts).
 */
export function LeadNotes({
  inquiryId,
  notes,
  canAdd,
  viewerName,
  offerMarkContacted,
}: {
  inquiryId: string;
  notes: LeadNoteItem[];
  canAdd: boolean;
  viewerName: string;
  offerMarkContacted: boolean;
}) {
  const [items, applyOptimistic] = useOptimistic(notes, (list, change: OptimisticChange) =>
    "add" in change ? [change.add, ...list] : list.filter((n) => n.id !== change.remove),
  );
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [state, dispatch, saving] = useActionState(
    async (prev: LeadNoteState, form: FormData): Promise<LeadNoteState> => {
      const body = String(form.get("body") ?? "");
      applyOptimistic({
        add: {
          id: `pending-${Date.now()}`,
          body: body.trim(),
          authorName: viewerName,
          createdAt: new Date().toISOString(),
          relative: "Saving…",
          absolute: "",
          canDelete: false,
          pending: true,
        },
      });
      let result: LeadNoteState;
      try {
        result = await addLeadNote(prev, form);
      } catch {
        // Offline, signed out (the sign-in redirect isn't an action response)
        // or a server error. Caught so the note isn't lost to the error page.
        result = {
          ok: false,
          error:
            "The note couldn't be saved. Check your connection, or sign in again in another tab, then try again.",
          body,
        };
      }
      // Put the text back so nothing is lost, unless they've started another note.
      const box = textareaRef.current;
      if (!result.ok && box && !box.value.trim()) box.value = result.body ?? body;
      return result;
    },
    { ok: true },
  );
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [, startDelete] = useTransition();

  // Submitted by hand rather than via <form action> so the box can clear right
  // away; React's automatic form reset would wait for the save and then wipe
  // anything typed meanwhile.
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    if (!String(data.get("body") ?? "").trim()) {
      textareaRef.current?.focus();
      return;
    }
    if (textareaRef.current) textareaRef.current.value = "";
    startTransition(() => dispatch(data));
  }

  function remove(note: LeadNoteItem) {
    if (!confirm("Delete this note? This can't be undone.")) return;
    setDeleteError(null);
    startDelete(async () => {
      applyOptimistic({ remove: note.id });
      try {
        const res = await deleteLeadNote(note.id, inquiryId);
        if (!res.ok) setDeleteError(res.message ?? "Couldn't delete that note.");
      } catch {
        setDeleteError("Couldn't delete that note. Check your connection, or sign in again.");
      }
    });
  }

  return (
    <section
      aria-labelledby="lead-notes-heading"
      className="rounded-2xl border border-line bg-surface"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-line px-5 py-4">
        <h2 id="lead-notes-heading" className="font-semibold text-ink">
          Notes
          {notes.length > 0 && (
            <span className="ml-2 text-sm font-normal text-muted tabular">{notes.length}</span>
          )}
        </h2>
        <p className="flex items-center gap-1.5 text-xs text-muted">
          <Lock className="size-3.5" aria-hidden />
          Only {site.name} staff on this lead can see these
        </p>
      </header>

      {canAdd && (
        <form onSubmit={submit} className="border-b border-line px-5 py-4">
          <input type="hidden" name="inquiryId" value={inquiryId} />
          <label htmlFor="lead-note-body" className="sr-only">
            New note
          </label>
          <Textarea
            ref={textareaRef}
            id="lead-note-body"
            name="body"
            rows={3}
            maxLength={MAX_NOTE_LENGTH}
            required
            placeholder="Log a call, showing feedback or next step…"
            aria-invalid={!state.ok && !!state.error}
            aria-describedby={!state.ok && state.error ? "lead-note-error" : undefined}
            className="text-base sm:text-sm"
            onKeyDown={(e) => {
              // ⌘/Ctrl + Enter saves, as in most note and chat apps.
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            {offerMarkContacted ? (
              <Checkbox name="markContacted" defaultChecked label="Mark lead as contacted" />
            ) : (
              <span className="hidden text-xs text-muted sm:block">⌘/Ctrl + Enter to save</span>
            )}
            <Button type="submit" disabled={saving} className="ml-auto min-w-28">
              {saving ? "Saving…" : "Add note"}
            </Button>
          </div>
          {!state.ok && state.error && (
            <p id="lead-note-error" role="alert" className="mt-2 text-sm text-clay-600">
              {state.error}
            </p>
          )}
          <p role="status" className="sr-only">
            {state.ok && !saving ? state.message : ""}
          </p>
        </form>
      )}

      {deleteError && (
        <div className="px-5 pt-4">
          <FormMessage>{deleteError}</FormMessage>
        </div>
      )}

      {items.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-muted">
          No notes yet. Log calls, showings and next steps here so anyone picking up this lead knows
          where it stands.
        </p>
      ) : (
        <ol className="px-5 py-2">
          {items.map((note, i) => (
            <li
              key={note.id}
              className={cn(
                "relative flex gap-3 py-3",
                note.pending && "animate-fade-in opacity-60",
              )}
            >
              {/* Timeline rail between avatars. */}
              {i < items.length - 1 && (
                <span aria-hidden className="absolute top-12 bottom-0 left-4 w-px bg-line" />
              )}
              <Avatar
                src={null}
                name={note.authorName ?? "Former staff member"}
                className="size-8 shrink-0 rounded-full text-xs"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm">
                    <span className="font-medium text-ink">
                      {note.authorName ?? "Former staff member"}
                    </span>{" "}
                    <span className="text-muted">·</span>{" "}
                    {note.pending ? (
                      <span className="text-muted">{note.relative}</span>
                    ) : (
                      <time dateTime={note.createdAt} title={note.absolute} className="text-muted">
                        {note.relative}
                      </time>
                    )}
                  </p>
                  {note.canDelete && (
                    <button
                      type="button"
                      onClick={() => remove(note)}
                      aria-label={`Delete note from ${note.relative}`}
                      title="Delete note"
                      className="-mt-2 -mr-2 flex size-10 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-clay-50 hover:text-clay-600"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  )}
                </div>
                <p className="mt-1 text-sm leading-relaxed [overflow-wrap:anywhere] whitespace-pre-line text-ink-soft">
                  {note.body}
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

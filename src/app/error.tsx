"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  const forbidden = error.name === "ForbiddenError";
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-4 py-24 text-center">
      <h1 className="font-display-tight text-4xl text-ink">
        {forbidden ? "You can't do that" : "Something went wrong"}
      </h1>
      <p className="mt-3 max-w-md text-muted">
        {forbidden
          ? "Your account doesn't have permission for that action."
          : "Please try again. If it keeps happening, let us know."}
      </p>
      <Button className="mt-8" onClick={reset}>
        Try again
      </Button>
    </main>
  );
}

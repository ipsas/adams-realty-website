import { vi } from "vitest";

const METHODS = ["log", "info", "warn", "error", "debug", "trace"] as const;

/** Silences every console method and returns what was written, one entry per call. */
export function captureConsole(): { output: () => string[]; restore: () => void } {
  const spies = METHODS.map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
  return {
    output: () => spies.flatMap((s) => s.mock.calls.map((c: unknown[]) => c.map(String).join(" "))),
    restore: () => spies.forEach((s) => s.mockRestore()),
  };
}

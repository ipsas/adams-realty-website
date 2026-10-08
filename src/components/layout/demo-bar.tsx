/**
 * The slim notice at the top of every page while the site shows sample listings
 * (demo-data mode, src/lib/demo-mode.ts). SiteHeader places it just above the
 * header, in the page's flow, so it scrolls away and the header still sticks (over
 * the home page's hero, the fixed header starts below it until the page scrolls).
 * A labelled landmark of its own, so landmark navigation doesn't skip it. Its
 * height is `--demo-bar-h` (globals.css), which pages sized to the viewport
 * subtract.
 */
export function DemoBar() {
  return (
    <aside
      aria-label="Sample listings notice"
      data-demo-bar
      className="flex min-h-(--demo-bar-h) w-full items-center justify-center bg-brass-100 py-1.5 pr-safe-4 pl-safe-4 text-center text-xs leading-4 text-brass-700 shadow-[inset_0_-1px_0_rgb(200_155_90/0.4)]"
    >
      <p className="min-w-0">
        <strong className="font-semibold">Preview:</strong> the homes on this site are samples, not
        real listings.
      </p>
    </aside>
  );
}

/**
 * The Equal Housing Opportunity logo: a house with an equal sign inside,
 * optionally with the wordmark underneath. Drawn in `currentColor` so it
 * inherits the surrounding text color (HUD allows any single color), and as
 * one SVG so the wordmark scales with the mark.
 */
export function EqualHousingLogo({
  withText = false,
  className,
}: {
  withText?: boolean;
  className?: string;
}) {
  return (
    <svg
      viewBox={withText ? "0 0 64 86" : "0 0 64 64"}
      role="img"
      aria-label="Equal Housing Opportunity"
      className={className}
    >
      <path
        fillRule="evenodd"
        fill="currentColor"
        d="M32 3 2 27h7v34h46V27h7L32 3Zm0 10.2L47 25v29H17V25l15-11.8Z"
      />
      <path fill="currentColor" d="M22 30h20v6H22zM22 41h20v6H22z" />
      {withText && (
        <g
          fill="currentColor"
          fontFamily="var(--font-sans)"
          fontSize="7"
          fontWeight="700"
          textAnchor="middle"
          aria-hidden
        >
          <text x="32" y="73" textLength="60" lengthAdjust="spacingAndGlyphs">
            EQUAL HOUSING
          </text>
          <text x="32" y="83" textLength="54" lengthAdjust="spacingAndGlyphs">
            OPPORTUNITY
          </text>
        </g>
      )}
    </svg>
  );
}

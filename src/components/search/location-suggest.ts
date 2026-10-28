/**
 * Whether the location box fetches and shows suggestions for `term` (its trimmed
 * text): at least 2 characters, and not just the value the page prefilled
 * (`defaultValue`, the current search) unless the user has edited the box, so
 * retyping the current search ("Clay County" on its own results page) still
 * suggests it.
 */
export function shouldSuggest(term: string, defaultValue: string, edited: boolean): boolean {
  return term.length >= 2 && (edited || term !== defaultValue);
}

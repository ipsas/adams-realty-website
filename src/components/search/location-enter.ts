/**
 * What Enter in the location box picks, if not the typed text: the
 * arrow-selected suggestion, else the first one when the list is open and its
 * suggestions are for the text as it is now (`itemsTerm === term`), so a
 * stale list for older text never wins. Undefined means search the text
 * (a town of the name wins there). The search button always searches the text.
 */
export function enterTarget<T>(
  items: readonly T[],
  itemsTerm: string,
  term: string,
  active: number,
  open: boolean,
): T | undefined {
  if (active >= 0 && items[active]) return items[active];
  if (open && items.length > 0 && itemsTerm === term) return items[0];
  return undefined;
}

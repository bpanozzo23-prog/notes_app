export function nowIso() {
  return new Date().toISOString();
}

// The app's own words are English, so dates use en-GB ("16 Oct 2026") on every device.
const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const time = (date) => date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
const dayMonth = (date) => date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const fullDate = (date) => date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

/** The notes list: "14:02" today, "16 Oct" this year, "16 Oct 2025" before. */
export function shortDate(iso, now = new Date()) {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "";
  if (sameDay(date, now)) return time(date);
  return date.getFullYear() === now.getFullYear() ? dayMonth(date) : fullDate(date);
}

/** The end of a note: "Created 3 Oct 2026 · Edited today, 14:02". A note never edited shows
 * only its creation. "Edited" is `updatedAt`: content changes, not pinning or housekeeping. */
export function noteDates({ createdAt, updatedAt }, now = new Date()) {
  const created = new Date(createdAt), edited = new Date(updatedAt);
  if (!Number.isFinite(created.getTime())) return "";
  const parts = [`Created ${fullDate(created)}`];
  if (Number.isFinite(edited.getTime()) && edited.getTime() !== created.getTime()) {
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    const when = sameDay(edited, now) ? `today, ${time(edited)}` : sameDay(edited, yesterday) ? `yesterday, ${time(edited)}`
      : edited.getFullYear() === now.getFullYear() ? `${dayMonth(edited)}, ${time(edited)}` : fullDate(edited);
    parts.push(`Edited ${when}`);
  }
  return parts.join(" · ");
}

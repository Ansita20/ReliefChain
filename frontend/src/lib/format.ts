/** Small display helpers. */

/** 0x1234abcd…: first 10 characters of a hash. Enough to tell entries apart, not enough to matter. */
export function shortHash(hash: string): string {
  return `${hash.slice(0, 10)}…`;
}

/** 0xf39F…2266 */
export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/** Unix seconds -> "23 Oct 2026, 14:05" in the viewer's locale. */
export function formatDateTime(seconds: number): string {
  return new Date(seconds * 1000).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Unix seconds -> "5 min ago" style text. */
export function timeAgo(seconds: number): string {
  const diff = Math.max(0, Math.floor(Date.now() / 1000 - seconds));
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`;
  return `${Math.floor(diff / 86400)} d ago`;
}

/** Date -> value for <input type="datetime-local"> (local time, no seconds). */
export function toDateTimeLocal(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

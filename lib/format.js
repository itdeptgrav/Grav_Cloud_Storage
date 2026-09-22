// lib/format.js — small display helpers (client + server safe).

export function fmtBytes(bytes) {
  const b = Number(bytes || 0);
  if (b < 1024) return `${b} B`;
  const u = ["KB", "MB", "GB", "TB", "PB"];
  let n = b / 1024;
  let i = 0;
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(1)} ${u[i]}`;
}

export function timeAgo(date) {
  if (!date) return "never";
  const d = new Date(date).getTime();
  if (Number.isNaN(d)) return "never";
  const s = Math.floor((Date.now() - d) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

export function fmtDate(date) {
  if (!date) return "—";
  try {
    return new Date(date).toISOString().slice(0, 10);
  } catch {
    return "—";
  }
}

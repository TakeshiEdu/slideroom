import { format } from "date-fns";

export function formatDateTime(value?: string) {
  if (!value) return "-";
  return format(new Date(value), "yyyy/MM/dd HH:mm");
}

export function formatDateShort(value?: string) {
  if (!value) return "-";
  return format(new Date(value), "MM/dd HH:mm");
}

export function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

export function makeInitials(name: string) {
  return name
    .split(/\s+/)
    .map((part) => part.slice(0, 1))
    .join("")
    .slice(0, 2);
}

// Anonymous per-device identity — no login, no personal info. A random id
// generated once and kept in localStorage, used only to group a student's own
// attempt history (progress over time, weak-topic aggregation) on this
// browser/device. Never sent anywhere except attached to their own attempt
// rows in Supabase.
const KEY = "ssccgl:device-id";

export function getDeviceId() {
  let id = localStorage.getItem(KEY);
  if (!id) {
    id =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    localStorage.setItem(KEY, id);
  }
  return id;
}

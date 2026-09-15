import { supabase } from "./supabaseClient";

// Browser Web Push API's applicationServerKey wants the VAPID public key as
// a raw Uint8Array, not the base64url string it's generated/stored as.
function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

export function pushSupported() {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window;
}

// Whether THIS browser already has an active push subscription — not
// whether the student has ever subscribed on any device, since each
// device/browser needs its own permission and its own subscription.
export async function getExistingSubscription() {
  if (!pushSupported()) return null;
  const registration = await navigator.serviceWorker.getRegistration("/sw.js");
  if (!registration) return null;
  return registration.pushManager.getSubscription();
}

// Registers the service worker (idempotent — safe to call every time),
// asks the browser for permission if needed, subscribes, and saves the
// subscription server-side so api/notify-new-mock.js can find it later.
// Throws with a readable message on denial/failure so the caller can show it.
export async function subscribeToPush(userId) {
  if (!pushSupported()) throw new Error("This browser doesn't support push notifications.");
  const vapidKey = import.meta.env.VITE_VAPID_PUBLIC_KEY;
  if (!vapidKey) throw new Error("Push notifications aren't set up on the server yet.");

  const registration = await navigator.serviceWorker.register("/sw.js");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error(permission === "denied" ? "Notifications are blocked for this site in your browser settings." : "Permission wasn't granted.");
  }

  const existing = await registration.pushManager.getSubscription();
  const subscription = existing || (await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidKey),
  }));

  const json = subscription.toJSON();
  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      user_id: userId,
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
    },
    { onConflict: "endpoint" }
  );
  if (error) throw error;
  return subscription;
}

// Unsubscribes this browser and removes its row server-side — a student's
// OTHER devices (if any) stay subscribed; this only affects the one they're
// using right now.
export async function unsubscribeFromPush() {
  const subscription = await getExistingSubscription();
  if (!subscription) return;
  const endpoint = subscription.endpoint;
  await subscription.unsubscribe();
  await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
}

// Admin-only — calls api/notify-new-mock.js to push "new mock available" to
// every subscribed student. Best-effort from the caller's side: publishing
// a mock should never fail just because the notification send had a hiccup.
export async function notifyStudentsOfNewMock(mockTitle) {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;
  if (!token) return;

  const res = await fetch("/api/notify-new-mock", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ mockTitle }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error || `Notification send failed (${res.status}).`);
  }
  return res.json();
}

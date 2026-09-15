// Vercel serverless function — sends a Web Push notification to every
// subscribed student when the admin publishes a new mock. Admin-only, same
// identity pattern as api/analyze-attempt.js: the Supabase client must
// carry the caller's own JWT (not just the anon key), because the
// admins-table RLS policy is "using (auth.uid() = id)" and without that
// header every request here would run as the anonymous role.
import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) {
    res.status(401).json({ error: "Missing auth token." });
    return;
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;
  const vapidPublicKey = process.env.VITE_VAPID_PUBLIC_KEY;
  const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
  const vapidContact = process.env.VAPID_CONTACT_EMAIL;

  if (!supabaseUrl || !supabaseAnonKey) {
    res.status(500).json({ error: "Server misconfigured: missing Supabase env vars." });
    return;
  }
  if (!vapidPublicKey || !vapidPrivateKey || !vapidContact) {
    res.status(500).json({ error: "Push notifications aren't set up yet — missing VAPID env vars." });
    return;
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData?.user) {
    res.status(401).json({ error: "Invalid or expired session." });
    return;
  }
  const { data: adminRow, error: adminError } = await supabase
    .from("admins")
    .select("id")
    .eq("id", userData.user.id)
    .maybeSingle();
  if (adminError || !adminRow) {
    res.status(403).json({ error: "This account isn't authorized to send notifications." });
    return;
  }

  const { mockTitle } = req.body || {};
  if (!mockTitle) {
    res.status(400).json({ error: "Missing mockTitle." });
    return;
  }

  const { data: subscriptions, error: subsError } = await supabase.from("push_subscriptions").select("*");
  if (subsError) {
    res.status(500).json({ error: subsError.message });
    return;
  }

  webpush.setVapidDetails(vapidContact, vapidPublicKey, vapidPrivateKey);

  const payload = JSON.stringify({
    title: "New mock test available",
    body: mockTitle,
    url: "/",
  });

  const staleEndpoints = [];
  await Promise.all(
    (subscriptions || []).map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload
        );
      } catch (err) {
        // 404/410 means the browser itself dropped this subscription (e.g.
        // the student cleared site data) — clean it up rather than retrying
        // a dead endpoint on every future mock. Any other error (network
        // blip, push service hiccup) is left alone; it's not this
        // subscription's fault.
        if (err.statusCode === 404 || err.statusCode === 410) {
          staleEndpoints.push(sub.endpoint);
        }
      }
    })
  );

  if (staleEndpoints.length > 0) {
    await supabase.from("push_subscriptions").delete().in("endpoint", staleEndpoints);
  }

  res.status(200).json({ sent: (subscriptions || []).length - staleEndpoints.length, cleaned: staleEndpoints.length });
}

import { supabase } from "./supabaseClient";

// Calls the api/analyze-attempt serverless function with this attempt's data
// and the current admin session's access token. Throws with a readable
// message on any failure so the caller can just show err.message.
export async function analyzeAttempt(payload) {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;
  if (!token) throw new Error("You need to be signed in to the admin panel to run this.");

  const res = await fetch("/api/analyze-attempt", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(body?.error || `Analysis failed (${res.status}).`);
  }
  return body.analysis;
}

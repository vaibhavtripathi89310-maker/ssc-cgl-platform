// Vercel serverless function — the app's first-ever backend endpoint.
// Takes one finished mock attempt's answer data, asks Gemini's free-tier API
// for a structured, plain-English performance breakdown, and returns it.
// Gated to signed-in Supabase sessions only (i.e. the one admin account) —
// students never call this, and it's never reachable from the public
// results screen, only from the admin panel's own "Run" flow.
import { createClient } from "@supabase/supabase-js";

// Free-tier Gemini models get deprioritized under load and return a 503
// ("currently experiencing high demand") fairly often — that's Google's
// side, not a bug here, but making the user manually click "Try again"
// three times for something this transient is a bad experience. Retry a
// couple of times with a short backoff before actually surfacing an error.
export const config = { maxDuration: 60 };

async function callGeminiWithRetry(url, body, maxAttempts = 2) {
  let res;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) return res;
    const retryable = res.status === 503 || res.status === 429;
    if (!retryable || attempt === maxAttempts) return res;
    await new Promise((r) => setTimeout(r, attempt * 1500)); // 1.5s, then 3s
  }
  return res;
}

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    overallSummary: { type: "STRING" },
    mistakePatterns: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          topic: { type: "STRING" },
          whatWentWrong: { type: "STRING" },
          questionsAffected: { type: "INTEGER" },
        },
        required: ["topic", "whatWentWrong", "questionsAffected"],
      },
    },
    weakTopics: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          topic: { type: "STRING" },
          why: { type: "STRING" },
          howToFix: { type: "STRING" },
        },
        required: ["topic", "why", "howToFix"],
      },
    },
    strongTopics: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          topic: { type: "STRING" },
          why: { type: "STRING" },
        },
        required: ["topic", "why"],
      },
    },
    timeManagement: { type: "ARRAY", items: { type: "STRING" } },
    focusPlan: { type: "ARRAY", items: { type: "STRING" } },
    // One entry per wrong/skipped question, no grouping or skipping any —
    // this is the exhaustive, question-by-question part of the report.
    questionBreakdown: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          section: { type: "STRING" },
          topic: { type: "STRING" },
          questionSummary: { type: "STRING" },
          status: { type: "STRING" },
          whatWentWrong: { type: "STRING" },
          correctAnswerText: { type: "STRING" },
          keyFormulaOrConcept: { type: "STRING" },
          howToApproach: { type: "STRING" },
        },
        required: [
          "section", "topic", "questionSummary", "status", "whatWentWrong",
          "correctAnswerText", "keyFormulaOrConcept", "howToApproach",
        ],
      },
    },
  },
  required: ["overallSummary", "mistakePatterns", "weakTopics", "strongTopics", "timeManagement", "focusPlan", "questionBreakdown"],
};

function buildPrompt(data) {
  return `You are an expert exam coach reviewing one student's completed mock test attempt in detail.

Write your entire analysis in plain, simple, everyday English — no exam jargon, no vague generic advice. Be specific: reference the actual topics and question patterns from the data below, not generic tips like "practice more." Be honest but encouraging, like a good tutor who wants the student to improve.

Exam: ${data.examLabel}
Mock: ${data.mockTitle}
Score: ${data.score} / ${data.totalMarks}
Correct: ${data.correct}, Incorrect: ${data.incorrect}, Skipped: ${data.skipped}

Section-wise performance:
${JSON.stringify(data.sectionBreakdown, null, 2)}

Topic-wise accuracy (only topics the student actually attempted at least one question in):
${JSON.stringify(data.topicRows, null, 2)}

Questions the student got wrong or skipped (with the correct answer, what they picked instead, how long they spent vs. a fair pace for that question, and the official explanation):
${JSON.stringify(data.problemQuestions, null, 2)}

Questions the student got right, but spent unusually long on (possible time-management issue even though the answer was correct):
${JSON.stringify(data.slowCorrectQuestions, null, 2)}

Using only this data, produce:
1. overallSummary — 2-4 sentences giving the big picture of how this attempt went.
2. mistakePatterns — a short, high-level grouping of the wrong/skipped questions into real recurring patterns (e.g. "kept misreading negative signs in profit-loss questions"), each with how many questions it affected. This is just the quick-scan overview — the exhaustive detail belongs in questionBreakdown below, so don't try to cover everything here.
3. weakTopics — the topics that need the most work, each with why (the actual pattern causing errors there) and howToFix (a specific, actionable study suggestion, not generic).
4. strongTopics — topics the student is genuinely doing well in, and why (e.g. fast and accurate).
5. timeManagement — specific observations about pacing (questions rushed into wrong answers, questions where too much time was spent even though the answer was correct, sections that ran short or long).
6. focusPlan — a short ordered list (4-6 items) of the single most useful next actions for this student before their next attempt.
7. questionBreakdown — THE MOST IMPORTANT PART. Go through every single question listed in "Questions the student got wrong or skipped" above, one at a time, in the same order — do not group them, do not summarize multiple questions into one entry, do not skip any of them, even if two questions look similar. For each one give: section, topic, questionSummary (one sentence identifying which question this is), status ("incorrect" or "skipped"), whatWentWrong (the specific reasoning error if incorrect, or why this was a winnable question worth attempting if skipped — reference the actual explanation text given), correctAnswerText, keyFormulaOrConcept (name the exact formula, rule, or method needed to solve this specific question — this is the single most useful field, be precise and concrete, not vague), and howToApproach (a short step-by-step method for solving this type of question quickly next time).`;
}

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
  const geminiKey = process.env.GEMINI_API_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    res.status(500).json({ error: "Server misconfigured: missing Supabase env vars." });
    return;
  }
  if (!geminiKey) {
    res.status(500).json({ error: "AI analysis isn't set up yet — GEMINI_API_KEY is missing from the server's environment variables." });
    return;
  }

  // Proves the caller holds a valid, non-expired Supabase session — since
  // this project has exactly one account (the admin's own, created directly
  // in the Supabase dashboard), being signed in IS being the admin. Same
  // trust model AdminGate itself already uses.
  const supabase = createClient(supabaseUrl, supabaseAnonKey);
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData?.user) {
    res.status(401).json({ error: "Invalid or expired session." });
    return;
  }

  const attempt = req.body;
  if (!attempt || typeof attempt !== "object" || !Array.isArray(attempt.problemQuestions)) {
    res.status(400).json({ error: "Malformed request body." });
    return;
  }

  try {
    const model = process.env.GEMINI_MODEL || "gemini-3.6-flash";
    const geminiRes = await callGeminiWithRetry(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`,
      {
        contents: [{ parts: [{ text: buildPrompt(attempt) }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: RESPONSE_SCHEMA,
          temperature: 0.4,
          // A full question-by-question breakdown can run long for a mock
          // with many wrong/skipped questions — give it real headroom so it
          // doesn't get cut off mid-JSON.
          maxOutputTokens: 32768,
        },
      }
    );

    if (!geminiRes.ok) {
      const errText = await geminiRes.text().catch(() => "");
      const friendly =
        geminiRes.status === 503 || geminiRes.status === 429
          ? "The AI service is overloaded right now even after a few retries — this is Google's side, not this app. Wait a minute and try again."
          : `AI service error (${geminiRes.status}). ${errText.slice(0, 300)}`;
      res.status(502).json({ error: friendly });
      return;
    }

    const geminiData = await geminiRes.json();
    const candidate = geminiData?.candidates?.[0];
    const text = candidate?.content?.parts?.[0]?.text;
    if (!text) {
      res.status(502).json({ error: "AI service returned an empty response." });
      return;
    }

    let analysis;
    try {
      analysis = JSON.parse(text);
    } catch {
      const hint =
        candidate?.finishReason === "MAX_TOKENS"
          ? " The report got cut off mid-way — this mock likely has too many wrong/skipped questions for one response. Try again, or ask to shorten the per-question breakdown."
          : "";
      res.status(502).json({ error: `AI service returned malformed data.${hint}` });
      return;
    }

    res.status(200).json({ analysis });
  } catch (err) {
    res.status(500).json({ error: err.message || "Unexpected server error." });
  }
}

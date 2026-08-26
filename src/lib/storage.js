import { supabase } from "./supabaseClient";

// ============================================================================
// STORAGE — Supabase-backed replacement for the old localStorage layer.
// Same five function names/signatures as before, so every call site in
// App.jsx (AdminPanel, StudentApp, MockEditorView, SectionManager) works
// unchanged. Callers pass the *entire* mocks array / question section-map on
// every save (that's how the old localStorage version worked too), so each
// save here reconciles the table against what's passed in: upsert what's
// present, delete whatever's no longer there.
// ============================================================================

const SECTION_KEYS = ["gi_reasoning", "general_awareness", "quant_aptitude", "english_comprehension"];
const emptySectionMap = () => Object.fromEntries(SECTION_KEYS.map((k) => [k, []]));

function mockToRow(m) {
  return {
    id: m.id,
    mock_number: m.mockNumber,
    title: m.title,
    description: m.description || "",
    instructions: m.instructions || "",
    duration: m.duration,
    total_marks: m.totalMarks,
    negative_marking: m.negativeMarking,
    status: m.status,
    mock_type: m.mockType,
    sectional_key: m.sectionalKey ?? null,
    sectional_question_count: m.sectionalQuestionCount ?? null,
    video_url: m.videoUrl ?? null,
    created_at: m.createdAt,
    updated_at: m.updatedAt,
  };
}

function rowToMock(r) {
  return {
    id: r.id,
    mockNumber: r.mock_number,
    title: r.title,
    description: r.description || "",
    instructions: r.instructions || "",
    duration: r.duration,
    totalMarks: r.total_marks,
    negativeMarking: r.negative_marking,
    status: r.status,
    mockType: r.mock_type,
    sectionalKey: r.sectional_key,
    sectionalQuestionCount: r.sectional_question_count,
    videoUrl: r.video_url ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function loadMocksIndex() {
  const { data, error } = await supabase.from("mocks").select("*");
  if (error) throw error;
  return (data || []).map(rowToMock);
}

export async function saveMocksIndex(list) {
  const { data: existingRows, error: fetchErr } = await supabase.from("mocks").select("id");
  if (fetchErr) throw fetchErr;
  const existingIds = new Set((existingRows || []).map((r) => r.id));
  const newIds = new Set(list.map((m) => m.id));

  const idsToDelete = [...existingIds].filter((id) => !newIds.has(id));
  if (idsToDelete.length > 0) {
    const { error: delErr } = await supabase.from("mocks").delete().in("id", idsToDelete);
    if (delErr) throw delErr;
  }

  if (list.length > 0) {
    const { error: upsertErr } = await supabase.from("mocks").upsert(list.map(mockToRow));
    if (upsertErr) throw upsertErr;
  }
}

export async function loadMockQuestions(mockId) {
  const { data, error } = await supabase
    .from("questions")
    .select("*")
    .eq("mock_id", mockId)
    .order("section_key", { ascending: true })
    .order("position", { ascending: true });
  if (error) throw error;

  const map = emptySectionMap();
  for (const r of data || []) {
    if (!map[r.section_key]) map[r.section_key] = [];
    map[r.section_key].push({
      id: r.id,
      text: r.text,
      options: r.options,
      answer: r.answer,
      explanation: r.explanation,
      difficulty: r.difficulty,
      topic: r.topic ?? null,
    });
  }
  return map;
}

export async function saveMockQuestions(mockId, data) {
  const { data: existingRows, error: fetchErr } = await supabase
    .from("questions")
    .select("id")
    .eq("mock_id", mockId);
  if (fetchErr) throw fetchErr;
  const existingIds = new Set((existingRows || []).map((r) => r.id));

  const newRows = [];
  const newIds = new Set();
  for (const [sectionKey, list] of Object.entries(data)) {
    (list || []).forEach((q, i) => {
      newIds.add(q.id);
      newRows.push({
        id: q.id,
        mock_id: mockId,
        section_key: sectionKey,
        position: i,
        text: q.text,
        options: q.options,
        answer: q.answer,
        explanation: q.explanation,
        difficulty: q.difficulty,
        topic: q.topic ?? null,
      });
    });
  }

  const idsToDelete = [...existingIds].filter((id) => !newIds.has(id));
  if (idsToDelete.length > 0) {
    const { error: delErr } = await supabase.from("questions").delete().eq("mock_id", mockId).in("id", idsToDelete);
    if (delErr) throw delErr;
  }

  if (newRows.length > 0) {
    const { error: upsertErr } = await supabase.from("questions").upsert(newRows, { onConflict: "mock_id,id" });
    if (upsertErr) throw upsertErr;
  }
}

export async function deleteMockQuestions(mockId) {
  const { error } = await supabase.from("questions").delete().eq("mock_id", mockId);
  if (error) throw error;
}

// ============================================================================
// ATTEMPT HISTORY — anonymous, per-device (see src/lib/device.js). Powers
// rank/percentile, "your progress over time", and cross-mock weak-topic
// aggregation. No personal info involved: device_id is just a random id
// generated in the browser, never tied to a name/phone/email.
// ============================================================================
export async function saveAttempt(attempt) {
  const { error } = await supabase.from("attempts").insert({
    id: attempt.id,
    device_id: attempt.deviceId,
    mock_id: attempt.mockId,
    score: attempt.score,
    correct: attempt.correct,
    incorrect: attempt.incorrect,
    skipped: attempt.skipped,
    total_time: attempt.totalTime,
    topic_breakdown: attempt.topicBreakdown,
    answers: attempt.answers,
    time_spent: attempt.timeSpent,
  });
  if (error) throw error;
}

export async function loadAttemptById(id) {
  const { data, error } = await supabase.from("attempts").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    id: data.id,
    deviceId: data.device_id,
    mockId: data.mock_id,
    score: data.score,
    correct: data.correct,
    incorrect: data.incorrect,
    skipped: data.skipped,
    totalTime: data.total_time,
    topicBreakdown: data.topic_breakdown || [],
    answers: data.answers || {},
    timeSpent: data.time_spent || {},
    createdAt: data.created_at,
  };
}

// Every attempt's id+score for a mock, sorted best-first — powers both
// percentile ("better than X% of students") and the top-scores leaderboard
// from one query. RLS only exposes attempts for published mocks, same as
// questions.
export async function loadMockScores(mockId) {
  const { data, error } = await supabase
    .from("attempts")
    .select("id, score")
    .eq("mock_id", mockId)
    .order("score", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function loadDeviceAttempts(deviceId) {
  const { data, error } = await supabase
    .from("attempts")
    .select("*")
    .eq("device_id", deviceId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data || []).map((r) => ({
    id: r.id,
    mockId: r.mock_id,
    score: r.score,
    correct: r.correct,
    incorrect: r.incorrect,
    skipped: r.skipped,
    totalTime: r.total_time,
    topicBreakdown: r.topic_breakdown || [],
    createdAt: r.created_at,
  }));
}

// Pulls real questions tagged with any of the given topics, for the
// "practice your weak topics" mode — RLS already restricts this to
// questions belonging to published mocks, same guarantee as everywhere else
// a student reads questions.
export async function loadQuestionsByTopics(topics, limit = 20) {
  if (!topics || topics.length === 0) return [];
  const { data, error } = await supabase.from("questions").select("*").in("topic", topics).limit(limit);
  if (error) throw error;
  return (data || []).map((r) => ({
    id: r.id,
    text: r.text,
    options: r.options,
    answer: r.answer,
    explanation: r.explanation,
    difficulty: r.difficulty,
    topic: r.topic ?? null,
  }));
}

// ============================================================================
// CUTOFFS — admin-entered historical SSC CGL cutoff scores, shown against a
// student's Full Mock score. Simple CRUD (a handful of rows at most), unlike
// mocks/questions there's no "whole list" reconciliation here.
// ============================================================================
export async function loadCutoffs() {
  const { data, error } = await supabase.from("cutoffs").select("*").order("year", { ascending: false });
  if (error) throw error;
  return (data || []).map((r) => ({ id: r.id, year: r.year, cutoff: r.cutoff }));
}

export async function addCutoff(cutoff) {
  const { error } = await supabase.from("cutoffs").insert({ id: cutoff.id, year: cutoff.year, cutoff: cutoff.cutoff });
  if (error) throw error;
}

export async function deleteCutoff(id) {
  const { error } = await supabase.from("cutoffs").delete().eq("id", id);
  if (error) throw error;
}

// ============================================================================
// CHALLENGES — async "challenge a friend": one attempt creates a shareable
// link, whoever opens it takes the same mock, and once both are done either
// side can view a full side-by-side answer sheet. No login involved — "who
// am I in this challenge" is worked out by matching this device's id against
// the device_id on the creator/opponent attempt rows.
// ============================================================================
export async function createChallenge({ id, mockId, creatorAttemptId }) {
  const { error } = await supabase.from("challenges").insert({ id, mock_id: mockId, creator_attempt_id: creatorAttemptId });
  if (error) throw error;
}

export async function loadChallenge(id) {
  const { data, error } = await supabase.from("challenges").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    id: data.id,
    mockId: data.mock_id,
    creatorAttemptId: data.creator_attempt_id,
    opponentAttemptId: data.opponent_attempt_id,
    creatorReaction: data.creator_reaction,
    opponentReaction: data.opponent_reaction,
  };
}

// Only succeeds if nobody has claimed the opponent slot yet — guards against
// two different people opening the same link and both trying to accept it.
export async function claimOpponentSlot(challengeId, attemptId) {
  const { data, error } = await supabase
    .from("challenges")
    .update({ opponent_attempt_id: attemptId })
    .eq("id", challengeId)
    .is("opponent_attempt_id", null)
    .select("id");
  if (error) throw error;
  return (data || []).length > 0;
}

export async function setChallengeReaction(challengeId, role, reaction) {
  const column = role === "creator" ? "creator_reaction" : "opponent_reaction";
  const { error } = await supabase.from("challenges").update({ [column]: reaction }).eq("id", challengeId);
  if (error) throw error;
}

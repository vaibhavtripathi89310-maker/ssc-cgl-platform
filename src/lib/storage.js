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

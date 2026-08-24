import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  LayoutDashboard, ListChecks, Plus, Search, Pencil, Eye, Copy, Trash2,
  CheckCircle2, XCircle, AlertCircle, ChevronUp, ChevronDown, Upload,
  ArrowLeft, Save, X, Lock, Play, Clock, Flag, Download,
} from "lucide-react";

// ============================================================================
// MATH RENDERING
//
// No external math library (KaTeX/MathJax) is bundled — this is a small
// self-contained parser instead: it turns common math notation into real
// HTML with proper superscripts, subscripts, fractions, and roots, not full
// LaTeX, but genuine visual typesetting instead of raw "x^2" text.
//
// Supported input, written directly in question text/options/explanations:
//   x^2, x^(2n+1)          -> superscript
//   x_1, x_(max)           -> subscript
//   sqrt(5), sqrt(x^2+1)   -> radical sign over the contents
//   1/x, (a+b)/(c-d)       -> stacked fraction (a on top of b)
//   \pi \theta \alpha etc  -> Greek letters
//   \times \div \le \ge \ne \pm \infty -> math symbols
// Plain English text around/between these is left completely untouched.
// ============================================================================
const GREEK = {
  "\\alpha": "α", "\\beta": "β", "\\gamma": "γ", "\\delta": "δ", "\\theta": "θ",
  "\\lambda": "λ", "\\mu": "μ", "\\pi": "π", "\\sigma": "σ", "\\phi": "φ",
  "\\omega": "ω", "\\Delta": "Δ", "\\Sigma": "Σ", "\\Omega": "Ω",
};
const SYMBOLS = {
  "\\times": "×", "\\div": "÷", "\\le": "≤", "\\ge": "≥", "\\ne": "≠",
  "\\pm": "±", "\\infty": "∞", "\\cdot": "·", "\\approx": "≈",
};

function grabGroup(str, start) {
  if (start >= str.length) return { text: "", next: start };
  const open = str[start];
  if (open === "(" || open === "{") {
    const close = open === "(" ? ")" : "}";
    let depth = 1, i = start + 1;
    while (i < str.length && depth > 0) {
      if (str[i] === open) depth++;
      else if (str[i] === close) depth--;
      i++;
    }
    return { text: str.slice(start + 1, i - 1), next: i };
  }
  let i = start;
  if (str[i] === "-") i++;
  while (i < str.length && /[A-Za-z0-9.]/.test(str[i])) i++;
  return { text: str.slice(start, i), next: i };
}

function parseMathSegment(segment, keyPrefix) {
  const nodes = [];
  let i = 0;
  let buffer = "";
  let key = 0;
  const flush = () => {
    if (buffer) {
      nodes.push(<span key={`${keyPrefix}-t${key++}`}>{buffer}</span>);
      buffer = "";
    }
  };

  while (i < segment.length) {
    const rest = segment.slice(i);

    const sqrtMatch = rest.match(/^sqrt/);
    if (sqrtMatch && (segment[i + 4] === "(" || segment[i + 4] === "{")) {
      flush();
      const { text, next } = grabGroup(segment, i + 4);
      nodes.push(
        <span key={`${keyPrefix}-r${key++}`} style={{ whiteSpace: "nowrap" }}>
          <span style={{ fontSize: "0.95em" }}>√</span>
          <span style={{ borderTop: "1.5px solid currentColor", paddingLeft: 2, paddingTop: 1 }}>
            {parseMathSegment(text, `${keyPrefix}-r${key}`)}
          </span>
        </span>
      );
      i = next;
      continue;
    }

    if (segment[i] === "\\") {
      const cmdMatch = rest.match(/^\\[A-Za-z]+/);
      if (cmdMatch) {
        const cmd = cmdMatch[0];
        if (GREEK[cmd] || SYMBOLS[cmd]) {
          flush();
          nodes.push(<span key={`${keyPrefix}-g${key++}`}>{GREEK[cmd] || SYMBOLS[cmd]}</span>);
          i += cmd.length;
          continue;
        }
      }
    }

    if (segment[i] === "^") {
      flush();
      const { text, next } = grabGroup(segment, i + 1);
      nodes.push(
        <sup key={`${keyPrefix}-s${key++}`} style={{ fontSize: "0.75em" }}>
          {parseMathSegment(text, `${keyPrefix}-s${key}`)}
        </sup>
      );
      i = next;
      continue;
    }

    if (segment[i] === "_") {
      flush();
      const { text, next } = grabGroup(segment, i + 1);
      nodes.push(
        <sub key={`${keyPrefix}-b${key++}`} style={{ fontSize: "0.75em" }}>
          {parseMathSegment(text, `${keyPrefix}-b${key}`)}
        </sub>
      );
      i = next;
      continue;
    }

    buffer += segment[i];
    i++;
  }
  flush();
  return nodes;
}

function parseWithFractions(segment, keyPrefix) {
  const fracPattern = /(\([^)]+\)|\{[^}]+\}|[A-Za-z0-9]+(?:\^[A-Za-z0-9(){}]+)?)\/(\([^)]+\)|\{[^}]+\}|[A-Za-z0-9]+(?:\^[A-Za-z0-9(){}]+)?)/;
  const match = segment.match(fracPattern);
  if (!match) return parseMathSegment(segment, keyPrefix);

  const before = segment.slice(0, match.index);
  const after = segment.slice(match.index + match[0].length);
  const stripWrap = (s) => (((s[0] === "(" && s[s.length - 1] === ")") || (s[0] === "{" && s[s.length - 1] === "}")) ? s.slice(1, -1) : s);
  const num = stripWrap(match[1]);
  const den = stripWrap(match[2]);

  return [
    ...(before ? parseMathSegment(before, `${keyPrefix}-pre`) : []),
    <span key={`${keyPrefix}-frac`} style={{ display: "inline-flex", flexDirection: "column", verticalAlign: "middle", textAlign: "center", margin: "0 2px", fontSize: "0.9em", lineHeight: 1.1 }}>
      <span style={{ borderBottom: "1.5px solid currentColor", padding: "0 3px 1px" }}>{parseMathSegment(num, `${keyPrefix}-n`)}</span>
      <span style={{ padding: "1px 3px 0" }}>{parseMathSegment(den, `${keyPrefix}-d`)}</span>
    </span>,
    ...(after ? parseWithFractions(after, `${keyPrefix}-post`) : []),
  ];
}

function MathText({ text }) {
  if (!text) return null;
  const hasMathChars = /[\^_/\\]|sqrt/.test(text);
  if (!hasMathChars) return <>{text}</>;
  return <>{parseWithFractions(text, "m")}</>;
}

// ============================================================================
// CONSTANTS
// ============================================================================
const SECTIONS = [
  { key: "gi_reasoning", label: "General Intelligence & Reasoning" },
  { key: "general_awareness", label: "General Awareness" },
  { key: "quant_aptitude", label: "Quantitative Aptitude" },
  { key: "english_comprehension", label: "English Comprehension" },
];
const REQUIRED_PER_SECTION = 25;
const MOCK_TYPES = { FULL: "full", SECTIONAL: "sectional" };
// Backward compatibility: any mock created before this feature existed (or
// any mock object that's momentarily undefined during a render) has no
// mockType field at all. Treat that — and any value that isn't literally
// "sectional" — as a Full Mock. This is the single source of truth for
// "what type is this mock" so nothing downstream re-implements the check.
function getMockType(mock) {
  return mock && mock.mockType === MOCK_TYPES.SECTIONAL ? MOCK_TYPES.SECTIONAL : MOCK_TYPES.FULL;
}
// Sections a given mock actually uses — Full Mock uses all four (unchanged
// behavior, including for any old mock with no mockType); Sectional Mock
// uses exactly the one section it was created for.
function sectionsForMock(mock) {
  if (getMockType(mock) === MOCK_TYPES.SECTIONAL) {
    const found = SECTIONS.filter((s) => s.key === mock.sectionalKey);
    // If sectionalKey is somehow missing/invalid, fall back to all sections
    // rather than returning an empty list that would render a blank app.
    return found.length ? found : SECTIONS;
  }
  return SECTIONS;
}
// How many questions a given section must have in THIS mock — 25 for every
// section of a Full Mock (unchanged), or the admin-configured count for the
// one section of a Sectional Mock.
function requiredCountFor(mock, sectionKey) {
  if (getMockType(mock) === MOCK_TYPES.SECTIONAL) {
    return mock.sectionalKey === sectionKey ? mock.sectionalQuestionCount || REQUIRED_PER_SECTION : 0;
  }
  return REQUIRED_PER_SECTION;
}
function mockTypeBadgeLabel(mock) {
  if (getMockType(mock) === MOCK_TYPES.SECTIONAL) {
    const short = { gi_reasoning: "REASONING", general_awareness: "GA", quant_aptitude: "QUANT", english_comprehension: "ENGLISH" };
    return `SECTIONAL — ${short[mock.sectionalKey] || "?"}`;
  }
  return "FULL MOCK";
}
const DIFFICULTIES = ["Easy", "Moderate", "Hard", "Very Hard", "Extremely Hard", "Crazy Hard"];
const DIFFICULTY_COLORS = {
  Easy: "bg-emerald-100 text-emerald-700",
  Moderate: "bg-blue-100 text-blue-700",
  Hard: "bg-amber-100 text-amber-700",
  "Very Hard": "bg-orange-100 text-orange-700",
  "Extremely Hard": "bg-red-100 text-red-700",
  "Crazy Hard": "bg-purple-100 text-purple-700",
};
const LETTERS = ["A", "B", "C", "D"];

// ============================================================================
// PURE HELPERS
// ============================================================================
function generateId(prefix) {
  const rand =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  return `${prefix}_${rand}`;
}
const nowISO = () => new Date().toISOString();
function formatTime(totalSec) {
  const m = Math.floor(totalSec / 60).toString().padStart(2, "0");
  const s = Math.floor(totalSec % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}
const nextMockNumber = (list) => (list.length ? Math.max(...list.map((m) => m.mockNumber || 0)) + 1 : 1);
const sectionLabel = (key) => SECTIONS.find((s) => s.key === key)?.label || key;
const emptySectionMap = () => Object.fromEntries(SECTIONS.map((s) => [s.key, []]));

function normalizeSectionLabel(input) {
  if (!input || typeof input !== "string") return null;
  const s = input.trim().toLowerCase();
  const found = SECTIONS.find((sec) => {
    if (sec.label.toLowerCase() === s || sec.key === s) return true;
    if (sec.key === "gi_reasoning" && s.includes("reasoning")) return true;
    if (sec.key === "general_awareness" && (s.includes("awareness") || s === "ga")) return true;
    if (sec.key === "quant_aptitude" && (s.includes("quant") || s.includes("maths") || s.includes("math"))) return true;
    if (sec.key === "english_comprehension" && s.includes("english")) return true;
    return false;
  });
  return found ? found.key : null;
}

// ============================================================================
// STORAGE
// Standalone equivalent of the artifact platform's window.storage API — this
// app previously ran only inside a Claude artifact, where window.storage is
// provided by the host. Outside Claude that API doesn't exist, so this is
// the one Claude-specific runtime dependency the app had. Replaced with the
// browser's own localStorage, wrapped behind the exact same function names
// and async signatures used everywhere else in this file, so no other call
// site anywhere in Admin or Student needed to change.
// ============================================================================
const LS_PREFIX = "ssccgl:";

async function loadMocksIndex() {
  try {
    const raw = localStorage.getItem(`${LS_PREFIX}admin:mocks-index`);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}
async function saveMocksIndex(list) {
  localStorage.setItem(`${LS_PREFIX}admin:mocks-index`, JSON.stringify(list));
}
async function loadMockQuestions(mockId) {
  try {
    const raw = localStorage.getItem(`${LS_PREFIX}admin:mock:${mockId}:questions`);
    return raw ? JSON.parse(raw) : emptySectionMap();
  } catch {
    return emptySectionMap();
  }
}
async function saveMockQuestions(mockId, data) {
  localStorage.setItem(`${LS_PREFIX}admin:mock:${mockId}:questions`, JSON.stringify(data));
}
async function deleteMockQuestions(mockId) {
  try {
    localStorage.removeItem(`${LS_PREFIX}admin:mock:${mockId}:questions`);
  } catch {
    /* key may not exist yet — fine */
  }
}

// ============================================================================
// VALIDATION — all-or-nothing: any invalid row blocks the entire import
// ============================================================================
function validateImportJSON(rawText, sectionKey, existingIdsInMock, currentCount, maxAllowed) {
  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch (e) {
    return { ok: false, errors: [{ index: null, message: `Invalid JSON — ${e.message}` }], questions: [] };
  }
  if (!Array.isArray(parsed)) {
    return { ok: false, errors: [{ index: null, message: "Top-level JSON must be an array of questions." }], questions: [] };
  }
  if (parsed.length === 0) {
    return { ok: false, errors: [{ index: null, message: "Array is empty — nothing to import." }], questions: [] };
  }

  // Hard cap check FIRST, before touching individual rows — this is a
  // strict maximum with no exceptions, so block the whole import up front
  // and say exactly why, rather than letting it partially land.
  const resultingTotal = currentCount + parsed.length;
  if (resultingTotal > maxAllowed) {
    const roomLeft = Math.max(0, maxAllowed - currentCount);
    return {
      ok: false,
      errors: [
        {
          index: null,
          message: `This section already has ${currentCount}/${maxAllowed}. Importing ${parsed.length} more would make ${resultingTotal}/${maxAllowed} — over the strict maximum. Only ${roomLeft} more question${roomLeft === 1 ? "" : "s"} can be added here. Reduce the batch, or use "Replace Existing Questions" if you want to start this section over.`,
        },
      ],
      questions: [],
    };
  }

  const errors = [];
  const seenInBatch = new Set();
  const cleaned = [];

  parsed.forEach((q, i) => {
    const n = i + 1;
    const fail = (msg) => errors.push({ index: n, message: msg });

    if (!q || typeof q !== "object") return fail("Not a valid question object.");
    if (!q.id || typeof q.id !== "string") return fail("Missing or invalid 'id'.");
    if (seenInBatch.has(q.id)) return fail(`Duplicate id "${q.id}" within this upload.`);
    if (existingIdsInMock.has(q.id)) return fail(`id "${q.id}" already exists elsewhere in this mock.`);
    if (!q.text || typeof q.text !== "string" || !q.text.trim()) return fail("Missing question text.");
    if (!Array.isArray(q.options) || q.options.length !== 4)
      return fail(`Expected exactly 4 options, got ${Array.isArray(q.options) ? q.options.length : "none"}.`);
    if (q.options.some((o) => typeof o !== "string" || !o.trim())) return fail("One or more options are empty.");
    if (![0, 1, 2, 3].includes(q.answer)) return fail(`Invalid answer index "${q.answer}" — must be 0, 1, 2, or 3.`);
    if (!q.explanation || typeof q.explanation !== "string" || !q.explanation.trim()) return fail("Missing explanation.");
    if (q.section) {
      const normalized = normalizeSectionLabel(q.section);
      if (normalized && normalized !== sectionKey) {
        return fail(`"section": "${q.section}" doesn't match ${sectionLabel(sectionKey)} — wrong upload box?`);
      }
    }

    seenInBatch.add(q.id);
    cleaned.push({
      id: q.id,
      text: q.text.trim(),
      options: q.options.map((o) => o.trim()),
      answer: q.answer,
      explanation: q.explanation.trim(),
      difficulty: DIFFICULTIES.includes(q.difficulty) ? q.difficulty : "Moderate",
    });
  });

  return { ok: errors.length === 0, errors, questions: errors.length === 0 ? cleaned : [] };
}

// ============================================================================
// SMALL UI ATOMS
// ============================================================================
function StatusBadge({ status }) {
  return status === "published" ? (
    <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
      <CheckCircle2 size={11} /> Published
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-slate-200 text-slate-600">
      Draft
    </span>
  );
}

function Toast({ toast }) {
  if (!toast) return null;
  const isError = toast.type === "error";
  return (
    <div
      className={`fixed bottom-5 right-5 z-50 max-w-sm rounded-lg shadow-lg px-4 py-3 text-sm flex items-start gap-2 ${
        isError ? "bg-red-600 text-white" : "bg-slate-900 text-white"
      }`}
    >
      {isError ? <AlertCircle size={16} className="mt-0.5 shrink-0" /> : <CheckCircle2 size={16} className="mt-0.5 shrink-0" />}
      {toast.message}
    </div>
  );
}

function ConfirmModal({ title, body, confirmLabel, danger, onConfirm, onCancel }) {
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-sm w-full p-5">
        <h3 className="font-semibold text-slate-800 mb-1.5">{title}</h3>
        <p className="text-sm text-slate-500 mb-5">{body}</p>
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="px-4 py-2 text-sm rounded-md border border-slate-200 text-slate-600">
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className={`px-4 py-2 text-sm rounded-md text-white ${danger ? "bg-red-600" : "bg-blue-900"}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// IMPORT DATA — one-time migration path for mocks exported from the old
// storage backend. Parses the file, shows exactly what will be imported,
// and only writes on explicit confirm.
// ============================================================================
function ImportDataView({ onImport }) {
  const [fileName, setFileName] = useState("");
  const [parsed, setParsed] = useState(null);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [importing, setImporting] = useState(false);

  function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError("");
    setResult(null);
    setParsed(null);
    setFileName(file.name);

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (!Array.isArray(data.mocksIndex) || typeof data.questionsByMock !== "object") {
          setError("This file doesn't look like a valid export — missing mocksIndex or questionsByMock.");
          return;
        }
        setParsed(data);
      } catch (err) {
        setError(`Couldn't read this file as JSON — ${err.message}`);
      }
    };
    reader.onerror = () => setError("Couldn't read the file.");
    reader.readAsText(file);
  }

  async function confirmImport() {
    setImporting(true);
    try {
      const outcome = await onImport(parsed);
      setResult(outcome);
      setParsed(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setImporting(false);
    }
  }

  const totalQuestionsInFile = parsed
    ? Object.values(parsed.questionsByMock).reduce(
        (sum, qMap) => sum + Object.values(qMap || {}).reduce((s, arr) => s + (Array.isArray(arr) ? arr.length : 0), 0),
        0
      )
    : 0;

  return (
    <div className="max-w-xl">
      <div className="bg-white border border-slate-200 rounded-lg p-6">
        <h2 className="text-sm font-semibold text-slate-700 mb-1">Import mock data</h2>
        <p className="text-xs text-slate-500 mb-4">
          Load a data export file (created with the export tool) to bring existing mocks and questions into this
          app. Existing mocks already here are never overwritten — imported mocks are added alongside them.
        </p>

        <label className="block border-2 border-dashed border-slate-200 rounded-lg p-6 text-center cursor-pointer hover:border-blue-300">
          <input type="file" accept=".json,application/json" onChange={handleFile} className="hidden" />
          <span className="text-sm text-slate-500">{fileName || "Click to choose a .json export file"}</span>
        </label>

        {error && (
          <div className="mt-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-md px-3 py-2">{error}</div>
        )}

        {parsed && (
          <div className="mt-4">
            <div className="bg-blue-50 border border-blue-200 rounded-md px-3 py-2 text-sm text-blue-800 mb-3">
              Found {parsed.mocksIndex.length} mock{parsed.mocksIndex.length === 1 ? "" : "s"} · {totalQuestionsInFile} question
              {totalQuestionsInFile === 1 ? "" : "s"} in this file.
            </div>
            <ul className="text-xs text-slate-500 mb-4 space-y-1 max-h-40 overflow-auto">
              {parsed.mocksIndex.map((m) => (
                <li key={m.id} className="flex justify-between bg-slate-50 rounded px-2 py-1">
                  <span>{m.title}</span>
                  <span className="text-slate-400">{m.status}</span>
                </li>
              ))}
            </ul>
            <button
              onClick={confirmImport}
              disabled={importing}
              className="w-full bg-blue-900 text-white text-sm font-medium rounded-lg py-2.5 disabled:opacity-50"
            >
              {importing ? "Importing..." : `Import ${parsed.mocksIndex.length} mock${parsed.mocksIndex.length === 1 ? "" : "s"}`}
            </button>
          </div>
        )}

        {result && (
          <div className="mt-4 bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm rounded-md px-3 py-2">
            Imported {result.mockCount} mock{result.mockCount === 1 ? "" : "s"} and {result.questionCount} question
            {result.questionCount === 1 ? "" : "s"}. Check Mock Tests to see them.
          </div>
        )}
      </div>
    </div>
  );
}

function DashboardView({ mocksIndex, questionCounts, onGoList, onCreateNew }) {
  const published = mocksIndex.filter((m) => m.status === "published").length;
  const draft = mocksIndex.length - published;
  const totalQuestions = Object.values(questionCounts).reduce((sum, n) => sum + n, 0);

  const cards = [
    { label: "Mock Tests", value: mocksIndex.length },
    { label: "Published", value: published },
    { label: "Draft", value: draft },
    { label: "Questions", value: totalQuestions },
  ];

  return (
    <div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        {cards.map((c) => (
          <div key={c.label} className="bg-white border border-slate-200 rounded-lg p-4">
            <div className="text-2xl font-semibold text-slate-800">{c.value}</div>
            <div className="text-xs text-slate-500 mt-0.5">{c.label}</div>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-slate-700">Recent mocks</h2>
        <button onClick={onGoList} className="text-xs text-blue-700 font-medium">
          View all →
        </button>
      </div>

      {mocksIndex.length === 0 ? (
        <div className="bg-white border border-dashed border-slate-200 rounded-lg p-10 text-center">
          <p className="text-sm text-slate-400 mb-3">No mocks yet.</p>
          <button
            onClick={onCreateNew}
            className="inline-flex items-center gap-1.5 bg-blue-900 text-white text-sm px-4 py-2 rounded-md"
          >
            <Plus size={15} /> Create New Mock Test
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {[...mocksIndex]
            .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
            .slice(0, 5)
            .map((m) => (
              <div key={m.id} className="bg-white border border-slate-200 rounded-lg px-4 py-3 flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-slate-800">{m.title}</div>
                  <div className="text-xs text-slate-400">Mock {String(m.mockNumber).padStart(2, "0")}</div>
                </div>
                <StatusBadge status={m.status} />
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// MOCK LIST
// ============================================================================
function MockListView({ mocksIndex, questionCounts, onEdit, onPreview, onRun, onDuplicate, onTogglePublish, onDeleteRequest }) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all"); // 'all' | 'full' | 'sectional'

  const filtered = mocksIndex.filter((m) => {
    const matchesQuery =
      !query ||
      m.title.toLowerCase().includes(query.toLowerCase()) ||
      String(m.mockNumber).includes(query);
    const matchesStatus = statusFilter === "all" || m.status === statusFilter;
    const matchesType = typeFilter === "all" || getMockType(m) === typeFilter;
    return matchesQuery && matchesStatus && matchesType;
  });

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-4">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-2.5 top-2.5 text-slate-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by title or mock number..."
            className="w-full text-sm border border-slate-200 rounded-md pl-8 pr-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-200"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="text-sm border border-slate-200 rounded-md px-3 py-2"
        >
          <option value="all">All statuses</option>
          <option value="published">Published</option>
          <option value="draft">Draft</option>
        </select>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="text-sm border border-slate-200 rounded-md px-3 py-2"
        >
          <option value="all">All mock types</option>
          <option value={MOCK_TYPES.FULL}>Full Mock</option>
          <option value={MOCK_TYPES.SECTIONAL}>Sectional Mock</option>
        </select>
      </div>

      {filtered.length === 0 ? (
        <div className="bg-white border border-dashed border-slate-200 rounded-lg p-10 text-center text-sm text-slate-400">
          No mocks match.
        </div>
      ) : (
        <div className="space-y-3">
          {filtered
            .sort((a, b) => a.mockNumber - b.mockNumber)
            .map((m) => {
              const applicableSections = sectionsForMock(m);
              const totalRequired = applicableSections.reduce((sum, s) => sum + requiredCountFor(m, s.key), 0);
              const total = (questionCounts[`${m.id}:total`]) ?? null;
              return (
                <div key={m.id} className="bg-white border border-slate-200 rounded-lg p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-xs text-slate-400 font-medium mb-0.5 flex items-center gap-1.5">
                        MOCK {String(m.mockNumber).padStart(2, "0")}
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${getMockType(m) === MOCK_TYPES.SECTIONAL ? "bg-purple-100 text-purple-700" : "bg-blue-100 text-blue-700"}`}>
                          {mockTypeBadgeLabel(m)}
                        </span>
                      </div>
                      <div className="font-semibold text-slate-800">{m.title}</div>
                      <div className="text-xs text-slate-400 mt-0.5">
                        {total !== null ? `${total}/${totalRequired} Questions` : "Loading..."}
                      </div>
                    </div>
                    <StatusBadge status={m.status} />
                  </div>

                  <div className="flex flex-wrap gap-1.5 mt-3">
                    <button onClick={() => onEdit(m.id)} className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md border border-slate-200 text-slate-600">
                      <Pencil size={12} /> Edit
                    </button>
                    <button onClick={() => onPreview(m.id)} className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md border border-slate-200 text-slate-600">
                      <Eye size={12} /> Preview
                    </button>
                    <button onClick={() => onRun(m.id)} className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md border border-emerald-200 text-emerald-700 bg-emerald-50">
                      <Play size={12} /> Run Mock
                    </button>
                    <button onClick={() => onDuplicate(m)} className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md border border-slate-200 text-slate-600">
                      <Copy size={12} /> Duplicate
                    </button>
                    <button
                      onClick={() => onTogglePublish(m)}
                      className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md border border-slate-200 text-slate-600"
                    >
                      {m.status === "published" ? "Unpublish" : "Publish"}
                    </button>
                    <button
                      onClick={() => onDeleteRequest(m)}
                      className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md border border-red-200 text-red-600 ml-auto"
                    >
                      <Trash2 size={12} /> Delete
                    </button>
                  </div>
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// MOCK EDITOR (metadata + 4 section cards)
// ============================================================================
function MockEditorView({ mock, questions, onSaveMeta, onOpenSection, onTogglePublish, onRun, onDirtyChange }) {
  const [form, setForm] = useState(mock);
  const [saved, setSaved] = useState(true);

  useEffect(() => {
    setForm(mock);
    setSaved(true);
  }, [mock.id]);

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
    setSaved(false);
    onDirtyChange(true);
  }

  function handleSave() {
    onSaveMeta(form);
    setSaved(true);
    onDirtyChange(false);
  }

  function goToSection(sectionKey) {
    // Guarantee the parent's activeMock reflects the current form before
    // SectionManager mounts with it — otherwise a not-yet-saved sectionalKey
    // / sectionalQuestionCount means the section screen opens against the
    // OLD mock object and shows the wrong (or 0) required count.
    if (!saved) {
      onSaveMeta(form);
      setSaved(true);
      onDirtyChange(false);
    }
    onOpenSection(sectionKey);
  }

  const formType = form.mockType === MOCK_TYPES.SECTIONAL ? MOCK_TYPES.SECTIONAL : MOCK_TYPES.FULL;
  const applicableSections = sectionsForMock(form);
  const totalQs = applicableSections.reduce((sum, s) => sum + (questions[s.key]?.length || 0), 0);
  const totalRequired = applicableSections.reduce((sum, s) => sum + requiredCountFor(form, s.key), 0);

  // Existing questions living in sections the current form selection would
  // no longer use — surfaced as a warning, never auto-deleted. The admin
  // must explicitly manage/clear those in Section Manager themselves.
  const orphanedCounts = SECTIONS.filter((s) => !applicableSections.some((a) => a.key === s.key))
    .map((s) => ({ label: s.label, count: (questions[s.key] || []).length }))
    .filter((s) => s.count > 0);

  return (
    <div className="max-w-3xl">
      <div className="bg-white border border-slate-200 rounded-lg p-5 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-slate-700">Mock details</h2>
          <div className="flex items-center gap-2">
            <span className={`text-xs ${saved ? "text-emerald-600" : "text-amber-600"}`}>
              {saved ? "Saved" : "Unsaved changes"}
            </span>
            <button onClick={handleSave} className="flex items-center gap-1 text-xs bg-blue-900 text-white px-3 py-1.5 rounded-md">
              <Save size={12} /> Save
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="block text-xs font-medium text-slate-500 mb-1">Title</label>
            <input value={form.title} onChange={(e) => update("title", e.target.value)} className="w-full text-sm border border-slate-200 rounded-md px-3 py-2" />
          </div>

          <div className="col-span-2">
            <label className="block text-xs font-medium text-slate-500 mb-1">Mock Type</label>
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() => update("mockType", MOCK_TYPES.FULL)}
                className={`text-xs px-3 py-1.5 rounded-md border ${formType === MOCK_TYPES.FULL ? "bg-blue-900 text-white border-blue-900" : "bg-white text-slate-500 border-slate-200"}`}
              >
                Full Mock
              </button>
              <button
                type="button"
                onClick={() => update("mockType", MOCK_TYPES.SECTIONAL)}
                className={`text-xs px-3 py-1.5 rounded-md border ${formType === MOCK_TYPES.SECTIONAL ? "bg-purple-600 text-white border-purple-600" : "bg-white text-slate-500 border-slate-200"}`}
              >
                Sectional Mock
              </button>
            </div>
          </div>

          {formType === MOCK_TYPES.SECTIONAL && (
            <>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Section</label>
                <select
                  value={form.sectionalKey || ""}
                  onChange={(e) => update("sectionalKey", e.target.value)}
                  className="w-full text-sm border border-slate-200 rounded-md px-3 py-2"
                >
                  <option value="" disabled>Select a section...</option>
                  {SECTIONS.map((s) => (
                    <option key={s.key} value={s.key}>{s.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Question count (max {REQUIRED_PER_SECTION})</label>
                <input
                  type="number"
                  min={1}
                  max={REQUIRED_PER_SECTION}
                  value={form.sectionalQuestionCount || REQUIRED_PER_SECTION}
                  onChange={(e) => update("sectionalQuestionCount", Math.max(1, Math.min(REQUIRED_PER_SECTION, Number(e.target.value) || 1)))}
                  className="w-full text-sm border border-slate-200 rounded-md px-3 py-2"
                />
              </div>
            </>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Mock number</label>
            <input type="number" value={form.mockNumber} onChange={(e) => update("mockNumber", Number(e.target.value))} className="w-full text-sm border border-slate-200 rounded-md px-3 py-2" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Duration (min)</label>
            <input type="number" value={form.duration} onChange={(e) => update("duration", Number(e.target.value))} className="w-full text-sm border border-slate-200 rounded-md px-3 py-2" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Total marks</label>
            <input type="number" value={form.totalMarks} onChange={(e) => update("totalMarks", Number(e.target.value))} className="w-full text-sm border border-slate-200 rounded-md px-3 py-2" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Negative marking</label>
            <input type="number" step="0.25" value={form.negativeMarking} onChange={(e) => update("negativeMarking", Number(e.target.value))} className="w-full text-sm border border-slate-200 rounded-md px-3 py-2" />
          </div>
          <div className="col-span-2">
            <label className="block text-xs font-medium text-slate-500 mb-1">Description</label>
            <textarea value={form.description} onChange={(e) => update("description", e.target.value)} rows={2} className="w-full text-sm border border-slate-200 rounded-md px-3 py-2" />
          </div>
          <div className="col-span-2">
            <label className="block text-xs font-medium text-slate-500 mb-1">Instructions</label>
            <textarea value={form.instructions} onChange={(e) => update("instructions", e.target.value)} rows={2} className="w-full text-sm border border-slate-200 rounded-md px-3 py-2" />
          </div>
        </div>

        {orphanedCounts.length > 0 && (
          <div className="mt-3 bg-amber-50 border border-amber-200 rounded-md px-3 py-2 text-xs text-amber-800">
            Heads up: this mock still has {orphanedCounts.map((o) => `${o.count} question${o.count === 1 ? "" : "s"} in ${o.label}`).join(", ")} that
            {" "}{orphanedCounts.length === 1 ? "won't" : "won't"} count toward this mock type. Nothing has been deleted — open that section from
            the question manager if you want to remove them.
          </div>
        )}
      </div>

      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-slate-700">
          {formType === MOCK_TYPES.SECTIONAL ? "Section" : "Sections"} — {totalQs}/{totalRequired} total
        </h2>
        <div className="flex items-center gap-2">
          <button
            onClick={() => onRun(mock.id)}
            className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-md border border-emerald-200 text-emerald-700 bg-emerald-50"
          >
            <Play size={12} /> Run Mock
          </button>
          <button
            onClick={() => onTogglePublish(mock)}
            className={`text-xs px-3 py-1.5 rounded-md text-white ${mock.status === "published" ? "bg-slate-500" : "bg-emerald-600"}`}
          >
            {mock.status === "published" ? "Unpublish" : "Publish"}
          </button>
        </div>
      </div>

      {formType === MOCK_TYPES.SECTIONAL && !form.sectionalKey ? (
        <div className="bg-amber-50 border border-dashed border-amber-300 rounded-lg p-4 text-xs text-amber-700">
          Select a section above and save before managing questions.
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {applicableSections.map((s) => {
            const required = requiredCountFor(form, s.key);
            const count = questions[s.key]?.length || 0;
            const complete = count === required;
            return (
              <button
                key={s.key}
                onClick={() => goToSection(s.key)}
                className="bg-white border border-slate-200 rounded-lg p-4 text-left hover:border-blue-300"
              >
                <div className="text-sm font-medium text-slate-800 mb-1">{s.label}</div>
                <div className={`text-xs font-medium ${complete ? "text-emerald-600" : "text-amber-600"}`}>
                  {count}/{required} questions
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// SECTION MANAGER — JSON import + question table + inline editor
// ============================================================================
function QuestionForm({ initial, onSave, onCancel }) {
  const [q, setQ] = useState(
    initial || { id: generateId("q"), text: "", options: ["", "", "", ""], answer: 0, explanation: "", difficulty: "Moderate" }
  );
  return (
    <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-2.5">
      <textarea
        value={q.text}
        onChange={(e) => setQ({ ...q, text: e.target.value })}
        placeholder="Question text"
        rows={2}
        className="w-full text-sm border border-slate-200 rounded-md px-3 py-2"
      />
      {q.options.map((opt, i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            type="radio"
            checked={q.answer === i}
            onChange={() => setQ({ ...q, answer: i })}
            title="Mark as correct answer"
          />
          <span className="text-xs font-medium text-slate-400 w-4">{LETTERS[i]}</span>
          <input
            value={opt}
            onChange={(e) => {
              const options = [...q.options];
              options[i] = e.target.value;
              setQ({ ...q, options });
            }}
            placeholder={`Option ${LETTERS[i]}`}
            className="flex-1 text-sm border border-slate-200 rounded-md px-3 py-1.5"
          />
        </div>
      ))}
      <textarea
        value={q.explanation}
        onChange={(e) => setQ({ ...q, explanation: e.target.value })}
        placeholder="Explanation"
        rows={2}
        className="w-full text-sm border border-slate-200 rounded-md px-3 py-2"
      />
      <select
        value={q.difficulty}
        onChange={(e) => setQ({ ...q, difficulty: e.target.value })}
        className="text-sm border border-slate-200 rounded-md px-3 py-1.5"
      >
        {DIFFICULTIES.map((d) => (
          <option key={d}>{d}</option>
        ))}
      </select>
      <div className="flex justify-end gap-2 pt-1">
        <button onClick={onCancel} className="text-xs px-3 py-1.5 rounded-md border border-slate-200 text-slate-600">
          Cancel
        </button>
        <button
          onClick={() => {
            if (!q.text.trim() || q.options.some((o) => !o.trim()) || !q.explanation.trim()) return;
            onSave(q);
          }}
          className="text-xs px-3 py-1.5 rounded-md bg-blue-900 text-white"
        >
          Save question
        </button>
      </div>
    </div>
  );
}

function SectionManager({ mockId, mock, sectionKey, questions, onQuestionsChange }) {
  const [jsonText, setJsonText] = useState("");
  const [importMode, setImportMode] = useState("add"); // 'add' | 'replace'
  const [errors, setErrors] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [addingNew, setAddingNew] = useState(false);
  const [tableQuery, setTableQuery] = useState("");
  const [selected, setSelected] = useState(new Set());
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [pendingImportCount, setPendingImportCount] = useState(0);
  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const [confirmDeleteSelected, setConfirmDeleteSelected] = useState(false);

  const requiredCount = requiredCountFor(mock, sectionKey);
  const list = questions[sectionKey] || [];
  const roomLeft = Math.max(0, requiredCount - list.length);
  const atCap = list.length >= requiredCount;

  async function persist(newList) {
    // Belt-and-braces: no code path in this component can ever write more
    // than this mock's required count for this section, even if a bug
    // upstream tried to. This is the one place all writes funnel through.
    const capped = newList.slice(0, requiredCount);
    const updated = { ...questions, [sectionKey]: capped };
    await onQuestionsChange(updated);
    setSelected(new Set());
  }

  function existingIdsExcludingThisSection() {
    // For a Sectional Mock the "other sections" are never populated at all
    // (sectionsForMock only ever writes into sectionalKey), so this
    // naturally stays an empty set for sectional mocks — nothing extra
    // needed to keep a sectional mock's questions isolated to its section.
    return new Set(SECTIONS.filter((s) => s.key !== sectionKey).flatMap((s) => (questions[s.key] || []).map((q) => q.id)));
  }

  function handleValidate() {
    const baseCount = importMode === "replace" ? 0 : list.length;
    const idsToCheckAgainst =
      importMode === "replace" ? existingIdsExcludingThisSection() : new Set([...list.map((q) => q.id), ...existingIdsExcludingThisSection()]);
    return validateImportJSON(jsonText, sectionKey, idsToCheckAgainst, baseCount, requiredCount);
  }

  function doImport() {
    const result = handleValidate();
    setErrors(result.errors);
    if (!result.ok) return;
    if (importMode === "replace") {
      persist(result.questions);
    } else {
      persist([...list, ...result.questions]);
    }
    setJsonText("");
    setConfirmReplace(false);
  }

  function handleImportClick() {
    if (importMode === "replace" && list.length > 0) {
      // must re-validate before showing the confirm, so the confirm dialog
      // never promises a replace that's actually going to fail validation
      const result = handleValidate();
      setErrors(result.errors);
      if (!result.ok) return;
      setPendingImportCount(result.questions.length);
      setConfirmReplace(true);
    } else {
      doImport();
    }
  }

  function moveQuestion(index, dir) {
    const newList = [...list];
    const target = index + dir;
    if (target < 0 || target >= newList.length) return;
    [newList[index], newList[target]] = [newList[target], newList[index]];
    persist(newList);
  }

  function deleteQuestion(id) {
    persist(list.filter((q) => q.id !== id));
  }

  function duplicateQuestion(q) {
    if (atCap) return; // can't duplicate into a full section
    const copy = { ...q, id: generateId("q") };
    const idx = list.findIndex((x) => x.id === q.id);
    const newList = [...list];
    newList.splice(idx + 1, 0, copy);
    persist(newList);
  }

  function saveEditedQuestion(updated) {
    persist(list.map((q) => (q.id === updated.id ? updated : q)));
    setEditingId(null);
  }

  function toggleSelect(id) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function selectAllFiltered() {
    setSelected(new Set(filteredList.map((q) => q.id)));
  }
  function clearSelection() {
    setSelected(new Set());
  }
  function deleteSelected() {
    persist(list.filter((q) => !selected.has(q.id)));
    setConfirmDeleteSelected(false);
  }
  function clearAllQuestions() {
    persist([]);
    setConfirmClearAll(false);
  }

  const filteredList = list.filter(
    (q) => !tableQuery || q.text.toLowerCase().includes(tableQuery.toLowerCase()) || q.difficulty.toLowerCase().includes(tableQuery.toLowerCase())
  );
  const allFilteredSelected = filteredList.length > 0 && filteredList.every((q) => selected.has(q.id));

  return (
    <div className="max-w-4xl">
      <div
        className={`border rounded-lg px-4 py-2.5 mb-4 text-sm font-medium ${
          atCap ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-blue-50 border-blue-200 text-blue-800"
        }`}
      >
        {sectionLabel(sectionKey)} — {list.length}/{requiredCount} questions
        {atCap && " · full"}
      </div>

      <div className="bg-white border border-slate-200 rounded-lg p-4 mb-6">
        <label className="flex items-center gap-1.5 text-xs font-medium text-slate-500 mb-1.5">
          <Upload size={13} /> Paste JSON array to import into this section
        </label>

        <div className="flex gap-1.5 mb-2">
          <button
            onClick={() => setImportMode("add")}
            className={`text-xs px-3 py-1.5 rounded-md border ${
              importMode === "add" ? "bg-blue-900 text-white border-blue-900" : "bg-white text-slate-500 border-slate-200"
            }`}
          >
            Add to Existing Questions
          </button>
          <button
            onClick={() => setImportMode("replace")}
            className={`text-xs px-3 py-1.5 rounded-md border ${
              importMode === "replace" ? "bg-red-600 text-white border-red-600" : "bg-white text-slate-500 border-slate-200"
            }`}
          >
            Replace Existing Questions
          </button>
        </div>

        {importMode === "add" && (
          <div className="text-xs text-slate-400 mb-2">
            {atCap ? "Section is full — no room to add more without deleting some first." : `Room for ${roomLeft} more question${roomLeft === 1 ? "" : "s"}.`}
          </div>
        )}
        {importMode === "replace" && (
          <div className="text-xs text-red-500 mb-2">
            This will delete all {list.length} existing question{list.length === 1 ? "" : "s"} in this section before importing.
          </div>
        )}

        <textarea
          value={jsonText}
          onChange={(e) => setJsonText(e.target.value)}
          rows={8}
          placeholder={`[\n  {\n    "id": "quant_001",\n    "section": "${sectionLabel(sectionKey)}",\n    "text": "...",\n    "options": ["...", "...", "...", "..."],\n    "answer": 0,\n    "explanation": "..."\n  }\n]`}
          className="w-full text-xs font-mono border border-slate-200 rounded-md p-3 focus:outline-none focus:ring-2 focus:ring-blue-200"
        />
        <div className="flex items-center gap-2 mt-2">
          <button onClick={() => setErrors(handleValidate().errors)} className="text-xs px-3 py-1.5 rounded-md border border-slate-200 text-slate-600">
            Validate
          </button>
          <button onClick={handleImportClick} className="text-xs px-3 py-1.5 rounded-md bg-blue-900 text-white">
            Validate &amp; Import
          </button>
        </div>

        {errors.length > 0 && (
          <div className="mt-3 bg-red-50 border border-red-200 rounded-md p-3 space-y-1">
            {errors.map((e, i) => (
              <div key={i} className="text-xs text-red-700">
                {e.index ? <span className="font-semibold">Question {e.index}: </span> : null}
                {e.message}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
        <div className="relative w-64">
          <Search size={13} className="absolute left-2.5 top-2.5 text-slate-400" />
          <input
            value={tableQuery}
            onChange={(e) => setTableQuery(e.target.value)}
            placeholder="Search questions..."
            className="w-full text-xs border border-slate-200 rounded-md pl-7 pr-2 py-1.5"
          />
        </div>
        <div className="flex items-center gap-1.5">
          {selected.size > 0 && (
            <>
              <span className="text-xs text-slate-500">{selected.size} selected</span>
              <button onClick={() => setConfirmDeleteSelected(true)} className="text-xs px-2.5 py-1.5 rounded-md border border-red-200 text-red-600">
                Delete Selected
              </button>
              <button onClick={clearSelection} className="text-xs px-2.5 py-1.5 rounded-md border border-slate-200 text-slate-500">
                Clear selection
              </button>
            </>
          )}
          <button onClick={allFilteredSelected ? clearSelection : selectAllFiltered} className="text-xs px-2.5 py-1.5 rounded-md border border-slate-200 text-slate-600">
            {allFilteredSelected ? "Deselect All" : "Select All"}
          </button>
          {list.length > 0 && (
            <button onClick={() => setConfirmClearAll(true)} className="text-xs px-2.5 py-1.5 rounded-md border border-red-200 text-red-600">
              Clear All
            </button>
          )}
          <button
            onClick={() => setAddingNew(true)}
            disabled={atCap}
            className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-md border border-slate-200 text-slate-600 disabled:opacity-40"
          >
            <Plus size={12} /> Add single question
          </button>
        </div>
      </div>

      {addingNew && (
        <div className="mb-3">
          <QuestionForm
            onSave={(q) => {
              if (atCap) {
                setAddingNew(false);
                return;
              }
              persist([...list, q]);
              setAddingNew(false);
            }}
            onCancel={() => setAddingNew(false)}
          />
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500">
            <tr>
              <th className="text-left px-3 py-2 w-8">
                <input type="checkbox" checked={allFilteredSelected} onChange={allFilteredSelected ? clearSelection : selectAllFiltered} />
              </th>
              <th className="text-left px-3 py-2 w-10">#</th>
              <th className="text-left px-3 py-2">Question</th>
              <th className="text-left px-3 py-2 w-16">Answer</th>
              <th className="text-left px-3 py-2 w-28">Difficulty</th>
              <th className="text-right px-3 py-2 w-32">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredList.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center text-slate-400 text-xs py-8">
                  No questions yet.
                </td>
              </tr>
            ) : (
              filteredList.map((q, i) => (
                <React.Fragment key={q.id}>
                  <tr className={`border-t border-slate-100 ${selected.has(q.id) ? "bg-blue-50/50" : ""}`}>
                    <td className="px-3 py-2">
                      <input type="checkbox" checked={selected.has(q.id)} onChange={() => toggleSelect(q.id)} />
                    </td>
                    <td className="px-3 py-2 text-slate-400 text-xs">{i + 1}</td>
                    <td className="px-3 py-2 text-slate-700"><MathText text={q.text} /></td>
                    <td className="px-3 py-2 font-medium text-emerald-600">{LETTERS[q.answer]}</td>
                    <td className="px-3 py-2">
                      <span className={`text-[11px] px-2 py-0.5 rounded-full ${DIFFICULTY_COLORS[q.difficulty]}`}>{q.difficulty}</span>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => moveQuestion(list.findIndex((x) => x.id === q.id), -1)} className="text-slate-300 hover:text-slate-600">
                          <ChevronUp size={14} />
                        </button>
                        <button onClick={() => moveQuestion(list.findIndex((x) => x.id === q.id), 1)} className="text-slate-300 hover:text-slate-600">
                          <ChevronDown size={14} />
                        </button>
                        <button onClick={() => duplicateQuestion(q)} disabled={atCap} className="text-slate-300 hover:text-blue-600 disabled:opacity-30">
                          <Copy size={13} />
                        </button>
                        <button onClick={() => setEditingId(editingId === q.id ? null : q.id)} className="text-slate-300 hover:text-blue-600">
                          <Pencil size={13} />
                        </button>
                        <button onClick={() => deleteQuestion(q.id)} className="text-slate-300 hover:text-red-600">
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                  {editingId === q.id && (
                    <tr>
                      <td colSpan={6} className="px-3 pb-3">
                        <QuestionForm initial={q} onSave={saveEditedQuestion} onCancel={() => setEditingId(null)} />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))
            )}
          </tbody>
        </table>
      </div>

      {confirmReplace && (
        <ConfirmModal
          title="Replace all questions in this section?"
          body={`This will permanently delete all ${list.length} existing question${list.length === 1 ? "" : "s"} in ${sectionLabel(sectionKey)}, then import the ${pendingImportCount} question${pendingImportCount === 1 ? "" : "s"} you pasted. This cannot be undone.`}
          confirmLabel="Replace"
          danger
          onConfirm={doImport}
          onCancel={() => setConfirmReplace(false)}
        />
      )}
      {confirmClearAll && (
        <ConfirmModal
          title="Clear all questions in this section?"
          body={`This permanently deletes all ${list.length} question${list.length === 1 ? "" : "s"} in ${sectionLabel(sectionKey)}. This cannot be undone.`}
          confirmLabel="Clear All"
          danger
          onConfirm={clearAllQuestions}
          onCancel={() => setConfirmClearAll(false)}
        />
      )}
      {confirmDeleteSelected && (
        <ConfirmModal
          title="Delete selected questions?"
          body={`This permanently deletes the ${selected.size} question${selected.size === 1 ? "" : "s"} you've selected. This cannot be undone.`}
          confirmLabel="Delete Selected"
          danger
          onConfirm={deleteSelected}
          onCancel={() => setConfirmDeleteSelected(false)}
        />
      )}
    </div>
  );
}

// ============================================================================
// PREVIEW — read-only, exactly what a student would see (answers hidden by default)
// ============================================================================
function PreviewView({ mock, questions }) {
  const sections = sectionsForMock(mock);
  const [sectionIdx, setSectionIdx] = useState(0);
  const [qIdx, setQIdx] = useState(0);
  const [reveal, setReveal] = useState(false);
  const section = sections[sectionIdx] || sections[0];
  const list = section ? questions[section.key] || [] : [];
  const q = list[qIdx];
  const isSectional = getMockType(mock) === MOCK_TYPES.SECTIONAL;

  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between mb-4">
        <div className="flex gap-1.5 flex-wrap">
          {!isSectional &&
            sections.map((s, i) => (
              <button
                key={s.key}
                onClick={() => {
                  setSectionIdx(i);
                  setQIdx(0);
                }}
                className={`px-3 py-1.5 rounded-md text-xs font-medium border ${
                  i === sectionIdx ? "bg-blue-900 text-white border-blue-900" : "bg-white text-slate-500 border-slate-200"
                }`}
              >
                {s.label}
              </button>
            ))}
          {isSectional && section && (
            <div className="px-3 py-1.5 rounded-md text-xs font-medium border bg-purple-600 text-white border-purple-600">
              {section.label} (Sectional)
            </div>
          )}
        </div>
        <label className="flex items-center gap-1.5 text-xs text-slate-500">
          <input type="checkbox" checked={reveal} onChange={(e) => setReveal(e.target.checked)} />
          Show correct answers (admin only)
        </label>
      </div>

      {!q ? (
        <div className="bg-white border border-dashed border-slate-200 rounded-lg p-10 text-center text-sm text-slate-400">
          No questions in this section yet.
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg p-6">
          <div className="text-xs text-slate-400 mb-2">
            {section.label} · Question {qIdx + 1} of {list.length}
          </div>
          <p className="text-slate-800 mb-4"><MathText text={q.text} /></p>
          <div className="space-y-2">
            {q.options.map((opt, i) => (
              <div
                key={i}
                className={`px-4 py-2 rounded-md border text-sm ${
                  reveal && i === q.answer ? "border-emerald-400 bg-emerald-50 text-emerald-800" : "border-slate-200 text-slate-700"
                }`}
              >
                {LETTERS[i]}. <MathText text={opt} />
              </div>
            ))}
          </div>
          {reveal && (
            <p className="text-xs text-slate-400 mt-3 italic"><MathText text={q.explanation} /></p>
          )}
          <div className="flex justify-between mt-5">
            <button
              disabled={qIdx === 0}
              onClick={() => setQIdx((x) => x - 1)}
              className="text-xs px-3 py-1.5 rounded-md border border-slate-200 text-slate-600 disabled:opacity-40"
            >
              Previous
            </button>
            <button
              disabled={qIdx === list.length - 1}
              onClick={() => setQIdx((x) => x + 1)}
              className="text-xs px-3 py-1.5 rounded-md border border-slate-200 text-slate-600 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// RUN MOCK — an actual timed, section-locked attempt, using this mock's real
// questions. Distinct from PreviewView: no answers shown, real countdown per
// section, auto-advances when time is up, gives a score at the end.
// ============================================================================
function RunMockView({ mock, questions, onExit }) {
  const [sectionIdx, setSectionIdx] = useState(0);
  const [qIdx, setQIdx] = useState(0);
  const [answers, setAnswers] = useState({}); // questionId -> optionIndex
  const sections = sectionsForMock(mock);
  const [saved, setSaved] = useState({}); // questionId -> true (has been Saved & Next'd at least once)
  const [visited, setVisited] = useState({}); // questionId -> true
  const [marked, setMarked] = useState({}); // questionId -> true
  const [timeLeft, setTimeLeft] = useState(Math.round((mock.duration / sections.length) * 60));
  const [timerHidden, setTimerHidden] = useState(false);
  const [finished, setFinished] = useState(false);
  const [toast, setToast] = useState("");
  const [confirmAction, setConfirmAction] = useState(null); // 'next-section' | 'finish' | null

  const section = sections[sectionIdx];
  const list = section ? questions[section.key] || [] : [];
  const q = list[qIdx];
  const isLastSection = sectionIdx === sections.length - 1;
  const perSectionSeconds = Math.round((mock.duration / sections.length) * 60);

  useEffect(() => {
    if (q) setVisited((v) => (v[q.id] ? v : { ...v, [q.id]: true }));
  }, [q]);

  function goToSection(nextIdx) {
    setSectionIdx(nextIdx);
    setQIdx(0);
    setTimeLeft(perSectionSeconds);
  }

  const advanceSection = useCallback(() => {
    if (isLastSection) {
      setFinished(true);
      return;
    }
    setToast(`Time up for ${section.label} — moving to the next section.`);
    setSectionIdx((i) => i + 1);
    setQIdx(0);
    setTimeLeft(perSectionSeconds);
  }, [isLastSection, section, perSectionSeconds]);

  useEffect(() => {
    if (finished) return;
    if (timeLeft <= 0) {
      advanceSection();
      return;
    }
    const id = setTimeout(() => setTimeLeft((t) => t - 1), 1000);
    return () => clearTimeout(id);
  }, [timeLeft, finished, advanceSection]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(""), 3500);
    return () => clearTimeout(id);
  }, [toast]);

  function selectOption(optIdx) {
    setAnswers((a) => ({ ...a, [q.id]: optIdx }));
  }
  function clearResponse() {
    setAnswers((a) => {
      const next = { ...a };
      delete next[q.id];
      return next;
    });
    setSaved((s) => {
      const next = { ...s };
      delete next[q.id];
      return next;
    });
  }
  function saveAndNext() {
    setSaved((s) => ({ ...s, [q.id]: true }));
    if (qIdx < list.length - 1) setQIdx((x) => x + 1);
  }
  function toggleMarkForReview() {
    setMarked((m) => ({ ...m, [q.id]: !m[q.id] }));
    if (qIdx < list.length - 1) setQIdx((x) => x + 1);
  }

  // "Next section" and "Finish" are always available, from any question — not
  // just the last one — per the requirement. Once confirmed, there's no way
  // back into a completed section: goToSection only ever moves forward, and
  // the section tabs are display-only for anything already passed.
  function requestNextSection() {
    setConfirmAction(isLastSection ? "finish" : "next-section");
  }
  function requestFinish() {
    setConfirmAction("finish");
  }
  function confirmProceed() {
    if (confirmAction === "finish") setFinished(true);
    else if (confirmAction === "next-section") goToSection(sectionIdx + 1);
    setConfirmAction(null);
  }

  function statusOf(qq) {
    const isAnswered = answers[qq.id] !== undefined;
    const isMarked = !!marked[qq.id];
    if (isMarked && isAnswered) return "marked-answered";
    if (isMarked) return "marked";
    if (isAnswered) return "answered";
    if (visited[qq.id]) return "visited";
    return "unvisited";
  }
  const STATUS_STYLE = {
    "answered": "bg-emerald-500 text-white border-emerald-500",
    "marked-answered": "bg-purple-500 text-white border-purple-500",
    "marked": "bg-purple-400 text-white border-purple-400",
    "visited": "bg-red-100 text-red-600 border-red-200",
    "unvisited": "bg-white text-slate-500 border-slate-300",
  };

  if (finished) {
    let correct = 0, incorrect = 0, skipped = 0;
    const sectionBreakdown = sections.map((s) => {
      let sCorrect = 0, sIncorrect = 0, sSkipped = 0;
      (questions[s.key] || []).forEach((qq) => {
        const sel = answers[qq.id];
        if (sel === undefined) sSkipped++;
        else if (sel === qq.answer) sCorrect++;
        else sIncorrect++;
      });
      correct += sCorrect;
      incorrect += sIncorrect;
      skipped += sSkipped;
      return { label: s.label, correct: sCorrect, incorrect: sIncorrect, skipped: sSkipped, score: sCorrect * 2 - sIncorrect * mock.negativeMarking };
    });
    const score = correct * 2 - incorrect * mock.negativeMarking;
    return (
      <div className="min-h-screen bg-slate-100 flex flex-col items-center py-10 px-4">
        <div className="max-w-md w-full text-center bg-white border border-slate-200 rounded-2xl shadow-sm p-10">
          <CheckCircle2 className="mx-auto mb-4 text-emerald-600" size={44} />
          <h2 className="text-xl font-semibold text-slate-800 mb-1">Test submitted</h2>
          <p className="text-sm text-slate-500 mb-6">{mock.title}</p>
          <div className="grid grid-cols-3 gap-3 text-sm mb-6">
            <div><div className="text-2xl font-semibold text-emerald-600">{correct}</div><div className="text-xs text-slate-400">Correct</div></div>
            <div><div className="text-2xl font-semibold text-red-500">{incorrect}</div><div className="text-xs text-slate-400">Incorrect</div></div>
            <div><div className="text-2xl font-semibold text-slate-400">{skipped}</div><div className="text-xs text-slate-400">Skipped</div></div>
          </div>
          <div className="text-3xl font-bold text-slate-800 mb-6">{score} <span className="text-lg font-normal text-slate-400">/ {mock.totalMarks}</span></div>

          {sectionBreakdown.length > 1 && (
            <div className="text-left mb-6 space-y-1.5">
              <div className="text-xs font-medium text-slate-400 mb-1">Section-wise score</div>
              {sectionBreakdown.map((s) => (
                <div key={s.label} className="flex items-center justify-between text-xs bg-slate-50 rounded-md px-3 py-1.5">
                  <span className="text-slate-600">{s.label}</span>
                  <span className="font-medium text-slate-800">{s.score}</span>
                </div>
              ))}
            </div>
          )}

          <button onClick={onExit} className="text-sm px-5 py-2.5 rounded-lg bg-slate-900 text-white">
            Back to admin panel
          </button>
        </div>

        <div className="max-w-2xl w-full mt-6 space-y-3">
          <h3 className="text-sm font-semibold text-slate-700 px-1">Answer review</h3>
          {sections.map((s) =>
            (questions[s.key] || []).map((qq, i) => {
              const sel = answers[qq.id];
              const isCorrect = sel === qq.answer;
              const isSkipped = sel === undefined;
              return (
                <div key={qq.id} className="bg-white border border-slate-200 rounded-xl p-5 text-left">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs text-slate-400">{s.label} · Q{i + 1}</span>
                    <span
                      className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                        isSkipped ? "bg-slate-100 text-slate-500" : isCorrect ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-600"
                      }`}
                    >
                      {isSkipped ? "Skipped" : isCorrect ? "Correct" : "Incorrect"}
                    </span>
                  </div>
                  <p className="text-sm text-slate-800 mb-3"><MathText text={qq.text} /></p>
                  <div className="space-y-1.5">
                    {qq.options.map((opt, oi) => {
                      const isYourPick = sel === oi;
                      const isRightAnswer = qq.answer === oi;
                      return (
                        <div
                          key={oi}
                          className={`text-sm px-3 py-2 rounded-md border ${
                            isRightAnswer
                              ? "border-emerald-400 bg-emerald-50 text-emerald-800"
                              : isYourPick
                              ? "border-red-300 bg-red-50 text-red-700"
                              : "border-slate-200 text-slate-600"
                          }`}
                        >
                          {LETTERS[oi]}. <MathText text={opt} />
                          {isRightAnswer && <span className="ml-2 text-xs font-medium">✓ Correct answer</span>}
                          {isYourPick && !isRightAnswer && <span className="ml-2 text-xs font-medium">Your answer</span>}
                        </div>
                      );
                    })}
                  </div>
                  {qq.explanation && (
                    <p className="text-xs text-slate-500 mt-3 italic"><MathText text={qq.explanation} /></p>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    );
  }

  if (!q) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-center bg-white border border-dashed border-slate-300 rounded-xl p-10 text-sm text-slate-400">
          {section.label} has no questions yet — can't run this section.
          <div className="mt-4">
            <button onClick={onExit} className="text-sm px-4 py-2 rounded-md border border-slate-200 text-slate-600">
              Back
            </button>
          </div>
        </div>
      </div>
    );
  }

  const isLowTime = timeLeft <= 60;
  const answeredCount = list.filter((qq) => answers[qq.id] !== undefined).length;
  const markedCount = list.filter((qq) => marked[qq.id]).length;
  const notVisitedCount = list.filter((qq) => !visited[qq.id]).length;
  const notAnsweredCount = list.filter((qq) => visited[qq.id] && answers[qq.id] === undefined && !marked[qq.id]).length;

  return (
    <div className="-m-6 min-h-[calc(100vh-49px)] bg-slate-100 flex flex-col">
      {/* Exam header — deliberately distinct from the admin chrome above it */}
      <div className="bg-white border-b border-slate-200 px-6 py-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <div className="text-sm font-semibold text-slate-800">{mock.title}</div>
            <div className="text-xs text-slate-400">{section.label}</div>
          </div>
          <div className="flex items-center gap-2">
            {!timerHidden && (
              <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg font-mono text-base font-semibold tabular-nums ${isLowTime ? "bg-red-50 text-red-600" : "bg-blue-50 text-blue-700"}`}>
                <Clock size={16} /> {formatTime(timeLeft)}
              </div>
            )}
            <button
              onClick={() => setTimerHidden((h) => !h)}
              title="Toggle timer visibility — useful for practice or screen recording"
              className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 text-slate-500"
            >
              {timerHidden ? "Show timer" : "Hide timer"}
            </button>
          </div>
        </div>
        {sections.length > 1 && (
          <div className="flex gap-1.5 flex-wrap mt-3">
            {sections.map((s, i) => (
              <div
                key={s.key}
                title={i < sectionIdx ? "Locked — already submitted, cannot return" : undefined}
                className={`px-3 py-1.5 rounded-md text-xs font-medium border ${
                  i === sectionIdx
                    ? "bg-blue-900 text-white border-blue-900"
                    : i < sectionIdx
                    ? "bg-slate-100 text-slate-400 border-slate-200 line-through"
                    : "bg-slate-50 text-slate-400 border-slate-200"
                }`}
              >
                {s.label}
              </div>
            ))}
          </div>
        )}
      </div>

      {toast && <div className="bg-amber-50 border-b border-amber-200 text-amber-800 text-sm px-6 py-2">{toast}</div>}

      {/* Main exam body */}
      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 overflow-auto p-8 flex justify-center">
          <div className="max-w-2xl w-full">
            <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-8">
              <div className="flex items-center justify-between mb-5">
                <div className="text-sm text-slate-400">
                  Question <span className="font-semibold text-slate-700">{qIdx + 1}</span> of {list.length}
                </div>
                <button
                  onClick={toggleMarkForReview}
                  className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border ${
                    marked[q.id] ? "border-purple-300 bg-purple-50 text-purple-700" : "border-slate-200 text-slate-500"
                  }`}
                >
                  <Flag size={13} /> {marked[q.id] ? "Marked for review" : "Mark for Review"}
                </button>
              </div>

              <p className="text-lg leading-relaxed text-slate-900 mb-8 font-medium"><MathText text={q.text} /></p>

              <div className="space-y-3">
                {q.options.map((opt, i) => (
                  <button
                    key={i}
                    onClick={() => selectOption(i)}
                    className={`w-full flex items-center gap-3 text-left px-5 py-3.5 rounded-xl border-2 text-base transition-colors ${
                      answers[q.id] === i
                        ? "border-blue-600 bg-blue-50 text-blue-900"
                        : "border-slate-200 text-slate-700 hover:border-slate-300 hover:bg-slate-50"
                    }`}
                  >
                    <span
                      className={`w-7 h-7 shrink-0 rounded-full flex items-center justify-center text-sm font-semibold ${
                        answers[q.id] === i ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-500"
                      }`}
                    >
                      {LETTERS[i]}
                    </span>
                    <MathText text={opt} />
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between mt-5 flex-wrap gap-2">
              <div className="flex gap-2">
                <button
                  disabled={qIdx === 0}
                  onClick={() => setQIdx((x) => x - 1)}
                  className="text-sm px-4 py-2.5 rounded-lg border border-slate-300 text-slate-600 bg-white disabled:opacity-40"
                >
                  Previous
                </button>
                <button
                  onClick={clearResponse}
                  disabled={answers[q.id] === undefined}
                  className="text-sm px-4 py-2.5 rounded-lg border border-slate-300 text-slate-600 bg-white disabled:opacity-40"
                >
                  Clear Response
                </button>
              </div>
              <div className="flex gap-2">
                <button onClick={saveAndNext} className="text-sm px-5 py-2.5 rounded-lg bg-blue-900 text-white font-medium">
                  Save &amp; Next
                </button>
                <button
                  disabled={qIdx === list.length - 1}
                  onClick={() => setQIdx((x) => x + 1)}
                  className="text-sm px-4 py-2.5 rounded-lg border border-slate-300 text-slate-600 bg-white disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>

            <div className="flex justify-center gap-3 mt-6">
              <button onClick={requestNextSection} className="text-sm px-5 py-2.5 rounded-lg border border-slate-300 text-slate-600 bg-white">
                {isLastSection ? "Finish exam" : `Next section: ${sections[sectionIdx + 1]?.label}`} →
              </button>
              <button onClick={requestFinish} className="text-sm px-5 py-2.5 rounded-lg bg-red-600 text-white font-medium">
                Finish Test
              </button>
            </div>
          </div>
        </div>

        {/* Question palette sidebar */}
        <div className="w-64 bg-white border-l border-slate-200 p-5 overflow-auto shrink-0">
          <div className="text-xs font-semibold text-slate-500 mb-3">
            Question {qIdx + 1} / {list.length} · {section.label}
          </div>

          <div className="grid grid-cols-2 gap-1.5 text-[11px] mb-4">
            <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-emerald-500" /> Answered ({answeredCount})</div>
            <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-red-100 border border-red-200" /> Not answered ({notAnsweredCount})</div>
            <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-white border border-slate-300" /> Not visited ({notVisitedCount})</div>
            <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-purple-500" /> Marked ({markedCount})</div>
          </div>

          <div className="grid grid-cols-5 gap-2">
            {list.map((qq, i) => {
              const status = statusOf(qq);
              return (
                <button
                  key={qq.id}
                  onClick={() => setQIdx(i)}
                  className={`aspect-square rounded-md text-xs font-semibold border-2 ${STATUS_STYLE[status]} ${
                    i === qIdx ? "ring-2 ring-offset-1 ring-blue-500" : ""
                  }`}
                >
                  {i + 1}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {confirmAction && (
        <ConfirmModal
          title={confirmAction === "finish" ? "Finish the test?" : "Move to the next section?"}
          body={
            confirmAction === "finish"
              ? "This submits the whole test now. Any unanswered questions in remaining sections will be scored as skipped. This cannot be undone."
              : `You'll move to ${sections[sectionIdx + 1]?.label}. Once you leave ${section.label}, you can never come back to it — including any unanswered or marked-for-review questions.`
          }
          confirmLabel={confirmAction === "finish" ? "Finish test" : "Move on"}
          danger
          onConfirm={confirmProceed}
          onCancel={() => setConfirmAction(null)}
        />
      )}
    </div>
  );
}

// ============================================================================
// APP SHELL
// ============================================================================
function AdminPanel() {
  const [mocksIndex, setMocksIndex] = useState([]);
  const [mocksLoaded, setMocksLoaded] = useState(false);
  const [view, setView] = useState("dashboard");
  const [activeMockId, setActiveMockId] = useState(null);
  const [activeSection, setActiveSection] = useState(null);
  const [questionsCache, setQuestionsCache] = useState({});
  const [toast, setToast] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [pendingNav, setPendingNav] = useState(null);

  useEffect(() => {
    (async () => {
      setMocksIndex(await loadMocksIndex());
      setMocksLoaded(true);
    })();
  }, []);

  useEffect(() => {
    if (activeMockId && !questionsCache[activeMockId]) {
      loadMockQuestions(activeMockId).then((q) => setQuestionsCache((c) => ({ ...c, [activeMockId]: q })));
    }
  }, [activeMockId, questionsCache]);

  const showToast = useCallback((message, type = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  }, []);

  function requestNav(fn) {
    if (dirty) setPendingNav(() => fn);
    else fn();
  }

  function goDashboard() {
    requestNav(() => {
      setView("dashboard");
      setActiveMockId(null);
    });
  }
  function goList() {
    requestNav(() => {
      setView("list");
      setActiveMockId(null);
    });
  }
  function openEditor(mockId) {
    requestNav(() => {
      setActiveMockId(mockId);
      setView("editor");
    });
  }
  function openSection(sectionKey) {
    setActiveSection(sectionKey);
    setView("section");
  }
  function openPreview(mockId) {
    requestNav(() => {
      setActiveMockId(mockId);
      setView("preview");
    });
  }
  function openRun(mockId) {
    requestNav(() => {
      setActiveMockId(mockId);
      setView("run");
    });
  }

  async function createMock() {
    const newMock = {
      id: generateId("mock"),
      mockNumber: nextMockNumber(mocksIndex),
      title: `SSC CGL Full Mock Test ${String(nextMockNumber(mocksIndex)).padStart(2, "0")}`,
      description: "",
      instructions: "",
      duration: 60,
      totalMarks: 200,
      negativeMarking: 0.5,
      status: "draft",
      mockType: MOCK_TYPES.FULL,
      sectionalKey: null,
      sectionalQuestionCount: REQUIRED_PER_SECTION,
      createdAt: nowISO(),
      updatedAt: nowISO(),
    };
    const updated = [...mocksIndex, newMock];
    setMocksIndex(updated);
    await saveMocksIndex(updated);
    setQuestionsCache((c) => ({ ...c, [newMock.id]: emptySectionMap() }));
    setActiveMockId(newMock.id);
    setView("editor");
    showToast(`Created "${newMock.title}"`);
  }

  // Imports mocks/questions exported from the old storage backend. Writes
  // through the exact same saveMocksIndex/saveMockQuestions functions every
  // other write in this app uses — this is not a separate data path, it's
  // the normal one, just fed from a file instead of a form. Existing mocks
  // already in this store are never touched; only new IDs are added, and
  // any ID collision gets a fresh ID rather than silently overwriting.
  async function importData(parsed) {
    if (!parsed || !Array.isArray(parsed.mocksIndex) || typeof parsed.questionsByMock !== "object") {
      throw new Error("This doesn't look like a valid export file — expected { mocksIndex, questionsByMock }.");
    }

    const existingIds = new Set(mocksIndex.map((m) => m.id));
    const idRemap = {}; // old id -> id actually used (same id, unless it collided)
    const importedMocks = [];

    for (const mock of parsed.mocksIndex) {
      if (!mock || typeof mock !== "object" || !mock.id) continue;
      const finalId = existingIds.has(mock.id) ? generateId("mock") : mock.id;
      idRemap[mock.id] = finalId;
      existingIds.add(finalId);
      importedMocks.push({
        ...mock,
        id: finalId,
        mockNumber: nextMockNumber([...mocksIndex, ...importedMocks]),
        updatedAt: nowISO(),
      });
    }

    const mergedIndex = [...mocksIndex, ...importedMocks];
    setMocksIndex(mergedIndex);
    await saveMocksIndex(mergedIndex);

    let importedQuestionCount = 0;
    const newCacheEntries = {};
    for (const [oldMockId, qMap] of Object.entries(parsed.questionsByMock)) {
      const finalId = idRemap[oldMockId];
      if (!finalId) continue; // question block for a mock that wasn't in mocksIndex — skip rather than guess
      const safeMap = qMap && typeof qMap === "object" ? qMap : emptySectionMap();
      await saveMockQuestions(finalId, safeMap);
      newCacheEntries[finalId] = safeMap;
      importedQuestionCount += SECTIONS.reduce((sum, s) => sum + (safeMap[s.key]?.length || 0), 0);
    }
    setQuestionsCache((c) => ({ ...c, ...newCacheEntries }));

    return { mockCount: importedMocks.length, questionCount: importedQuestionCount };
  }

  async function saveMockMeta(form) {
    const updated = mocksIndex.map((m) => (m.id === form.id ? { ...form, updatedAt: nowISO() } : m));
    setMocksIndex(updated);
    await saveMocksIndex(updated);
    showToast("Mock details saved.");
  }

  async function updateQuestionsForActiveMock(newQuestionsMap) {
    setQuestionsCache((c) => ({ ...c, [activeMockId]: newQuestionsMap }));
    await saveMockQuestions(activeMockId, newQuestionsMap);
  }

  async function togglePublish(mock) {
    if (mock.status === "published") {
      const updated = mocksIndex.map((m) => (m.id === mock.id ? { ...m, status: "draft", updatedAt: nowISO() } : m));
      setMocksIndex(updated);
      await saveMocksIndex(updated);
      showToast(`"${mock.title}" unpublished.`);
      return;
    }
    if (getMockType(mock) === MOCK_TYPES.SECTIONAL && !mock.sectionalKey) {
      showToast(`Cannot publish — no section selected for this sectional mock.`, "error");
      return;
    }
    const qMap = questionsCache[mock.id] || (await loadMockQuestions(mock.id));
    const applicableSections = sectionsForMock(mock);
    const shortfalls = applicableSections
      .map((s) => ({ label: s.label, count: (qMap[s.key] || []).length, required: requiredCountFor(mock, s.key) }))
      .filter((s) => s.count !== s.required);
    if (shortfalls.length > 0) {
      showToast(`Cannot publish — ${shortfalls.map((s) => `${s.label} ${s.count}/${s.required}`).join("; ")}`, "error");
      return;
    }
    // Sectional mocks must never accidentally contain questions from another
    // section — this can only happen via stray/legacy data, since the
    // question manager itself only ever writes into sectionalKey, but it's
    // checked explicitly here as a hard publish gate regardless of cause.
    if (getMockType(mock) === MOCK_TYPES.SECTIONAL) {
      const strayCount = SECTIONS.filter((s) => s.key !== mock.sectionalKey).reduce((sum, s) => sum + (qMap[s.key]?.length || 0), 0);
      if (strayCount > 0) {
        showToast(`Cannot publish — this sectional mock has ${strayCount} question(s) sitting in other sections. Clear them from the question manager first.`, "error");
        return;
      }
    }
    const updated = mocksIndex.map((m) => (m.id === mock.id ? { ...m, status: "published", updatedAt: nowISO() } : m));
    setMocksIndex(updated);
    await saveMocksIndex(updated);
    showToast(`"${mock.title}" published.`);
  }

  async function duplicateMock(mock) {
    const original = questionsCache[mock.id] || (await loadMockQuestions(mock.id));
    const clonedQuestions = {};
    for (const s of SECTIONS) clonedQuestions[s.key] = (original[s.key] || []).map((q) => ({ ...q, id: generateId("q") }));

    const newMock = {
      ...mock,
      id: generateId("mock"),
      mockNumber: nextMockNumber(mocksIndex),
      title: `${mock.title} (Copy)`,
      status: "draft",
      createdAt: nowISO(),
      updatedAt: nowISO(),
    };
    const updated = [...mocksIndex, newMock];
    setMocksIndex(updated);
    await saveMocksIndex(updated);
    setQuestionsCache((c) => ({ ...c, [newMock.id]: clonedQuestions }));
    await saveMockQuestions(newMock.id, clonedQuestions);
    showToast(`Duplicated as "${newMock.title}" (draft).`);
  }

  function requestDelete(mock) {
    setDeleteTarget(mock);
  }
  async function confirmDelete() {
    const mock = deleteTarget;
    const updated = mocksIndex.filter((m) => m.id !== mock.id);
    setMocksIndex(updated);
    await saveMocksIndex(updated);
    await deleteMockQuestions(mock.id);
    setQuestionsCache((c) => {
      const next = { ...c };
      delete next[mock.id];
      return next;
    });
    setDeleteTarget(null);
    showToast(`"${mock.title}" deleted.`);
    if (activeMockId === mock.id) {
      setView("list");
      setActiveMockId(null);
    }
  }

  // question counts for dashboard + list, computed from whatever's cached
  const questionCounts = {};
  for (const [mockId, qmap] of Object.entries(questionsCache)) {
    const total = SECTIONS.reduce((sum, s) => sum + (qmap[s.key]?.length || 0), 0);
    questionCounts[mockId] = qmap;
    questionCounts[`${mockId}:total`] = total;
  }
  // ensure counts load for mocks visible in the list even before opened
  useEffect(() => {
    mocksIndex.forEach((m) => {
      if (!questionsCache[m.id]) {
        loadMockQuestions(m.id).then((q) => setQuestionsCache((c) => (c[m.id] ? c : { ...c, [m.id]: q })));
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mocksLoaded, mocksIndex.length]);

  const activeMock = mocksIndex.find((m) => m.id === activeMockId);
  const activeQuestions = activeMockId ? questionsCache[activeMockId] : null;

  const NAV = [
    { key: "dashboard", label: "Dashboard", icon: LayoutDashboard, onClick: goDashboard },
    { key: "list", label: "Mock Tests", icon: ListChecks, onClick: goList },
    { key: "import", label: "Import Data", icon: Upload, onClick: () => setView("import") },
  ];

  if (!mocksLoaded) {
    return <div className="min-h-screen flex items-center justify-center text-sm text-slate-400">Loading admin panel...</div>;
  }

  return (
    <div className="min-h-screen bg-slate-50 flex text-slate-800">
      <aside className="w-56 bg-slate-900 text-slate-300 flex flex-col shrink-0">
        <div className="px-4 py-5 text-white font-semibold text-sm border-b border-slate-800">SSC CGL Admin</div>
        <nav className="flex-1 py-3">
          {NAV.map((n) => (
            <button
              key={n.key}
              onClick={n.onClick}
              className={`w-full flex items-center gap-2 px-4 py-2.5 text-sm ${
                view === n.key || (n.key === "list" && ["editor", "section", "preview", "run"].includes(view))
                  ? "bg-slate-800 text-white"
                  : "hover:bg-slate-800/50"
              }`}
            >
              <n.icon size={15} /> {n.label}
            </button>
          ))}
        </nav>
        <div className="p-3">
          <button onClick={createMock} className="w-full flex items-center justify-center gap-1.5 bg-blue-600 text-white text-sm py-2 rounded-md">
            <Plus size={14} /> Create New Mock
          </button>
        </div>
        <div className="px-4 py-3 border-t border-slate-800 flex items-center gap-1.5 text-[11px] text-slate-500">
          <Lock size={11} /> No login gate in this preview
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="bg-white border-b border-slate-200 px-6 py-3 flex items-center gap-3">
          {["editor", "section", "preview", "run"].includes(view) && (
            <button
              onClick={() => (view === "section" ? setView("editor") : goList())}
              className="text-slate-400 hover:text-slate-700"
            >
              <ArrowLeft size={16} />
            </button>
          )}
          <h1 className="text-sm font-semibold text-slate-800">
            {view === "dashboard" && "Dashboard"}
            {view === "list" && "Mock Tests"}
            {view === "import" && "Import Data"}
            {view === "editor" && activeMock?.title}
            {view === "section" && `${activeMock?.title} — ${sectionLabel(activeSection)}`}
            {view === "preview" && `Preview — ${activeMock?.title}`}
            {view === "run" && `Running — ${activeMock?.title}`}
          </h1>
        </header>

        <main className="flex-1 p-6 overflow-auto">
          {view === "dashboard" && (
            <DashboardView mocksIndex={mocksIndex} questionCounts={questionsCache} onGoList={goList} onCreateNew={createMock} />
          )}
          {view === "list" && (
            <MockListView
              mocksIndex={mocksIndex}
              questionCounts={questionCounts}
              onEdit={openEditor}
              onPreview={openPreview}
              onRun={openRun}
              onDuplicate={duplicateMock}
              onTogglePublish={togglePublish}
              onDeleteRequest={requestDelete}
            />
          )}
          {view === "import" && <ImportDataView onImport={importData} />}
          {view === "editor" && activeMock && activeQuestions && (
            <MockEditorView
              mock={activeMock}
              questions={activeQuestions}
              onSaveMeta={saveMockMeta}
              onOpenSection={openSection}
              onTogglePublish={togglePublish}
              onRun={openRun}
              onDirtyChange={setDirty}
            />
          )}
          {view === "section" && activeMock && activeQuestions && (
            <SectionManager
              mockId={activeMockId}
              mock={activeMock}
              sectionKey={activeSection}
              questions={activeQuestions}
              onQuestionsChange={updateQuestionsForActiveMock}
            />
          )}
          {view === "preview" && activeMock && activeQuestions && (
            <PreviewView mock={activeMock} questions={activeQuestions} />
          )}
          {view === "run" && activeMock && activeQuestions && (
            <RunMockView mock={activeMock} questions={activeQuestions} onExit={goList} />
          )}
        </main>
      </div>

      {deleteTarget && (
        <ConfirmModal
          title="Delete this mock?"
          body={`"${deleteTarget.title}" and all its questions will be permanently deleted. This cannot be undone.`}
          confirmLabel="Delete"
          danger
          onConfirm={confirmDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
      {pendingNav && (
        <ConfirmModal
          title="Unsaved changes"
          body="You have unsaved changes on this mock's details. Leave without saving?"
          confirmLabel="Discard & leave"
          danger
          onConfirm={() => {
            const fn = pendingNav;
            setPendingNav(null);
            setDirty(false);
            fn();
          }}
          onCancel={() => setPendingNav(null)}
        />
      )}
      <Toast toast={toast} />
    </div>
  );
}

// ============================================================================
// STUDENT VIEW
// Reads from the exact same storage functions AdminPanel uses (loadMocksIndex
// / loadMockQuestions) — no separate store, no duplicated data. Reuses
// RunMockView unmodified for the actual test-taking experience. Only mocks
// with status === "published" are ever shown or reachable here.
// ============================================================================
function StudentMockCard({ mock, onStart }) {
  const sections = sectionsForMock(mock);
  const totalQuestions = sections.reduce((sum, s) => sum + requiredCountFor(mock, s.key), 0);
  const isSectional = getMockType(mock) === MOCK_TYPES.SECTIONAL;

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col">
      <div className="flex items-center gap-2 mb-2">
        <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${isSectional ? "bg-purple-100 text-purple-700" : "bg-blue-100 text-blue-700"}`}>
          {mockTypeBadgeLabel(mock)}
        </span>
      </div>
      <h3 className="font-semibold text-slate-800 mb-1">{mock.title}</h3>
      {isSectional && sections[0] && (
        <p className="text-xs text-slate-500 mb-3">{sections[0].label}</p>
      )}
      {mock.description && <p className="text-xs text-slate-500 mb-3">{mock.description}</p>}

      <div className="grid grid-cols-3 gap-2 text-center my-3 py-3 border-y border-slate-100">
        <div>
          <div className="text-sm font-semibold text-slate-800">{totalQuestions}</div>
          <div className="text-[10px] text-slate-400">Questions</div>
        </div>
        <div>
          <div className="text-sm font-semibold text-slate-800">{mock.duration}</div>
          <div className="text-[10px] text-slate-400">Minutes</div>
        </div>
        <div>
          <div className="text-sm font-semibold text-slate-800">{mock.totalMarks}</div>
          <div className="text-[10px] text-slate-400">Marks</div>
        </div>
      </div>

      <button onClick={() => onStart(mock)} className="mt-auto w-full text-sm font-medium bg-blue-900 text-white rounded-lg py-2.5">
        View Details
      </button>
    </div>
  );
}

function StudentInstructionsView({ mock, questionCount, onStart, onBack }) {
  const sections = sectionsForMock(mock);
  const isSectional = getMockType(mock) === MOCK_TYPES.SECTIONAL;

  return (
    <div className="max-w-2xl mx-auto">
      <button onClick={onBack} className="text-sm text-slate-500 mb-4">← Back to mock list</button>
      <div className="bg-white border border-slate-200 rounded-2xl p-8">
        <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold mb-3 ${isSectional ? "bg-purple-100 text-purple-700" : "bg-blue-100 text-blue-700"}`}>
          {mockTypeBadgeLabel(mock)}
        </span>
        <h1 className="text-xl font-semibold text-slate-800 mb-1">{mock.title}</h1>
        {mock.description && <p className="text-sm text-slate-500 mb-5">{mock.description}</p>}

        <div className="grid grid-cols-3 gap-3 mb-6">
          <div className="bg-slate-50 rounded-lg p-3 text-center">
            <div className="text-lg font-semibold text-slate-800">{questionCount}</div>
            <div className="text-xs text-slate-400">Questions</div>
          </div>
          <div className="bg-slate-50 rounded-lg p-3 text-center">
            <div className="text-lg font-semibold text-slate-800">{mock.duration} min</div>
            <div className="text-xs text-slate-400">Duration</div>
          </div>
          <div className="bg-slate-50 rounded-lg p-3 text-center">
            <div className="text-lg font-semibold text-slate-800">{mock.totalMarks}</div>
            <div className="text-xs text-slate-400">Total Marks</div>
          </div>
        </div>

        <div className="mb-6">
          <h2 className="text-sm font-semibold text-slate-700 mb-2">Sections</h2>
          <div className="space-y-1.5">
            {sections.map((s) => (
              <div key={s.key} className="flex justify-between text-sm bg-slate-50 rounded-md px-3 py-2">
                <span className="text-slate-600">{s.label}</span>
                <span className="text-slate-400">{requiredCountFor(mock, s.key)} questions</span>
              </div>
            ))}
          </div>
        </div>

        <div className="mb-6 text-sm text-slate-600 space-y-1.5">
          <h2 className="text-sm font-semibold text-slate-700 mb-2">Instructions</h2>
          {mock.instructions ? (
            <p className="whitespace-pre-line">{mock.instructions}</p>
          ) : (
            <ul className="list-disc pl-5 space-y-1 text-slate-500">
              <li>Each section has its own timer. Once time is up, you'll automatically move to the next section.</li>
              <li>Once you leave a section, you cannot return to it.</li>
              <li>Negative marking: {mock.negativeMarking} mark(s) deducted per wrong answer.</li>
              <li>You can finish the test at any time using "Finish Test".</li>
            </ul>
          )}
        </div>

        <button onClick={onStart} className="w-full bg-blue-900 text-white text-sm font-medium rounded-lg py-3">
          Start Test
        </button>
      </div>
    </div>
  );
}

function TypeSelectCard({ type, count, onSelect }) {
  const isSectional = type === MOCK_TYPES.SECTIONAL;
  return (
    <button
      onClick={() => onSelect(type)}
      className="bg-white border border-slate-200 rounded-2xl p-8 text-left hover:border-blue-300 hover:shadow-sm transition-all"
    >
      <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold mb-3 ${isSectional ? "bg-purple-100 text-purple-700" : "bg-blue-100 text-blue-700"}`}>
        {isSectional ? "SECTIONAL" : "FULL LENGTH"}
      </span>
      <h2 className="text-lg font-semibold text-slate-800 mb-1">{isSectional ? "Sectional Mock" : "Full Mock"}</h2>
      <p className="text-sm text-slate-500 mb-4">
        {isSectional
          ? "Practice one section at a time — Reasoning, GA, Quant, or English — at your own configured length."
          : "The complete SSC CGL Tier-I paper — all four sections, 100 questions, 60 minutes."}
      </p>
      <span className="text-sm font-medium text-blue-800">{count} test{count === 1 ? "" : "s"} available →</span>
    </button>
  );
}

function StudentApp() {
  const [mocksIndex, setMocksIndex] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [view, setView] = useState("type"); // 'type' | 'list' | 'instructions' | 'run'
  const [typeFilter, setTypeFilter] = useState(null); // MOCK_TYPES.FULL | MOCK_TYPES.SECTIONAL
  const [selectedMock, setSelectedMock] = useState(null);
  const [selectedQuestions, setSelectedQuestions] = useState(null);

  // Same storage source as AdminPanel — no separate student store. Reloading
  // on every visit to a list screen (not just once on mount) means an admin
  // publishing/unpublishing while a student has the tab open is picked up
  // without needing a shared live-sync mechanism that doesn't exist here.
  const refreshMocks = useCallback(async () => {
    setMocksIndex(await loadMocksIndex());
    setLoaded(true);
  }, []);

  useEffect(() => {
    refreshMocks();
  }, [refreshMocks]);

  // While sitting on a browsing screen, re-check every few seconds so an
  // admin publishing/unpublishing elsewhere reflects promptly.
  useEffect(() => {
    if (view !== "type" && view !== "list") return;
    const id = setInterval(refreshMocks, 4000);
    return () => clearInterval(id);
  }, [view, refreshMocks]);

  const publishedMocks = mocksIndex.filter((m) => m.status === "published");
  const fullCount = publishedMocks.filter((m) => getMockType(m) === MOCK_TYPES.FULL).length;
  const sectionalCount = publishedMocks.filter((m) => getMockType(m) === MOCK_TYPES.SECTIONAL).length;
  const listForType = publishedMocks.filter((m) => getMockType(m) === typeFilter).sort((a, b) => a.mockNumber - b.mockNumber);

  function chooseType(type) {
    setTypeFilter(type);
    setView("list");
  }

  function backToType() {
    setTypeFilter(null);
    setView("type");
    refreshMocks();
  }

  async function openInstructions(mock) {
    setSelectedMock(mock);
    // Honest limitation: this loads the FULL question objects — including
    // the correct `answer` field — into this browser tab's memory, because
    // scoring happens client-side (see RunMockView) and there is no server
    // to do that scoring instead. A student who opens dev tools during the
    // test can read every correct answer from React state or the network
    // tab. There is no client-only fix for this — it requires a backend
    // that keeps answers server-side and only returns a score after
    // submission. Flagging this here rather than pretending it's handled.
    const q = await loadMockQuestions(mock.id);
    setSelectedQuestions(q);
    setView("instructions");
  }

  function backToList() {
    setSelectedMock(null);
    setSelectedQuestions(null);
    setView("list");
    refreshMocks(); // re-check published status in case admin changed something meanwhile
  }

  function startTest() {
    setView("run");
  }

  if (!loaded) {
    return <div className="min-h-screen flex items-center justify-center text-sm text-slate-400">Loading available tests...</div>;
  }

  if (view === "run" && selectedMock && selectedQuestions) {
    // The exact same RunMockView the Admin Panel's "Run Mock" button uses —
    // no second engine, no reimplementation of timer/scoring/palette logic.
    return <RunMockView mock={selectedMock} questions={selectedQuestions} onExit={backToList} />;
  }

  if (view === "instructions" && selectedMock && selectedQuestions) {
    const sections = sectionsForMock(selectedMock);
    const questionCount = sections.reduce((sum, s) => sum + (selectedQuestions[s.key]?.length || 0), 0);
    return (
      <div className="min-h-screen bg-slate-50 p-6">
        <StudentInstructionsView mock={selectedMock} questionCount={questionCount} onStart={startTest} onBack={backToList} />
      </div>
    );
  }

  if (view === "type") {
    return (
      <div className="min-h-screen bg-slate-50">
        <header className="bg-white border-b border-slate-200 px-6 py-4">
          <h1 className="text-base font-semibold text-slate-800">SSC CGL Mock Tests</h1>
          <p className="text-xs text-slate-400">{publishedMocks.length} test{publishedMocks.length === 1 ? "" : "s"} available</p>
        </header>
        <main className="p-6 max-w-3xl mx-auto">
          <p className="text-sm text-slate-500 mb-5">What would you like to practice?</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <TypeSelectCard type={MOCK_TYPES.FULL} count={fullCount} onSelect={chooseType} />
            <TypeSelectCard type={MOCK_TYPES.SECTIONAL} count={sectionalCount} onSelect={chooseType} />
          </div>
        </main>
      </div>
    );
  }

  // view === 'list' — only mocks of the chosen type
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200 px-6 py-4">
        <button onClick={backToType} className="text-sm text-slate-500 mb-2">← Back</button>
        <h1 className="text-base font-semibold text-slate-800">
          {typeFilter === MOCK_TYPES.SECTIONAL ? "Sectional Mocks" : "Full Mocks"}
        </h1>
        <p className="text-xs text-slate-400">{listForType.length} test{listForType.length === 1 ? "" : "s"} available</p>
      </header>

      <main className="p-6 max-w-5xl mx-auto">
        {listForType.length === 0 ? (
          <div className="bg-white border border-dashed border-slate-200 rounded-xl p-12 text-center text-sm text-slate-400">
            No {typeFilter === MOCK_TYPES.SECTIONAL ? "sectional" : "full"} tests are available right now — check back soon.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {listForType.map((m) => (
              <StudentMockCard key={m.id} mock={m} onStart={openInstructions} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

// ============================================================================
// TOP-LEVEL APP — toggles between the Admin Panel and the Student View.
// AdminPanel itself is completely unchanged; StudentApp reads the same
// storage functions rather than a separate data source.
//
// ACCESS NOTE: routing below decides which experience renders based on the
// URL path (/admin vs anything else) and nothing in the Student UI links to
// or reveals /admin — so a normal visitor never sees an admin option. This
// is NOT real authentication: there is no backend, so anyone who knows or
// guesses the /admin path can open it. It's "not discoverable," not "not
// accessible." Wiring real auth (e.g. Supabase Auth) in front of the /admin
// route is exactly the kind of thing to add once a real backend exists —
// the routing seam here is deliberately where that would plug in later.
//
// ADMIN ACCESS GATE
// This is a client-side password check. The password lives in this
// JavaScript bundle, which anyone can read via browser dev tools — so a
// technically determined person can find it, or simply skip calling this
// component by editing the page's JS in their own browser. This is NOT
// real authentication. It stops a casual visitor from stumbling into
// /admin or guessing the path and getting straight in. It does NOT stop
// someone who deliberately goes looking for the password in the bundle.
// Real protection requires a server that checks credentials before ever
// sending admin data to the browser — that's what Supabase Auth (or
// equivalent) in front of a real backend gives you.
//
// CHANGE ADMIN_PASSWORD_HASH BELOW BEFORE DEPLOYING — see instructions further down.
// ============================================================================

// ADMIN_PASSWORD is no longer stored as visible plain text — a casual look
// at the source (or this GitHub repo) no longer shows your actual password.
// This is still a client-side check and can still be defeated by someone
// deliberately reverse-engineering the hash or reading it out of network
// traffic — hashing raises the bar, it does not make this a real backend
// auth system. See the comment block above for what that would take.
//
// To change the password: open the browser console on ANY website, run:
//   crypto.subtle.digest("SHA-256", new TextEncoder().encode("yourNewPassword"))
//     .then(b => console.log(Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2,"0")).join("")))
// and paste the printed hash below.
const ADMIN_PASSWORD_HASH = "494a715f7e9b4071aca61bac42ca858a309524e5864f0920030862a4ae7589be"; // sha-256 of "changeme123" — CHANGE THIS

async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

const MAX_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 10;

function AdminGate({ children }) {
  const [unlocked, setUnlocked] = useState(() => sessionStorage.getItem("ssccgl:admin-unlocked") === "1");
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);
  const [lockedUntil, setLockedUntil] = useState(() => {
    const stored = Number(localStorage.getItem("ssccgl:admin-lockout-until") || 0);
    return stored > Date.now() ? stored : 0;
  });

  async function handleSubmit(e) {
    e.preventDefault();
    if (lockedUntil > Date.now()) return;

    setChecking(true);
    const hash = await sha256(input);
    setChecking(false);

    if (hash === ADMIN_PASSWORD_HASH) {
      sessionStorage.setItem("ssccgl:admin-unlocked", "1");
      localStorage.removeItem("ssccgl:admin-attempts");
      localStorage.removeItem("ssccgl:admin-lockout-until");
      setUnlocked(true);
      setError("");
    } else {
      const attempts = Number(localStorage.getItem("ssccgl:admin-attempts") || 0) + 1;
      localStorage.setItem("ssccgl:admin-attempts", String(attempts));
      if (attempts >= MAX_ATTEMPTS) {
        const until = Date.now() + LOCKOUT_MINUTES * 60 * 1000;
        localStorage.setItem("ssccgl:admin-lockout-until", String(until));
        setLockedUntil(until);
        setError(`Too many attempts. Locked for ${LOCKOUT_MINUTES} minutes.`);
      } else {
        setError(`Incorrect password. ${MAX_ATTEMPTS - attempts} attempt${MAX_ATTEMPTS - attempts === 1 ? "" : "s"} remaining before lockout.`);
      }
    }
  }

  if (unlocked) return children;

  const isLocked = lockedUntil > Date.now();
  const minutesLeft = isLocked ? Math.ceil((lockedUntil - Date.now()) / 60000) : 0;

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-6">
      <form onSubmit={handleSubmit} className="bg-white rounded-2xl p-8 max-w-sm w-full">
        <h1 className="text-lg font-semibold text-slate-800 mb-1">Admin Access</h1>
        <p className="text-xs text-slate-400 mb-5">This area is not linked from the student site.</p>
        <input
          type="password"
          autoFocus
          disabled={isLocked}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Password"
          className="w-full text-sm border border-slate-200 rounded-md px-3 py-2.5 mb-3 disabled:bg-slate-50"
        />
        {error && <p className="text-xs text-red-600 mb-3">{error}</p>}
        {isLocked && <p className="text-xs text-amber-600 mb-3">Try again in {minutesLeft} minute{minutesLeft === 1 ? "" : "s"}.</p>}
        <button
          type="submit"
          disabled={isLocked || checking}
          className="w-full bg-blue-900 text-white text-sm font-medium rounded-lg py-2.5 disabled:opacity-50"
        >
          {checking ? "Checking..." : "Enter"}
        </button>
      </form>
    </div>
  );
}

export default function App() {
  const [path, setPath] = useState(window.location.pathname);

  useEffect(() => {
    const onPopState = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const isAdmin = path.startsWith("/admin");

  if (isAdmin) {
    return (
      <AdminGate>
        <div>
          <div className="bg-slate-900 px-4 py-1.5 flex justify-end">
            <a href="/" className="text-[11px] text-slate-300 hover:text-white">
              View as Student →
            </a>
          </div>
          <AdminPanel />
        </div>
      </AdminGate>
    );
  }
  return <StudentApp />;
}

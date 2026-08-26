import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  LayoutDashboard, ListChecks, Plus, Search, Pencil, Eye, Copy, Trash2,
  CheckCircle2, XCircle, AlertCircle, ChevronUp, ChevronDown, Upload,
  ArrowLeft, Save, X, Lock, Play, Clock, Flag, Download, LogOut,
  TrendingUp, Target, Youtube, Trophy, Flame, Share2, BarChart2,
  Swords, ThumbsUp, ThumbsDown, Link2, Activity,
} from "lucide-react";
import {
  loadMocksIndex, saveMocksIndex, loadMockQuestions, saveMockQuestions, deleteMockQuestions,
  saveAttempt, loadMockScores, loadDeviceAttempts, loadQuestionsByTopics,
  loadCutoffs, addCutoff, deleteCutoff,
  createChallenge, loadChallenge, claimOpponentSlot, setChallengeReaction, loadAttemptById,
  loadAttemptsInRange,
} from "./lib/storage";
import { signIn, signOut, getSession, onAuthStateChange } from "./lib/auth";
import { getDeviceId } from "./lib/device";

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
      const { text, next } = grabGroup(segment, i + 1);
      // An underscore with nothing valid after it (another underscore, a
      // space, end of string...) isn't math subscript notation — it's very
      // likely a fill-in-the-blank marker like "___". Treat it as a literal
      // character instead of silently swallowing it into an empty <sub>.
      if (text) {
        flush();
        nodes.push(
          <sub key={`${keyPrefix}-b${key++}`} style={{ fontSize: "0.75em" }}>
            {parseMathSegment(text, `${keyPrefix}-b${key}`)}
          </sub>
        );
        i = next;
        continue;
      }
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
const YOUTUBE_CHANNEL_URL = "https://www.youtube.com/@the100percentiler";

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
// Supabase-backed — see src/lib/storage.js. Same five function names/async
// signatures the rest of this file already expects, so nothing below this
// point needed to change when the backend moved off localStorage.
// ============================================================================

// ============================================================================
// VALIDATION — all-or-nothing: any invalid row blocks the entire import
// ============================================================================
function validateImportJSON(rawText, sectionKey, idsInThisSection, idsInOtherSections, currentCount, maxAllowed) {
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
  // and say exactly why, rather than letting it partially land. Only rows
  // whose id isn't already in this section count toward the total — a
  // question being updated in place (same id, new content) isn't a net
  // addition, so re-uploading a fix for an existing question never trips
  // this even when the section is already at its cap.
  const netNewCount = parsed.filter((q) => !q || typeof q !== "object" || !idsInThisSection.has(q.id)).length;
  const resultingTotal = currentCount + netNewCount;
  if (resultingTotal > maxAllowed) {
    const roomLeft = Math.max(0, maxAllowed - currentCount);
    return {
      ok: false,
      errors: [
        {
          index: null,
          message: `This section already has ${currentCount}/${maxAllowed}. Importing ${netNewCount} new question${netNewCount === 1 ? "" : "s"} would make ${resultingTotal}/${maxAllowed} — over the strict maximum. Only ${roomLeft} more new question${roomLeft === 1 ? "" : "s"} can be added here (questions with an id already in this section update in place and don't count against this). Reduce the batch, or use "Replace Existing Questions" if you want to start this section over.`,
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
    // An id matching one already in THIS section is treated as an update to
    // that question, not a duplicate — that's the whole point of this mode.
    // An id belonging to a DIFFERENT section is still rejected: a question's
    // id should never live in two sections of the same mock at once.
    if (idsInOtherSections.has(q.id)) return fail(`id "${q.id}" already exists in another section of this mock — wrong upload box?`);
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
      // Optional — powers the post-test "topic-wise performance" breakdown.
      // Falls back to the section label when absent, so this is never
      // required and never blocks an import.
      topic: typeof q.topic === "string" && q.topic.trim() ? q.topic.trim() : null,
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
// ANALYTICS — admin-only. Everything here is derived from the `attempts`
// table already being written to for percentile/leaderboard/progress — no
// new schema, just aggregated several different ways, client-side (row
// counts here are small enough that this is never a real cost). Sections:
// overview, daily trend, per-mock breakdown, audience-wide weak topics
// (aggregated from topicBreakdown — tells the admin what content to make
// next), and toughest individual questions (cross-referenced from each
// attempt's raw per-question answers against the real question list).
// ============================================================================
function AnalyticsView({ mocksIndex }) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [questionStats, setQuestionStats] = useState({});

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await loadAttemptsInRange({ from, to });
      setRows(data);

      // Toughest questions needs the real question list (text + correct
      // answer) for every mock that was actually attempted in this range —
      // fetched once per distinct mock, not per attempt.
      const mockIds = [...new Set(data.map((r) => r.mockId))];
      const questionMaps = await Promise.all(mockIds.map((id) => loadMockQuestions(id).catch(() => ({}))));
      const qLookup = {};
      mockIds.forEach((mockId, i) => {
        Object.values(questionMaps[i]).forEach((list) => {
          (list || []).forEach((q) => {
            qLookup[q.id] = { text: q.text, answer: q.answer, topic: q.topic, mockId };
          });
        });
      });
      const stats = {};
      data.forEach((r) => {
        Object.entries(r.answers || {}).forEach(([qId, selected]) => {
          const q = qLookup[qId];
          if (!q) return;
          if (!stats[qId]) stats[qId] = { attempted: 0, correct: 0, text: q.text, topic: q.topic, mockId: q.mockId };
          stats[qId].attempted += 1;
          if (selected === q.answer) stats[qId].correct += 1;
        });
      });
      setQuestionStats(stats);
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  function setPreset(days) {
    const toD = new Date();
    const fromD = new Date();
    fromD.setDate(fromD.getDate() - days);
    setFrom(fromD.toISOString().slice(0, 10));
    setTo(toD.toISOString().slice(0, 10));
  }
  function clearRange() {
    setFrom("");
    setTo("");
  }

  // --- Overview ---
  const uniqueDevices = new Set(rows.map((r) => r.deviceId)).size;
  const attemptsPerDevice = {};
  rows.forEach((r) => {
    attemptsPerDevice[r.deviceId] = (attemptsPerDevice[r.deviceId] || 0) + 1;
  });
  const returningDevices = Object.values(attemptsPerDevice).filter((n) => n >= 2).length;
  const oneTimeDevices = uniqueDevices - returningDevices;
  const avgAccuracy = rows.length
    ? Math.round(
        (rows.reduce((sum, r) => {
          const total = r.correct + r.incorrect + r.skipped;
          return sum + (total ? r.correct / total : 0);
        }, 0) /
          rows.length) *
          100
      )
    : null;

  // --- Daily trend ---
  const byDay = {};
  rows.forEach((r) => {
    const day = r.createdAt.slice(0, 10);
    if (!byDay[day]) byDay[day] = { attempts: 0, devices: new Set() };
    byDay[day].attempts += 1;
    byDay[day].devices.add(r.deviceId);
  });
  const days = Object.keys(byDay).sort();
  const maxDayAttempts = Math.max(1, ...days.map((d) => byDay[d].attempts));

  // --- Per-mock breakdown ---
  const perMock = {};
  rows.forEach((r) => {
    if (!perMock[r.mockId]) perMock[r.mockId] = { attempts: 0, devices: new Set(), scoreSum: 0, accSum: 0 };
    const p = perMock[r.mockId];
    p.attempts += 1;
    p.devices.add(r.deviceId);
    p.scoreSum += r.score;
    const total = r.correct + r.incorrect + r.skipped;
    p.accSum += total ? r.correct / total : 0;
  });
  const perMockRows = Object.entries(perMock)
    .map(([mockId, v]) => ({
      mockId,
      title: mocksIndex.find((m) => m.id === mockId)?.title || "Deleted mock",
      attempts: v.attempts,
      devices: v.devices.size,
      avgScore: Math.round((v.scoreSum / v.attempts) * 10) / 10,
      avgAccuracy: Math.round((v.accSum / v.attempts) * 100),
    }))
    .sort((a, b) => b.attempts - a.attempts);

  // --- Audience-wide weak topics ---
  const topicAgg = {};
  rows.forEach((r) => {
    (r.topicBreakdown || []).forEach((t) => {
      if (!topicAgg[t.topic]) topicAgg[t.topic] = { correct: 0, total: 0 };
      topicAgg[t.topic].correct += t.correct;
      topicAgg[t.topic].total += t.total;
    });
  });
  const topicRows = Object.entries(topicAgg)
    .map(([topic, v]) => ({ topic, ...v, accuracy: v.correct / v.total }))
    .sort((a, b) => a.accuracy - b.accuracy);
  function topicBadge(accuracy) {
    if (accuracy < 0.4) return { label: "Weak", cls: "bg-red-100 text-red-700" };
    if (accuracy < 0.7) return { label: "Getting there", cls: "bg-amber-100 text-amber-700" };
    return { label: "Strong", cls: "bg-emerald-100 text-emerald-700" };
  }

  // --- Toughest questions (min 3 answers so one fluke doesn't dominate) ---
  const toughestQuestions = Object.entries(questionStats)
    .map(([qId, v]) => ({ qId, ...v, accuracy: v.correct / v.attempted }))
    .filter((q) => q.attempted >= 3)
    .sort((a, b) => a.accuracy - b.accuracy)
    .slice(0, 10);

  return (
    <div className="max-w-4xl space-y-6">
      <div className="bg-white border border-slate-200 rounded-lg p-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">From</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="text-sm border border-slate-200 rounded-md px-3 py-2" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">To</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="text-sm border border-slate-200 rounded-md px-3 py-2" />
        </div>
        <button onClick={() => setPreset(7)} className="text-xs px-3 py-2 rounded-md border border-slate-200 text-slate-600">
          Last 7 days
        </button>
        <button onClick={() => setPreset(30)} className="text-xs px-3 py-2 rounded-md border border-slate-200 text-slate-600">
          Last 30 days
        </button>
        <button onClick={clearRange} className="text-xs px-3 py-2 rounded-md border border-slate-200 text-slate-600">
          All time
        </button>
      </div>

      {loading ? (
        <div className="text-sm text-slate-400">Loading...</div>
      ) : rows.length === 0 ? (
        <div className="bg-white border border-dashed border-slate-200 rounded-xl p-12 text-center text-sm text-slate-400">
          No attempts in this range.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="bg-white border border-slate-200 rounded-lg p-4">
              <div className="text-2xl font-semibold text-slate-800">{uniqueDevices}</div>
              <div className="text-xs text-slate-500 mt-0.5">Unique devices</div>
            </div>
            <div className="bg-white border border-slate-200 rounded-lg p-4">
              <div className="text-2xl font-semibold text-slate-800">{rows.length}</div>
              <div className="text-xs text-slate-500 mt-0.5">Total attempts</div>
            </div>
            <div className="bg-white border border-slate-200 rounded-lg p-4">
              <div className="text-2xl font-semibold text-slate-800">
                {oneTimeDevices} <span className="text-sm font-normal text-slate-400">/ {returningDevices}</span>
              </div>
              <div className="text-xs text-slate-500 mt-0.5">One-time / returning</div>
            </div>
            <div className="bg-white border border-slate-200 rounded-lg p-4">
              <div className="text-2xl font-semibold text-slate-800">{avgAccuracy}%</div>
              <div className="text-xs text-slate-500 mt-0.5">Average accuracy</div>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-lg p-4">
            <h2 className="text-sm font-semibold text-slate-700 mb-3">Daily activity</h2>
            <div className="flex items-end gap-1.5 overflow-x-auto pb-1" style={{ minHeight: 130 }}>
              {days.map((day) => {
                const v = byDay[day];
                const height = Math.max(4, Math.round((v.attempts / maxDayAttempts) * 100));
                return (
                  <div key={day} className="flex flex-col items-center shrink-0" style={{ width: 30 }} title={`${v.attempts} attempts, ${v.devices.size} devices`}>
                    <div className="text-[9px] text-slate-400 mb-1">{v.attempts}</div>
                    <div className="w-4 bg-blue-600 rounded-t" style={{ height: `${height}px` }} />
                    <div className="text-[8px] text-slate-400 mt-1">{day.slice(5)}</div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100">
              <h2 className="text-sm font-semibold text-slate-700">Per-mock breakdown</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500">
                  <tr>
                    <th className="text-left px-4 py-2">Mock</th>
                    <th className="text-right px-4 py-2">Attempts</th>
                    <th className="text-right px-4 py-2">Devices</th>
                    <th className="text-right px-4 py-2">Avg score</th>
                    <th className="text-right px-4 py-2">Avg accuracy</th>
                  </tr>
                </thead>
                <tbody>
                  {perMockRows.map((r) => (
                    <tr key={r.mockId} className="border-t border-slate-100">
                      <td className="px-4 py-2 text-slate-700">{r.title}</td>
                      <td className="px-4 py-2 text-right text-slate-600">{r.attempts}</td>
                      <td className="px-4 py-2 text-right text-slate-600">{r.devices}</td>
                      <td className="px-4 py-2 text-right text-slate-600">{r.avgScore}</td>
                      <td className="px-4 py-2 text-right text-slate-600">{r.avgAccuracy}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100">
              <h2 className="text-sm font-semibold text-slate-700">Audience-wide weak topics</h2>
              <p className="text-xs text-slate-400 mt-0.5">Aggregated across every attempt in this range — a good signal for what to make content about next.</p>
            </div>
            {topicRows.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-400">No topic-tagged questions attempted in this range yet.</div>
            ) : (
              <div className="divide-y divide-slate-100">
                {topicRows.map((t) => {
                  const badge = topicBadge(t.accuracy);
                  return (
                    <div key={t.topic} className="flex items-center justify-between px-4 py-2.5 text-sm">
                      <span className="text-slate-700">{t.topic}</span>
                      <span className="flex items-center gap-2">
                        <span className="text-xs text-slate-400">
                          {t.correct}/{t.total}
                        </span>
                        <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${badge.cls}`}>{badge.label}</span>
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100">
              <h2 className="text-sm font-semibold text-slate-700">Toughest questions</h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Lowest accuracy among students who answered (skipped questions aren't counted against this) — at least 3 answers, so one fluke doesn't skew it.
              </p>
            </div>
            {toughestQuestions.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-400">Not enough answered questions yet to show this.</div>
            ) : (
              <div className="divide-y divide-slate-100">
                {toughestQuestions.map((q) => (
                  <div key={q.qId} className="px-4 py-2.5 text-sm flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-slate-700 truncate">
                        <MathText text={q.text} />
                      </div>
                      <div className="text-xs text-slate-400 mt-0.5">
                        {mocksIndex.find((m) => m.id === q.mockId)?.title || "Deleted mock"}
                        {q.topic ? ` · ${q.topic}` : ""}
                      </div>
                    </div>
                    <span className="shrink-0 text-xs font-medium px-2 py-0.5 rounded-full bg-red-100 text-red-700">
                      {q.correct}/{q.attempted} correct
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ============================================================================
// CUTOFFS — admin-managed historical SSC CGL cutoff scores, shown to
// students on Full Mock results. Deliberately absent from the student side
// until at least one row exists here.
// ============================================================================
function CutoffsView() {
  const [cutoffs, setCutoffs] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [year, setYear] = useState(new Date().getFullYear());
  const [cutoff, setCutoff] = useState("");
  const [deleteTarget, setDeleteTarget] = useState(null);

  const refresh = useCallback(async () => {
    setCutoffs(await loadCutoffs());
    setLoaded(true);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function handleAdd() {
    const y = Number(year);
    const c = Number(cutoff);
    if (!y || !c) return;
    await addCutoff({ id: generateId("cutoff"), year: y, cutoff: c });
    setCutoff("");
    refresh();
  }

  async function handleDelete() {
    await deleteCutoff(deleteTarget.id);
    setDeleteTarget(null);
    refresh();
  }

  if (!loaded) {
    return <div className="text-sm text-slate-400">Loading...</div>;
  }

  return (
    <div className="max-w-xl">
      <div className="bg-white border border-slate-200 rounded-lg p-6 mb-6">
        <h2 className="text-sm font-semibold text-slate-700 mb-1">Add a cutoff</h2>
        <p className="text-xs text-slate-500 mb-4">
          Shown to students on Full Mock results, comparing their score against real past SSC CGL cutoffs. This
          comparison only appears on the student side once you've added at least one year here.
        </p>
        <div className="flex gap-2">
          <input
            type="number"
            value={year}
            onChange={(e) => setYear(e.target.value)}
            placeholder="Year"
            className="w-28 text-sm border border-slate-200 rounded-md px-3 py-2"
          />
          <input
            type="number"
            value={cutoff}
            onChange={(e) => setCutoff(e.target.value)}
            placeholder="Cutoff score (out of 200)"
            className="flex-1 text-sm border border-slate-200 rounded-md px-3 py-2"
          />
          <button onClick={handleAdd} className="text-sm px-4 py-2 rounded-md bg-blue-900 text-white">
            Add
          </button>
        </div>
      </div>

      {cutoffs.length === 0 ? (
        <div className="bg-white border border-dashed border-slate-200 rounded-lg p-10 text-center text-sm text-slate-400">
          No cutoffs added yet — students won't see this comparison until you add one.
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          {cutoffs.map((c) => (
            <div key={c.id} className="flex items-center justify-between px-4 py-3 border-b border-slate-100 last:border-0">
              <div className="text-sm text-slate-700">
                {c.year} <span className="text-slate-400">— cutoff {c.cutoff}</span>
              </div>
              <button onClick={() => setDeleteTarget(c)} className="text-slate-300 hover:text-red-600">
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      {deleteTarget && (
        <ConfirmModal
          title="Delete this cutoff?"
          body={`Remove the ${deleteTarget.year} cutoff (${deleteTarget.cutoff})? Students won't see it anymore.`}
          confirmLabel="Delete"
          danger
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
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
          <div className="col-span-2">
            <label className="block text-xs font-medium text-slate-500 mb-1">
              "Watch me take this test" YouTube link (optional)
            </label>
            <input
              value={form.videoUrl || ""}
              onChange={(e) => update("videoUrl", e.target.value)}
              placeholder="https://youtube.com/watch?v=..."
              className="w-full text-sm border border-slate-200 rounded-md px-3 py-2"
            />
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
    initial || { id: generateId("q"), text: "", options: ["", "", "", ""], answer: 0, explanation: "", difficulty: "Moderate", topic: "" }
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
      <div className="flex items-center gap-2">
        <select
          value={q.difficulty}
          onChange={(e) => setQ({ ...q, difficulty: e.target.value })}
          className="text-sm border border-slate-200 rounded-md px-3 py-1.5"
        >
          {DIFFICULTIES.map((d) => (
            <option key={d}>{d}</option>
          ))}
        </select>
        <input
          value={q.topic || ""}
          onChange={(e) => setQ({ ...q, topic: e.target.value })}
          placeholder="Topic (optional, e.g. Percentages)"
          className="flex-1 text-sm border border-slate-200 rounded-md px-3 py-1.5"
        />
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <button onClick={onCancel} className="text-xs px-3 py-1.5 rounded-md border border-slate-200 text-slate-600">
          Cancel
        </button>
        <button
          onClick={() => {
            if (!q.text.trim() || q.options.some((o) => !o.trim()) || !q.explanation.trim()) return;
            onSave({ ...q, topic: q.topic && q.topic.trim() ? q.topic.trim() : null });
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
    // In "replace" mode the section is being cleared, so nothing in it counts
    // as "already here" — every uploaded id is new to this (now-empty)
    // section. In "add" mode, an id matching one already in this section is
    // an update-in-place, not a duplicate — see validateImportJSON.
    const idsInThisSection = importMode === "replace" ? new Set() : new Set(list.map((q) => q.id));
    return validateImportJSON(jsonText, sectionKey, idsInThisSection, existingIdsExcludingThisSection(), baseCount, requiredCount);
  }

  function doImport() {
    const result = handleValidate();
    setErrors(result.errors);
    if (!result.ok) return;
    if (importMode === "replace") {
      persist(result.questions);
    } else {
      // Add/update: any uploaded question whose id matches one already in
      // this section replaces it in place (same position); anything with a
      // genuinely new id is appended after.
      const byId = new Map(result.questions.map((q) => [q.id, q]));
      const updated = list.map((q) => byId.get(q.id) || q);
      const added = result.questions.filter((q) => !list.some((existing) => existing.id === q.id));
      persist([...updated, ...added]);
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
            Add / Update Questions
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
            A question with an id already in this section is updated in place — everything else is unaffected.{" "}
            {atCap
              ? "This section is full, but you can still fix existing questions by re-uploading their id."
              : `Room for ${roomLeft} more new question${roomLeft === 1 ? "" : "s"}.`}
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
          placeholder={`[\n  {\n    "id": "quant_001",\n    "section": "${sectionLabel(sectionKey)}",\n    "topic": "Percentages",\n    "text": "...",\n    "options": ["...", "...", "...", "..."],\n    "answer": 0,\n    "explanation": "..."\n  }\n]`}
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
                    <td className="px-3 py-2 text-slate-700">
                      <MathText text={q.text} />
                      <div className="text-[10px] font-mono text-slate-300 mt-1" title="Re-upload this id via Add / Update Questions to fix this question">
                        id: {q.id}
                      </div>
                    </td>
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
// SHARE RESULT CARD — draws a story/status-shaped (1080x1920) image with the
// student's score, so it drops straight into a WhatsApp Status or Instagram
// Story without cropping. Uses the Canvas API directly (no image library) —
// on mobile browsers, sharing hands the actual image file to the OS share
// sheet so the student can pick WhatsApp/Instagram/anything directly;
// otherwise it just downloads, and the card is visible on screen either way
// so a plain screenshot always works as a fallback.
// ============================================================================
function ShareResultCard({ mock, score, totalMarks }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const W = canvas.width, H = canvas.height;

    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, "#1e3a8a");
    grad.addColorStop(1, "#1d4ed8");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    ctx.textAlign = "center";
    ctx.fillStyle = "#ffffff";

    ctx.font = "600 52px system-ui, sans-serif";
    ctx.fillText("I SCORED", W / 2, H * 0.36);

    ctx.font = "800 150px system-ui, sans-serif";
    ctx.fillText(`${score}/${totalMarks}`, W / 2, H * 0.47);

    ctx.font = "600 44px system-ui, sans-serif";
    wrapCanvasText(ctx, "IN THE SSC CGL MOCK TEST BY THE 100 PERCENTILER", W / 2, H * 0.57, W * 0.82, 56);

    ctx.font = "600 34px system-ui, sans-serif";
    ctx.fillStyle = "#bfdbfe";
    ctx.fillText("TRY IT YOURSELF →", W / 2, H * 0.7);

    ctx.font = "400 26px system-ui, sans-serif";
    ctx.fillStyle = "#93c5fd";
    wrapCanvasText(ctx, mock.title || "SSC CGL Mock Test", W / 2, H * 0.88, W * 0.82, 34);
    ctx.fillText("@the100percentiler", W / 2, H * 0.95);
  }, [score, totalMarks, mock.title]);

  function shareOrDownload() {
    const canvas = canvasRef.current;
    canvas.toBlob(async (blob) => {
      if (!blob) return;
      const file = new File([blob], "my-ssc-cgl-score.png", { type: "image/png" });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: "SSC CGL Mock Test" });
          return;
        } catch {
          // user cancelled the share sheet — fall through to download
        }
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "my-ssc-cgl-score.png";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    }, "image/png");
  }

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5">
      <h3 className="text-sm font-semibold text-slate-700 mb-3">Share your score</h3>
      <canvas ref={canvasRef} width={1080} height={1920} className="w-full max-w-[220px] mx-auto rounded-xl shadow-md block" />
      <button
        onClick={shareOrDownload}
        className="w-full mt-4 flex items-center justify-center gap-2 bg-blue-900 text-white text-sm font-medium py-2.5 rounded-lg"
      >
        <Share2 size={15} /> Share / Download
      </button>
      <p className="text-[11px] text-slate-400 text-center mt-2">
        Post it as a WhatsApp Status, Instagram Story, anywhere — or just screenshot it.
      </p>
    </div>
  );
}

function wrapCanvasText(ctx, text, x, y, maxWidth, lineHeight) {
  const words = text.split(" ");
  let line = "";
  let curY = y;
  for (const word of words) {
    const test = `${line}${word} `;
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line.trim(), x, curY);
      line = `${word} `;
      curY += lineHeight;
    } else {
      line = test;
    }
  }
  ctx.fillText(line.trim(), x, curY);
}

// ============================================================================
// RUN MOCK — an actual timed, section-locked attempt, using this mock's real
// questions. Distinct from PreviewView: no answers shown, real countdown per
// section, auto-advances when time is up, gives a score at the end.
// ============================================================================
function RunMockView({ mock, questions, onExit, challengeId }) {
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
  const [timeSpent, setTimeSpent] = useState({}); // questionId -> seconds spent on it

  const section = sections[sectionIdx];
  const list = section ? questions[section.key] || [] : [];
  const q = list[qIdx];
  const isLastSection = sectionIdx === sections.length - 1;
  const perSectionSeconds = Math.round((mock.duration / sections.length) * 60);

  useEffect(() => {
    if (q) setVisited((v) => (v[q.id] ? v : { ...v, [q.id]: true }));
  }, [q]);

  // Per-question time tracking for the post-test "time analysis" — accumulates
  // into timeSpent[q.id] every time the student navigates away from a
  // question (including moving sections or finishing), so it survives
  // revisits within the same section and doesn't require touching every
  // render.
  const questionEnterRef = useRef(Date.now());
  function flushTime() {
    if (!q) return;
    const elapsed = Math.round((Date.now() - questionEnterRef.current) / 1000);
    questionEnterRef.current = Date.now();
    if (elapsed <= 0) return;
    setTimeSpent((t) => ({ ...t, [q.id]: (t[q.id] || 0) + elapsed }));
  }

  function goToSection(nextIdx) {
    flushTime();
    setSectionIdx(nextIdx);
    setQIdx(0);
    setTimeLeft(perSectionSeconds);
  }

  const advanceSection = useCallback(() => {
    flushTime();
    if (isLastSection) {
      setFinished(true);
      return;
    }
    setToast(`Time up for ${section.label} — moving to the next section.`);
    setSectionIdx((i) => i + 1);
    setQIdx(0);
    setTimeLeft(perSectionSeconds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLastSection, section, perSectionSeconds, q]);

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
  function goToQuestion(idx) {
    flushTime();
    setQIdx(idx);
  }
  function saveAndNext() {
    setSaved((s) => ({ ...s, [q.id]: true }));
    if (qIdx < list.length - 1) goToQuestion(qIdx + 1);
  }
  function toggleMarkForReview() {
    setMarked((m) => ({ ...m, [q.id]: !m[q.id] }));
    if (qIdx < list.length - 1) goToQuestion(qIdx + 1);
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
    if (confirmAction === "finish") {
      flushTime();
      setFinished(true);
    } else if (confirmAction === "next-section") {
      goToSection(sectionIdx + 1);
    }
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

  // Score + topic-wise breakdown, shared by the results screen render and the
  // attempt-history save below — computed from answers/questions/sections,
  // which are always in scope regardless of `finished`.
  function computeResults() {
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

    // Topic-wise performance — groups by each question's tagged topic, or
    // falls back to its section label when no topic was set on it (so this
    // is always useful even for mocks made before topics existed).
    const topicStats = {};
    sections.forEach((s) => {
      (questions[s.key] || []).forEach((qq) => {
        const key = qq.topic || s.label;
        if (!topicStats[key]) topicStats[key] = { correct: 0, total: 0 };
        topicStats[key].total += 1;
        if (answers[qq.id] === qq.answer) topicStats[key].correct += 1;
      });
    });
    const topicRows = Object.entries(topicStats)
      .map(([topic, v]) => ({ topic, ...v, accuracy: v.correct / v.total }))
      .sort((a, b) => a.accuracy - b.accuracy);
    const weakTopics = topicRows.filter((t) => t.accuracy < 0.4).map((t) => t.topic);
    const strongTopics = topicRows.filter((t) => t.accuracy >= 0.7).map((t) => t.topic);

    return { correct, incorrect, skipped, sectionBreakdown, score, topicRows, weakTopics, strongTopics };
  }

  // Save this attempt to anonymous per-device history once the test is
  // finished, then work out where it ranks against everyone else who's
  // attempted this same mock. Best-effort: if Supabase is briefly
  // unreachable, the results screen still works, just without a percentile.
  const [percentile, setPercentile] = useState(null);
  const [leaderboard, setLeaderboard] = useState([]);
  const [myAttemptId, setMyAttemptId] = useState(null);
  const [cutoffs, setCutoffs] = useState([]);
  const [challengeClaim, setChallengeClaim] = useState(null); // 'claimed' | 'taken' | null (only relevant when challengeId prop is set)
  const [myChallengeLink, setMyChallengeLink] = useState(null); // set after creating a NEW challenge from a solo attempt
  useEffect(() => {
    if (!finished) return;
    const { score, correct, incorrect, skipped, topicRows } = computeResults();
    const totalTime = Object.values(timeSpent).reduce((sum, s) => sum + s, 0);
    const attemptId = generateId("attempt");
    setMyAttemptId(attemptId);
    (async () => {
      try {
        await saveAttempt({
          id: attemptId,
          deviceId: getDeviceId(),
          mockId: mock.id,
          score,
          correct,
          incorrect,
          skipped,
          totalTime,
          topicBreakdown: topicRows,
          answers,
          timeSpent,
        });
        const rows = await loadMockScores(mock.id); // [{id, score}], best first
        const better = rows.filter((r) => r.score < score).length;
        setPercentile(rows.length > 1 ? Math.round((better / rows.length) * 100) : null);
        setLeaderboard(rows.slice(0, 5));
        if (challengeId) {
          const claimed = await claimOpponentSlot(challengeId, attemptId);
          setChallengeClaim(claimed ? "claimed" : "taken");
        }
      } catch {
        // Non-critical — the results screen works fine without this.
      }
    })();
    // Cutoff comparison only makes sense on the same 200-mark scale as the
    // real exam, so only Full Mocks show it — and only once you've entered
    // at least one year in admin.
    if (getMockType(mock) === MOCK_TYPES.FULL) {
      loadCutoffs()
        .then(setCutoffs)
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished]);

  async function handleChallengeAFriend() {
    if (!myAttemptId) return;
    const id = generateId("ch");
    try {
      await createChallenge({ id, mockId: mock.id, creatorAttemptId: myAttemptId });
      setMyChallengeLink(`${window.location.origin}/challenge/${id}`);
    } catch {
      // Non-critical — the rest of the results screen still works.
    }
  }

  if (finished) {
    const { correct, incorrect, skipped, sectionBreakdown, score, topicRows, weakTopics, strongTopics } = computeResults();
    function topicBadge(accuracy) {
      if (accuracy < 0.4) return { label: "Needs revision", cls: "bg-red-100 text-red-700" };
      if (accuracy < 0.7) return { label: "Getting there", cls: "bg-amber-100 text-amber-700" };
      return { label: "Strong", cls: "bg-emerald-100 text-emerald-700" };
    }

    // Time analysis — colors each question relative to a "fair" pace (the
    // section's time budget split evenly across its questions), not a fixed
    // number of seconds, so it stays meaningful across mocks of any length.
    function parTimeFor(sectionKey) {
      return perSectionSeconds / ((questions[sectionKey] || []).length || 1);
    }
    function timeBadge(qq, sectionKey) {
      const t = timeSpent[qq.id] || 0;
      const par = parTimeFor(sectionKey);
      if (t === 0) return "bg-slate-100 text-slate-400 border-slate-200";
      if (t <= par * 0.5) return "bg-emerald-100 text-emerald-700 border-emerald-200";
      if (t <= par * 1.5) return "bg-amber-100 text-amber-700 border-amber-200";
      return "bg-red-100 text-red-700 border-red-200";
    }

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
          <div className="text-3xl font-bold text-slate-800 mb-2">{score} <span className="text-lg font-normal text-slate-400">/ {mock.totalMarks}</span></div>
          {percentile !== null && (
            <div className="inline-block bg-blue-50 text-blue-700 text-xs font-medium px-3 py-1 rounded-full mb-4">
              Better than {percentile}% of students who've attempted this mock
            </div>
          )}

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

        <div className="max-w-md w-full mt-6">
          <ShareResultCard mock={mock} score={score} totalMarks={mock.totalMarks} />
        </div>

        {challengeId ? (
          <div className="max-w-md w-full mt-6 bg-white border border-slate-200 rounded-2xl p-5 text-center">
            <Swords size={20} className="mx-auto mb-2 text-blue-700" />
            <h3 className="text-sm font-semibold text-slate-700 mb-1">
              {challengeClaim === "taken" ? "This challenge was already completed" : "Challenge accepted!"}
            </h3>
            <p className="text-xs text-slate-500 mb-4">
              {challengeClaim === "taken"
                ? "Someone else already finished this challenge first — your attempt was still saved, just not linked to it."
                : "See the full side-by-side answer sheet with whoever sent you this."}
            </p>
            {challengeClaim === "claimed" && (
              <a href={`/challenge/${challengeId}`} className="inline-block bg-blue-900 text-white text-sm font-medium px-4 py-2 rounded-lg">
                View comparison →
              </a>
            )}
          </div>
        ) : (
          <div className="max-w-md w-full mt-6 bg-white border border-slate-200 rounded-2xl p-5">
            <h3 className="text-sm font-semibold text-slate-700 mb-1 flex items-center gap-1.5">
              <Swords size={15} className="text-blue-700" /> Challenge a friend
            </h3>
            <p className="text-xs text-slate-400 mb-3">
              Send this exact mock to a friend — once they finish, you'll both see a full side-by-side answer sheet.
            </p>
            {myChallengeLink ? (
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  value={myChallengeLink}
                  onClick={(e) => e.target.select()}
                  className="flex-1 text-xs border border-slate-200 rounded-md px-3 py-2 text-slate-600"
                />
                <button
                  onClick={() => navigator.clipboard?.writeText(myChallengeLink)}
                  className="shrink-0 text-xs px-3 py-2 rounded-md border border-slate-200 text-slate-600"
                  title="Copy link"
                >
                  <Link2 size={13} />
                </button>
              </div>
            ) : (
              <button
                onClick={handleChallengeAFriend}
                disabled={!myAttemptId}
                className="w-full flex items-center justify-center gap-2 bg-blue-900 text-white text-sm font-medium py-2.5 rounded-lg disabled:opacity-50"
              >
                <Swords size={15} /> Create Challenge Link
              </button>
            )}
          </div>
        )}

        {leaderboard.length > 0 && (
          <div className="max-w-md w-full mt-6 bg-white border border-slate-200 rounded-2xl p-5 text-left">
            <h3 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-1.5">
              <Trophy size={15} className="text-amber-500" /> Top scores for this mock
            </h3>
            <div className="space-y-1.5">
              {leaderboard.map((row, i) => (
                <div
                  key={row.id}
                  className={`flex items-center justify-between text-xs rounded-md px-3 py-2 ${
                    row.id === myAttemptId ? "bg-blue-50 border border-blue-200" : "bg-slate-50"
                  }`}
                >
                  <span className={row.id === myAttemptId ? "font-semibold text-blue-800" : "text-slate-600"}>
                    #{i + 1}{row.id === myAttemptId ? " · You" : ""}
                  </span>
                  <span className="font-medium text-slate-800">{row.score}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {cutoffs.length > 0 && (
          <div className="max-w-md w-full mt-6 bg-white border border-slate-200 rounded-2xl p-5 text-left">
            <h3 className="text-sm font-semibold text-slate-700 mb-1 flex items-center gap-1.5">
              <BarChart2 size={15} className="text-blue-700" /> Your score vs. past cutoffs
            </h3>
            <p className="text-xs text-slate-400 mb-3">How {score} compares to recent years' actual SSC CGL cutoffs.</p>
            <div className="space-y-1.5">
              {cutoffs.slice(0, 5).map((c) => {
                const cleared = score >= c.cutoff;
                return (
                  <div key={c.id} className="flex items-center justify-between text-xs bg-slate-50 rounded-md px-3 py-2">
                    <div>
                      <div className="text-slate-700 font-medium">{c.year}</div>
                      <div className="text-slate-400">Cutoff: {c.cutoff}</div>
                    </div>
                    <span
                      className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${
                        cleared ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-600"
                      }`}
                    >
                      {cleared ? "Would clear" : "Below cutoff"}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="max-w-2xl w-full mt-6 space-y-3">
          <div className="bg-white border border-slate-200 rounded-xl p-5 text-left">
            <h3 className="text-sm font-semibold text-slate-700 mb-1">Time analysis</h3>
            <p className="text-xs text-slate-400 mb-4">How long you spent on each question, compared to a fair pace for this test.</p>
            <div className="flex items-center gap-3 text-[11px] text-slate-500 mb-4 flex-wrap">
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-emerald-100 border border-emerald-200" /> Quick</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-amber-100 border border-amber-200" /> Normal pace</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-red-100 border border-red-200" /> Took long</span>
            </div>
            {sections.map((s) => {
              const sList = questions[s.key] || [];
              if (sList.length === 0) return null;
              return (
                <div key={s.key} className="mb-4 last:mb-0">
                  {sections.length > 1 && <div className="text-xs font-medium text-slate-500 mb-2">{s.label}</div>}
                  <div className="grid grid-cols-5 sm:grid-cols-8 gap-2">
                    {sList.map((qq, i) => (
                      <div
                        key={qq.id}
                        title={`${s.label} · Q${i + 1} — ${formatTime(timeSpent[qq.id] || 0)}`}
                        className={`rounded-md border text-center py-1.5 ${timeBadge(qq, s.key)}`}
                      >
                        <div className="text-[10px] font-semibold">{i + 1}</div>
                        <div className="text-[10px]">{formatTime(timeSpent[qq.id] || 0)}</div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5 text-left">
            <h3 className="text-sm font-semibold text-slate-700 mb-1">Topic-wise performance</h3>
            <p className="text-xs text-slate-400 mb-4">Where to focus your revision, based on this attempt.</p>
            {weakTopics.length > 0 && (
              <div className="bg-red-50 border border-red-200 rounded-md px-3 py-2 text-xs text-red-700 mb-2">
                📌 Focus your revision on: <span className="font-medium">{weakTopics.join(", ")}</span>
              </div>
            )}
            {strongTopics.length > 0 && (
              <div className="bg-emerald-50 border border-emerald-200 rounded-md px-3 py-2 text-xs text-emerald-700 mb-4">
                ✅ You're doing well in: <span className="font-medium">{strongTopics.join(", ")}</span>
              </div>
            )}
            <div className="space-y-1.5">
              {topicRows.map((t) => {
                const badge = topicBadge(t.accuracy);
                return (
                  <div key={t.topic} className="flex items-center justify-between text-xs bg-slate-50 rounded-md px-3 py-2">
                    <span className="text-slate-600">{t.topic}</span>
                    <span className="flex items-center gap-2">
                      <span className="text-slate-400">{t.correct}/{t.total}</span>
                      <span className={`px-2 py-0.5 rounded-full font-medium ${badge.cls}`}>{badge.label}</span>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

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

        <div className="max-w-2xl w-full mt-6 space-y-3">
          {mock.videoUrl && (
            <a
              href={mock.videoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 bg-white border border-slate-200 rounded-2xl p-5 hover:border-red-300 transition-colors"
            >
              <span className="shrink-0 w-10 h-10 rounded-full bg-red-50 text-red-600 flex items-center justify-center">
                <Youtube size={20} />
              </span>
              <span className="text-left">
                <span className="block text-sm font-semibold text-slate-800">Watch me take this exact test</span>
                <span className="block text-xs text-slate-500">See the strategy and thinking behind every question →</span>
              </span>
            </a>
          )}
          <a
            href={YOUTUBE_CHANNEL_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="block bg-gradient-to-r from-red-600 to-red-500 text-white rounded-2xl p-6 text-center hover:opacity-95 transition-opacity"
          >
            <div className="text-sm font-semibold mb-1">Want to seriously prepare for SSC CGL?</div>
            <div className="text-xs text-red-50 mb-3">
              Get free strategy sessions, topic breakdowns, and more mocks on our YouTube channel.
            </div>
            <span className="inline-block bg-white text-red-600 text-sm font-medium px-4 py-2 rounded-lg">
              Visit The 100 Percentiler →
            </span>
          </a>
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
                  onClick={() => goToQuestion(qIdx - 1)}
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
                  onClick={() => goToQuestion(qIdx + 1)}
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
                  onClick={() => goToQuestion(i)}
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
      videoUrl: null,
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
    { key: "analytics", label: "Analytics", icon: Activity, onClick: () => setView("analytics") },
    { key: "cutoffs", label: "Cutoffs", icon: BarChart2, onClick: () => setView("cutoffs") },
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
          <Lock size={11} /> Protected by Supabase Auth
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
            {view === "analytics" && "Analytics"}
            {view === "cutoffs" && "Cutoffs"}
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
          {view === "analytics" && <AnalyticsView mocksIndex={mocksIndex} />}
          {view === "cutoffs" && <CutoffsView />}
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

function StudentInstructionsView({ mock, questionCount, onStart, onBack, viaChallenge }) {
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
        {viaChallenge && (
          <div className="bg-blue-50 border border-blue-200 rounded-md px-3 py-2 text-xs text-blue-800 mb-5 flex items-center gap-2">
            <Swords size={14} className="shrink-0" /> Finish this test to get a link you can send to a friend to challenge them.
          </div>
        )}

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

// ============================================================================
// MY PROGRESS — this device's attempt history (see src/lib/device.js: no
// login, just a random id kept in localStorage) plus weak topics aggregated
// across every attempt, with a one-click way to drill into them.
// ============================================================================
// Consecutive days (including a one-day grace if today has no attempt yet)
// with at least one attempt on this device — 0 if the streak is broken, in
// which case the caller just doesn't show a badge rather than a "0" one.
function computeStreak(attempts) {
  const days = new Set(attempts.map((a) => new Date(a.createdAt).toDateString()));
  const oneDay = 24 * 60 * 60 * 1000;
  let cursor = new Date();
  if (!days.has(cursor.toDateString())) cursor = new Date(cursor.getTime() - oneDay);
  let streak = 0;
  while (days.has(cursor.toDateString())) {
    streak++;
    cursor = new Date(cursor.getTime() - oneDay);
  }
  return streak;
}

function ProgressView({ attempts, mocksIndex, onBack, onPractice }) {
  const streak = computeStreak(attempts);
  const topicAgg = {};
  attempts.forEach((a) => {
    (a.topicBreakdown || []).forEach((t) => {
      if (!topicAgg[t.topic]) topicAgg[t.topic] = { correct: 0, total: 0 };
      topicAgg[t.topic].correct += t.correct;
      topicAgg[t.topic].total += t.total;
    });
  });
  const weakTopics = Object.entries(topicAgg)
    .map(([topic, v]) => ({ topic, ...v, accuracy: v.correct / v.total }))
    .filter((t) => t.accuracy < 0.4)
    .sort((a, b) => a.accuracy - b.accuracy)
    .map((t) => t.topic);

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-start justify-between">
        <div>
          <button onClick={onBack} className="text-sm text-slate-500 mb-2">← Back</button>
          <h1 className="text-base font-semibold text-slate-800 flex items-center gap-2">
            <TrendingUp size={16} className="text-blue-700" /> My Progress
          </h1>
          <p className="text-xs text-slate-400">{attempts.length} test{attempts.length === 1 ? "" : "s"} attempted on this device</p>
        </div>
        {streak > 0 && (
          <div className="flex items-center gap-1.5 bg-orange-50 text-orange-700 border border-orange-200 px-3 py-1.5 rounded-full text-xs font-semibold">
            <Flame size={14} /> {streak}-day streak
          </div>
        )}
      </header>

      <main className="p-6 max-w-3xl mx-auto">
        {attempts.length === 0 ? (
          <div className="bg-white border border-dashed border-slate-200 rounded-xl p-12 text-center text-sm text-slate-400">
            You haven't attempted any tests on this device yet — take a mock to start tracking your progress.
          </div>
        ) : (
          <>
            {weakTopics.length > 0 && (
              <div className="bg-white border border-slate-200 rounded-xl p-5 mb-4">
                <h2 className="text-sm font-semibold text-slate-700 mb-1">Your weak topics</h2>
                <p className="text-xs text-slate-400 mb-3">Aggregated across every test you've attempted on this device.</p>
                <div className="flex flex-wrap gap-1.5 mb-4">
                  {weakTopics.map((t) => (
                    <span key={t} className="text-xs bg-red-50 text-red-700 border border-red-200 px-2.5 py-1 rounded-full">
                      {t}
                    </span>
                  ))}
                </div>
                <button
                  onClick={() => onPractice(weakTopics)}
                  className="flex items-center gap-1.5 text-sm bg-blue-900 text-white px-4 py-2 rounded-lg"
                >
                  <Target size={14} /> Practice these topics
                </button>
              </div>
            )}

            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-5 py-3 border-b border-slate-100">
                <h2 className="text-sm font-semibold text-slate-700">Attempt history</h2>
              </div>
              <div className="divide-y divide-slate-100">
                {[...attempts].reverse().map((a) => {
                  const m = mocksIndex.find((mm) => mm.id === a.mockId);
                  return (
                    <div key={a.id} className="px-5 py-3 flex items-center justify-between">
                      <div>
                        <div className="text-sm text-slate-700">{m ? m.title || "Untitled mock" : "Deleted mock"}</div>
                        <div className="text-xs text-slate-400">
                          {new Date(a.createdAt).toLocaleDateString()} · {a.correct} correct, {a.incorrect} incorrect, {a.skipped} skipped
                        </div>
                      </div>
                      <div className="text-sm font-semibold text-slate-800">{a.score}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

// ============================================================================
// PRACTICE WEAK TOPICS — a lightweight, untimed drill through real questions
// tagged with the student's weak topics (pulled across all published mocks).
// Deliberately not RunMockView: immediate feedback per question suits
// revision practice better than a timed exam simulation.
// ============================================================================
function WeakTopicPracticeView({ topics, onExit }) {
  const [loading, setLoading] = useState(true);
  const [list, setList] = useState([]);
  const [idx, setIdx] = useState(0);
  const [selected, setSelected] = useState(null);
  const [correctCount, setCorrectCount] = useState(0);
  const [done, setDone] = useState(false);

  useEffect(() => {
    (async () => {
      const qs = await loadQuestionsByTopics(topics, 20);
      setList(qs);
      setLoading(false);
    })();
  }, [topics]);

  function choose(i) {
    if (selected !== null) return;
    setSelected(i);
    if (i === list[idx].answer) setCorrectCount((c) => c + 1);
  }
  function next() {
    if (idx < list.length - 1) {
      setIdx((x) => x + 1);
      setSelected(null);
    } else {
      setDone(true);
    }
  }

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-sm text-slate-400">Loading practice questions...</div>;
  }
  if (list.length === 0) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-center bg-white border border-dashed border-slate-300 rounded-xl p-10 text-sm text-slate-400">
          No tagged questions found for your weak topics yet — check back once more are added.
          <div className="mt-4">
            <button onClick={onExit} className="text-sm px-4 py-2 rounded-md border border-slate-200 text-slate-600">
              Back
            </button>
          </div>
        </div>
      </div>
    );
  }
  if (done) {
    return (
      <div className="min-h-screen bg-slate-100 flex flex-col items-center py-10 px-4">
        <div className="max-w-md w-full text-center bg-white border border-slate-200 rounded-2xl shadow-sm p-10">
          <Target className="mx-auto mb-4 text-blue-700" size={40} />
          <h2 className="text-xl font-semibold text-slate-800 mb-1">Practice complete</h2>
          <p className="text-sm text-slate-500 mb-6">{correctCount} / {list.length} correct</p>
          <button onClick={onExit} className="text-sm px-5 py-2.5 rounded-lg bg-slate-900 text-white">
            Back to progress
          </button>
        </div>
      </div>
    );
  }

  const q = list[idx];
  return (
    <div className="min-h-screen bg-slate-100 flex flex-col items-center py-10 px-4">
      <div className="max-w-2xl w-full">
        <div className="flex items-center justify-between mb-3">
          <button onClick={onExit} className="text-sm text-slate-500">← Exit practice</button>
          <span className="text-xs text-slate-400">
            Question {idx + 1} of {list.length}{q.topic ? ` · ${q.topic}` : ""}
          </span>
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-8">
          <p className="text-lg leading-relaxed text-slate-900 mb-6 font-medium">
            <MathText text={q.text} />
          </p>
          <div className="space-y-3">
            {q.options.map((opt, i) => {
              const isRight = i === q.answer;
              const isPicked = i === selected;
              let cls = "border-slate-200 text-slate-700 hover:border-slate-300 hover:bg-slate-50";
              if (selected !== null) {
                if (isRight) cls = "border-emerald-400 bg-emerald-50 text-emerald-800";
                else if (isPicked) cls = "border-red-300 bg-red-50 text-red-700";
              }
              return (
                <button
                  key={i}
                  onClick={() => choose(i)}
                  disabled={selected !== null}
                  className={`w-full flex items-center gap-3 text-left px-5 py-3.5 rounded-xl border-2 text-base transition-colors ${cls}`}
                >
                  <span className="w-7 h-7 shrink-0 rounded-full flex items-center justify-center text-sm font-semibold bg-slate-100 text-slate-500">
                    {LETTERS[i]}
                  </span>
                  <MathText text={opt} />
                </button>
              );
            })}
          </div>
          {selected !== null && q.explanation && (
            <p className="text-xs text-slate-500 mt-4 italic">
              <MathText text={q.explanation} />
            </p>
          )}
        </div>
        {selected !== null && (
          <div className="flex justify-end mt-4">
            <button onClick={next} className="text-sm px-5 py-2.5 rounded-lg bg-blue-900 text-white font-medium">
              {idx < list.length - 1 ? "Next question" : "Finish practice"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function StudentApp() {
  const [mocksIndex, setMocksIndex] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [view, setView] = useState("type"); // 'type' | 'list' | 'instructions' | 'run'
  const [typeFilter, setTypeFilter] = useState(null); // MOCK_TYPES.FULL | MOCK_TYPES.SECTIONAL
  const [selectedMock, setSelectedMock] = useState(null);
  const [selectedQuestions, setSelectedQuestions] = useState(null);
  const [attempts, setAttempts] = useState([]);
  const [practiceTopics, setPracticeTopics] = useState(null);

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
  const listForType = (typeFilter === "all" ? publishedMocks : publishedMocks.filter((m) => getMockType(m) === typeFilter)).sort(
    (a, b) => a.mockNumber - b.mockNumber
  );

  function chooseType(type) {
    setTypeFilter(type);
    setView("list");
  }

  // "Challenge a friend" from the home page — any published mock works, so
  // this reuses the same list+instructions+run flow untouched; the only
  // difference is no type filter, and the existing "Create Challenge Link"
  // button already appears on the results screen once they finish it.
  function chooseChallenge() {
    setTypeFilter("all");
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

  async function openProgress() {
    setAttempts(await loadDeviceAttempts(getDeviceId()));
    setView("progress");
  }

  function startPractice(topics) {
    setPracticeTopics(topics);
    setView("practice");
  }

  if (!loaded) {
    return <div className="min-h-screen flex items-center justify-center text-sm text-slate-400">Loading available tests...</div>;
  }

  if (view === "run" && selectedMock && selectedQuestions) {
    // The exact same RunMockView the Admin Panel's "Run Mock" button uses —
    // no second engine, no reimplementation of timer/scoring/palette logic.
    return <RunMockView mock={selectedMock} questions={selectedQuestions} onExit={backToList} />;
  }

  if (view === "progress") {
    return <ProgressView attempts={attempts} mocksIndex={mocksIndex} onBack={backToType} onPractice={startPractice} />;
  }

  if (view === "practice" && practiceTopics) {
    return <WeakTopicPracticeView topics={practiceTopics} onExit={() => setView("progress")} />;
  }

  if (view === "instructions" && selectedMock && selectedQuestions) {
    const sections = sectionsForMock(selectedMock);
    const questionCount = sections.reduce((sum, s) => sum + (selectedQuestions[s.key]?.length || 0), 0);
    return (
      <div className="min-h-screen bg-slate-50 p-6">
        <StudentInstructionsView
          mock={selectedMock}
          questionCount={questionCount}
          onStart={startTest}
          onBack={backToList}
          viaChallenge={typeFilter === "all"}
        />
      </div>
    );
  }

  if (view === "type") {
    return (
      <div className="min-h-screen bg-slate-50">
        <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-base font-semibold text-slate-800">SSC CGL Mock Tests</h1>
            <p className="text-xs text-slate-400">{publishedMocks.length} test{publishedMocks.length === 1 ? "" : "s"} available</p>
          </div>
          <button onClick={openProgress} className="flex items-center gap-1.5 text-xs font-medium text-blue-700 border border-blue-200 bg-blue-50 px-3 py-1.5 rounded-full">
            <TrendingUp size={13} /> My Progress
          </button>
        </header>
        <main className="p-6 max-w-3xl mx-auto">
          <p className="text-sm text-slate-500 mb-5">What would you like to practice?</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <TypeSelectCard type={MOCK_TYPES.FULL} count={fullCount} onSelect={chooseType} />
            <TypeSelectCard type={MOCK_TYPES.SECTIONAL} count={sectionalCount} onSelect={chooseType} />
          </div>

          <button
            onClick={chooseChallenge}
            className="w-full bg-gradient-to-r from-blue-900 to-blue-700 text-white rounded-2xl p-8 text-left hover:opacity-95 transition-opacity"
          >
            <div className="flex items-center gap-2 mb-3">
              <span className="inline-block px-2 py-0.5 rounded text-[10px] font-semibold bg-white/20">1v1</span>
              <span
                title="Take any mock, then send the link to a friend. Once they finish it too, you'll both be able to see a full side-by-side answer sheet — every question, both people's answers, and how much time each of you took."
                className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-white/20 text-white text-[10px] font-bold cursor-help"
              >
                i
              </span>
            </div>
            <h2 className="text-lg font-semibold mb-1 flex items-center gap-2">
              <Swords size={18} /> Challenge a Friend
            </h2>
            <p className="text-sm text-blue-100">
              Take any mock, then challenge a friend to beat your score — see exactly how you each did, question by question.
            </p>
          </button>
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
          {typeFilter === "all" ? "Pick a mock to challenge a friend" : typeFilter === MOCK_TYPES.SECTIONAL ? "Sectional Mocks" : "Full Mocks"}
        </h1>
        <p className="text-xs text-slate-400">{listForType.length} test{listForType.length === 1 ? "" : "s"} available</p>
      </header>

      <main className="p-6 max-w-5xl mx-auto">
        {typeFilter === "all" && listForType.length > 0 && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-2.5 text-xs text-blue-800 mb-4">
            Take any test below, then use "Create Challenge Link" on your results screen to send it to a friend.
          </div>
        )}
        {listForType.length === 0 ? (
          <div className="bg-white border border-dashed border-slate-200 rounded-xl p-12 text-center text-sm text-slate-400">
            No {typeFilter === MOCK_TYPES.SECTIONAL ? "sectional" : typeFilter === MOCK_TYPES.FULL ? "full" : ""} tests are available right now — check back soon.
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
// or reveals /admin — so a normal visitor never sees an admin option.
//
// ADMIN ACCESS GATE — real Supabase Auth. AdminGate renders its children
// only once a genuine Supabase session exists, established by
// supabase.auth.signInWithPassword against the admin user created in the
// Supabase dashboard (see src/lib/auth.js) — no password lives in this
// bundle anymore. The actual enforcement point is Row Level Security on the
// `mocks`/`questions` tables in Supabase: draft mocks and all writes are
// rejected by the database itself for anyone without a valid session, even
// if this component were bypassed entirely.
// ============================================================================
function AdminGate({ children }) {
  const [session, setSession] = useState(undefined); // undefined = checking, null = signed out
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    getSession().then(setSession);
    return onAuthStateChange(setSession);
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setChecking(true);
    try {
      await signIn(email, password);
    } catch (err) {
      setError(err.message || "Sign-in failed.");
    } finally {
      setChecking(false);
    }
  }

  if (session === undefined) {
    return <div className="min-h-screen flex items-center justify-center text-sm text-slate-400">Loading...</div>;
  }

  if (session) return children;

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-6">
      <form onSubmit={handleSubmit} className="bg-white rounded-2xl p-8 max-w-sm w-full">
        <h1 className="text-lg font-semibold text-slate-800 mb-1">Admin Access</h1>
        <p className="text-xs text-slate-400 mb-5">Sign in with your admin account.</p>
        <input
          type="email"
          autoFocus
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
          className="w-full text-sm border border-slate-200 rounded-md px-3 py-2.5 mb-3"
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          className="w-full text-sm border border-slate-200 rounded-md px-3 py-2.5 mb-3"
        />
        {error && <p className="text-xs text-red-600 mb-3">{error}</p>}
        <button
          type="submit"
          disabled={checking}
          className="w-full bg-blue-900 text-white text-sm font-medium rounded-lg py-2.5 disabled:opacity-50"
        >
          {checking ? "Signing in..." : "Sign in"}
        </button>
      </form>
    </div>
  );
}

// Text shown when one side reacts to the other's performance — deliberately
// a small fixed set of templates (not free text) since there's no login or
// moderation on this app; "reaction" is who SENT it, the scores tell us
// whether it reads as a genuine compliment or friendly trash talk.
function challengeNoteFor(reaction, senderScore, receiverScore) {
  if (reaction === "up") {
    return receiverScore >= senderScore
      ? "You beat me fair and square — well played! 🎉"
      : "Solid effort — respect for taking on the challenge! 👏";
  }
  if (reaction === "down") {
    return receiverScore < senderScore
      ? "Better luck next time — I've got the edge this round 😏"
      : "You got me this time, but I'm coming back stronger next round! 💪";
  }
  return null;
}

// ============================================================================
// CHALLENGE COMPARISON — the full side-by-side answer sheet once both the
// creator and opponent have finished: score comparison, per-question
// answer+time for both people, and a thumbs-up/down + auto-note exchange.
// ============================================================================
function ChallengeComparisonView({ challenge, mock, questions, creatorAttempt, opponentAttempt, myRole, onReactionSent }) {
  const sections = sectionsForMock(mock);
  const myAttempt = myRole === "opponent" ? opponentAttempt : creatorAttempt;
  const theirAttempt = myRole === "opponent" ? creatorAttempt : opponentAttempt;
  const myReaction = myRole === "creator" ? challenge.creatorReaction : challenge.opponentReaction;
  const theirReaction = myRole === "creator" ? challenge.opponentReaction : challenge.creatorReaction;
  const [sending, setSending] = useState(false);

  async function react(type) {
    setSending(true);
    try {
      await setChallengeReaction(challenge.id, myRole, type);
      onReactionSent();
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col items-center py-10 px-4">
      <div className="max-w-md w-full bg-white border border-slate-200 rounded-2xl shadow-sm p-8 text-center">
        <Swords size={28} className="mx-auto mb-3 text-blue-700" />
        <h1 className="text-lg font-semibold text-slate-800 mb-1">{mock.title}</h1>
        <p className="text-xs text-slate-400 mb-5">Challenge result</p>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className={`text-3xl font-bold ${myAttempt.score >= theirAttempt.score ? "text-emerald-600" : "text-slate-500"}`}>
              {myAttempt.score}
            </div>
            <div className="text-xs text-slate-400">You</div>
          </div>
          <div>
            <div className={`text-3xl font-bold ${theirAttempt.score > myAttempt.score ? "text-emerald-600" : "text-slate-500"}`}>
              {theirAttempt.score}
            </div>
            <div className="text-xs text-slate-400">Them</div>
          </div>
        </div>
      </div>

      <div className="max-w-md w-full mt-4 bg-white border border-slate-200 rounded-2xl p-5">
        {theirReaction && (
          <div className="bg-blue-50 border border-blue-200 rounded-md px-3 py-2 text-sm text-blue-800 mb-3">
            Your friend sent you {theirReaction === "up" ? "👍" : "👎"} — "
            {challengeNoteFor(theirReaction, theirAttempt.score, myAttempt.score)}"
          </div>
        )}
        {myReaction ? (
          <p className="text-xs text-slate-400">You reacted {myReaction === "up" ? "👍" : "👎"} to their performance.</p>
        ) : (
          <div>
            <p className="text-xs text-slate-500 mb-2">React to your friend's performance:</p>
            <div className="flex gap-2">
              <button
                onClick={() => react("up")}
                disabled={sending}
                className="flex-1 flex items-center justify-center gap-1.5 text-sm border border-slate-200 rounded-lg py-2 hover:bg-emerald-50 hover:border-emerald-300 disabled:opacity-50"
              >
                <ThumbsUp size={15} /> Thumbs up
              </button>
              <button
                onClick={() => react("down")}
                disabled={sending}
                className="flex-1 flex items-center justify-center gap-1.5 text-sm border border-slate-200 rounded-lg py-2 hover:bg-red-50 hover:border-red-300 disabled:opacity-50"
              >
                <ThumbsDown size={15} /> Thumbs down
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="max-w-2xl w-full mt-6 space-y-3">
        <h3 className="text-sm font-semibold text-slate-700 px-1">Answer sheet — you vs. them</h3>
        {sections.map((s) =>
          (questions[s.key] || []).map((qq, i) => {
            const mySel = myAttempt.answers?.[qq.id];
            const theirSel = theirAttempt.answers?.[qq.id];
            const myTime = myAttempt.timeSpent?.[qq.id] || 0;
            const theirTime = theirAttempt.timeSpent?.[qq.id] || 0;
            const myCorrect = mySel === qq.answer;
            const theirCorrect = theirSel === qq.answer;
            return (
              <div key={qq.id} className="bg-white border border-slate-200 rounded-xl p-5 text-left">
                <div className="text-xs text-slate-400 mb-2">
                  {s.label} · Q{i + 1}
                </div>
                <p className="text-sm text-slate-800 mb-3">
                  <MathText text={qq.text} />
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div
                    className={`rounded-md px-3 py-2 border ${
                      mySel === undefined ? "border-slate-200 bg-slate-50" : myCorrect ? "border-emerald-300 bg-emerald-50" : "border-red-300 bg-red-50"
                    }`}
                  >
                    <div className="font-medium text-slate-600 mb-1">You</div>
                    <div className="text-slate-700">{mySel !== undefined ? `${LETTERS[mySel]}. ${qq.options[mySel]}` : "Skipped"}</div>
                    <div className="text-slate-400 mt-1">{formatTime(myTime)}</div>
                  </div>
                  <div
                    className={`rounded-md px-3 py-2 border ${
                      theirSel === undefined ? "border-slate-200 bg-slate-50" : theirCorrect ? "border-emerald-300 bg-emerald-50" : "border-red-300 bg-red-50"
                    }`}
                  >
                    <div className="font-medium text-slate-600 mb-1">Them</div>
                    <div className="text-slate-700">{theirSel !== undefined ? `${LETTERS[theirSel]}. ${qq.options[theirSel]}` : "Skipped"}</div>
                    <div className="text-slate-400 mt-1">{formatTime(theirTime)}</div>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ============================================================================
// CHALLENGE FLOW — top-level view for /challenge/:code. Works out who's
// viewing (creator, opponent, or a fresh visitor) purely by comparing this
// device's id against the two attempts' device ids, and routes to the right
// state: accept-and-take-it, waiting-on-your-friend, already-taken-by-
// someone-else, or the full comparison.
// ============================================================================
function ChallengeFlow({ code }) {
  const [state, setState] = useState("loading");
  const [challenge, setChallenge] = useState(null);
  const [mock, setMock] = useState(null);
  const [questions, setQuestions] = useState(null);
  const [creatorAttempt, setCreatorAttempt] = useState(null);
  const [opponentAttempt, setOpponentAttempt] = useState(null);
  const [myRole, setMyRole] = useState(null);

  const load = useCallback(async () => {
    setState("loading");
    const ch = await loadChallenge(code);
    if (!ch) {
      setState("not-found");
      return;
    }
    setChallenge(ch);

    const [mocksIdx, cAttempt] = await Promise.all([loadMocksIndex(), loadAttemptById(ch.creatorAttemptId)]);
    const m = mocksIdx.find((mm) => mm.id === ch.mockId);
    setMock(m || null);
    setCreatorAttempt(cAttempt);

    let oAttempt = null;
    if (ch.opponentAttemptId) {
      oAttempt = await loadAttemptById(ch.opponentAttemptId);
      setOpponentAttempt(oAttempt);
    }

    if (!m) {
      setState("not-found");
      return;
    }

    const myDevice = getDeviceId();
    let role = "stranger";
    if (cAttempt && cAttempt.deviceId === myDevice) role = "creator";
    else if (oAttempt && oAttempt.deviceId === myDevice) role = "opponent";
    setMyRole(role);

    // A third visitor who isn't either participant never sees the
    // comparison or attempt data — just a neutral "already completed"
    // message, regardless of whether the challenge is still in progress or
    // fully done. Only the creator/opponent themselves ever see results.
    if (role === "stranger") {
      setState(ch.opponentAttemptId ? "already-taken" : "landing");
    } else if (cAttempt && oAttempt) {
      const q = await loadMockQuestions(ch.mockId);
      setQuestions(q);
      setState("comparison");
    } else {
      setState("waiting");
    }
  }, [code]);

  useEffect(() => {
    load();
  }, [load]);

  async function accept() {
    const q = await loadMockQuestions(mock.id);
    setQuestions(q);
    setState("instructions");
  }

  if (state === "loading") {
    return <div className="min-h-screen flex items-center justify-center text-sm text-slate-400">Loading challenge...</div>;
  }

  if (state === "not-found") {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="text-center bg-white border border-dashed border-slate-300 rounded-xl p-10 text-sm text-slate-400 max-w-sm">
          This challenge link doesn't exist, or the mock it was for isn't available anymore.
          <div className="mt-4">
            <a href="/" className="text-sm px-4 py-2 rounded-md border border-slate-200 text-slate-600 inline-block">
              Go to SSC CGL Mock Tests
            </a>
          </div>
        </div>
      </div>
    );
  }

  if (state === "already-taken") {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="text-center bg-white border border-dashed border-slate-300 rounded-xl p-10 text-sm text-slate-400 max-w-sm">
          Someone already accepted this challenge. Ask your friend to send you a fresh one if you want to compete too.
          <div className="mt-4">
            <a href="/" className="text-sm px-4 py-2 rounded-md border border-slate-200 text-slate-600 inline-block">
              Go to SSC CGL Mock Tests
            </a>
          </div>
        </div>
      </div>
    );
  }

  if (state === "landing") {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white border border-slate-200 rounded-2xl p-8 text-center">
          <Swords size={32} className="mx-auto mb-4 text-blue-700" />
          <h1 className="text-lg font-semibold text-slate-800 mb-1">You've been challenged!</h1>
          <p className="text-sm text-slate-500 mb-6">
            A friend wants to see how you do on <span className="font-medium text-slate-700">{mock.title}</span>. Take it now
            and you'll both get a full side-by-side comparison once you're done.
          </p>
          <button onClick={accept} className="w-full bg-blue-900 text-white text-sm font-medium rounded-lg py-3">
            Accept Challenge
          </button>
        </div>
      </div>
    );
  }

  if (state === "waiting") {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white border border-slate-200 rounded-2xl p-8 text-center">
          <Swords size={32} className="mx-auto mb-4 text-slate-300" />
          <h1 className="text-lg font-semibold text-slate-800 mb-1">Waiting for your friend</h1>
          <p className="text-sm text-slate-500 mb-6">
            Check back once they've taken the test — this page will show the full comparison automatically.
          </p>
          <button onClick={load} className="text-sm px-4 py-2 rounded-md border border-slate-200 text-slate-600">
            Check again
          </button>
        </div>
      </div>
    );
  }

  if (state === "instructions") {
    const sections = sectionsForMock(mock);
    const questionCount = sections.reduce((sum, s) => sum + (questions[s.key]?.length || 0), 0);
    return (
      <div className="min-h-screen bg-slate-50 p-6">
        <StudentInstructionsView
          mock={mock}
          questionCount={questionCount}
          onStart={() => setState("run")}
          onBack={() => setState("landing")}
        />
      </div>
    );
  }

  if (state === "run") {
    return <RunMockView mock={mock} questions={questions} onExit={() => (window.location.href = "/")} challengeId={code} />;
  }

  if (state === "comparison") {
    return (
      <ChallengeComparisonView
        challenge={challenge}
        mock={mock}
        questions={questions}
        creatorAttempt={creatorAttempt}
        opponentAttempt={opponentAttempt}
        myRole={myRole}
        onReactionSent={load}
      />
    );
  }

  return null;
}

export default function App() {
  const [path, setPath] = useState(window.location.pathname);

  useEffect(() => {
    const onPopState = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const isAdmin = path.startsWith("/admin");
  const challengeMatch = path.match(/^\/challenge\/([A-Za-z0-9_-]+)/);

  if (challengeMatch) {
    return <ChallengeFlow code={challengeMatch[1]} />;
  }

  if (isAdmin) {
    return (
      <AdminGate>
        <div>
          <div className="bg-slate-900 px-4 py-1.5 flex items-center justify-between">
            <button onClick={signOut} className="flex items-center gap-1 text-[11px] text-slate-300 hover:text-white">
              <LogOut size={11} /> Sign out
            </button>
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

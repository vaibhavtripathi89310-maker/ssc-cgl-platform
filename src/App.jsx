import React, { useState, useEffect, useCallback, useRef, useContext, createContext } from "react";
import heroCharacter from "./assets/hero-character.png";
import logoImg from "./assets/logo.png";
import {
  LayoutDashboard, ListChecks, Plus, Search, Pencil, Eye, Copy, Trash2,
  CheckCircle2, XCircle, AlertCircle, ChevronUp, ChevronDown, Upload,
  ArrowLeft, ArrowRight, Save, X, Lock, Play, Clock, Flag, Download, LogOut,
  TrendingUp, Target, Youtube, Trophy, Flame, Share2, BarChart2,
  Swords, ThumbsUp, ThumbsDown, Link2, Activity,
  Landmark, GraduationCap, Award, Sparkles, FileText, Layers, BookOpen, Users,
  Zap, ShieldCheck, MousePointerClick,
} from "lucide-react";
import {
  loadMocksIndex, saveMocksIndex, loadMockQuestions, saveMockQuestions, deleteMockQuestions,
  saveAttempt, loadMockScores, loadDeviceAttempts, loadQuestionsByTopics,
  loadCutoffs, addCutoff, deleteCutoff,
  createChallenge, loadChallenge, claimOpponentSlot, setChallengeReaction, loadAttemptById,
  loadAttemptsInRange,
  loadPracticeTopicSummary, loadPracticeQuestions, loadAllPracticeQuestions,
  savePracticeQuestions, deletePracticeQuestion, deletePracticeQuestions,
  loadPracticeGroundEnabled, setPracticeGroundEnabled,
  loadDistinctMockIdsTakenByUser, loadStudentProfile, ensureStudentProfile,
  saveStudentPhoneNumber, loadAllStudentProfiles, checkIsAdmin,
} from "./lib/storage";
import { signIn, signOut, signInWithGoogle, getSession, onAuthStateChange } from "./lib/auth";
import { analyzeAttempt } from "./lib/aiAnalysis";
import { getDeviceId } from "./lib/device";
import {
  ResponsiveContainer, ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  BarChart, Bar, Cell, PieChart, Pie, Legend, LabelList,
} from "recharts";

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
  // The bare (unbracketed) side of a fraction only matches a number or a
  // single letter — e.g. 1/x, 5/9, x^2/y — never a whole word. Without this,
  // ordinary English like "is/are", "he/she", "km/hr" gets misread as a
  // fraction and stacked, which is wrong; an admin can still force a real
  // fraction with multi-letter terms by wrapping them in parentheses.
  const fracPattern =
    /(\([^)]+\)|\{[^}]+\}|\b\d+(?:\.\d+)?\b(?:\^[A-Za-z0-9(){}]+)?|\b[A-Za-z]\b(?:\^[A-Za-z0-9(){}]+)?)\/(\([^)]+\)|\{[^}]+\}|\b\d+(?:\.\d+)?\b(?:\^[A-Za-z0-9(){}]+)?|\b[A-Za-z]\b(?:\^[A-Za-z0-9(){}]+)?)/;
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
// EXAMS — the platform supports more than one exam now; everything that used
// to be a single hardcoded SECTIONS array is keyed by exam instead. Section
// keys are unique across every exam here (never reused), which is what lets
// most call sites below key a lookup purely off a section key without also
// needing to know which exam it belongs to.
const EXAMS = {
  ssc_cgl: {
    key: "ssc_cgl",
    label: "SSC CGL",
    tagline: "SSC CGL Tier-I — General Intelligence, General Awareness, Quant & English.",
    sections: [
      { key: "gi_reasoning", label: "General Intelligence & Reasoning", short: "REASONING", questionCount: 25 },
      { key: "general_awareness", label: "General Awareness", short: "GA", questionCount: 25 },
      { key: "quant_aptitude", label: "Quantitative Aptitude", short: "QUANT", questionCount: 25 },
      { key: "english_comprehension", label: "English Comprehension", short: "ENGLISH", questionCount: 25 },
    ],
    hasNegativeMarking: true,
    defaultNegativeMarking: 0.5,
    fullDuration: 60,
    fullTotalMarks: 200,
    // Locked, one-way section timer: a fixed slice of the total time per
    // section, "Next Section" is a one-way door — matches the real exam.
    timerMode: "sectional",
  },
  gmat: {
    key: "gmat",
    label: "GMAT",
    tagline: "GMAT Focus Edition — Quantitative Reasoning, Verbal Reasoning & Data Insights.",
    sections: [
      { key: "quant", label: "Quantitative Reasoning", short: "QUANT", questionCount: 21 },
      { key: "verbal", label: "Verbal Reasoning", short: "VERBAL", questionCount: 23 },
      { key: "data_insights", label: "Data Insights", short: "DI", questionCount: 20 },
    ],
    hasNegativeMarking: false,
    defaultNegativeMarking: 0,
    fullDuration: 135,
    fullTotalMarks: 64,
    timerMode: "sectional",
  },
  snap: {
    key: "snap",
    label: "SNAP",
    tagline: "SNAP — General English, Analytical & Logical Reasoning, Quant/DI/DS & Ethics, Morality & Values.",
    sections: [
      { key: "general_english", label: "General English", short: "GE", questionCount: 10 },
      { key: "analytical_logical_reasoning", label: "Analytical & Logical Reasoning", short: "A-LR", questionCount: 20 },
      { key: "quant_di_ds", label: "Quantitative, DI & DS", short: "QA-DI-DS", questionCount: 20 },
      { key: "ethics_morality_values", label: "Ethics, Morality & Values", short: "EMV", questionCount: 10 },
    ],
    hasNegativeMarking: true,
    defaultNegativeMarking: 0.25,
    fullDuration: 60,
    fullTotalMarks: 60,
    // SNAP's real format has no sectional time limit at all — one composite
    // 60-minute timer for the whole test, and students can jump freely
    // between any section's questions the entire time. This is a
    // fundamentally different navigation model from SSC CGL/GMAT's locked
    // per-section timer, not just different content — see RunMockView's
    // `isComposite` branches.
    timerMode: "composite",
  },
};
const EXAM_LIST = Object.values(EXAMS);
const DEFAULT_EXAM = "ssc_cgl";
// Presentation only (icon/color per exam on the student home screen) — kept
// separate from EXAMS itself, which stays pure exam-format data. Tailwind
// needs literal class strings (not computed ones) to keep them in the
// production build, hence the full class names spelled out per exam here.
const EXAM_THEME = {
  ssc_cgl: {
    icon: Landmark,
    gradient: "from-blue-600 to-blue-800",
    ring: "hover:border-blue-300",
    badgeBg: "bg-blue-50 text-blue-700",
    iconBg: "bg-blue-100 text-blue-700",
  },
  gmat: {
    icon: GraduationCap,
    gradient: "from-violet-600 to-purple-800",
    ring: "hover:border-violet-300",
    badgeBg: "bg-violet-50 text-violet-700",
    iconBg: "bg-violet-100 text-violet-700",
  },
  snap: {
    icon: Award,
    gradient: "from-emerald-600 to-teal-700",
    ring: "hover:border-emerald-300",
    badgeBg: "bg-emerald-50 text-emerald-700",
    iconBg: "bg-emerald-100 text-emerald-700",
  },
};
// Flat list of every section across every exam — safe to use wherever a
// lookup only needs a section's key/label and doesn't care which exam it's
// from (e.g. resolving a badge, or sweeping for orphaned questions left
// behind after an admin switches a mock's exam).
const ALL_SECTIONS = EXAM_LIST.flatMap((e) => e.sections);

// Backward compatibility: any mock created before multi-exam support (or any
// mock object that's momentarily undefined during a render) has no `exam`
// field at all — treat that as SSC CGL, the exam this platform launched with.
function getExamKey(mock) {
  return mock && EXAMS[mock.exam] ? mock.exam : DEFAULT_EXAM;
}
function getExam(mock) {
  return EXAMS[getExamKey(mock)];
}

const MOCK_TYPES = { FULL: "full", SECTIONAL: "sectional" };
// Backward compatibility: any mock created before this feature existed (or
// any mock object that's momentarily undefined during a render) has no
// mockType field at all. Treat that — and any value that isn't literally
// "sectional" — as a Full Mock. This is the single source of truth for
// "what type is this mock" so nothing downstream re-implements the check.
function getMockType(mock) {
  return mock && mock.mockType === MOCK_TYPES.SECTIONAL ? MOCK_TYPES.SECTIONAL : MOCK_TYPES.FULL;
}
// Sections a given mock actually uses — Full Mock uses every section of its
// exam (unchanged behavior, including for any old mock with no mockType);
// Sectional Mock uses exactly the one section it was created for.
function sectionsForMock(mock) {
  const exam = getExam(mock);
  if (getMockType(mock) === MOCK_TYPES.SECTIONAL) {
    const found = exam.sections.filter((s) => s.key === mock.sectionalKey);
    // If sectionalKey is somehow missing/invalid, fall back to all of this
    // exam's sections rather than returning an empty list that would render
    // a blank app.
    return found.length ? found : exam.sections;
  }
  return exam.sections;
}
// How many questions a given section must have in THIS mock — the section's
// standard count for every section of a Full Mock (unchanged), or the
// admin-configured count for the one section of a Sectional Mock.
function requiredCountFor(mock, sectionKey) {
  const section = getExam(mock).sections.find((s) => s.key === sectionKey);
  const standardCount = section?.questionCount || 25;
  if (getMockType(mock) === MOCK_TYPES.SECTIONAL) {
    return mock.sectionalKey === sectionKey ? mock.sectionalQuestionCount || standardCount : 0;
  }
  return standardCount;
}
function mockTypeBadgeLabel(mock) {
  if (getMockType(mock) === MOCK_TYPES.SECTIONAL) {
    const section = getExam(mock).sections.find((s) => s.key === mock.sectionalKey);
    return `SECTIONAL — ${section?.short || "?"}`;
  }
  return "FULL MOCK";
}
const DIFFICULTIES = ["Easy", "Moderate", "Hard", "Very Hard", "Extremely Hard", "Crazy Hard"];
// Practice Ground uses its own simple 3-level scale — deliberately separate
// from DIFFICULTIES above (which is just informational metadata on a mock
// question). Here difficulty is the primary way a student picks what to
// practice, so it's kept to exactly three deliberate levels.
const PRACTICE_DIFFICULTIES = ["Easy", "Medium", "Hard"];
const PRACTICE_DIFFICULTY_COLORS = {
  Easy: "bg-emerald-100 text-emerald-700 border-emerald-200",
  Medium: "bg-amber-100 text-amber-700 border-amber-200",
  Hard: "bg-red-100 text-red-700 border-red-200",
};
// Curated topic lists for Practice Ground, keyed by exam then section key
// (same section keys EXAMS already uses) — picked from a fixed list instead
// of free-typed, so a topic name can never accidentally drift/mismatch
// across separate uploads (and later, so an AI-analysis "practice this
// topic" link has something reliable to match against). All four SSC CGL
// sections are filled in (per real syllabus research, see project memory).
// GMAT/SNAP have no curated lists yet and fall back to free-text entry in
// the UI until their own get built.
const CURATED_PRACTICE_TOPICS = {
  ssc_cgl: {
    quant_aptitude: [
      "Number System", "HCF and LCM", "Simplification and Approximation", "Percentage",
      "Ratio and Proportion", "Average", "Profit, Loss and Discount", "Simple and Compound Interest",
      "Time and Work", "Time, Speed and Distance", "Mixture and Alligation", "Partnership",
      "Algebra", "Geometry", "Coordinate Geometry", "Mensuration", "Trigonometry",
      "Height and Distance", "Data Interpretation", "Statistics",
    ],
    general_awareness: [
      "Ancient Indian History", "Medieval Indian History", "Modern Indian History and Freedom Struggle",
      "Indian Polity and Constitution", "Indian Geography", "World Geography", "Indian Economy",
      "Physics", "Chemistry", "Biology", "Static GK (Books, Authors, Awards)", "Art and Culture",
      "Sports", "Important Days and Events", "International Organizations", "Government Schemes",
      "Current Affairs",
    ],
    gi_reasoning: [
      "Analogy", "Classification", "Series (Number, Alphabet and Alphanumeric)", "Coding-Decoding",
      "Blood Relations", "Direction Sense", "Ranking and Order", "Seating Arrangement", "Puzzle",
      "Syllogism", "Venn Diagram", "Statement and Conclusion", "Statement and Assumption",
      "Mathematical Operations", "Word Formation", "Missing Number and Matrix",
      "Mirror and Water Images", "Paper Folding and Cutting", "Embedded Figures and Figure Counting",
      "Dice and Cubes",
    ],
    english_comprehension: [
      "Reading Comprehension", "Cloze Test", "Para Jumbles", "Error Spotting", "Sentence Improvement",
      "Synonyms", "Antonyms", "One Word Substitution", "Idioms and Phrases", "Spelling Correction",
      "Active and Passive Voice", "Direct and Indirect Speech", "Fill in the Blanks",
      "Homonyms and Homophones", "Confusable Words",
    ],
  },
};
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

// A short, quiet synthesized "tick" for deliberate clicks on interactive
// results-screen elements (tab switches, etc.) — generated in-browser via
// the Web Audio API rather than an embedded/hosted audio file, so there's
// no asset to load and nothing to fail if a browser blocks it. One shared
// AudioContext is reused across calls rather than creating a new one per
// click (browsers cap how many can exist at once).
let sharedAudioCtx = null;
function playClickSound() {
  try {
    if (!sharedAudioCtx) sharedAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const ctx = sharedAudioCtx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.08);
    gain.gain.setValueAtTime(0.07, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
    osc.start();
    osc.stop(ctx.currentTime + 0.12);
  } catch {
    // Web Audio unsupported or blocked (e.g. autoplay policy) — sound is a
    // nice-to-have, never worth breaking the click itself over.
  }
}
const nextMockNumber = (list) => (list.length ? Math.max(...list.map((m) => m.mockNumber || 0)) + 1 : 1);
const sectionLabel = (key) => ALL_SECTIONS.find((s) => s.key === key)?.label || key;
const emptySectionMap = () => Object.fromEntries(ALL_SECTIONS.map((s) => [s.key, []]));

// `candidateSections` scopes the match to one exam's sections (e.g. the mock
// being imported into) — this matters because a couple of section names
// overlap in spirit across exams ("Quant" means something in both SSC CGL
// and GMAT), so matching against every exam at once could resolve to the
// wrong exam's section key.
function normalizeSectionLabel(input, candidateSections = ALL_SECTIONS) {
  if (!input || typeof input !== "string") return null;
  const s = input.trim().toLowerCase();
  const found = candidateSections.find((sec) => {
    if (sec.label.toLowerCase() === s || sec.key === s) return true;
    if (sec.key === "gi_reasoning" && s.includes("reasoning")) return true;
    if (sec.key === "general_awareness" && (s.includes("awareness") || s === "ga")) return true;
    if (sec.key === "quant_aptitude" && (s.includes("quant") || s.includes("maths") || s.includes("math"))) return true;
    if (sec.key === "english_comprehension" && s.includes("english")) return true;
    if (sec.key === "quant" && (s.includes("quant") || s.includes("math"))) return true;
    if (sec.key === "verbal" && (s.includes("verbal") || s.includes("reading") || s.includes("critical"))) return true;
    if (sec.key === "data_insights" && (s.includes("data") || s.includes("insight"))) return true;
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
function validateImportJSON(rawText, sectionKey, idsInThisSection, idsInOtherSections, currentCount, maxAllowed, examSections = ALL_SECTIONS) {
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
      const normalized = normalizeSectionLabel(q.section, examSections);
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

// Practice Ground questions have no fixed container to bound them (unlike a
// mock section, there's no "required count") and every id is a plain
// upsert — a matching id updates that question in place, a new id adds one.
// The only strict requirements are the two fields mock questions don't need:
// topic (it's the primary way students browse) and a valid difficulty.
// `topic` is chosen once via the dropdown/input above the textarea and
// applied to every question in the batch — not repeated per question in the
// JSON anymore, since a whole paste is always "N questions for this one
// topic I just picked." Any stray "topic" field inside an individual
// question object is simply ignored in favor of the selected one.
function validatePracticeImportJSON(rawText, topic) {
  if (!topic || !topic.trim()) {
    return { ok: false, errors: [{ index: null, message: "Pick a topic above first — every question in this batch will be tagged with it." }], questions: [] };
  }
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

  const errors = [];
  const seenInBatch = new Set();
  const cleaned = [];

  parsed.forEach((q, i) => {
    const n = i + 1;
    const fail = (msg) => errors.push({ index: n, message: msg });

    if (!q || typeof q !== "object") return fail("Not a valid question object.");
    if (!q.id || typeof q.id !== "string") return fail("Missing or invalid 'id'.");
    if (seenInBatch.has(q.id)) return fail(`Duplicate id "${q.id}" within this upload.`);
    if (!PRACTICE_DIFFICULTIES.includes(q.difficulty)) return fail(`Invalid 'difficulty' "${q.difficulty}" — must be one of ${PRACTICE_DIFFICULTIES.join(", ")}.`);
    if (!q.text || typeof q.text !== "string" || !q.text.trim()) return fail("Missing question text.");
    if (!Array.isArray(q.options) || q.options.length !== 4)
      return fail(`Expected exactly 4 options, got ${Array.isArray(q.options) ? q.options.length : "none"}.`);
    if (q.options.some((o) => typeof o !== "string" || !o.trim())) return fail("One or more options are empty.");
    if (![0, 1, 2, 3].includes(q.answer)) return fail(`Invalid answer index "${q.answer}" — must be 0, 1, 2, or 3.`);
    if (!q.explanation || typeof q.explanation !== "string" || !q.explanation.trim()) return fail("Missing explanation.");

    seenInBatch.add(q.id);
    cleaned.push({
      id: q.id,
      topic: topic.trim(),
      difficulty: q.difficulty,
      text: q.text.trim(),
      options: q.options.map((o) => o.trim()),
      answer: q.answer,
      explanation: q.explanation.trim(),
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
  const [examFilter, setExamFilter] = useState("all"); // 'all' | 'ssc_cgl' | 'gmat'
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [questionStats, setQuestionStats] = useState({});
  const mockExamById = Object.fromEntries(mocksIndex.map((m) => [m.id, getExamKey(m)]));
  // Once an exam other than SSC CGL exists, mixing both exams' numbers into
  // one set of stats is actively misleading (different scoring, different
  // audience) — this scopes every metric below to the chosen exam, without
  // re-fetching (the date-range fetch stays exam-agnostic).
  const scopedRows = examFilter === "all" ? rows : rows.filter((r) => (mockExamById[r.mockId] || "ssc_cgl") === examFilter);

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
  const uniqueDevices = new Set(scopedRows.map((r) => r.deviceId)).size;
  const attemptsPerDevice = {};
  scopedRows.forEach((r) => {
    attemptsPerDevice[r.deviceId] = (attemptsPerDevice[r.deviceId] || 0) + 1;
  });
  const returningDevices = Object.values(attemptsPerDevice).filter((n) => n >= 2).length;
  const oneTimeDevices = uniqueDevices - returningDevices;
  const avgAccuracy = scopedRows.length
    ? Math.round(
        (scopedRows.reduce((sum, r) => {
          // Accuracy is correct ÷ attempted — skipped questions were never
          // attempted, so they don't dilute this.
          const attempted = r.correct + r.incorrect;
          return sum + (attempted ? r.correct / attempted : 0);
        }, 0) /
          scopedRows.length) *
          100
      )
    : null;

  // --- Daily trend ---
  const byDay = {};
  scopedRows.forEach((r) => {
    const day = r.createdAt.slice(0, 10);
    if (!byDay[day]) byDay[day] = { attempts: 0, devices: new Set() };
    byDay[day].attempts += 1;
    byDay[day].devices.add(r.deviceId);
  });
  const days = Object.keys(byDay).sort();
  const maxDayDevices = Math.max(1, ...days.map((d) => byDay[d].devices.size));

  // --- Audience-wide weak topics ---
  const topicAgg = {};
  scopedRows.forEach((r) => {
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
    .filter((q) => q.attempted >= 3 && (examFilter === "all" || (mockExamById[q.mockId] || "ssc_cgl") === examFilter))
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
        <select
          value={examFilter}
          onChange={(e) => setExamFilter(e.target.value)}
          className="text-sm border border-slate-200 rounded-md px-3 py-2"
        >
          <option value="all">All exams</option>
          {EXAM_LIST.map((exam) => (
            <option key={exam.key} value={exam.key}>{exam.label}</option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="text-sm text-slate-400">Loading...</div>
      ) : scopedRows.length === 0 ? (
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
              <div className="text-2xl font-semibold text-slate-800">{scopedRows.length}</div>
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
            <h2 className="text-sm font-semibold text-slate-700 mb-3">Daily unique visitors</h2>
            <div className="flex items-end gap-1.5 overflow-x-auto pb-1" style={{ minHeight: 130 }}>
              {days.map((day) => {
                const v = byDay[day];
                const uniqueCount = v.devices.size;
                const height = Math.max(4, Math.round((uniqueCount / maxDayDevices) * 100));
                return (
                  <div key={day} className="flex flex-col items-center shrink-0" style={{ width: 30 }} title={`${uniqueCount} unique visitors, ${v.attempts} attempts`}>
                    <div className="text-[9px] text-slate-400 mb-1">{uniqueCount}</div>
                    <div className="w-4 bg-blue-600 rounded-t" style={{ height: `${height}px` }} />
                    <div className="text-[8px] text-slate-400 mt-1">{day.slice(5)}</div>
                  </div>
                );
              })}
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
  const [examFilter, setExamFilter] = useState("all"); // 'all' | 'ssc_cgl' | 'gmat'

  const filtered = mocksIndex.filter((m) => {
    const matchesQuery =
      !query ||
      m.title.toLowerCase().includes(query.toLowerCase()) ||
      String(m.mockNumber).includes(query);
    const matchesStatus = statusFilter === "all" || m.status === statusFilter;
    const matchesType = typeFilter === "all" || getMockType(m) === typeFilter;
    const matchesExam = examFilter === "all" || getExamKey(m) === examFilter;
    return matchesQuery && matchesStatus && matchesType && matchesExam;
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
        <select
          value={examFilter}
          onChange={(e) => setExamFilter(e.target.value)}
          className="text-sm border border-slate-200 rounded-md px-3 py-2"
        >
          <option value="all">All exams</option>
          {EXAM_LIST.map((exam) => (
            <option key={exam.key} value={exam.key}>{exam.label}</option>
          ))}
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
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-600">
                          {getExam(m).label}
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

  // Switching exam changes what sections even exist, so the previously
  // selected section almost never applies to the new exam — reset it rather
  // than leaving a stale, invalid sectionalKey around. Also snaps negative
  // marking to the new exam's default (0 for exams that don't use it, like
  // GMAT) since that's not something an admin should have to remember to
  // change by hand every time.
  function updateExam(examKey) {
    const exam = EXAMS[examKey];
    setForm((f) => ({
      ...f,
      exam: examKey,
      sectionalKey: null,
      negativeMarking: exam.hasNegativeMarking ? exam.defaultNegativeMarking : 0,
    }));
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
  const formExamKey = getExamKey(form);
  const examConfig = EXAMS[formExamKey];
  const sectionMaxCount = examConfig.sections.find((s) => s.key === form.sectionalKey)?.questionCount || examConfig.sections[0]?.questionCount || 25;
  const applicableSections = sectionsForMock(form);
  const totalQs = applicableSections.reduce((sum, s) => sum + (questions[s.key]?.length || 0), 0);
  const totalRequired = applicableSections.reduce((sum, s) => sum + requiredCountFor(form, s.key), 0);

  // Existing questions living in sections the current form selection would
  // no longer use — surfaced as a warning, never auto-deleted. The admin
  // must explicitly manage/clear those in Section Manager themselves.
  const orphanedCounts = ALL_SECTIONS.filter((s) => !applicableSections.some((a) => a.key === s.key))
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
            <label className="block text-xs font-medium text-slate-500 mb-1">Exam</label>
            <div className="flex gap-1.5">
              {EXAM_LIST.map((exam) => (
                <button
                  key={exam.key}
                  type="button"
                  onClick={() => updateExam(exam.key)}
                  className={`text-xs px-3 py-1.5 rounded-md border ${formExamKey === exam.key ? "bg-blue-900 text-white border-blue-900" : "bg-white text-slate-500 border-slate-200"}`}
                >
                  {exam.label}
                </button>
              ))}
            </div>
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
                  {examConfig.sections.map((s) => (
                    <option key={s.key} value={s.key}>{s.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Question count (max {sectionMaxCount})</label>
                <input
                  type="number"
                  min={1}
                  max={sectionMaxCount}
                  value={form.sectionalQuestionCount || sectionMaxCount}
                  onChange={(e) => update("sectionalQuestionCount", Math.max(1, Math.min(sectionMaxCount, Number(e.target.value) || 1)))}
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
            {examConfig.hasNegativeMarking ? (
              <input type="number" step="0.25" value={form.negativeMarking} onChange={(e) => update("negativeMarking", Number(e.target.value))} className="w-full text-sm border border-slate-200 rounded-md px-3 py-2" />
            ) : (
              <div className="w-full text-sm border border-slate-100 bg-slate-50 text-slate-400 rounded-md px-3 py-2">
                None — {examConfig.label} doesn't use negative marking
              </div>
            )}
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
    return new Set(ALL_SECTIONS.filter((s) => s.key !== sectionKey).flatMap((s) => (questions[s.key] || []).map((q) => q.id)));
  }

  function handleValidate() {
    const baseCount = importMode === "replace" ? 0 : list.length;
    // In "replace" mode the section is being cleared, so nothing in it counts
    // as "already here" — every uploaded id is new to this (now-empty)
    // section. In "add" mode, an id matching one already in this section is
    // an update-in-place, not a duplicate — see validateImportJSON.
    const idsInThisSection = importMode === "replace" ? new Set() : new Set(list.map((q) => q.id));
    return validateImportJSON(
      jsonText, sectionKey, idsInThisSection, existingIdsExcludingThisSection(), baseCount, requiredCount, getExam(mock).sections
    );
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
function ShareResultCard({ mock, score, totalMarks, examLabel }) {
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
    wrapCanvasText(ctx, `IN THE ${examLabel.toUpperCase()} MOCK TEST BY THE 100 PERCENTILER`, W / 2, H * 0.57, W * 0.82, 56);

    ctx.font = "600 34px system-ui, sans-serif";
    ctx.fillStyle = "#bfdbfe";
    ctx.fillText("TRY IT YOURSELF →", W / 2, H * 0.7);

    ctx.font = "400 26px system-ui, sans-serif";
    ctx.fillStyle = "#93c5fd";
    wrapCanvasText(ctx, mock.title || `${examLabel} Mock Test`, W / 2, H * 0.88, W * 0.82, 34);
    ctx.fillText("@the100percentiler", W / 2, H * 0.95);
  }, [score, totalMarks, mock.title, examLabel]);

  function shareOrDownload() {
    const canvas = canvasRef.current;
    canvas.toBlob(async (blob) => {
      if (!blob) return;
      const file = new File([blob], "my-mock-score.png", { type: "image/png" });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: `${examLabel} Mock Test` });
          return;
        } catch {
          // user cancelled the share sheet — fall through to download
        }
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "my-mock-score.png";
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
function RunMockView({ mock, questions, onExit, challengeId, adminMode = false }) {
  // null in every context this doesn't apply to (admin's own "Run" preview,
  // or the un-gated ChallengeFlow) — attempts from those just save without
  // a user_id, same as before student accounts existed.
  const studentSession = useStudentSession();
  const [sectionIdx, setSectionIdx] = useState(0);
  const [qIdx, setQIdx] = useState(0);
  const [answers, setAnswers] = useState({}); // questionId -> optionIndex
  const sections = sectionsForMock(mock);
  // SNAP's real format has no per-section lock: one composite timer for the
  // whole test, free navigation between any section's questions the entire
  // time. SSC CGL/GMAT lock one section at a time with its own timer slice.
  // This is the single flag everything below branches on.
  const isComposite = getExam(mock).timerMode === "composite";
  const [saved, setSaved] = useState({}); // questionId -> true (has been Saved & Next'd at least once)
  const [visited, setVisited] = useState({}); // questionId -> true
  const [marked, setMarked] = useState({}); // questionId -> true
  const [timeLeft, setTimeLeft] = useState(
    isComposite ? Math.round(mock.duration * 60) : Math.round((mock.duration / sections.length) * 60)
  );
  const [timerHidden, setTimerHidden] = useState(false);
  const [finished, setFinished] = useState(false);
  const [toast, setToast] = useState("");
  const [confirmAction, setConfirmAction] = useState(null); // 'next-section' | 'finish' | null
  const [timeSpent, setTimeSpent] = useState({}); // questionId -> seconds spent on it
  const [reviewFilter, setReviewFilter] = useState("all"); // 'all' | 'correct' | 'incorrect' | 'skipped'
  const [reviewSectionKey, setReviewSectionKey] = useState(null); // null = every section, or one section's key
  const reviewSectionRef = useRef(null);
  function jumpToReview(filter, sectionKey = null) {
    setReviewFilter(filter);
    setReviewSectionKey(sectionKey);
    reviewSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // PDF export (admin only) — just the browser's own print-to-PDF, no new
  // dependency. Forces every collapsed review/AI card open and clears any
  // review filter first, so the printed page has the complete answer sheet
  // rather than whatever happened to be collapsed/filtered on screen.
  const [isPrinting, setIsPrinting] = useState(false);
  useEffect(() => {
    function resetAfterPrint() {
      setIsPrinting(false);
    }
    window.addEventListener("afterprint", resetAfterPrint);
    return () => window.removeEventListener("afterprint", resetAfterPrint);
  }, []);
  function handleDownloadPdf() {
    setReviewFilter("all");
    setReviewSectionKey(null);
    setIsPrinting(true);
    requestAnimationFrame(() => requestAnimationFrame(() => window.print()));
  }

  // In composite mode `list` is every question from every section, flattened
  // into one navigable sequence (tagged with which section each came from,
  // purely for display/grouping) — `qIdx` walks this directly, with no
  // per-section slicing or locking. In sectional-lock mode `list` stays
  // scoped to just the current (unlocked) section, same as before.
  const flatList = sections.flatMap((s) => (questions[s.key] || []).map((qq) => ({ ...qq, _sectionKey: s.key, _sectionLabel: s.label })));
  const sectionOffsets = {};
  {
    let offset = 0;
    sections.forEach((s) => {
      sectionOffsets[s.key] = offset;
      offset += (questions[s.key] || []).length;
    });
  }

  const section = sections[sectionIdx];
  const list = isComposite ? flatList : section ? questions[section.key] || [] : [];
  const q = list[qIdx];
  const currentSectionLabel = isComposite ? q?._sectionLabel || sections[0]?.label : section?.label;
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
      // Composite mode has no "next section" to advance to — running out of
      // time ends the whole test, exactly like a manual Finish Test.
      if (isComposite) {
        flushTime();
        setFinished(true);
        return;
      }
      advanceSection();
      return;
    }
    const id = setTimeout(() => setTimeLeft((t) => t - 1), 1000);
    return () => clearTimeout(id);
  }, [timeLeft, finished, advanceSection, isComposite]);

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
    // Marks per correct answer isn't hardcoded to SSC CGL's "+2" scheme — it's
    // derived from this mock's own total marks spread across its questions,
    // so it works whether an exam awards 2 marks per question (SSC CGL) or 1
    // (GMAT, which has no negative marking either).
    const totalQuestionCount = sections.reduce((sum, s) => sum + (questions[s.key]?.length || 0), 0);
    const marksPerCorrect = totalQuestionCount > 0 ? mock.totalMarks / totalQuestionCount : 1;
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
      return { label: s.label, correct: sCorrect, incorrect: sIncorrect, skipped: sSkipped, score: sCorrect * marksPerCorrect - sIncorrect * mock.negativeMarking };
    });
    const score = correct * marksPerCorrect - incorrect * mock.negativeMarking;

    // Topic-wise performance — groups by each question's tagged topic, or
    // falls back to its section label when no topic was set on it (so this
    // is always useful even for mocks made before topics existed). Accuracy
    // is correct ÷ attempted: a skipped question was never attempted, so it
    // doesn't count toward a topic's total at all (not as wrong, and not
    // diluting the denominator) — a topic with nothing attempted just never
    // gets an entry here, rather than showing a misleading 0%.
    const topicStats = {};
    sections.forEach((s) => {
      (questions[s.key] || []).forEach((qq) => {
        const sel = answers[qq.id];
        if (sel === undefined) return;
        const key = qq.topic || s.label;
        if (!topicStats[key]) topicStats[key] = { correct: 0, total: 0 };
        topicStats[key].total += 1;
        if (sel === qq.answer) topicStats[key].correct += 1;
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
          userId: studentSession?.userId,
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
        studentSession?.refreshAttemptedMockIds?.();
        if (challengeId) {
          const claimed = await claimOpponentSlot(challengeId, attemptId);
          setChallengeClaim(claimed ? "claimed" : "taken");
        }
      } catch {
        // Non-critical — the results screen works fine without this.
      }
    })();
    // Cutoff comparison only makes sense on the same 200-mark scale as the
    // real SSC CGL exam, so only SSC CGL Full Mocks show it — and only once
    // you've entered at least one year in admin. GMAT doesn't have an
    // equivalent published "cutoff" concept, so it never shows this card.
    if (getMockType(mock) === MOCK_TYPES.FULL && getExamKey(mock) === "ssc_cgl") {
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

    // Time analysis — colors each question relative to a "fair" pace (the
    // section's time budget split evenly across its questions), not a fixed
    // number of seconds, so it stays meaningful across mocks of any length.
    function parTimeFor(sectionKey) {
      // Composite mode has no enforced per-section time slice, so "fair
      // pace" is the whole test's time spread evenly across every question
      // in it, not this section's share of a divided-up clock.
      if (isComposite) {
        const totalQ = sections.reduce((sum, s) => sum + (questions[s.key]?.length || 0), 0);
        return totalQ > 0 ? (mock.duration * 60) / totalQ : 60;
      }
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
    // Same pace judgment as timeBadge, but as a {cls, label} pair for
    // AnswerReviewCard, which shows the time verdict inline with the
    // question instead of in a separate section.
    function timeInfoFor(qq, sectionKey) {
      const t = timeSpent[qq.id] || 0;
      const par = parTimeFor(sectionKey);
      const cls = timeBadge(qq, sectionKey);
      if (t === 0) return { cls, label: "Not visited" };
      if (t <= par * 0.5) return { cls, label: `${formatTime(t)} · Quick` };
      if (t <= par * 1.5) return { cls, label: `${formatTime(t)} · Normal` };
      return { cls, label: `${formatTime(t)} · Slow` };
    }

    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-100 via-slate-50 to-blue-50 py-8 px-4 sm:px-8">
        <div className="max-w-6xl mx-auto space-y-6">
          {adminMode && (
            <div className="print:hidden flex justify-end">
              <button
                onClick={handleDownloadPdf}
                className="inline-flex items-center gap-2 bg-white border border-slate-200 text-slate-700 text-sm font-medium px-4 py-2 rounded-lg hover:bg-slate-50 transition-colors"
              >
                <Download size={14} /> Download PDF (answer sheet + AI analysis)
              </button>
            </div>
          )}

          {/* HERO — score, live stats, and per-section drill-down all in
              one interactive card (overall vs. section is a tab switch, not
              two separate sections repeating the same list). */}
          <ResultsHero
            mock={mock}
            score={score}
            correct={correct}
            incorrect={incorrect}
            skipped={skipped}
            percentile={percentile}
            sectionBreakdown={sectionBreakdown}
            sections={sections}
            onExit={onExit}
            onJumpReview={jumpToReview}
          />

          {/* AI PERFORMANCE ANALYSIS — admin-only, never shown to students.
              Only rendered when RunMockView is reached via the admin panel's
              own "Run" flow (adminMode=true), never from StudentApp. */}
          {adminMode && (
            <AIAnalysisPanel
              mock={mock}
              sections={sections}
              questions={questions}
              answers={answers}
              timeSpent={timeSpent}
              topicRows={topicRows}
              weakTopics={weakTopics}
              strongTopics={strongTopics}
              sectionBreakdown={sectionBreakdown}
              score={score}
              correct={correct}
              incorrect={incorrect}
              skipped={skipped}
              parTimeFor={parTimeFor}
              isPrinting={isPrinting}
            />
          )}

          {/* QUESTION ANALYSIS — one unified, interactive card. Subject
              accuracy, pace, and the full per-question review used to be
              three disconnected sections (with "time analysis" oddly
              standalone from the questions it was timing); now it's one
              scannable flow, with time folded directly into each review row
              instead of living apart from the question it describes. */}
          <div className="bg-white border border-slate-200 rounded-3xl shadow-sm overflow-hidden">
            <div className="p-6 sm:p-8">
              <h2 className="text-lg font-bold text-slate-800 mb-1">Question Analysis</h2>
              <p className="text-sm text-slate-500 mb-5">Where you're strong, where to focus, and how you paced yourself — this mock only.</p>

              {weakTopics.length > 0 && (
                <div className="bg-red-50 border border-red-200 rounded-md px-3 py-2 text-xs text-red-700 mb-2">
                  📌 Focus your revision on: <span className="font-medium">{weakTopics.join(", ")}</span>
                </div>
              )}
              {strongTopics.length > 0 && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-md px-3 py-2 text-xs text-emerald-700 mb-5">
                  ✅ You're doing well in: <span className="font-medium">{strongTopics.join(", ")}</span>
                </div>
              )}

              <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 mb-6">
                <div className="lg:col-span-3">
                  <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Subject-wise accuracy</h3>
                  <SubjectAccuracyChart
                    sectionAccuracy={topicRows.map((t) => ({ label: t.topic, correct: t.correct, total: t.total, accuracy: t.accuracy }))}
                  />
                </div>
                <div className="lg:col-span-2">
                  <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Correct / Incorrect / Skipped</h3>
                  <AnswerBreakdownDonut attempts={[{ correct, incorrect, skipped }]} caption="questions in this mock" />
                </div>
              </div>

              <div className="border-t border-slate-100 pt-5">
                <div ref={reviewSectionRef} className="flex items-center justify-between mb-3">
                  <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                    Answer review
                    {reviewFilter !== "all" ? ` — ${reviewFilter} only` : ""}
                    {reviewSectionKey ? ` in ${sections.find((s) => s.key === reviewSectionKey)?.label}` : ""}
                  </h3>
                  {(reviewFilter !== "all" || reviewSectionKey) && (
                    <button
                      onClick={() => {
                        setReviewFilter("all");
                        setReviewSectionKey(null);
                      }}
                      className="print:hidden text-xs text-blue-700 font-medium"
                    >
                      Show all →
                    </button>
                  )}
                </div>
                <div className="space-y-2">
                  {sections
                    .flatMap((s) => (questions[s.key] || []).map((qq, i) => ({ s, qq, i })))
                    .filter(({ s, qq }) => {
                      if (reviewSectionKey && s.key !== reviewSectionKey) return false;
                      const sel = answers[qq.id];
                      if (reviewFilter === "all") return true;
                      if (reviewFilter === "skipped") return sel === undefined;
                      if (reviewFilter === "correct") return sel === qq.answer;
                      return sel !== undefined && sel !== qq.answer; // 'incorrect'
                    })
                    .map(({ s, qq, i }) => (
                      <AnswerReviewCard
                        key={qq.id}
                        qq={qq}
                        sectionLabel={s.label}
                        qNumber={i + 1}
                        sel={answers[qq.id]}
                        timeInfo={timeInfoFor(qq, s.key)}
                        forceExpanded={isPrinting}
                      />
                    ))}
                </div>
              </div>
            </div>
          </div>

          {/* SHARE & COMPETE — secondary to the analysis above (that's the
              point of the page), and laid out so it never leaves empty grid
              cells regardless of how many of these cards exist. Not part of
              the answer sheet / AI analysis PDF export, so hidden on print. */}
          <div className="print:hidden grid grid-cols-1 lg:grid-cols-5 gap-6 items-start">
            <div className="lg:col-span-3">
              <ShareResultCard mock={mock} score={score} totalMarks={mock.totalMarks} examLabel={getExam(mock).label} />
            </div>
            <div className="lg:col-span-2 space-y-4">
              {challengeId ? (
                <div className="bg-white border border-slate-200 rounded-2xl p-5 text-center">
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
                <div className="bg-white border border-slate-200 rounded-2xl p-5">
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
                <div className="bg-white border border-slate-200 rounded-2xl p-5 text-left">
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
                <div className="bg-white border border-slate-200 rounded-2xl p-5 text-left">
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
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
              className={`block bg-gradient-to-r from-red-600 to-red-500 text-white rounded-2xl p-6 text-center hover:opacity-95 transition-opacity ${
                mock.videoUrl ? "" : "md:col-span-2"
              }`}
            >
              <div className="text-sm font-semibold mb-1">Want to seriously prepare for {getExam(mock).label}?</div>
              <div className="text-xs text-red-50 mb-3">
                Get free strategy sessions, topic breakdowns, and more mocks on our YouTube channel.
              </div>
              <span className="inline-block bg-white text-red-600 text-sm font-medium px-4 py-2 rounded-lg">
                Visit The 100 Percentiler →
              </span>
            </a>
          </div>
        </div>
      </div>
    );
  }

  if (!q) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-center bg-white border border-dashed border-slate-300 rounded-xl p-10 text-sm text-slate-400">
          {isComposite ? "This mock" : section?.label} has no questions yet — can't run this {isComposite ? "test" : "section"}.
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
            <div className="text-xs text-slate-400">{currentSectionLabel}</div>
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
            {sections.map((s, i) =>
              isComposite ? (
                // No lock in composite mode — every section tab is always
                // clickable, jumping straight to that section's first
                // question, matching the real exam's free navigation.
                <button
                  key={s.key}
                  onClick={() => goToQuestion(sectionOffsets[s.key])}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${
                    q?._sectionKey === s.key
                      ? "bg-blue-900 text-white border-blue-900"
                      : "bg-slate-50 text-slate-500 border-slate-200 hover:border-blue-300"
                  }`}
                >
                  {s.label}
                </button>
              ) : (
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
              )
            )}
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
              {!isComposite && (
                <button onClick={requestNextSection} className="text-sm px-5 py-2.5 rounded-lg border border-slate-300 text-slate-600 bg-white">
                  {isLastSection ? "Finish exam" : `Next section: ${sections[sectionIdx + 1]?.label}`} →
                </button>
              )}
              <button onClick={requestFinish} className="text-sm px-5 py-2.5 rounded-lg bg-red-600 text-white font-medium">
                Finish Test
              </button>
            </div>
          </div>
        </div>

        {/* Question palette sidebar */}
        <div className="w-64 bg-white border-l border-slate-200 p-5 overflow-auto shrink-0">
          <div className="text-xs font-semibold text-slate-500 mb-3">
            Question {qIdx + 1} / {list.length} · {currentSectionLabel}
          </div>

          <div className="grid grid-cols-2 gap-1.5 text-[11px] mb-4">
            <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-emerald-500" /> Answered ({answeredCount})</div>
            <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-red-100 border border-red-200" /> Not answered ({notAnsweredCount})</div>
            <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-white border border-slate-300" /> Not visited ({notVisitedCount})</div>
            <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-purple-500" /> Marked ({markedCount})</div>
          </div>

          {isComposite ? (
            // Grouped by section (for orientation) but every tile is always
            // clickable — no lock, matching the real exam's free navigation.
            <div className="space-y-4">
              {sections.map((s) => {
                const sectionQs = questions[s.key] || [];
                if (sectionQs.length === 0) return null;
                const offset = sectionOffsets[s.key];
                return (
                  <div key={s.key}>
                    <div className="text-[11px] font-semibold text-slate-500 mb-1.5">{s.label}</div>
                    <div className="grid grid-cols-5 gap-1.5">
                      {sectionQs.map((qq, i) => {
                        const globalI = offset + i;
                        const status = statusOf(qq);
                        return (
                          <button
                            key={qq.id}
                            onClick={() => goToQuestion(globalI)}
                            className={`aspect-square rounded-md text-xs font-semibold border-2 ${STATUS_STYLE[status]} ${
                              globalI === qIdx ? "ring-2 ring-offset-1 ring-blue-500" : ""
                            }`}
                          >
                            {globalI + 1}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
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
          )}
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

// A single practice question, added or edited by hand — the manual
// alternative to pasting JSON. Unlike QuestionForm (mock questions, where
// topic is optional metadata), topic is the first field and required here:
// it's the only thing a student browses Practice Ground by, and it's also
// what a future "practice this topic" link from the AI analysis will match
// against, so it has to be filled in deliberately, not left blank.
// ============================================================================
// LEADS (admin) — every student who's ever signed up (email, always
// present from Google sign-in) and whichever phone number they've given
// once they hit the free-tier limit (blank until then). Read-only: no
// action to take here beyond seeing who to reach out to.
// ============================================================================
function StudentLeadsView() {
  const [profiles, setProfiles] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [query, setQuery] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        setProfiles(await loadAllStudentProfiles());
      } catch {
        setLoadError(true);
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  const filtered = profiles.filter(
    (p) => !query || p.email?.toLowerCase().includes(query.toLowerCase()) || p.phoneNumber?.includes(query)
  );
  const withPhone = profiles.filter((p) => p.phoneNumber).length;

  function downloadCsv() {
    const header = "email,phone,signed_up";
    const rows = filtered.map((p) =>
      [p.email || "", p.phoneNumber || "", p.createdAt ? new Date(p.createdAt).toISOString() : ""]
        .map((v) => `"${v.replace(/"/g, '""')}"`)
        .join(",")
    );
    const csv = [header, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `student-leads-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function copyEmails() {
    const emails = filtered.map((p) => p.email).filter(Boolean).join(", ");
    await navigator.clipboard.writeText(emails);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="text-sm text-slate-600">
          <span className="font-semibold text-slate-800">{profiles.length}</span> signed up ·{" "}
          <span className="font-semibold text-slate-800">{withPhone}</span> gave a phone number
        </div>
        <div className="flex items-center gap-2">
          <div className="relative w-56">
            <Search size={13} className="absolute left-2.5 top-2.5 text-slate-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search email or phone..."
              className="w-full text-xs border border-slate-200 rounded-md pl-7 pr-2 py-1.5"
            />
          </div>
          <button
            onClick={copyEmails}
            disabled={filtered.length === 0}
            className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-md border border-slate-200 text-slate-600 shrink-0 disabled:opacity-50"
          >
            <Copy size={12} /> {copied ? "Copied!" : "Copy emails"}
          </button>
          <button
            onClick={downloadCsv}
            disabled={filtered.length === 0}
            className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-md border border-slate-200 text-slate-600 shrink-0 disabled:opacity-50"
          >
            <Download size={12} /> Export CSV
          </button>
        </div>
      </div>

      {!loaded ? (
        <div className="text-sm text-slate-400">Loading...</div>
      ) : loadError ? (
        <div className="text-center bg-red-50 border border-dashed border-red-200 rounded-xl p-10 text-sm text-red-500">
          Couldn't load Leads — if you haven't run the setup SQL for the student_profiles/admins tables yet, that's why.
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center bg-white border border-dashed border-slate-300 rounded-xl p-10 text-sm text-slate-400">
          {profiles.length === 0 ? "No one has signed up yet." : "No match for that search."}
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-left text-xs font-semibold text-slate-500">
                <th className="px-4 py-2.5">Email</th>
                <th className="px-4 py-2.5">Phone</th>
                <th className="px-4 py-2.5">Signed up</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((p) => (
                <tr key={p.id}>
                  <td className="px-4 py-2.5 text-slate-700">{p.email}</td>
                  <td className="px-4 py-2.5">
                    {p.phoneNumber ? (
                      <span className="text-slate-700">{p.phoneNumber}</span>
                    ) : (
                      <span className="text-slate-300">— not given yet —</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-slate-400 text-xs">
                    {p.createdAt ? new Date(p.createdAt).toLocaleDateString() : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function PracticeQuestionForm({ initial, topicOptions, defaultTopic, onSave, onCancel }) {
  const [q, setQ] = useState(
    initial || { id: generateId("pq"), topic: defaultTopic || "", difficulty: "Easy", text: "", options: ["", "", "", ""], answer: 0, explanation: "" }
  );
  const canSave = q.topic.trim() && q.text.trim() && q.options.every((o) => o.trim()) && q.explanation.trim();
  // If editing a question whose topic isn't in the curated list (e.g. it
  // was free-typed before a curated list existed for this exam), keep it
  // selectable so saving the form never silently changes/loses it.
  const options = topicOptions && topicOptions.length > 0
    ? topicOptions.includes(q.topic) || !q.topic
      ? topicOptions
      : [q.topic, ...topicOptions]
    : null;
  return (
    <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-2.5">
      <div className="flex items-center gap-2">
        <div className="flex-1">
          <label className="block text-[11px] font-medium text-slate-500 mb-1">Topic (required)</label>
          {options ? (
            <select
              value={q.topic}
              onChange={(e) => setQ({ ...q, topic: e.target.value })}
              className="w-full text-sm border border-slate-200 rounded-md px-3 py-1.5"
            >
              <option value="" disabled>Select a topic...</option>
              {options.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          ) : (
            <input
              value={q.topic}
              onChange={(e) => setQ({ ...q, topic: e.target.value })}
              placeholder="e.g. Height and Distance"
              className="w-full text-sm border border-slate-200 rounded-md px-3 py-1.5"
            />
          )}
        </div>
        <div>
          <label className="block text-[11px] font-medium text-slate-500 mb-1">Difficulty</label>
          <select
            value={q.difficulty}
            onChange={(e) => setQ({ ...q, difficulty: e.target.value })}
            className="text-sm border border-slate-200 rounded-md px-3 py-1.5"
          >
            {PRACTICE_DIFFICULTIES.map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
        </div>
      </div>
      <textarea
        value={q.text}
        onChange={(e) => setQ({ ...q, text: e.target.value })}
        placeholder="Question text"
        rows={2}
        className="w-full text-sm border border-slate-200 rounded-md px-3 py-2"
      />
      {q.options.map((opt, i) => (
        <div key={i} className="flex items-center gap-2">
          <input type="radio" checked={q.answer === i} onChange={() => setQ({ ...q, answer: i })} title="Mark as correct answer" />
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
      <div className="flex justify-end gap-2 pt-1">
        <button onClick={onCancel} className="text-xs px-3 py-1.5 rounded-md border border-slate-200 text-slate-600">
          Cancel
        </button>
        <button
          onClick={() => canSave && onSave({ ...q, topic: q.topic.trim() })}
          disabled={!canSave}
          className="text-xs px-3 py-1.5 rounded-md bg-blue-900 text-white disabled:opacity-40"
        >
          Save question
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// PRACTICE BANK (admin) — upload/manage the standalone Practice Ground
// question bank, per exam/topic/difficulty. Deliberately simpler than
// SectionManager: there's no fixed capacity to manage and no add-vs-replace
// mode, since every upload is just an upsert (matching id updates in place,
// new id adds alongside). Deleting a question is the only other write.
// ============================================================================
function PracticeBankView() {
  const [examKey, setExamKey] = useState(EXAM_LIST[0].key);
  const [jsonText, setJsonText] = useState("");
  const [errors, setErrors] = useState([]);
  const [successMsg, setSuccessMsg] = useState("");
  const [uploading, setUploading] = useState(false);
  const [questions, setQuestions] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [filterTopic, setFilterTopic] = useState("");
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [confirmingBulkDelete, setConfirmingBulkDelete] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [enabledLoaded, setEnabledLoaded] = useState(false);
  const [togglingEnabled, setTogglingEnabled] = useState(false);
  const [addingNew, setAddingNew] = useState(false);
  const [editingQuestion, setEditingQuestion] = useState(null);
  const [sectionKey, setSectionKey] = useState(EXAMS[EXAM_LIST[0].key].sections[0].key);
  const [selectedTopic, setSelectedTopic] = useState("");

  const examSections = EXAMS[examKey].sections;
  const topicOptions = CURATED_PRACTICE_TOPICS[examKey]?.[sectionKey]?.length > 0
    ? CURATED_PRACTICE_TOPICS[examKey][sectionKey]
    : null;

  // Switching exams resets the section (and by extension the topic, via the
  // effect below) — a section key from one exam has no guaranteed meaning
  // for another, and a curated topic from one section certainly doesn't
  // belong to a different one.
  useEffect(() => {
    setSectionKey(EXAMS[examKey].sections[0].key);
  }, [examKey]);

  useEffect(() => {
    setSelectedTopic(topicOptions?.[0] || "");
  }, [sectionKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = useCallback(async () => {
    setLoaded(false);
    setLoadError(false);
    setSelectedIds(new Set());
    try {
      setQuestions(await loadAllPracticeQuestions(examKey, sectionKey));
    } catch {
      setLoadError(true);
    } finally {
      setLoaded(true);
    }
  }, [examKey, sectionKey]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    (async () => {
      try {
        setEnabled(await loadPracticeGroundEnabled());
      } catch {
        // Leave it at the safe default (hidden) if this fails to load —
        // never show the toggle as "on" when we couldn't actually confirm that.
      } finally {
        setEnabledLoaded(true);
      }
    })();
  }, []);

  async function toggleEnabled() {
    const next = !enabled;
    setTogglingEnabled(true);
    try {
      await setPracticeGroundEnabled(next);
      setEnabled(next);
    } finally {
      setTogglingEnabled(false);
    }
  }

  function handleValidate() {
    return validatePracticeImportJSON(jsonText, selectedTopic);
  }

  async function handleImport() {
    const result = handleValidate();
    setErrors(result.errors);
    setSuccessMsg("");
    if (!result.ok) return;
    setUploading(true);
    try {
      await savePracticeQuestions(examKey, sectionKey, result.questions);
      setJsonText("");
      setSuccessMsg(`Uploaded ${result.questions.length} question${result.questions.length === 1 ? "" : "s"}.`);
      await refresh();
    } finally {
      setUploading(false);
    }
  }

  async function confirmDelete() {
    await deletePracticeQuestion(deleteTarget.id);
    setDeleteTarget(null);
    refresh();
  }

  function toggleSelected(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectGroup(qs) {
    const groupIds = qs.map((q) => q.id);
    const allSelected = groupIds.every((id) => selectedIds.has(id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      groupIds.forEach((id) => (allSelected ? next.delete(id) : next.add(id)));
      return next;
    });
  }

  async function confirmBulkDelete() {
    setBulkDeleting(true);
    try {
      await deletePracticeQuestions([...selectedIds]);
      setConfirmingBulkDelete(false);
      await refresh();
    } finally {
      setBulkDeleting(false);
    }
  }

  async function saveManualQuestion(question) {
    await savePracticeQuestions(examKey, sectionKey, [question]);
    setAddingNew(false);
    setEditingQuestion(null);
    await refresh();
  }

  const filtered = questions.filter((q) => !filterTopic || q.topic.toLowerCase().includes(filterTopic.toLowerCase()));
  const topicGroups = {};
  filtered.forEach((q) => {
    if (!topicGroups[q.topic]) topicGroups[q.topic] = [];
    topicGroups[q.topic].push(q);
  });

  return (
    <div className="max-w-4xl">
      <div className={`flex items-center justify-between gap-3 border rounded-lg px-4 py-3 mb-5 ${enabled ? "bg-emerald-50 border-emerald-200" : "bg-slate-100 border-slate-200"}`}>
        <div>
          <div className="text-sm font-medium text-slate-800">
            {enabled ? "Practice Ground is visible to students" : "Practice Ground is hidden from students"}
          </div>
          <div className="text-xs text-slate-500 mt-0.5">
            {enabled
              ? "The Practice Ground card is showing on every exam's picker screen."
              : "Students won't see the Practice Ground card anywhere until you turn this on."}
          </div>
        </div>
        <button
          onClick={toggleEnabled}
          disabled={!enabledLoaded || togglingEnabled}
          role="switch"
          aria-checked={enabled}
          className={`shrink-0 w-11 h-6 rounded-full relative transition-colors disabled:opacity-50 ${enabled ? "bg-emerald-500" : "bg-slate-300"}`}
        >
          <span
            className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${enabled ? "translate-x-5" : "translate-x-0"}`}
          />
        </button>
      </div>

      <div className="flex gap-1.5 mb-3">
        {EXAM_LIST.map((exam) => (
          <button
            key={exam.key}
            onClick={() => setExamKey(exam.key)}
            className={`text-xs px-3 py-1.5 rounded-md border ${
              examKey === exam.key ? "bg-blue-900 text-white border-blue-900" : "bg-white text-slate-500 border-slate-200"
            }`}
          >
            {exam.label}
          </button>
        ))}
      </div>

      <div className="flex gap-1.5 mb-4">
        {examSections.map((s) => (
          <button
            key={s.key}
            onClick={() => setSectionKey(s.key)}
            className={`text-xs px-3 py-1.5 rounded-md border ${
              sectionKey === s.key ? "bg-purple-600 text-white border-purple-600" : "bg-white text-slate-500 border-slate-200"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="bg-white border border-slate-200 rounded-lg p-4 mb-6">
        <label className="flex items-center gap-1.5 text-xs font-medium text-slate-500 mb-1.5">
          <Upload size={13} /> Add Practice Ground questions for {EXAMS[examKey].label} — {examSections.find((s) => s.key === sectionKey)?.label}
        </label>

        <div className="mb-3">
          <label className="block text-[11px] font-medium text-slate-500 mb-1">
            Topic — every question pasted below gets tagged with this one
          </label>
          {topicOptions ? (
            <select
              value={selectedTopic}
              onChange={(e) => setSelectedTopic(e.target.value)}
              className="w-full sm:w-80 text-sm border border-slate-200 rounded-md px-3 py-1.5"
            >
              {topicOptions.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          ) : (
            <>
              <input
                value={selectedTopic}
                onChange={(e) => setSelectedTopic(e.target.value)}
                placeholder="e.g. Verbal Reasoning"
                className="w-full sm:w-80 text-sm border border-slate-200 rounded-md px-3 py-1.5"
              />
              <div className="text-[11px] text-slate-400 mt-1">
                No curated topic list built yet for {EXAMS[examKey].label} — type one directly for now.
              </div>
            </>
          )}
        </div>

        <div className="text-xs text-slate-400 mb-2">
          A question with an id that already exists here updates in place — there's no fixed limit, add as many as
          you like. Each question still needs its own "difficulty" (exactly "Easy", "Medium", or "Hard") — no need
          to repeat "topic" per question anymore, it's taken from your selection above.
        </div>
        <textarea
          value={jsonText}
          onChange={(e) => setJsonText(e.target.value)}
          rows={8}
          placeholder={`[\n  {\n    "id": "trig_easy_001",\n    "difficulty": "Easy",\n    "text": "...",\n    "options": ["...", "...", "...", "..."],\n    "answer": 0,\n    "explanation": "..."\n  }\n]`}
          className="w-full text-xs font-mono border border-slate-200 rounded-md p-3 focus:outline-none focus:ring-2 focus:ring-blue-200"
        />
        <div className="flex items-center gap-2 mt-2">
          <button onClick={() => setErrors(handleValidate().errors)} className="text-xs px-3 py-1.5 rounded-md border border-slate-200 text-slate-600">
            Validate
          </button>
          <button onClick={handleImport} disabled={uploading} className="text-xs px-3 py-1.5 rounded-md bg-blue-900 text-white disabled:opacity-50">
            {uploading ? "Uploading..." : "Validate & Upload"}
          </button>
          {successMsg && <span className="text-xs text-emerald-600 font-medium">{successMsg}</span>}
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

      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h3 className="text-sm font-semibold text-slate-700">
          {questions.length} question{questions.length === 1 ? "" : "s"} in {EXAMS[examKey].label} — {examSections.find((s) => s.key === sectionKey)?.label}
        </h3>
        <div className="flex items-center gap-2">
          <div className="relative w-56">
            <Search size={13} className="absolute left-2.5 top-2.5 text-slate-400" />
            <input
              value={filterTopic}
              onChange={(e) => setFilterTopic(e.target.value)}
              placeholder="Filter by topic..."
              className="w-full text-xs border border-slate-200 rounded-md pl-7 pr-2 py-1.5"
            />
          </div>
          <button
            onClick={() => {
              setEditingQuestion(null);
              setAddingNew(true);
            }}
            className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-md border border-slate-200 text-slate-600 shrink-0"
          >
            <Plus size={12} /> Add single question
          </button>
        </div>
      </div>

      {filtered.length > 0 && (
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <label className="flex items-center gap-1.5 text-xs text-slate-500 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={filtered.every((q) => selectedIds.has(q.id))}
              onChange={() => toggleSelectGroup(filtered)}
              className="rounded border-slate-300"
            />
            {selectedIds.size > 0 ? `${selectedIds.size} selected` : "Select all"}
          </label>
          {selectedIds.size > 0 && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setSelectedIds(new Set())}
                className="text-xs text-slate-500 hover:text-slate-700"
              >
                Clear selection
              </button>
              <button
                onClick={() => setConfirmingBulkDelete(true)}
                className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-md bg-red-50 border border-red-200 text-red-600 hover:bg-red-100"
              >
                <Trash2 size={12} /> Delete {selectedIds.size} question{selectedIds.size === 1 ? "" : "s"}
              </button>
            </div>
          )}
        </div>
      )}

      {(addingNew || editingQuestion) && (
        <div className="mb-5">
          <PracticeQuestionForm
            initial={editingQuestion}
            topicOptions={topicOptions}
            defaultTopic={selectedTopic}
            onSave={saveManualQuestion}
            onCancel={() => {
              setAddingNew(false);
              setEditingQuestion(null);
            }}
          />
        </div>
      )}

      {!loaded ? (
        <div className="text-sm text-slate-400">Loading...</div>
      ) : loadError ? (
        <div className="text-center bg-red-50 border border-dashed border-red-200 rounded-xl p-10 text-sm text-red-500">
          Couldn't load the Practice Bank — if you haven't run the setup SQL for the practice_questions table yet,
          that's why. Otherwise, try again in a moment.
        </div>
      ) : questions.length === 0 ? (
        <div className="text-center bg-white border border-dashed border-slate-300 rounded-xl p-10 text-sm text-slate-400">
          No practice questions uploaded for {EXAMS[examKey].label} — {examSections.find((s) => s.key === sectionKey)?.label} yet.
        </div>
      ) : (
        <div className="space-y-5">
          {Object.entries(topicGroups).map(([topic, qs]) => (
            <div key={topic} className="bg-white border border-slate-200 rounded-lg overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-2.5 bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                <input
                  type="checkbox"
                  checked={qs.every((q) => selectedIds.has(q.id))}
                  onChange={() => toggleSelectGroup(qs)}
                  className="rounded border-slate-300"
                />
                {topic} · {qs.length} question{qs.length === 1 ? "" : "s"}
              </div>
              <div className="divide-y divide-slate-100">
                {qs.map((q) => (
                  <div
                    key={q.id}
                    onClick={() => {
                      setAddingNew(false);
                      setEditingQuestion(q);
                    }}
                    className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-slate-50"
                  >
                    <input
                      type="checkbox"
                      checked={selectedIds.has(q.id)}
                      onClick={(e) => e.stopPropagation()}
                      onChange={() => toggleSelected(q.id)}
                      className="rounded border-slate-300 shrink-0"
                    />
                    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded border shrink-0 ${PRACTICE_DIFFICULTY_COLORS[q.difficulty]}`}>
                      {q.difficulty}
                    </span>
                    <span className="flex-1 min-w-0 text-sm text-slate-700 truncate">
                      <MathText text={q.text} />
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteTarget(q);
                      }}
                      className="text-slate-300 hover:text-red-500 shrink-0"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {deleteTarget && (
        <ConfirmModal
          title="Delete this practice question?"
          body="This removes it permanently from the Practice Ground bank. This cannot be undone."
          confirmLabel="Delete"
          danger
          onConfirm={confirmDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      {confirmingBulkDelete && (
        <ConfirmModal
          title={`Delete ${selectedIds.size} question${selectedIds.size === 1 ? "" : "s"}?`}
          body="This removes all selected questions permanently from the Practice Ground bank. This cannot be undone."
          confirmLabel={bulkDeleting ? "Deleting..." : "Delete"}
          danger
          onConfirm={confirmBulkDelete}
          onCancel={() => setConfirmingBulkDelete(false)}
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
      title: `New Mock Test ${String(nextMockNumber(mocksIndex)).padStart(2, "0")}`,
      description: "",
      instructions: "",
      duration: EXAMS[DEFAULT_EXAM].fullDuration,
      totalMarks: EXAMS[DEFAULT_EXAM].fullTotalMarks,
      negativeMarking: EXAMS[DEFAULT_EXAM].defaultNegativeMarking,
      status: "draft",
      mockType: MOCK_TYPES.FULL,
      exam: DEFAULT_EXAM,
      sectionalKey: null,
      sectionalQuestionCount: EXAMS[DEFAULT_EXAM].sections[0].questionCount,
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
      importedQuestionCount += ALL_SECTIONS.reduce((sum, s) => sum + (safeMap[s.key]?.length || 0), 0);
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
      const strayCount = ALL_SECTIONS.filter((s) => s.key !== mock.sectionalKey).reduce((sum, s) => sum + (qMap[s.key]?.length || 0), 0);
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
    for (const s of ALL_SECTIONS) clonedQuestions[s.key] = (original[s.key] || []).map((q) => ({ ...q, id: generateId("q") }));

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
    const total = ALL_SECTIONS.reduce((sum, s) => sum + (qmap[s.key]?.length || 0), 0);
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
    { key: "practiceBank", label: "Practice Bank", icon: BookOpen, onClick: () => setView("practiceBank") },
    { key: "leads", label: "Leads", icon: Users, onClick: () => setView("leads") },
    { key: "cutoffs", label: "Cutoffs", icon: BarChart2, onClick: () => setView("cutoffs") },
    { key: "import", label: "Import Data", icon: Upload, onClick: () => setView("import") },
  ];

  if (!mocksLoaded) {
    return <div className="min-h-screen flex items-center justify-center text-sm text-slate-400">Loading admin panel...</div>;
  }

  return (
    <div className="min-h-screen bg-slate-50 flex text-slate-800">
      <aside className="print:hidden w-56 bg-slate-900 text-slate-300 flex flex-col shrink-0">
        <div className="px-4 py-5 text-white font-semibold text-sm border-b border-slate-800">The 100 Percentiler — Admin</div>
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
        <header className="print:hidden bg-white border-b border-slate-200 px-6 py-3 flex items-center gap-3">
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
            {view === "practiceBank" && "Practice Bank"}
            {view === "leads" && "Leads"}
            {view === "cutoffs" && "Cutoffs"}
            {view === "import" && "Import Data"}
            {view === "editor" && activeMock?.title}
            {view === "section" && `${activeMock?.title} — ${sectionLabel(activeSection)}`}
            {view === "preview" && `Preview — ${activeMock?.title}`}
            {view === "run" && `Running — ${activeMock?.title}`}
          </h1>
        </header>

        <main className="flex-1 p-6 overflow-auto print:overflow-visible print:h-auto print:p-0">
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
          {view === "practiceBank" && <PracticeBankView />}
          {view === "leads" && <StudentLeadsView />}
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
            <RunMockView mock={activeMock} questions={activeQuestions} onExit={goList} adminMode />
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
  const theme = EXAM_THEME[getExamKey(mock)];

  return (
    <div
      className={`group relative bg-white border border-slate-200 rounded-3xl p-5 flex flex-col shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300 overflow-hidden ${theme.ring}`}
    >
      <div className={`absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r ${theme.gradient}`} />
      <div className="flex items-center gap-2 mb-2 mt-1">
        <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${theme.badgeBg}`}>{mockTypeBadgeLabel(mock)}</span>
      </div>
      <h3 className="font-bold text-slate-800 mb-1">{mock.title}</h3>
      {isSectional && sections[0] && (
        <p className="text-xs text-slate-500 mb-3">{sections[0].label}</p>
      )}
      {mock.description && <p className="text-xs text-slate-500 mb-3">{mock.description}</p>}

      <div className="grid grid-cols-3 gap-2 text-center my-3 py-3 border-y border-slate-100">
        <div>
          <ListChecks size={14} className="mx-auto mb-1 text-slate-400" />
          <div className="text-sm font-semibold text-slate-800">{totalQuestions}</div>
          <div className="text-[10px] text-slate-400">Questions</div>
        </div>
        <div>
          <Clock size={14} className="mx-auto mb-1 text-slate-400" />
          <div className="text-sm font-semibold text-slate-800">{mock.duration}</div>
          <div className="text-[10px] text-slate-400">Minutes</div>
        </div>
        <div>
          <Target size={14} className="mx-auto mb-1 text-slate-400" />
          <div className="text-sm font-semibold text-slate-800">{mock.totalMarks}</div>
          <div className="text-[10px] text-slate-400">Marks</div>
        </div>
      </div>

      <button
        onClick={() => onStart(mock)}
        className={`mt-auto w-full flex items-center justify-center gap-1.5 text-sm font-medium text-white rounded-xl py-2.5 bg-gradient-to-r ${theme.gradient} group-hover:shadow-lg transition-shadow`}
      >
        View Details <ArrowRight size={14} className="group-hover:translate-x-0.5 transition-transform" />
      </button>
    </div>
  );
}

function StudentInstructionsView({ mock, questionCount, onStart, onBack, viaChallenge }) {
  const sections = sectionsForMock(mock);
  const theme = EXAM_THEME[getExamKey(mock)];

  return (
    <div className="max-w-2xl mx-auto">
      <button onClick={onBack} className="text-sm text-slate-500 hover:text-slate-700 mb-4 transition-colors">
        ← Back to mock list
      </button>
      <div className="bg-white border border-slate-200 rounded-3xl overflow-hidden shadow-sm">
        <div className={`relative overflow-hidden bg-gradient-to-br ${theme.gradient} text-white p-8`}>
          <div className="absolute -right-10 -top-10 w-40 h-40 bg-white/10 rounded-full blur-2xl pointer-events-none" />
          <div className="relative">
            <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold mb-3 bg-white/20">
              {mockTypeBadgeLabel(mock)}
            </span>
            <h1 className="text-xl font-bold mb-1">{mock.title}</h1>
            {mock.description && <p className="text-sm text-white/80">{mock.description}</p>}
          </div>
        </div>

        <div className="p-8">
          {viaChallenge && (
            <div className="bg-blue-50 border border-blue-200 rounded-md px-3 py-2 text-xs text-blue-800 mb-5 flex items-center gap-2">
              <Swords size={14} className="shrink-0" /> Finish this test to get a link you can send to a friend to challenge them.
            </div>
          )}

          <div className="grid grid-cols-3 gap-3 mb-6">
            <div className={`rounded-2xl p-3 text-center ${theme.iconBg}`}>
              <div className="text-lg font-bold mb-0.5">{questionCount}</div>
              <div className="text-xs opacity-70">Questions</div>
            </div>
            <div className={`rounded-2xl p-3 text-center ${theme.iconBg}`}>
              <div className="text-lg font-bold mb-0.5">{mock.duration} min</div>
              <div className="text-xs opacity-70">Duration</div>
            </div>
            <div className={`rounded-2xl p-3 text-center ${theme.iconBg}`}>
              <div className="text-lg font-bold mb-0.5">{mock.totalMarks}</div>
              <div className="text-xs opacity-70">Total Marks</div>
            </div>
          </div>

          <div className="mb-6">
            <h2 className="text-sm font-semibold text-slate-700 mb-2">Sections</h2>
            <div className="space-y-1.5">
              {sections.map((s) => (
                <div key={s.key} className="flex justify-between text-sm bg-slate-50 rounded-lg px-3 py-2.5 hover:bg-slate-100 transition-colors">
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
                {getExam(mock).timerMode === "composite" ? (
                  <li>One timer for the whole test — you can move freely between any section's questions the entire time, in any order.</li>
                ) : (
                  <>
                    <li>Each section has its own timer. Once time is up, you'll automatically move to the next section.</li>
                    <li>Once you leave a section, you cannot return to it.</li>
                  </>
                )}
                <li>{mock.negativeMarking > 0 ? `Negative marking: ${mock.negativeMarking} mark(s) deducted per wrong answer.` : "No negative marking — attempt every question."}</li>
                <li>You can finish the test at any time using "Finish Test".</li>
              </ul>
            )}
          </div>

          <button
            onClick={onStart}
            className={`w-full text-white text-sm font-semibold rounded-xl py-3.5 bg-gradient-to-r ${theme.gradient} hover:shadow-lg hover:-translate-y-0.5 transition-all flex items-center justify-center gap-2`}
          >
            Start Test <ArrowRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

function TypeSelectCard({ type, count, onSelect, exam }) {
  const isSectional = type === MOCK_TYPES.SECTIONAL;
  const theme = EXAM_THEME[exam.key];
  const Icon = isSectional ? Layers : FileText;
  const sectionNames = exam.sections.map((s) => s.label).join(", ");
  return (
    <button
      onClick={() => onSelect(type)}
      className={`group relative bg-white border border-slate-200 rounded-3xl p-7 text-left shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300 overflow-hidden ${theme.ring}`}
    >
      <div className={`absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r ${theme.gradient}`} />
      <div className={`w-12 h-12 rounded-2xl flex items-center justify-center mb-4 ${theme.iconBg}`}>
        <Icon size={22} />
      </div>
      <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold mb-2 ${theme.badgeBg}`}>
        {isSectional ? "SECTIONAL" : "FULL LENGTH"}
      </span>
      <h2 className="text-lg font-bold text-slate-800 mb-1.5">{isSectional ? "Sectional Mock" : "Full Mock"}</h2>
      <p className="text-sm text-slate-500 mb-5 leading-relaxed">
        {isSectional
          ? `Practice one section at a time — ${sectionNames} — at your own configured length.`
          : `The complete ${exam.label} paper — ${sectionNames}, all in one sitting.`}
      </p>
      <div className="flex items-center justify-between">
        <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${theme.badgeBg}`}>
          {count} test{count === 1 ? "" : "s"} available
        </span>
        <span
          className={`inline-flex items-center justify-center w-8 h-8 rounded-full bg-gradient-to-br ${theme.gradient} text-white group-hover:scale-110 transition-transform`}
        >
          <ArrowRight size={15} />
        </span>
      </div>
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

// Score, normalized to a 0-100 "percent of total marks" scale so attempts
// across different mocks (and different exams — SSC CGL's 200 vs GMAT's 64)
// are comparable on one chart/average. Falls back to accuracy% for the rare
// case of a deleted mock (totalMarks unavailable), rather than a gap.
function scorePercentFor(attempt, mocksIndex, accuracyPct) {
  const mock = mocksIndex.find((m) => m.id === attempt.mockId);
  if (!mock?.totalMarks) return accuracyPct;
  return Math.max(0, Math.min(100, (attempt.score / mock.totalMarks) * 100));
}
// Accuracy is correct ÷ attempted (correct + incorrect), not ÷ every question
// in the mock — a skipped question was never attempted, so it shouldn't
// dilute this number.
function accuracyPercentFor(attempt) {
  const attempted = attempt.correct + attempt.incorrect;
  return attempted ? (attempt.correct / attempted) * 100 : 0;
}

function ProgressTrendChart({ attempts, mocksIndex }) {
  const recent = attempts.slice(-20);
  const data = recent.map((a, i) => {
    const accuracyPct = accuracyPercentFor(a);
    return {
      label: `Test ${i + 1}`,
      date: new Date(a.createdAt).toLocaleDateString(),
      Score: Math.round(scorePercentFor(a, mocksIndex, accuracyPct)),
      Accuracy: Math.round(accuracyPct),
    };
  });
  if (data.length < 2) {
    return <p className="text-xs text-slate-400">Take a couple more tests to see a trend here.</p>;
  }
  return (
    <ResponsiveContainer width="100%" height={260}>
      <ComposedChart data={data} margin={{ top: 8, right: 12, left: -18, bottom: 0 }}>
        <defs>
          <linearGradient id="scoreFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#6366f1" stopOpacity={0.35} />
            <stop offset="95%" stopColor="#6366f1" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
        <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
        <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickFormatter={(v) => `${v}%`} tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} width={40} />
        <Tooltip
          contentStyle={{ borderRadius: 10, border: "1px solid #e2e8f0", fontSize: 12 }}
          formatter={(value, name) => [`${value}%`, name]}
          labelFormatter={(label, payload) => (payload?.[0]?.payload?.date ? `${label} · ${payload[0].payload.date}` : label)}
        />
        <Legend verticalAlign="top" height={28} iconType="circle" wrapperStyle={{ fontSize: 12 }} />
        <Area type="monotone" dataKey="Score" stroke="#6366f1" strokeWidth={2.5} fill="url(#scoreFill)" dot={{ r: 3, fill: "#6366f1" }} activeDot={{ r: 5 }} />
        <Line type="monotone" dataKey="Accuracy" stroke="#10b981" strokeWidth={2.5} dot={{ r: 3, fill: "#10b981" }} activeDot={{ r: 5 }} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

function SubjectAccuracyChart({ sectionAccuracy }) {
  const data = sectionAccuracy.map((s) => ({ ...s, accuracyPct: Math.round(s.accuracy * 100) }));
  return (
    <ResponsiveContainer width="100%" height={Math.max(140, data.length * 52)}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 28, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
        <XAxis type="number" domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickFormatter={(v) => `${v}%`} tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
        <YAxis type="category" dataKey="label" width={90} tick={{ fontSize: 11, fill: "#475569" }} axisLine={false} tickLine={false} />
        <Tooltip
          contentStyle={{ borderRadius: 10, border: "1px solid #e2e8f0", fontSize: 12 }}
          formatter={(value, _name, props) => [`${value}% (${props.payload.correct}/${props.payload.total})`, "Accuracy"]}
        />
        <Bar dataKey="accuracyPct" radius={[0, 6, 6, 0]} barSize={20} minPointSize={3}>
          <LabelList dataKey="accuracyPct" position="right" formatter={(v) => `${v}%`} style={{ fontSize: 11, fill: "#475569", fontWeight: 600 }} />
          {data.map((d) => (
            <Cell key={d.label} fill={d.accuracyPct < 40 ? "#f87171" : d.accuracyPct < 70 ? "#fbbf24" : "#6366f1"} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function AnswerBreakdownDonut({ attempts, caption = "questions answered across all attempts" }) {
  const totals = attempts.reduce(
    (acc, a) => ({ correct: acc.correct + a.correct, incorrect: acc.incorrect + a.incorrect, skipped: acc.skipped + a.skipped }),
    { correct: 0, incorrect: 0, skipped: 0 }
  );
  const data = [
    { name: "Correct", value: totals.correct, color: "#10b981" },
    { name: "Incorrect", value: totals.incorrect, color: "#f87171" },
    { name: "Skipped", value: totals.skipped, color: "#cbd5e1" },
  ].filter((d) => d.value > 0);
  const grandTotal = totals.correct + totals.incorrect + totals.skipped;
  if (grandTotal === 0) return null;
  return (
    <div>
      <ResponsiveContainer width="100%" height={220}>
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" innerRadius={55} outerRadius={80} paddingAngle={3} strokeWidth={0}>
            {data.map((d) => (
              <Cell key={d.name} fill={d.color} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{ borderRadius: 10, border: "1px solid #e2e8f0", fontSize: 12 }}
            formatter={(value, name) => [`${value} (${Math.round((value / grandTotal) * 100)}%)`, name]}
          />
          <Legend verticalAlign="bottom" height={28} iconType="circle" wrapperStyle={{ fontSize: 12 }} />
        </PieChart>
      </ResponsiveContainer>
      <p className="text-center text-xs text-slate-400 -mt-1">{grandTotal} {caption}</p>
    </div>
  );
}

// The results-screen hero — score, live stats, AND per-section drill-down
// all in one interactive surface. This used to be two separate things (a
// static hero with plain non-interactive section-score tiles, then a whole
// separate "Section performance" card further down repeating the same
// sections as clickable tabs) — genuinely redundant, showing the same
// section list twice. Now "Overall" and each section are tabs on the same
// card: Overall shows the full-mock score/correct/incorrect/skipped (with
// click-to-jump into Answer Review, unchanged); picking a section swaps the
// same content area to that section's accuracy/pie/breakdown instead, with
// a fade transition and a soft click sound on every tab change.
function ResultsHero({ mock, score, correct, incorrect, skipped, percentile, sectionBreakdown, sections, onExit, onJumpReview }) {
  const [tab, setTab] = useState("overall");
  const sectionIdx = sections.findIndex((s) => s.key === tab);
  const isSectionTab = sectionIdx >= 0;
  const stats = isSectionTab ? sectionBreakdown[sectionIdx] : { correct, incorrect, skipped, score };
  const attempted = stats.correct + stats.incorrect;
  const accuracyPct = attempted ? Math.round((stats.correct / attempted) * 100) : 0;
  const pieData = [
    { name: "Correct", value: stats.correct, color: "#6ee7b7" },
    { name: "Incorrect", value: stats.incorrect, color: "#fda4af" },
    { name: "Skipped", value: stats.skipped, color: "rgba(255,255,255,0.25)" },
  ].filter((d) => d.value > 0);

  function selectTab(key) {
    playClickSound();
    setTab(key);
  }

  return (
    <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-blue-950 via-blue-900 to-indigo-900 text-white p-6 sm:p-10 shadow-xl">
      <div className="absolute -right-16 -top-16 w-72 h-72 bg-blue-400/20 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -left-10 -bottom-16 w-56 h-56 bg-indigo-400/20 rounded-full blur-3xl pointer-events-none" />
      <div className="relative">
        <div className="flex items-center gap-2 text-blue-200 mb-1.5">
          <CheckCircle2 size={18} />
          <span className="text-xs font-medium uppercase tracking-wide">Test submitted</span>
        </div>
        <h2 className="text-lg sm:text-xl font-semibold mb-5">{mock.title}</h2>

        {sections.length > 1 && (
          <div className="print:hidden flex flex-wrap gap-2 mb-6">
            <button
              onClick={() => selectTab("overall")}
              className={`text-xs font-medium px-3.5 py-1.5 rounded-full border transition-all duration-200 hover:scale-105 ${
                tab === "overall" ? "bg-white text-blue-950 border-white" : "bg-white/10 border-white/20 text-blue-100 hover:bg-white/20"
              }`}
            >
              Overall
            </button>
            {sections.map((s) => (
              <button
                key={s.key}
                onClick={() => selectTab(s.key)}
                className={`text-xs font-medium px-3.5 py-1.5 rounded-full border transition-all duration-200 hover:scale-105 ${
                  tab === s.key ? "bg-white text-blue-950 border-white" : "bg-white/10 border-white/20 text-blue-100 hover:bg-white/20"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        )}

        <div key={tab} className="animate-fade-slide">
          {!isSectionTab ? (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 items-end mb-2">
                <div className="col-span-2 sm:col-span-1">
                  <div className="text-4xl sm:text-5xl font-bold cursor-default hover:scale-105 transition-transform duration-200 inline-block">
                    {score} <span className="text-lg font-normal text-blue-300">/ {mock.totalMarks}</span>
                  </div>
                  {percentile !== null && (
                    <div className="inline-block mt-2 bg-white/15 text-white text-xs font-medium px-3 py-1 rounded-full">
                      Better than {percentile}% of students
                    </div>
                  )}
                </div>
                <button onClick={() => correct > 0 && onJumpReview("correct")} disabled={correct === 0} className="text-left disabled:cursor-default group">
                  <div className="text-3xl font-bold text-emerald-300 group-hover:scale-110 transition-transform duration-200 inline-block">{correct}</div>
                  <div className={`text-xs text-blue-200 ${correct > 0 ? "underline decoration-dotted underline-offset-2" : ""}`}>Correct</div>
                </button>
                <button onClick={() => incorrect > 0 && onJumpReview("incorrect")} disabled={incorrect === 0} className="text-left disabled:cursor-default group">
                  <div className="text-3xl font-bold text-red-300 group-hover:scale-110 transition-transform duration-200 inline-block">{incorrect}</div>
                  <div className={`text-xs text-blue-200 ${incorrect > 0 ? "underline decoration-dotted underline-offset-2" : ""}`}>Incorrect</div>
                </button>
                <button onClick={() => skipped > 0 && onJumpReview("skipped")} disabled={skipped === 0} className="text-left disabled:cursor-default group">
                  <div className="text-3xl font-bold text-slate-300 group-hover:scale-110 transition-transform duration-200 inline-block">{skipped}</div>
                  <div className={`text-xs text-blue-200 ${skipped > 0 ? "underline decoration-dotted underline-offset-2" : ""}`}>Skipped</div>
                </button>
              </div>
            </>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 items-center">
              <ResponsiveContainer width="100%" height={180}>
                <PieChart>
                  <Pie data={pieData} dataKey="value" nameKey="name" outerRadius={75} strokeWidth={2} stroke="rgba(255,255,255,0.15)">
                    {pieData.map((d) => (
                      <Cell key={d.name} fill={d.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ borderRadius: 10, border: "none", fontSize: 12, background: "rgba(15,23,42,0.9)", color: "#fff" }}
                    formatter={(value, name) => [value, name]}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div>
                <div className="text-4xl font-bold cursor-default hover:scale-105 transition-transform duration-200 inline-block">{accuracyPct}%</div>
                <div className="text-xs text-blue-200 mb-3">Accuracy in {sections[sectionIdx].label}</div>
                <div className="grid grid-cols-3 gap-2 text-center max-w-xs">
                  <button
                    onClick={() => stats.correct > 0 && onJumpReview("correct", sections[sectionIdx].key)}
                    disabled={stats.correct === 0}
                    className="bg-white/10 rounded-lg py-2 hover:bg-white/20 transition-colors disabled:cursor-default disabled:hover:bg-white/10 group"
                  >
                    <div className="font-semibold text-emerald-300 group-hover:scale-110 transition-transform duration-200 inline-block">{stats.correct}</div>
                    <div className="text-[10px] text-blue-200">Correct</div>
                  </button>
                  <button
                    onClick={() => stats.incorrect > 0 && onJumpReview("incorrect", sections[sectionIdx].key)}
                    disabled={stats.incorrect === 0}
                    className="bg-white/10 rounded-lg py-2 hover:bg-white/20 transition-colors disabled:cursor-default disabled:hover:bg-white/10 group"
                  >
                    <div className="font-semibold text-red-300 group-hover:scale-110 transition-transform duration-200 inline-block">{stats.incorrect}</div>
                    <div className="text-[10px] text-blue-200">Incorrect</div>
                  </button>
                  <button
                    onClick={() => stats.skipped > 0 && onJumpReview("skipped", sections[sectionIdx].key)}
                    disabled={stats.skipped === 0}
                    className="bg-white/10 rounded-lg py-2 hover:bg-white/20 transition-colors disabled:cursor-default disabled:hover:bg-white/10 group"
                  >
                    <div className="font-semibold text-slate-300 group-hover:scale-110 transition-transform duration-200 inline-block">{stats.skipped}</div>
                    <div className="text-[10px] text-blue-200">Skipped</div>
                  </button>
                </div>
                <div className="text-xs text-blue-200 mt-3">
                  Score in this section: <span className="font-medium text-white">{stats.score}</span>
                </div>
              </div>
            </div>
          )}
        </div>

        <button onClick={onExit} className="print:hidden mt-6 text-sm px-5 py-2.5 rounded-lg bg-white text-blue-950 font-medium hover:bg-blue-50 transition-colors">
          Back to admin panel
        </button>
      </div>
    </div>
  );
}

// AI PERFORMANCE ANALYSIS — admin-only. Packages this attempt's full
// per-question detail (only for questions that need explaining: wrong,
// skipped, or correct-but-slow — no need to send every correct-and-quick
// answer) and sends it to api/analyze-attempt, which asks Gemini's free
// tier for a structured, plain-English breakdown. Never reachable from the
// student-facing results screen — see the adminMode gate in RunMockView.
function buildAnalysisPayload({ mock, sections, questions, answers, timeSpent, topicRows, weakTopics, strongTopics, sectionBreakdown, score, correct, incorrect, skipped, parTimeFor }) {
  const problemQuestions = [];
  const slowCorrectQuestions = [];
  sections.forEach((s) => {
    (questions[s.key] || []).forEach((qq) => {
      const sel = answers[qq.id];
      const t = timeSpent[qq.id] || 0;
      const par = parTimeFor(s.key);
      const isSkipped = sel === undefined;
      const isCorrect = !isSkipped && sel === qq.answer;
      const pace = t === 0 ? "not visited" : t <= par * 0.5 ? "quick" : t <= par * 1.5 ? "normal" : "slow";
      if (!isCorrect) {
        problemQuestions.push({
          section: s.label,
          topic: qq.topic || s.label,
          questionText: qq.text,
          options: qq.options,
          correctAnswerText: qq.options[qq.answer],
          selectedAnswerText: isSkipped ? null : qq.options[sel],
          status: isSkipped ? "skipped" : "incorrect",
          timeSpentSeconds: t,
          parTimeSeconds: Math.round(par),
          pace,
          explanation: qq.explanation || "",
        });
      } else if (pace === "slow") {
        slowCorrectQuestions.push({
          section: s.label,
          topic: qq.topic || s.label,
          questionText: qq.text,
          timeSpentSeconds: t,
          parTimeSeconds: Math.round(par),
        });
      }
    });
  });
  return {
    examLabel: getExam(mock).label,
    mockTitle: mock.title,
    totalMarks: mock.totalMarks,
    score, correct, incorrect, skipped,
    sectionBreakdown, topicRows, weakTopics, strongTopics,
    problemQuestions, slowCorrectQuestions,
  };
}

function AIAnalysisPanel({ isPrinting, ...payloadProps }) {
  const [state, setState] = useState("idle"); // 'idle' | 'loading' | 'done' | 'error'
  const [result, setResult] = useState(null);
  const [errorMsg, setErrorMsg] = useState("");

  async function runAnalysis() {
    setState("loading");
    setErrorMsg("");
    try {
      const payload = buildAnalysisPayload(payloadProps);
      const data = await analyzeAttempt(payload);
      setResult(data);
      setState("done");
    } catch (err) {
      setErrorMsg(err.message || "Something went wrong.");
      setState("error");
    }
  }

  return (
    <div className="bg-white border border-indigo-100 rounded-2xl p-6 shadow-sm">
      <div className="flex items-center gap-2 mb-1">
        <Sparkles size={16} className="text-indigo-600" />
        <h2 className="text-sm font-semibold text-slate-800">AI Performance Analysis</h2>
        <span className="text-[10px] font-medium text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full">Admin only</span>
      </div>
      <p className="text-xs text-slate-500 mb-4">
        A detailed, plain-English breakdown of this attempt — mistakes, weak/strong topics, and where time was lost.
      </p>

      {state === "idle" && (
        <button
          onClick={runAnalysis}
          className="print:hidden inline-flex items-center gap-2 bg-indigo-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-indigo-700 transition-colors"
        >
          <Sparkles size={14} /> Analyze with AI
        </button>
      )}

      {state === "loading" && (
        <div className="print:hidden flex items-center gap-2 text-sm text-slate-500">
          <div className="w-4 h-4 border-2 border-indigo-300 border-t-indigo-600 rounded-full animate-spin" />
          Analyzing this attempt — this can take up to a minute...
        </div>
      )}

      {state === "error" && (
        <div className="print:hidden text-sm text-red-600">
          {errorMsg}
          <button onClick={runAnalysis} className="ml-3 text-indigo-600 font-medium underline">
            Try again
          </button>
        </div>
      )}

      {state === "done" && result && (
        <div className="space-y-5 animate-fade-slide">
          <p className="text-sm text-slate-700 leading-relaxed"><MathText text={result.overallSummary} /></p>

          {result.mistakePatterns?.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Where you went wrong</h3>
              <div className="space-y-2">
                {result.mistakePatterns.map((m, i) => (
                  <div key={i} className="bg-red-50 border border-red-100 rounded-lg p-3">
                    <div className="text-sm font-medium text-red-800">
                      {m.topic}{" "}
                      <span className="text-xs font-normal text-red-500">
                        ({m.questionsAffected} question{m.questionsAffected === 1 ? "" : "s"})
                      </span>
                    </div>
                    <div className="text-xs text-red-700 mt-1"><MathText text={m.whatWentWrong} /></div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {result.weakTopics?.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Topics to focus on</h3>
              <div className="space-y-2">
                {result.weakTopics.map((w, i) => (
                  <div key={i} className="bg-amber-50 border border-amber-100 rounded-lg p-3">
                    <div className="text-sm font-medium text-amber-800">{w.topic}</div>
                    <div className="text-xs text-amber-700 mt-1"><MathText text={w.why} /></div>
                    <div className="text-xs text-amber-900 mt-1.5">
                      <span className="font-medium">How to fix:</span> <MathText text={w.howToFix} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {result.strongTopics?.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">What's working</h3>
              <div className="space-y-2">
                {result.strongTopics.map((s, i) => (
                  <div key={i} className="bg-emerald-50 border border-emerald-100 rounded-lg p-3">
                    <div className="text-sm font-medium text-emerald-800">{s.topic}</div>
                    <div className="text-xs text-emerald-700 mt-1"><MathText text={s.why} /></div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {result.timeManagement?.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Time management</h3>
              <ul className="list-disc list-inside space-y-1 text-xs text-slate-600">
                {result.timeManagement.map((t, i) => (
                  <li key={i}><MathText text={t} /></li>
                ))}
              </ul>
            </div>
          )}

          {result.focusPlan?.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Your focus plan</h3>
              <ul className="space-y-1.5">
                {result.focusPlan.map((f, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
                    <CheckCircle2 size={14} className="text-indigo-500 mt-0.5 shrink-0" />
                    <MathText text={f} />
                  </li>
                ))}
              </ul>
            </div>
          )}

          {result.questionBreakdown?.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                Every question you missed ({result.questionBreakdown.length})
              </h3>
              <div className="space-y-1.5">
                {result.questionBreakdown.map((q, i) => (
                  <AIQuestionBreakdownCard key={i} q={q} forceExpanded={isPrinting} />
                ))}
              </div>
            </div>
          )}

          <button onClick={runAnalysis} className="print:hidden text-xs text-indigo-600 font-medium">
            Re-run analysis →
          </button>
        </div>
      )}
    </div>
  );
}

// One AI-written entry for a single wrong/skipped question — collapsed to
// topic + one-line summary by default (there can be dozens of these), full
// breakdown (correct answer, the exact formula/concept, the actual worked
// solution) on click. Same collapse-by-default pattern as AnswerReviewCard,
// for the same reason: dozens of always-expanded cards would be a wall, not
// a list. `forceExpanded` overrides the collapsed state for PDF export, so
// the printed report shows every question fully rather than one-line rows.
function AIQuestionBreakdownCard({ q, forceExpanded }) {
  const [expanded, setExpanded] = useState(false);
  const isSkipped = q.status === "skipped";
  const open = expanded || forceExpanded;
  return (
    <div className="border border-slate-200 rounded-lg overflow-hidden">
      <button onClick={() => setExpanded((e) => !e)} className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-slate-50">
        <span
          className={`text-[10px] font-medium px-1.5 py-0.5 rounded shrink-0 ${
            isSkipped ? "bg-slate-100 text-slate-500" : "bg-red-50 text-red-600"
          }`}
        >
          {isSkipped ? "Skipped" : "Incorrect"}
        </span>
        <span className="text-xs text-slate-400 shrink-0">{q.topic}</span>
        <span className="text-sm text-slate-700 truncate flex-1">{q.questionSummary}</span>
        <span className="print:hidden shrink-0">
          {open ? <ChevronUp size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />}
        </span>
      </button>
      {open && (
        <div className="px-3 pb-3 pt-1 space-y-2 text-xs bg-slate-50 border-t border-slate-200">
          <div className="text-slate-500">{q.section}</div>
          <div>
            <span className="font-medium text-slate-600">What went wrong: </span>
            <span className="text-slate-700"><MathText text={q.whatWentWrong} /></span>
          </div>
          <div>
            <span className="font-medium text-slate-600">Correct answer: </span>
            <span className="text-slate-700"><MathText text={q.correctAnswerText} /></span>
          </div>
          <div className="bg-indigo-50 border border-indigo-100 rounded-md p-2">
            <span className="font-medium text-indigo-700">Formula / concept to remember: </span>
            <span className="text-indigo-800"><MathText text={q.keyFormulaOrConcept} /></span>
          </div>
          <div>
            <span className="font-medium text-slate-600">Worked solution: </span>
            <span className="text-slate-700"><MathText text={q.workedSolution} /></span>
          </div>
        </div>
      )}
    </div>
  );
}

// One row of Answer Review — collapsed by default (section, a one-line
// preview of the question, correctness, and time-spent all in one glance),
// expanding to the full question/options/explanation on click. Time is
// folded directly into this row rather than living in its own separate
// section, since "how long did I take on this one" and "did I get this one
// right" are really the same question about the same question.
function AnswerReviewCard({ qq, sectionLabel, qNumber, sel, timeInfo, forceExpanded }) {
  const [expanded, setExpanded] = useState(false);
  const open = expanded || forceExpanded;
  const isCorrect = sel === qq.answer;
  const isSkipped = sel === undefined;
  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden hover:border-slate-300 transition-colors">
      <button onClick={() => setExpanded((e) => !e)} className="w-full flex items-center gap-3 px-4 py-3 text-left">
        <span className="hidden sm:inline text-xs text-slate-400 shrink-0 whitespace-nowrap">
          {sectionLabel} · Q{qNumber}
        </span>
        <span className="sm:hidden text-xs text-slate-400 shrink-0">Q{qNumber}</span>
        <span className="flex-1 min-w-0 text-sm text-slate-700 truncate">
          <MathText text={qq.text} />
        </span>
        <span
          className={`shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-full ${
            isSkipped ? "bg-slate-100 text-slate-500" : isCorrect ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-600"
          }`}
        >
          {isSkipped ? "Skipped" : isCorrect ? "Correct" : "Incorrect"}
        </span>
        <span className={`hidden md:inline-block shrink-0 text-[11px] font-medium px-2 py-0.5 rounded-full border ${timeInfo.cls}`}>
          {timeInfo.label}
        </span>
        <ChevronDown size={16} className={`print:hidden shrink-0 text-slate-400 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="px-5 pb-5 pt-1 border-t border-slate-100 text-left">
          <span className={`md:hidden inline-block mb-3 text-[11px] font-medium px-2 py-0.5 rounded-full border ${timeInfo.cls}`}>
            {timeInfo.label}
          </span>
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
      )}
    </div>
  );
}

// Subject-wise accuracy and the "silly mistakes" heuristic both need the real
// question list (correct answer + which section each question belongs to)
// for every mock in `attempts` — not something the attempt rows carry
// themselves, so this is a one-time fetch per distinct mock, mirroring the
// same pattern Analytics uses for "toughest questions". Powers My Progress's
// exam-wide dashboard (ExamPerformancePanel) — never used on the per-mock
// results screen, which builds its charts straight from in-memory attempt
// data instead (see SectionPerformancePicker above).
function useSectionStats(attempts, mocksIndex) {
  const [sectionAccuracy, setSectionAccuracy] = useState([]);
  const [sillyMistakeCount, setSillyMistakeCount] = useState(0);
  const [statsLoading, setStatsLoading] = useState(true);

  useEffect(() => {
    if (attempts.length === 0) {
      setSectionAccuracy([]);
      setSillyMistakeCount(0);
      setStatsLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setStatsLoading(true);
      const mockIds = [...new Set(attempts.map((a) => a.mockId))];
      const questionMaps = await Promise.all(mockIds.map((id) => loadMockQuestions(id).catch(() => ({}))));
      const qLookup = {}; // qId -> { answer, sectionKey }
      const mockMeta = {}; // mockId -> { mock, qMap }
      mockIds.forEach((mockId, i) => {
        const qMap = questionMaps[i];
        mockMeta[mockId] = { mock: mocksIndex.find((m) => m.id === mockId), qMap };
        Object.entries(qMap).forEach(([sectionKey, list]) => {
          (list || []).forEach((q) => {
            qLookup[q.id] = { answer: q.answer, sectionKey };
          });
        });
      });

      const secAgg = {};
      let sillyCount = 0;
      attempts.forEach((a) => {
        const meta = mockMeta[a.mockId];
        if (!meta?.mock) return;
        const applicableSections = sectionsForMock(meta.mock);
        const perSectionSeconds = (meta.mock.duration / applicableSections.length) * 60;
        Object.entries(a.answers || {}).forEach(([qId, sel]) => {
          const q = qLookup[qId];
          if (!q) return;
          const label = sectionLabel(q.sectionKey);
          if (!secAgg[label]) secAgg[label] = { correct: 0, total: 0 };
          secAgg[label].total += 1;
          const isCorrect = sel === q.answer;
          if (isCorrect) {
            secAgg[label].correct += 1;
            return;
          }
          // A wrong answer given in well under a fair pace for that
          // question reads as a rushed guess, not a content gap — this is
          // an estimate (students don't self-tag guesses), not an exact count.
          const sectionQCount = (meta.qMap[q.sectionKey] || []).length || 1;
          const parTime = perSectionSeconds / sectionQCount;
          const spent = (a.timeSpent || {})[qId] || 0;
          if (spent < parTime * 0.4) sillyCount += 1;
        });
      });

      if (!cancelled) {
        setSectionAccuracy(
          Object.entries(secAgg)
            .map(([label, v]) => ({ label, ...v, accuracy: v.correct / v.total }))
            .sort((a, b) => b.total - a.total)
        );
        setSillyMistakeCount(sillyCount);
        setStatsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempts]);

  return { sectionAccuracy, sillyMistakeCount, statsLoading };
}

// The stat-cards + trend chart + subject-accuracy/donut block — shared
// between My Progress (all of this device's attempts) and the results
// screen's "your performance in this exam" panel (attempts pre-filtered to
// just the exam of the mock just taken). Renders nothing for zero attempts.
function ExamPerformancePanel({ attempts, mocksIndex }) {
  const last8 = attempts.slice(-8);
  const avgScorePct = last8.length
    ? Math.round(last8.reduce((sum, a) => sum + scorePercentFor(a, mocksIndex, accuracyPercentFor(a)), 0) / last8.length)
    : null;
  const avgAccuracyPct = last8.length ? Math.round(last8.reduce((sum, a) => sum + accuracyPercentFor(a), 0) / last8.length) : null;
  const { sectionAccuracy, sillyMistakeCount, statsLoading } = useSectionStats(attempts, mocksIndex);

  if (attempts.length === 0) return null;

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-2xl font-semibold text-slate-800">{attempts.length}</div>
          <div className="text-xs text-slate-500 mt-0.5">Tests taken</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-2xl font-semibold text-slate-800">{avgScorePct === null ? "—" : `${avgScorePct}%`}</div>
          <div className="text-xs text-slate-500 mt-0.5">Avg score (last {last8.length})</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-2xl font-semibold text-slate-800">{avgAccuracyPct === null ? "—" : `${avgAccuracyPct}%`}</div>
          <div className="text-xs text-slate-500 mt-0.5">Avg accuracy (last {last8.length})</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-2xl font-semibold text-slate-800">{statsLoading ? "—" : sillyMistakeCount}</div>
          <div className="text-xs text-slate-500 mt-0.5">Silly mistakes (est.)</div>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-5 mb-4">
        <h2 className="text-sm font-semibold text-slate-700 mb-3">Score &amp; accuracy trend</h2>
        <ProgressTrendChart attempts={attempts} mocksIndex={mocksIndex} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-5 gap-4 mb-4">
        {!statsLoading && sectionAccuracy.length > 0 && (
          <div className="sm:col-span-3 bg-white border border-slate-200 rounded-xl p-5">
            <h2 className="text-sm font-semibold text-slate-700 mb-3">Subject-wise accuracy</h2>
            <SubjectAccuracyChart sectionAccuracy={sectionAccuracy} />
          </div>
        )}
        <div className={`bg-white border border-slate-200 rounded-xl p-5 ${sectionAccuracy.length > 0 ? "sm:col-span-2" : "sm:col-span-5"}`}>
          <h2 className="text-sm font-semibold text-slate-700 mb-1">Correct vs. incorrect vs. skipped</h2>
          <p className="text-xs text-slate-400 mb-2">Across every attempt on this device.</p>
          <AnswerBreakdownDonut attempts={attempts} />
        </div>
      </div>
    </>
  );
}

function ProgressView({ attempts, mocksIndex, onBack, onPractice }) {
  const [progressTab, setProgressTab] = useState(MOCK_TYPES.FULL);
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

  // Full Mock and Sectional Mock are different beasts — a sectional attempt
  // only ever touches one section, so blending the two into one trend/
  // subject-accuracy view makes both harder to read. Split by mock type and
  // give each its own panel instead.
  const fullAttempts = attempts.filter((a) => getMockType(mocksIndex.find((m) => m.id === a.mockId)) === MOCK_TYPES.FULL);
  const sectionalAttempts = attempts.filter((a) => getMockType(mocksIndex.find((m) => m.id === a.mockId)) === MOCK_TYPES.SECTIONAL);

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
            <div className="inline-flex bg-slate-100 rounded-full p-1 mb-4">
              <button
                onClick={() => setProgressTab(MOCK_TYPES.FULL)}
                className={`flex items-center gap-1.5 text-sm font-medium px-4 py-2 rounded-full transition-all duration-300 ${
                  progressTab === MOCK_TYPES.FULL ? "bg-white text-blue-800 shadow-sm" : "text-slate-500 hover:text-slate-700"
                }`}
              >
                Full Mock
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${progressTab === MOCK_TYPES.FULL ? "bg-blue-100 text-blue-700" : "bg-slate-200 text-slate-500"}`}>
                  {fullAttempts.length}
                </span>
              </button>
              <button
                onClick={() => setProgressTab(MOCK_TYPES.SECTIONAL)}
                className={`flex items-center gap-1.5 text-sm font-medium px-4 py-2 rounded-full transition-all duration-300 ${
                  progressTab === MOCK_TYPES.SECTIONAL ? "bg-white text-blue-800 shadow-sm" : "text-slate-500 hover:text-slate-700"
                }`}
              >
                Sectional Mock
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${progressTab === MOCK_TYPES.SECTIONAL ? "bg-blue-100 text-blue-700" : "bg-slate-200 text-slate-500"}`}>
                  {sectionalAttempts.length}
                </span>
              </button>
            </div>

            <div key={progressTab} className="animate-fade-slide mb-6">
              {progressTab === MOCK_TYPES.FULL ? (
                fullAttempts.length > 0 ? (
                  <ExamPerformancePanel attempts={fullAttempts} mocksIndex={mocksIndex} />
                ) : (
                  <div className="bg-white border border-dashed border-slate-200 rounded-xl p-8 text-center text-sm text-slate-400">
                    No Full Mocks attempted yet.
                  </div>
                )
              ) : sectionalAttempts.length > 0 ? (
                <ExamPerformancePanel attempts={sectionalAttempts} mocksIndex={mocksIndex} />
              ) : (
                <div className="bg-white border border-dashed border-slate-200 rounded-xl p-8 text-center text-sm text-slate-400">
                  No Sectional Mocks attempted yet.
                </div>
              )}
            </div>

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

// ============================================================================
// PRACTICE GROUND (student) — a standalone question bank picker + runner,
// separate from mocks entirely (no timer, no fixed question count). Not to
// be confused with WeakTopicPracticeView above, which reuses questions
// already tagged on published mocks — this pulls from the practice_questions
// table admin uploads independently via PracticeBankView.
// ============================================================================
// First step of Practice Ground: pick which of the exam's four sections to
// drill (Quant, Reasoning, English, GA/GS for SSC CGL) — every exam's own
// section list (EXAMS[exam.key].sections), so this scales to GMAT/SNAP's
// own sections automatically without any extra wiring. Always shows all
// four regardless of whether questions exist yet for a given one — the
// next screen handles the "nothing here yet" case, same as Full/Sectional
// Mock cards do when a mock type has zero published tests.
function PracticeGroundSectionPickerView({ exam, onPick, onBack }) {
  const theme = EXAM_THEME[exam.key];
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-100 via-slate-50 to-blue-50">
      <div className={`relative overflow-hidden bg-gradient-to-br ${theme.gradient} text-white px-6 py-10 sm:py-14`}>
        <div className="absolute -right-16 -top-16 w-64 h-64 bg-white/10 rounded-full blur-3xl pointer-events-none" />
        <div className="relative max-w-5xl mx-auto">
          <button onClick={onBack} className="text-sm text-white/80 hover:text-white mb-4 inline-flex items-center gap-1 transition-colors">
            ← Back
          </button>
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-white/15 backdrop-blur flex items-center justify-center shrink-0">
              <BookOpen size={22} />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold">{exam.label} Practice Ground</h1>
              <p className="text-sm text-white/70">Which section do you want to drill?</p>
            </div>
          </div>
        </div>
      </div>

      <main className="max-w-5xl mx-auto px-6 -mt-6 pb-16 relative">
        <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-4">
          {exam.sections.map((s) => (
            <button
              key={s.key}
              onClick={() => onPick(s)}
              className={`group bg-white border border-slate-200 rounded-2xl p-6 text-left shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300 ${theme.ring}`}
            >
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold text-slate-800">{s.label}</h3>
                <span
                  className={`inline-flex items-center justify-center w-8 h-8 rounded-full bg-gradient-to-br ${theme.gradient} text-white group-hover:scale-110 transition-transform`}
                >
                  <ArrowRight size={15} />
                </span>
              </div>
            </button>
          ))}
        </div>
      </main>
    </div>
  );
}

function PracticeGroundPickerView({ exam, section, onStart, onBack }) {
  const [topics, setTopics] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    (async () => {
      setLoaded(false);
      setLoadError(false);
      try {
        setTopics(await loadPracticeTopicSummary(exam.key, section.key));
      } catch {
        setLoadError(true);
      } finally {
        setLoaded(true);
      }
    })();
  }, [exam.key, section.key]);

  const theme = EXAM_THEME[exam.key];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-100 via-slate-50 to-blue-50">
      <div className={`relative overflow-hidden bg-gradient-to-br ${theme.gradient} text-white px-6 py-10 sm:py-14`}>
        <div className="absolute -right-16 -top-16 w-64 h-64 bg-white/10 rounded-full blur-3xl pointer-events-none" />
        <div className="relative max-w-5xl mx-auto">
          <button onClick={onBack} className="text-sm text-white/80 hover:text-white mb-4 inline-flex items-center gap-1 transition-colors">
            ← Back
          </button>
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-white/15 backdrop-blur flex items-center justify-center shrink-0">
              <BookOpen size={22} />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold">{section.label}</h1>
              <p className="text-sm text-white/70">Pick a topic and a difficulty — no timer, go at your own pace.</p>
            </div>
          </div>
        </div>
      </div>

      <main className="max-w-5xl mx-auto px-6 -mt-6 pb-16 relative">
        {!loaded ? (
          <div className="mt-8 text-sm text-slate-400">Loading topics...</div>
        ) : loadError ? (
          <div className="mt-8 text-center bg-red-50 border border-dashed border-red-200 rounded-xl p-10 text-sm text-red-500">
            Couldn't load Practice Ground right now — please try again in a moment.
          </div>
        ) : topics.length === 0 ? (
          <div className="mt-8 text-center bg-white border border-dashed border-slate-300 rounded-xl p-10 text-sm text-slate-400">
            No practice questions have been added for {section.label} yet — check back soon.
          </div>
        ) : (
          <div className="mt-8 space-y-3">
            {topics.map((t) => (
              <div key={t.topic} className="bg-white border border-slate-200 rounded-2xl p-5">
                <h3 className="text-sm font-semibold text-slate-800 mb-3">{t.topic}</h3>
                <div className="flex flex-wrap gap-2">
                  {PRACTICE_DIFFICULTIES.map((d) => {
                    const count = t[d] || 0;
                    return (
                      <button
                        key={d}
                        onClick={() => count > 0 && onStart(t.topic, d)}
                        disabled={count === 0}
                        className={`text-xs font-medium px-3.5 py-2 rounded-full border transition-colors disabled:opacity-40 disabled:cursor-default ${PRACTICE_DIFFICULTY_COLORS[d]}`}
                      >
                        {d} · {count}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

// Practice Ground explanations are uploaded as one JSON string field, so a
// multi-step explanation like "Step 1: ... Step 2: ... Step 3: ... Option C
// is correct." arrives as one unbroken run of text with no real line breaks
// to render. Split it back into readable paragraphs client-side: one per
// "Step N:" marker, and the trailing "Option X is correct." sentence (if
// present) pulled out as its own concluding line.
function formatExplanationParagraphs(text) {
  if (!text) return [];
  const stepSplit = text.split(/(?=Step\s+\d+\s*:)/g).map((s) => s.trim()).filter(Boolean);
  const paragraphs = [];
  stepSplit.forEach((seg) => {
    const match = seg.match(/^(.*?)([.!?])\s*(Option\s+[A-D]\s+is\s+correct\.?)\s*$/i);
    if (match && match[1].trim()) {
      paragraphs.push(`${match[1].trim()}${match[2]}`);
      paragraphs.push(match[3].trim());
    } else {
      paragraphs.push(seg);
    }
  });
  return paragraphs;
}

function PracticeGroundRunView({ examKey, sectionKey, topic, difficulty, onExit }) {
  const studentSession = useStudentSession();
  const [loading, setLoading] = useState(true);
  const [currentDifficulty, setCurrentDifficulty] = useState(difficulty);
  const [coveredDifficulties, setCoveredDifficulties] = useState([difficulty]);
  const [list, setList] = useState([]);
  const [idx, setIdx] = useState(0);
  const [selected, setSelected] = useState(null);
  const [correctCount, setCorrectCount] = useState(0);
  // Counts every question the student has moved past, across every
  // difficulty tier — unlike `idx`, which resets to 0 each time the tier
  // chains up to the next one. This is what both the free-tier gate and the
  // final "X / Y correct" stat need: a running total for the whole session,
  // not just the current tier's list.
  const [totalSeen, setTotalSeen] = useState(0);
  const [done, setDone] = useState(false);
  const [advancing, setAdvancing] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        setList(await loadPracticeQuestions(examKey, sectionKey, topic, difficulty));
      } catch {
        setList([]);
      } finally {
        setLoading(false);
      }
    })();
  }, [examKey, sectionKey, topic, difficulty]);

  function choose(i) {
    if (selected !== null) return;
    setSelected(i);
    if (i === list[idx].answer) setCorrectCount((c) => c + 1);
  }

  // Easy → Medium → Hard happens automatically: finishing the last question
  // of one tier moves straight into the next one instead of stopping, and a
  // tier with nothing uploaded for this topic is skipped rather than ending
  // the session early. Only once every remaining tier is either finished or
  // empty does this actually end the practice session.
  async function next() {
    setTotalSeen((n) => n + 1);
    if (idx < list.length - 1) {
      setIdx((x) => x + 1);
      setSelected(null);
      return;
    }
    setAdvancing(true);
    try {
      let nextTierIdx = PRACTICE_DIFFICULTIES.indexOf(currentDifficulty) + 1;
      while (nextTierIdx < PRACTICE_DIFFICULTIES.length) {
        const nextDifficulty = PRACTICE_DIFFICULTIES[nextTierIdx];
        const nextList = await loadPracticeQuestions(examKey, sectionKey, topic, nextDifficulty);
        if (nextList.length > 0) {
          setCurrentDifficulty(nextDifficulty);
          setCoveredDifficulties((arr) => [...arr, nextDifficulty]);
          setList(nextList);
          setIdx(0);
          setSelected(null);
          return;
        }
        nextTierIdx++;
      }
      setDone(true);
    } finally {
      setAdvancing(false);
    }
  }

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-sm text-slate-400">Loading practice questions...</div>;
  }
  if (list.length === 0) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-center bg-white border border-dashed border-slate-300 rounded-xl p-10 text-sm text-slate-400">
          No questions found for {topic} ({difficulty}) — check back once more are added.
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
          <p className="text-sm text-slate-500 mb-6">
            {correctCount} / {totalSeen} correct · {topic} ({coveredDifficulties.join(" → ")})
          </p>
          <button onClick={onExit} className="text-sm px-5 py-2.5 rounded-lg bg-slate-900 text-white">
            Back to Practice Ground
          </button>
        </div>
      </div>
    );
  }

  // Free tier: FREE_PRACTICE_QUESTIONS_PER_TOPIC questions per topic (summed
  // across every difficulty in this session, not per tier — otherwise
  // chaining into Medium/Hard would silently reset the free count), then the
  // same phone-number gate that guards mocks. Once unlocked, this never
  // shows again for the rest of the account's lifetime, in any topic.
  if (!studentSession?.hasUnlocked && totalSeen >= FREE_PRACTICE_QUESTIONS_PER_TOPIC) {
    return (
      <div className="min-h-screen bg-slate-100">
        <div className="flex justify-center pt-6">
          <button onClick={onExit} className="text-sm text-slate-500">← Exit practice</button>
        </div>
        <PhoneNumberGate />
      </div>
    );
  }

  const q = list[idx];
  const answered = selected !== null;
  const isLastTier = PRACTICE_DIFFICULTIES.indexOf(currentDifficulty) === PRACTICE_DIFFICULTIES.length - 1;
  const isLastQuestionOfTier = idx === list.length - 1;
  const nextLabel = advancing ? "Loading..." : isLastQuestionOfTier && isLastTier ? "Finish practice" : "Next question";
  return (
    <div className="min-h-screen bg-slate-100 flex flex-col items-center py-10 px-4">
      <div className={`w-full transition-all ${answered ? "max-w-5xl" : "max-w-2xl"}`}>
        <div className="flex items-center justify-between mb-3">
          <button onClick={onExit} className="text-sm text-slate-500">← Exit practice</button>
          <span className="text-xs text-slate-400 flex items-center gap-1.5">
            Question {idx + 1} of {list.length} · {topic}
            <span className={`px-1.5 py-0.5 rounded border ${PRACTICE_DIFFICULTY_COLORS[currentDifficulty]}`}>{currentDifficulty}</span>
          </span>
        </div>
        <div className={`grid gap-6 ${answered ? "grid-cols-1 lg:grid-cols-[1fr_340px]" : "grid-cols-1"}`}>
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
          </div>

          {answered && (
            <div className="flex flex-col gap-4">
              {q.explanation && (
                <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5">
                  <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Explanation</div>
                  <div className="space-y-2.5">
                    {formatExplanationParagraphs(q.explanation).map((p, i) => (
                      <p
                        key={i}
                        className={
                          /^Option\s+[A-D]\s+is\s+correct/i.test(p)
                            ? "text-sm font-semibold text-emerald-700"
                            : "text-sm text-slate-600 leading-relaxed"
                        }
                      >
                        <MathText text={p} />
                      </p>
                    ))}
                  </div>
                </div>
              )}
              <button
                onClick={next}
                disabled={advancing}
                className="text-sm px-5 py-2.5 rounded-lg bg-blue-900 text-white font-medium disabled:opacity-60"
              >
                {nextLabel}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StudentApp() {
  const studentSession = useStudentSession();
  const [mocksIndex, setMocksIndex] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [view, setView] = useState("exam"); // 'exam' | 'type' | 'list' | 'instructions' | 'run'
  const [examFilter, setExamFilter] = useState(null); // 'ssc_cgl' | 'gmat'
  const [typeFilter, setTypeFilter] = useState(null); // MOCK_TYPES.FULL | MOCK_TYPES.SECTIONAL
  const [sectionFilter, setSectionFilter] = useState(null); // one of the exam's section keys, sectional mocks only
  const [selectedMock, setSelectedMock] = useState(null);
  const [selectedQuestions, setSelectedQuestions] = useState(null);
  const [attempts, setAttempts] = useState([]);
  const [practiceTopics, setPracticeTopics] = useState(null);
  const [practiceGroundSection, setPracticeGroundSection] = useState(null); // one of exam.sections, chosen first
  const [practiceGroundSelection, setPracticeGroundSelection] = useState(null); // { topic, difficulty }
  const [pendingGatedMock, setPendingGatedMock] = useState(null); // a mock blocked by the free-tier limit, resumed once phone is given
  // Global admin-controlled switch (see PracticeBankView) — hidden by
  // default (and while still loading) so it never flashes on and then
  // disappears; only ever shown once we've confirmed it's actually on.
  const [practiceGroundEnabled, setPracticeGroundEnabledLocal] = useState(false);
  useEffect(() => {
    loadPracticeGroundEnabled()
      .then(setPracticeGroundEnabledLocal)
      .catch(() => {});
  }, []);

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
    if (view !== "exam" && view !== "type" && view !== "list") return;
    const id = setInterval(refreshMocks, 4000);
    return () => clearInterval(id);
  }, [view, refreshMocks]);

  const publishedMocks = mocksIndex.filter((m) => m.status === "published");
  // Every mock created before multi-exam support has no `exam` field and is
  // treated as SSC CGL (see getExamKey) — same rule applies here so old
  // mocks keep showing up exactly where they always did.
  const publishedMocksInExam = examFilter ? publishedMocks.filter((m) => getExamKey(m) === examFilter) : [];
  const fullCount = publishedMocksInExam.filter((m) => getMockType(m) === MOCK_TYPES.FULL).length;
  const sectionalCount = publishedMocksInExam.filter((m) => getMockType(m) === MOCK_TYPES.SECTIONAL).length;
  const listForType = (
    typeFilter === "all" ? publishedMocksInExam : publishedMocksInExam.filter((m) => getMockType(m) === typeFilter)
  )
    .filter((m) => !sectionFilter || m.sectionalKey === sectionFilter)
    .sort((a, b) => a.mockNumber - b.mockNumber);
  // Sectional mocks are grouped by section before showing the list — one
  // more click, but "all sectional mocks of every section mixed together"
  // stops being readable once there's more than a handful of them.
  const sectionCounts = examFilter
    ? EXAMS[examFilter].sections.map((s) => ({
        ...s,
        count: publishedMocksInExam.filter((m) => getMockType(m) === MOCK_TYPES.SECTIONAL && m.sectionalKey === s.key).length,
      }))
    : [];

  function chooseExam(examKey) {
    setExamFilter(examKey);
    setView("type");
  }

  function openPracticeGround() {
    setView("practiceGroundSection");
  }
  function choosePracticeGroundSection(section) {
    setPracticeGroundSection(section);
    setView("practiceGroundPick");
  }
  function backToPracticeGroundSection() {
    setPracticeGroundSection(null);
    setView("practiceGroundSection");
  }
  function startPracticeGround(topic, difficulty) {
    setPracticeGroundSelection({ topic, difficulty });
    setView("practiceGroundRun");
  }
  function exitPracticeGroundRun() {
    setPracticeGroundSelection(null);
    setView("practiceGroundPick");
  }

  function chooseType(type) {
    setTypeFilter(type);
    setSectionFilter(null);
    setView("list");
  }

  function chooseSection(sectionKey) {
    setSectionFilter(sectionKey);
  }

  // "Challenge a friend" from the home page — any published mock in this
  // exam works, so this reuses the same list+instructions+run flow
  // untouched; the only difference is no type filter, and the existing
  // "Create Challenge Link" button already appears on the results screen
  // once they finish it.
  function chooseChallenge() {
    setTypeFilter("all");
    setSectionFilter(null);
    setView("list");
  }

  function backToType() {
    setTypeFilter(null);
    setSectionFilter(null);
    setView("type");
    refreshMocks();
  }

  // From a filtered sectional-mock list back to the "pick a section" step —
  // distinct from backToType, which exits the sectional flow entirely.
  function backToSectionPicker() {
    setSectionFilter(null);
    refreshMocks();
  }

  function backToExam() {
    setExamFilter(null);
    setTypeFilter(null);
    setView("exam");
    refreshMocks();
  }

  // Once the phone-number gate is cleared (hasUnlocked flips true), resume
  // straight into whichever mock triggered it — the student never has to
  // re-click anything after providing their number.
  useEffect(() => {
    if (view === "phoneGate" && pendingGatedMock && studentSession?.hasUnlocked) {
      const mock = pendingGatedMock;
      setPendingGatedMock(null);
      openInstructions(mock);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentSession?.hasUnlocked, view, pendingGatedMock]);

  async function openInstructions(mock) {
    // Free tier: FREE_MOCK_LIMIT distinct mocks per account, then a phone
    // number unlocks the rest permanently. A mock already attempted before
    // never re-triggers this, however many times it's retaken.
    const alreadyAttempted = studentSession?.attemptedMockIds?.has(mock.id);
    const atFreeLimit = (studentSession?.attemptedMockIds?.size || 0) >= FREE_MOCK_LIMIT;
    if (!studentSession?.hasUnlocked && !alreadyAttempted && atFreeLimit) {
      setPendingGatedMock(mock);
      setView("phoneGate");
      return;
    }
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

  if (view === "practiceGroundSection" && examFilter) {
    return (
      <PracticeGroundSectionPickerView
        exam={EXAMS[examFilter] || EXAMS[DEFAULT_EXAM]}
        onPick={choosePracticeGroundSection}
        onBack={() => setView("type")}
      />
    );
  }

  if (view === "practiceGroundPick" && examFilter && practiceGroundSection) {
    return (
      <PracticeGroundPickerView
        exam={EXAMS[examFilter] || EXAMS[DEFAULT_EXAM]}
        section={practiceGroundSection}
        onStart={startPracticeGround}
        onBack={backToPracticeGroundSection}
      />
    );
  }

  if (view === "practiceGroundRun" && practiceGroundSelection && practiceGroundSection) {
    return (
      <PracticeGroundRunView
        examKey={examFilter}
        sectionKey={practiceGroundSection.key}
        topic={practiceGroundSelection.topic}
        difficulty={practiceGroundSelection.difficulty}
        onExit={exitPracticeGroundRun}
      />
    );
  }

  if (view === "phoneGate" && pendingGatedMock) {
    return (
      <div className="min-h-screen bg-slate-50">
        <PhoneNumberGate />
      </div>
    );
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

  if (view === "exam") {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-100 via-slate-50 to-blue-50">
        <div className="relative overflow-hidden bg-gradient-to-br from-blue-950 via-blue-900 to-indigo-900 text-white px-6 py-16 sm:py-20">
          <div className="absolute -right-20 -top-20 w-80 h-80 bg-blue-400/20 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute -left-16 -bottom-20 w-72 h-72 bg-indigo-400/20 rounded-full blur-3xl pointer-events-none" />
          <div className="relative max-w-5xl mx-auto text-center">
            <div className="inline-flex items-center gap-1.5 bg-white/10 backdrop-blur text-blue-100 text-xs font-medium px-3 py-1.5 rounded-full mb-5">
              <Sparkles size={13} /> The 100 Percentiler
            </div>
            <h1 className="text-2xl sm:text-4xl font-bold mb-3">Which exam are you preparing for?</h1>
            <p className="text-sm sm:text-base text-blue-200">
              {publishedMocks.length} mock test{publishedMocks.length === 1 ? "" : "s"} live and ready — pick your exam to get started.
            </p>
          </div>
        </div>

        <main className="max-w-5xl mx-auto px-6 -mt-10 pb-16 relative">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {EXAM_LIST.map((exam) => {
              const theme = EXAM_THEME[exam.key];
              const Icon = theme.icon;
              const count = publishedMocks.filter((m) => getExamKey(m) === exam.key).length;
              return (
                <button
                  key={exam.key}
                  onClick={() => chooseExam(exam.key)}
                  className={`group relative bg-white border border-slate-200 rounded-3xl p-7 text-left shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300 overflow-hidden ${theme.ring}`}
                >
                  <div className={`absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r ${theme.gradient}`} />
                  <div className={`w-12 h-12 rounded-2xl flex items-center justify-center mb-4 ${theme.iconBg}`}>
                    <Icon size={22} />
                  </div>
                  <h2 className="text-lg font-bold text-slate-800 mb-1.5">{exam.label}</h2>
                  <p className="text-sm text-slate-500 mb-5 leading-relaxed">{exam.tagline}</p>
                  <div className="flex flex-wrap gap-1.5 mb-5">
                    {exam.sections.map((s) => (
                      <span key={s.key} className="text-[10px] font-semibold px-2 py-1 rounded-full bg-slate-100 text-slate-500">
                        {s.short}
                      </span>
                    ))}
                  </div>
                  <div className="flex items-center justify-between">
                    <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${theme.badgeBg}`}>
                      {count} test{count === 1 ? "" : "s"} available
                    </span>
                    <span
                      className={`inline-flex items-center justify-center w-8 h-8 rounded-full bg-gradient-to-br ${theme.gradient} text-white group-hover:scale-110 transition-transform`}
                    >
                      <ArrowRight size={15} />
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </main>
      </div>
    );
  }

  if (view === "type") {
    const exam = EXAMS[examFilter] || EXAMS[DEFAULT_EXAM];
    const theme = EXAM_THEME[exam.key];
    const ExamIcon = theme.icon;
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-100 via-slate-50 to-blue-50">
        <div className={`relative overflow-hidden bg-gradient-to-br ${theme.gradient} text-white px-6 py-10 sm:py-14`}>
          <div className="absolute -right-16 -top-16 w-64 h-64 bg-white/10 rounded-full blur-3xl pointer-events-none" />
          <div className="relative max-w-5xl mx-auto">
            <button onClick={backToExam} className="text-sm text-white/80 hover:text-white mb-4 inline-flex items-center gap-1 transition-colors">
              ← Back to exams
            </button>
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-white/15 backdrop-blur flex items-center justify-center shrink-0">
                  <ExamIcon size={22} />
                </div>
                <div>
                  <h1 className="text-xl sm:text-2xl font-bold">{exam.label} Mock Tests</h1>
                  <p className="text-sm text-white/70">{publishedMocksInExam.length} test{publishedMocksInExam.length === 1 ? "" : "s"} available</p>
                </div>
              </div>
              <button
                onClick={openProgress}
                className="flex items-center gap-1.5 text-xs font-medium bg-white/15 backdrop-blur text-white px-3 py-2 rounded-full hover:bg-white/25 transition-colors"
              >
                <TrendingUp size={13} /> My Progress
              </button>
            </div>
          </div>
        </div>

        <main className="max-w-5xl mx-auto px-6 -mt-6 pb-16 relative">
          <p className="text-sm text-slate-500 mb-5 mt-8">What would you like to practice?</p>
          <div className={`grid grid-cols-1 sm:grid-cols-2 gap-5 mb-5 ${practiceGroundEnabled ? "lg:grid-cols-3" : ""}`}>
            <TypeSelectCard type={MOCK_TYPES.FULL} count={fullCount} onSelect={chooseType} exam={exam} />
            <TypeSelectCard type={MOCK_TYPES.SECTIONAL} count={sectionalCount} onSelect={chooseType} exam={exam} />
            {practiceGroundEnabled && (
            <button
              onClick={openPracticeGround}
              className={`group relative bg-white border border-slate-200 rounded-3xl p-7 text-left shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300 overflow-hidden ${theme.ring}`}
            >
              <div className={`absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r ${theme.gradient}`} />
              <div className={`w-12 h-12 rounded-2xl flex items-center justify-center mb-4 ${theme.iconBg}`}>
                <BookOpen size={22} />
              </div>
              <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold mb-2 ${theme.badgeBg}`}>PRACTICE</span>
              <h2 className="text-lg font-bold text-slate-800 mb-1.5">Practice Ground</h2>
              <p className="text-sm text-slate-500 mb-5 leading-relaxed">
                Pick one topic — like Trigonometry — and drill it at Easy, Medium, or Hard. No timer, no pressure.
              </p>
              <div className="flex items-center justify-between">
                <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${theme.badgeBg}`}>Untimed</span>
                <span
                  className={`inline-flex items-center justify-center w-8 h-8 rounded-full bg-gradient-to-br ${theme.gradient} text-white group-hover:scale-110 transition-transform`}
                >
                  <ArrowRight size={15} />
                </span>
              </div>
            </button>
            )}
          </div>

          <button
            onClick={chooseChallenge}
            className={`group w-full bg-gradient-to-r ${theme.gradient} text-white rounded-3xl p-8 text-left hover:shadow-xl hover:-translate-y-1 transition-all duration-300 relative overflow-hidden`}
          >
            <div className="absolute -right-10 -top-10 w-40 h-40 bg-white/10 rounded-full blur-2xl pointer-events-none" />
            <div className="relative">
              <div className="flex items-center gap-2 mb-3">
                <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold bg-white/20">1v1</span>
                <span
                  title="Take any mock, then send the link to a friend. Once they finish it too, you'll both be able to see a full side-by-side answer sheet — every question, both people's answers, and how much time each of you took."
                  className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-white/20 text-white text-[10px] font-bold cursor-help"
                >
                  i
                </span>
              </div>
              <h2 className="text-lg font-bold mb-1 flex items-center gap-2">
                <Swords size={18} /> Challenge a Friend
              </h2>
              <p className="text-sm text-white/80">
                Take any mock, then challenge a friend to beat your score — see exactly how you each did, question by question.
              </p>
              <span className="inline-flex items-center gap-1 mt-4 text-sm font-medium group-hover:gap-2 transition-all">
                Get started <ArrowRight size={15} />
              </span>
            </div>
          </button>
        </main>
      </div>
    );
  }

  // Sectional Mock, section not chosen yet — pick a section first, so the
  // list a student sees is only ever one section's mocks, not every
  // section's mocks mixed together.
  if (typeFilter === MOCK_TYPES.SECTIONAL && !sectionFilter) {
    const exam = EXAMS[examFilter] || EXAMS[DEFAULT_EXAM];
    const theme = EXAM_THEME[exam.key];
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-100 via-slate-50 to-blue-50">
        <div className={`relative overflow-hidden bg-gradient-to-br ${theme.gradient} text-white px-6 py-10 sm:py-14`}>
          <div className="absolute -right-16 -top-16 w-64 h-64 bg-white/10 rounded-full blur-3xl pointer-events-none" />
          <div className="relative max-w-5xl mx-auto">
            <button onClick={backToType} className="text-sm text-white/80 hover:text-white mb-4 inline-flex items-center gap-1 transition-colors">
              ← Back
            </button>
            <h1 className="text-xl sm:text-2xl font-bold mb-1">Sectional Mocks</h1>
            <p className="text-sm text-white/70">Pick a section to practice</p>
          </div>
        </div>
        <main className="max-w-5xl mx-auto px-6 -mt-6 pb-16 relative">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 mt-8">
            {sectionCounts.map((s) => (
              <button
                key={s.key}
                onClick={() => chooseSection(s.key)}
                disabled={s.count === 0}
                className={`group relative bg-white border border-slate-200 rounded-3xl p-6 text-left shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300 overflow-hidden disabled:opacity-40 disabled:hover:shadow-sm disabled:hover:translate-y-0 ${theme.ring}`}
              >
                <div className={`absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r ${theme.gradient}`} />
                <h2 className="text-base font-bold text-slate-800 mb-3">{s.label}</h2>
                <div className="flex items-center justify-between">
                  <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${theme.badgeBg}`}>
                    {s.count} test{s.count === 1 ? "" : "s"} available
                  </span>
                  <span
                    className={`inline-flex items-center justify-center w-8 h-8 rounded-full bg-gradient-to-br ${theme.gradient} text-white group-hover:scale-110 transition-transform`}
                  >
                    <ArrowRight size={15} />
                  </span>
                </div>
              </button>
            ))}
          </div>
        </main>
      </div>
    );
  }

  // view === 'list' — only mocks of the chosen type (and, for Sectional, the
  // chosen section)
  {
    const exam = EXAMS[examFilter] || EXAMS[DEFAULT_EXAM];
    const theme = EXAM_THEME[exam.key];
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-100 via-slate-50 to-blue-50">
        <div className={`relative overflow-hidden bg-gradient-to-br ${theme.gradient} text-white px-6 py-10 sm:py-14`}>
          <div className="absolute -right-16 -top-16 w-64 h-64 bg-white/10 rounded-full blur-3xl pointer-events-none" />
          <div className="relative max-w-5xl mx-auto">
            <button
              onClick={typeFilter === MOCK_TYPES.SECTIONAL ? backToSectionPicker : backToType}
              className="text-sm text-white/80 hover:text-white mb-4 inline-flex items-center gap-1 transition-colors"
            >
              ← Back
            </button>
            <h1 className="text-xl sm:text-2xl font-bold mb-1">
              {typeFilter === "all"
                ? "Pick a mock to challenge a friend"
                : typeFilter === MOCK_TYPES.SECTIONAL
                ? `Sectional Mocks — ${sectionLabel(sectionFilter)}`
                : "Full Mocks"}
            </h1>
            <p className="text-sm text-white/70">{listForType.length} test{listForType.length === 1 ? "" : "s"} available</p>
          </div>
        </div>

        <main className="max-w-5xl mx-auto px-6 -mt-6 pb-16 relative">
          {typeFilter === "all" && listForType.length > 0 && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-2.5 text-xs text-blue-800 mb-4 mt-8">
              Take any test below, then use "Create Challenge Link" on your results screen to send it to a friend.
            </div>
          )}
          {listForType.length === 0 ? (
            <div className="bg-white border border-dashed border-slate-200 rounded-xl p-12 text-center text-sm text-slate-400 mt-8">
              No {typeFilter === MOCK_TYPES.SECTIONAL ? "sectional" : typeFilter === MOCK_TYPES.FULL ? "full" : ""} tests are available right now — check back soon.
            </div>
          ) : (
            <div className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 ${typeFilter === "all" ? "" : "mt-8"}`}>
              {listForType.map((m) => (
                <StudentMockCard key={m.id} mock={m} onStart={openInstructions} />
              ))}
            </div>
          )}
        </main>
      </div>
    );
  }
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
// ============================================================================
// STUDENT ACCOUNTS — Google sign-in required for anything on the student
// side (ChallengeFlow is the one exception, left open on purpose: it's a
// friend-invite link, and gating that behind a login would kill the viral
// loop it exists for). Free tier: FREE_MOCK_LIMIT distinct mocks and
// FREE_PRACTICE_QUESTIONS_PER_TOPIC questions per Practice Ground topic —
// beyond either, a one-time phone number (collected, not OTP-verified: see
// [[project ... auth]] memory for why) unlocks everything for that account
// permanently. student_profiles is the one new table this needs; attempts
// gained a nullable user_id alongside its existing device_id so this can
// count a student's real distinct-mock history regardless of device.
// ============================================================================
const FREE_MOCK_LIMIT = 3;
const FREE_PRACTICE_QUESTIONS_PER_TOPIC = 3;

const StudentSessionContext = createContext(null);
function useStudentSession() {
  return useContext(StudentSessionContext);
}

// Shown inline wherever a student hits the free-tier ceiling. Not OTP-verified
// — collected as plain text, purely for the admin's own outreach/marketing
// list (see the "Leads" admin panel) — verifying it would mean paying for
// SMS delivery, which this app otherwise deliberately avoids everywhere else.
function PhoneNumberGate() {
  const { saveMyPhoneNumber } = useStudentSession();
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    const digitsOnly = phone.replace(/[\s()+-]/g, "");
    if (!/^\d{7,15}$/.test(digitsOnly)) {
      setError("Enter a valid phone number.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await saveMyPhoneNumber(phone.trim());
    } catch {
      setError("Couldn't save that — please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-[60vh] flex items-center justify-center p-6">
      <div className="max-w-sm w-full bg-white border border-slate-200 rounded-2xl shadow-sm p-8 text-center">
        <div className="w-12 h-12 rounded-2xl bg-blue-50 flex items-center justify-center mx-auto mb-4">
          <Lock size={20} className="text-blue-700" />
        </div>
        <h2 className="text-lg font-semibold text-slate-800 mb-5">Sign up with your phone number to continue</h2>
        <form onSubmit={handleSubmit}>
          <input
            type="tel"
            autoFocus
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="Phone number"
            className="w-full text-sm border border-slate-200 rounded-md px-3 py-2.5 mb-3 text-center"
          />
          {error && <p className="text-xs text-red-600 mb-3">{error}</p>}
          <button
            type="submit"
            disabled={saving}
            className="w-full bg-blue-900 text-white text-sm font-medium rounded-lg py-2.5 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Continue"}
          </button>
        </form>
      </div>
    </div>
  );
}

// Cursor-reactive geometric background for the sign-in screen — purely
// decorative, built entirely in CSS (no animation library). Mouse position
// is written straight onto the container's CSS custom properties via a ref
// on every mousemove, not through React state, so this never triggers a
// re-render no matter how fast the cursor moves. Each shape is wrapped in
// two layers: an outer div whose transform comes from those `--mx`/`--my`
// vars scaled by its own `--depth` (parallax — shapes "closer" to the
// viewer drift further), and an inner div carrying a constant slow
// float/rotate/pulse keyframe animation, so the ambient motion and the
// cursor-driven motion never fight over the same `transform` property.
// Every shape is also directly hoverable (see .geo-shape in index.css) for
// an immediate reaction, not just an approximated proximity effect.
// Real content for the sign-in screen's first impression — a punchy hero
// built entirely from features that actually exist in the product (no
// syllabus-topic listing here anymore; that read as cluttered and forced a
// second row of cards below the fold). Every chip below maps to a real,
// shipped capability — nothing here is a stat or a feature we haven't built.
function SSCSyllabusShowcase() {
  const features = [
    { icon: Clock, label: "Real Exam-Pattern Mocks" },
    { icon: BarChart2, label: "AI Performance Analysis" },
    { icon: BookOpen, label: "Topic-wise Practice" },
    { icon: Trophy, label: "Leaderboard & Streaks" },
  ];

  return (
    <div className="order-2 lg:order-1 relative z-10">
      <img src={logoImg} alt="100 Percentiler" className="h-16 sm:h-20 w-auto mb-5" />

      <div className="flex items-center gap-2 text-blue-300/70 text-xs font-semibold uppercase tracking-widest mb-4">
        <span>Practice</span><ArrowRight size={12} />
        <span>Analyze</span><ArrowRight size={12} />
        <span>Improve</span><ArrowRight size={12} />
        <span className="text-blue-200">Succeed</span>
      </div>

      <div className="inline-flex items-center gap-1.5 bg-white/10 backdrop-blur text-blue-100 text-xs font-semibold uppercase tracking-wider px-3 py-1.5 rounded-full mb-5">
        <GraduationCap size={14} /> Built exclusively for SSC CGL
      </div>
      <h1
        className="text-4xl sm:text-5xl font-extrabold text-white leading-tight mb-4"
        style={{ textShadow: "0 0 40px rgba(96,165,250,0.35)" }}
      >
        Not Just Mock Tests.<br />
        <span className="bg-gradient-to-r from-sky-300 via-blue-300 to-indigo-300 bg-clip-text text-transparent">AI-Powered</span> Exam Prep.
      </h1>
      <p className="text-base text-blue-200/80 max-w-md mb-7">
        Real exam-pattern mocks, topic-wise practice mapped to the actual syllabus, and deep performance
        analysis after every attempt — all in one place.
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 max-w-lg">
        {features.map((f) => (
          <div
            key={f.label}
            className="flex flex-col items-center text-center gap-2 bg-blue-950/40 backdrop-blur border border-blue-400/20 rounded-xl px-2 py-4 hover:border-blue-300/60 hover:shadow-[0_0_20px_rgba(59,130,246,0.35)] transition-all duration-300"
          >
            <div className="w-10 h-10 rounded-full bg-blue-500/10 border border-blue-400/30 flex items-center justify-center">
              <f.icon size={18} className="text-blue-300" />
            </div>
            <span className="text-xs text-blue-100/90 leading-tight">{f.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Shape defs — visual size/kind/ambient-flavor only. Position and velocity
// are physics state (see the effect below) and deliberately never touch
// React state: they're mutated in a ref and written straight to each node's
// `transform` every animation frame, the same "skip the render cycle for
// 60fps motion" trick the old cursor-parallax version used.
const GEO_SHAPE_DEFS = [
  { size: 90, kind: "ring", anim: "geo-spin-slow" },
  { size: 60, kind: "triangle", anim: "geo-spin-slow" },
  { size: 70, kind: "hexagon", anim: "geo-spin-slow-rev" },
  { size: 46, kind: "diamond", anim: "geo-pulse" },
  { size: 22, kind: "dot", anim: "geo-pulse" },
  { size: 18, kind: "dot", anim: "geo-pulse" },
  { size: 14, kind: "dot", anim: "geo-pulse" },
  { size: 50, kind: "ring", anim: "geo-spin-slow-rev" },
  { size: 40, kind: "triangle", anim: "geo-spin-slow" },
  { size: 110, kind: "ring", anim: "geo-pulse" },
  { size: 34, kind: "hexagon", anim: "geo-spin-slow-rev" },
  { size: 26, kind: "diamond", anim: "geo-pulse" },
  { size: 16, kind: "dot", anim: "geo-pulse" },
  { size: 20, kind: "dot", anim: "geo-pulse" },
  { size: 56, kind: "triangle", anim: "geo-spin-slow-rev" },
  { size: 30, kind: "ring", anim: "geo-spin-slow" },
];

function renderGeoShape(kind) {
  if (kind === "ring") {
    return <div className="geo-shape w-full h-full rounded-full border-2 border-blue-300/40" />;
  }
  if (kind === "dot") {
    return <div className="geo-shape w-full h-full rounded-full bg-blue-200/50" />;
  }
  if (kind === "diamond") {
    return <div className="geo-shape w-full h-full border-2 border-indigo-200/40" style={{ transform: "rotate(45deg)" }} />;
  }
  if (kind === "triangle") {
    // Border + clip-path clips the whole box (border included), which
    // only leaves fragments of the outline visible rather than a clean
    // triangle — an SVG stroke with no fill draws the actual outline.
    return (
      <svg viewBox="0 0 100 100" className="geo-shape w-full h-full">
        <polygon points="50,4 4,96 96,96" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-sky-200/40" />
      </svg>
    );
  }
  if (kind === "hexagon") {
    return (
      <svg viewBox="0 0 100 100" className="geo-shape w-full h-full">
        <polygon
          points="25,4 75,4 96,50 75,96 25,96 4,50"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          className="text-indigo-200/40"
        />
      </svg>
    );
  }
  return null;
}

// A handful of large, softly blurred color blobs that drift slowly in the
// background for atmosphere — pure CSS, no JS, never touched by the physics
// loop below.
const GEO_ORBS = [
  { top: "5%", left: "8%", size: 260, color: "rgba(56,130,246,0.28)", delay: "0s" },
  { top: "55%", right: "6%", size: 320, color: "rgba(99,102,241,0.25)", delay: "-7s" },
  { bottom: "8%", left: "30%", size: 220, color: "rgba(56,189,248,0.22)", delay: "-14s" },
];

function GeoStarField() {
  // Positions are random per mount but never move — only opacity/scale
  // twinkle via CSS, so this needs no physics and costs nothing per frame.
  const stars = useRef(
    Array.from({ length: 35 }, () => ({
      top: `${Math.random() * 100}%`,
      left: `${Math.random() * 100}%`,
      size: 1 + Math.random() * 2,
      duration: 2 + Math.random() * 3,
      delay: -Math.random() * 5,
    }))
  ).current;
  return (
    <>
      {stars.map((s, i) => (
        <div
          key={i}
          className="geo-star"
          style={{
            top: s.top,
            left: s.left,
            width: s.size,
            height: s.size,
            animationDuration: `${s.duration}s`,
            animationDelay: `${s.delay}s`,
          }}
        />
      ))}
    </>
  );
}

// The sign-in screen's "hyper-interactive" backdrop: a field of geometric
// outline shapes that drift under real 2D physics — they carry momentum,
// bounce elastically off the container walls and off each other (equal-mass
// elastic collision: swap the velocity component along the line connecting
// the two centers, then push them apart so they don't overlap), and get
// shoved away from the cursor like a repulsion field. All of this runs in a
// single requestAnimationFrame loop that writes directly to each shape's
// `style.transform` — never through React state — so 60fps motion never
// triggers a re-render.
function GeometricSignInBackground() {
  const containerRef = useRef(null);
  const shapeElsRef = useRef([]);
  const physicsRef = useRef([]);
  const cursorRef = useRef({ x: -9999, y: -9999 });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    let width = rect.width || 1;
    let height = rect.height || 1;

    physicsRef.current = GEO_SHAPE_DEFS.map((d) => {
      const r = d.size / 2;
      return {
        x: r + Math.random() * Math.max(width - d.size, 1),
        y: r + Math.random() * Math.max(height - d.size, 1),
        vx: (Math.random() - 0.5) * 50,
        vy: (Math.random() - 0.5) * 50,
        r,
      };
    });

    function paint() {
      physicsRef.current.forEach((s, i) => {
        const el = shapeElsRef.current[i];
        if (el) el.style.transform = `translate3d(${(s.x - s.r).toFixed(1)}px, ${(s.y - s.r).toFixed(1)}px, 0)`;
      });
    }
    paint();

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return; // Static field, no motion — respected up front, no rAF loop at all.
    }

    function handleMouseMove(e) {
      const r = container.getBoundingClientRect();
      cursorRef.current = { x: e.clientX - r.left, y: e.clientY - r.top };
    }
    function handleMouseLeave() {
      cursorRef.current = { x: -9999, y: -9999 };
    }
    function handleResize() {
      const r = container.getBoundingClientRect();
      width = r.width || 1;
      height = r.height || 1;
    }
    container.addEventListener("mousemove", handleMouseMove);
    container.addEventListener("mouseleave", handleMouseLeave);
    window.addEventListener("resize", handleResize);

    let last = performance.now();
    let rafId;

    function tick(now) {
      const dt = Math.min((now - last) / 1000, 0.05); // clamp so a stalled tab can't fling shapes
      last = now;
      const shapes = physicsRef.current;
      const cursor = cursorRef.current;
      const REPEL_RADIUS = 150;
      const MIN_SPEED = 10;

      for (const s of shapes) {
        const dxCursor = s.x - cursor.x;
        const dyCursor = s.y - cursor.y;
        const distCursor = Math.hypot(dxCursor, dyCursor);
        if (distCursor < REPEL_RADIUS) {
          const force = (1 - distCursor / REPEL_RADIUS) * 1100;
          const nx = distCursor === 0 ? 1 : dxCursor / distCursor;
          const ny = distCursor === 0 ? 0 : dyCursor / distCursor;
          s.vx += nx * force * dt;
          s.vy += ny * force * dt;
        }

        s.x += s.vx * dt;
        s.y += s.vy * dt;

        // Elastic wall bounce, clamped back inside so high speed can't tunnel through.
        if (s.x - s.r < 0) { s.x = s.r; s.vx = Math.abs(s.vx); }
        if (s.x + s.r > width) { s.x = width - s.r; s.vx = -Math.abs(s.vx); }
        if (s.y - s.r < 0) { s.y = s.r; s.vy = Math.abs(s.vy); }
        if (s.y + s.r > height) { s.y = height - s.r; s.vy = -Math.abs(s.vy); }

        // Light drag so a cursor shove settles instead of building forever.
        s.vx *= 0.997;
        s.vy *= 0.997;

        const speed = Math.hypot(s.vx, s.vy);
        if (speed < MIN_SPEED) {
          const boost = MIN_SPEED / (speed || 1);
          s.vx *= boost;
          s.vy *= boost;
        }
      }

      // Pairwise elastic collisions — equal-mass swap of the normal velocity
      // component, then separate any overlap along that same normal.
      for (let i = 0; i < shapes.length; i++) {
        for (let j = i + 1; j < shapes.length; j++) {
          const a = shapes[i], b = shapes[j];
          const dx = b.x - a.x, dy = b.y - a.y;
          const dist = Math.hypot(dx, dy) || 0.0001;
          const minDist = a.r + b.r;
          if (dist < minDist) {
            const nx = dx / dist, ny = dy / dist;
            const relVelAlongNormal = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
            if (relVelAlongNormal > 0) {
              a.vx -= relVelAlongNormal * nx;
              a.vy -= relVelAlongNormal * ny;
              b.vx += relVelAlongNormal * nx;
              b.vy += relVelAlongNormal * ny;
            }
            const overlap = (minDist - dist) / 2;
            a.x -= nx * overlap; a.y -= ny * overlap;
            b.x += nx * overlap; b.y += ny * overlap;
          }
        }
      }

      paint();
      rafId = requestAnimationFrame(tick);
    }
    rafId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafId);
      container.removeEventListener("mousemove", handleMouseMove);
      container.removeEventListener("mouseleave", handleMouseLeave);
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  return (
    <div ref={containerRef} className="absolute inset-0 overflow-hidden pointer-events-none">
      {GEO_ORBS.map((o, i) => (
        <div
          key={i}
          className="geo-orb"
          style={{ top: o.top, left: o.left, right: o.right, bottom: o.bottom, width: o.size, height: o.size, background: o.color, animationDelay: o.delay }}
        />
      ))}
      <GeoStarField />
      {GEO_SHAPE_DEFS.map((d, i) => (
        <div
          key={i}
          ref={(el) => (shapeElsRef.current[i] = el)}
          className="absolute top-0 left-0 pointer-events-auto will-change-transform"
          style={{ width: d.size, height: d.size }}
        >
          <div className={d.anim} style={{ width: "100%", height: "100%" }}>
            {renderGeoShape(d.kind)}
          </div>
        </div>
      ))}
    </div>
  );
}

function StudentGate({ children }) {
  const [session, setSession] = useState(undefined); // undefined = checking, null = signed out
  const [profile, setProfile] = useState(null);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [attemptedMockIds, setAttemptedMockIds] = useState(new Set());

  useEffect(() => {
    getSession().then(setSession);
    return onAuthStateChange(setSession);
  }, []);

  useEffect(() => {
    if (!session) return;
    (async () => {
      const p = await ensureStudentProfile(session.user.id, session.user.email);
      setProfile(p);
      setProfileLoaded(true);
      setAttemptedMockIds(new Set(await loadDistinctMockIdsTakenByUser(session.user.id)));
    })();
  }, [session]);

  async function saveMyPhoneNumber(phone) {
    await saveStudentPhoneNumber(session.user.id, phone);
    setProfile((p) => ({ ...p, phoneNumber: phone }));
  }

  async function refreshAttemptedMockIds() {
    if (!session) return;
    setAttemptedMockIds(new Set(await loadDistinctMockIdsTakenByUser(session.user.id)));
  }

  if (session === undefined) {
    return <div className="min-h-screen flex items-center justify-center text-sm text-slate-400">Loading...</div>;
  }

  if (!session) {
    return (
      <div className="geo-bg-gradient relative min-h-screen lg:h-screen overflow-hidden">
        <GeometricSignInBackground />
        <img
          src={heroCharacter}
          alt=""
          aria-hidden="true"
          className="hidden lg:block absolute right-[3%] bottom-0 h-[85vh] object-contain object-bottom pointer-events-none select-none"
          style={{ filter: "drop-shadow(0 0 60px rgba(56,130,246,0.5))" }}
        />
        <div className="relative min-h-screen lg:h-full flex items-center justify-center p-6 py-8">
          <div className="relative w-full max-w-5xl grid grid-cols-1 lg:grid-cols-[1.15fr_0.85fr] gap-8 items-center">
            <SSCSyllabusShowcase />
            <div className="order-1 lg:order-2 relative z-10 animate-fade-slide max-w-md w-full mx-auto lg:mx-0 bg-blue-950/60 backdrop-blur-md rounded-2xl p-8 text-center shadow-2xl shadow-blue-950/70 border border-blue-400/25">
              <div className="inline-flex items-center gap-1.5 bg-blue-500/15 text-blue-200 border border-blue-400/30 text-xs font-medium px-3 py-1.5 rounded-full mb-5">
                <Sparkles size={14} /> The 100 Percentiler
              </div>
              <h1 className="text-2xl font-semibold text-white mb-2">Welcome back</h1>
              <p className="text-base text-blue-200/80 mb-6">Sign in with Google to take mock tests and practice questions.</p>
              <button
                onClick={() => signInWithGoogle()}
                className="w-full flex items-center justify-center gap-2 bg-white border border-white/50 text-slate-700 text-base font-medium rounded-lg py-3 hover:shadow-[0_0_20px_rgba(255,255,255,0.4)] hover:-translate-y-0.5 transition-all"
              >
                Continue with Google
              </button>
              <div className="flex items-center justify-center gap-5 mt-6 pt-5 border-t border-blue-400/15">
                <div className="flex flex-col items-center gap-1.5 text-blue-300/70">
                  <Zap size={17} />
                  <span className="text-[11px] leading-tight text-center">Fast<br />&amp; Secure</span>
                </div>
                <div className="flex flex-col items-center gap-1.5 text-blue-300/70">
                  <ShieldCheck size={17} />
                  <span className="text-[11px] leading-tight text-center">Data Stays<br />Private</span>
                </div>
                <div className="flex flex-col items-center gap-1.5 text-blue-300/70">
                  <MousePointerClick size={17} />
                  <span className="text-[11px] leading-tight text-center">One-Click<br />Access</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!profileLoaded) {
    return <div className="min-h-screen flex items-center justify-center text-sm text-slate-400">Loading...</div>;
  }

  return (
    <StudentSessionContext.Provider
      value={{
        userId: session.user.id,
        email: session.user.email,
        phoneNumber: profile?.phoneNumber || null,
        hasUnlocked: !!profile?.phoneNumber,
        attemptedMockIds,
        refreshAttemptedMockIds,
        saveMyPhoneNumber,
      }}
    >
      {children}
    </StudentSessionContext.Provider>
  );
}

function AdminGate({ children }) {
  const [session, setSession] = useState(undefined); // undefined = checking, null = signed out
  const [isAdmin, setIsAdmin] = useState(undefined); // undefined = checking, null/false = not admin
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    getSession().then(setSession);
    return onAuthStateChange(setSession);
  }, []);

  // A valid Supabase session no longer means "is the admin" now that
  // students also get real accounts via Google sign-in — every session gets
  // checked against the admins table before anything renders.
  useEffect(() => {
    if (!session) {
      setIsAdmin(session === null ? false : undefined);
      return;
    }
    setIsAdmin(undefined);
    checkIsAdmin(session.user.id)
      .then(setIsAdmin)
      .catch(() => setIsAdmin(false));
  }, [session]);

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

  if (session === undefined || (session && isAdmin === undefined)) {
    return <div className="min-h-screen flex items-center justify-center text-sm text-slate-400">Loading...</div>;
  }

  if (session && isAdmin) return children;

  if (session && !isAdmin) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-6">
        <div className="bg-white rounded-2xl p-8 max-w-sm w-full text-center">
          <h1 className="text-lg font-semibold text-slate-800 mb-1">Not an admin account</h1>
          <p className="text-sm text-slate-500 mb-5">This Google account isn't authorized for admin access.</p>
          <button onClick={signOut} className="text-sm px-4 py-2 rounded-md border border-slate-200 text-slate-600">
            Sign out
          </button>
        </div>
      </div>
    );
  }

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
              Go to Mock Tests
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
              Go to Mock Tests
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
    return (
      <RunMockView mock={mock} questions={questions} onExit={() => (window.location.href = "/")} challengeId={code} />
    );
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
  return (
    <StudentGate>
      <StudentApp />
    </StudentGate>
  );
}

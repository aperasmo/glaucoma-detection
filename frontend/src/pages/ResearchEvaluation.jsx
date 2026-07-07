// src/pages/ResearchEvaluation.jsx
// Blind LLM evaluation scoring page - Research feature for Paper 2.
// Only accessible to users with is_researcher === true.
// NEVER shows actual_llm - letters are identified by label only (A/B/C/D).

import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import Layout from "../components/Layout";
import API from "../api/index";

const SCENARIO_LABELS = {
  1: "High confidence + OHTS Critical",
  2: "Low confidence + OHTS Critical",
  3: "High confidence + OHTS Low",
  4: "High confidence + No OHTS",
  7: "False Positive - model predicted glaucoma, ground truth normal",
};

function AutoScoreRow({ label, value }) {
  const isPass = value === 1;
  return (
    <div className="flex items-center justify-between py-2 border-b border-white/7 last:border-0">
      <span className="text-xs text-text2">{label}</span>
      <span className={`text-sm font-semibold ${isPass ? "text-pos" : "text-neg"}`}>
        {isPass ? "✓" : "✗"}
      </span>
    </div>
  );
}

function ResearchEvaluation() {
  const navigate = useNavigate();

  const [letters, setLetters]       = useState([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [scoring, setScoring]       = useState(false);
  const [scoreMessage, setScoreMessage] = useState(null);
  const [total, setTotal]           = useState(0);
  const [scoredCount, setScoredCount] = useState(0);

  useEffect(() => {
    API.get("/evaluation/letters")
      .then(res => {
        const data = res.data;
        const list = data.letters || [];
        setLetters(list);
        setTotal(data.total || 0);
        setScoredCount(data.scored_count || 0);
        // Jump to first unscored on load
        const firstUnscored = list.findIndex(l => !l.is_scored);
        setCurrentIndex(firstUnscored === -1 ? 0 : firstUnscored);
        setLoading(false);
      })
      .catch(() => {
        setError("Failed to load evaluation letters.");
        setLoading(false);
      });
  }, []);

  const current = letters[currentIndex] || null;

  function jumpToFirstUnscored() {
    const idx = letters.findIndex(l => !l.is_scored);
    if (idx !== -1) setCurrentIndex(idx);
    else setScoreMessage("All letters have been scored.");
  }

  function goNext() {
    if (currentIndex < letters.length - 1) setCurrentIndex(prev => prev + 1);
  }

  function goPrev() {
    if (currentIndex > 0) setCurrentIndex(prev => prev - 1);
  }

  async function handleScore(score) {
    if (!current || scoring) return;
    setScoring(true);
    setScoreMessage(null);
    try {
      await API.post("/evaluation/score", {
        case_id:              current.case_id,
        label:                current.label,
        d5_professional_tone: score,
      });

      // Update local state so no refetch needed
      const updated = letters.map((l, i) =>
        i === currentIndex ? { ...l, is_scored: true, d5_score: score } : l
      );
      setLetters(updated);
      setScoredCount(prev => current.is_scored ? prev : prev + 1);

      // Auto-advance to next unscored
      const nextUnscored = updated.findIndex((l, i) => i > currentIndex && !l.is_scored);
      if (nextUnscored !== -1) {
        setTimeout(() => setCurrentIndex(nextUnscored), 400);
      } else {
        setScoreMessage("All remaining letters scored. Great work!");
      }
    } catch {
      setScoreMessage("Failed to save score. Please try again.");
    } finally {
      setScoring(false);
    }
  }

  const progressPct = total > 0 ? Math.round((scoredCount / total) * 100) : 0;

  const actions = (
    <button
      onClick={jumpToFirstUnscored}
      className="px-3 py-1.5 text-xs text-text2 border border-white/12 rounded-lg bg-transparent hover:bg-white/5 transition-colors cursor-pointer font-sans"
    >
      → Jump to first unscored
    </button>
  );

  if (loading) return (
    <Layout title="LLM Evaluation" actions={actions}>
      <p className="text-text3 text-sm">Loading letters...</p>
    </Layout>
  );

  if (error) return (
    <Layout title="LLM Evaluation" actions={actions}>
      <p className="text-neg text-sm">{error}</p>
    </Layout>
  );

  return (
    <Layout title="LLM Evaluation" actions={actions}>

      {/* Progress bar */}
      <div className="mb-5">
        <div className="flex items-center justify-between text-xs text-text3 mb-1.5">
          <span>{scoredCount} / {total} letters scored</span>
          <span>{progressPct}% complete</span>
        </div>
        <div className="h-1.5 bg-surface3 rounded-full overflow-hidden">
          <div
            className="h-full bg-pos rounded-full transition-all"
            style={{ width: `${progressPct}%` }}
          />
        </div>
        {scoreMessage && (
          <p className="text-xs text-warn mt-2">{scoreMessage}</p>
        )}
      </div>

      {!current ? (
        <div className="text-center py-20 text-text3 text-sm">No letters available.</div>
      ) : (
        <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 280px" }}>

          {/* LEFT COLUMN */}
          <div className="flex flex-col gap-4">

            {/* Navigation */}
            <div className="bg-surface border border-white/7 rounded-xl px-4 py-3 flex items-center justify-between">
              <button
                onClick={goPrev}
                disabled={currentIndex === 0}
                className="px-3 py-1.5 text-xs text-text2 border border-white/12 rounded-lg bg-transparent hover:bg-white/5 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer font-sans"
              >
                ← Previous
              </button>
              <span className="text-xs text-text3 font-mono">
                Letter {currentIndex + 1} of {letters.length}
              </span>
              <button
                onClick={goNext}
                disabled={currentIndex === letters.length - 1}
                className="px-3 py-1.5 text-xs text-text2 border border-white/12 rounded-lg bg-transparent hover:bg-white/5 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer font-sans"
              >
                Next →
              </button>
            </div>

            {/* Scenario + Clinical Context */}
            <div className="bg-surface border border-white/7 rounded-xl overflow-hidden">
              <div className="px-5 py-3.5 border-b border-white/7 flex items-center gap-3">
                <span className="text-xs px-2.5 py-1 rounded-full bg-accent/10 text-accent2 border border-accent/20 font-medium">
                  Scenario {current.scenario} - {SCENARIO_LABELS[current.scenario] || "Unknown"}
                </span>
                {current.is_scored && (
                  <span className={`text-xs px-2.5 py-1 rounded-full font-medium border ${
                    current.d5_score === 1
                      ? "bg-pos/10 text-pos border-pos/20"
                      : "bg-neg/10 text-neg border-neg/20"
                  }`}>
                    Already scored: {current.d5_score === 1 ? "YES" : "NO"}
                  </span>
                )}
              </div>
              <div className="grid grid-cols-4 gap-3 p-4">
                <div className="bg-surface2 rounded-lg p-3 border border-white/7">
                  <div className="text-xs text-text3 mb-1">Confidence</div>
                  <div className={`text-sm font-semibold font-mono ${
                    current.ai_confidence_score >= 0.7 ? "text-neg" : "text-warn"
                  }`}>
                    {(current.ai_confidence_score * 100).toFixed(1)}%
                  </div>
                </div>
                <div className="bg-surface2 rounded-lg p-3 border border-white/7">
                  <div className="text-xs text-text3 mb-1">OHTS Score</div>
                  <div className="text-sm font-semibold text-text1 font-mono">
                    {current.ohts_score != null ? `${current.ohts_score} / 16` : "N/A"}
                  </div>
                </div>
                <div className="bg-surface2 rounded-lg p-3 border border-white/7">
                  <div className="text-xs text-text3 mb-1">OHTS Tier</div>
                  <div className={`text-sm font-semibold capitalize ${
                    current.ohts_tier === "critical" ? "text-neg" :
                    current.ohts_tier === "possible" ? "text-warn" : "text-pos"
                  }`}>
                    {current.ohts_tier || "N/A"}
                  </div>
                </div>
                <div className="bg-surface2 rounded-lg p-3 border border-white/7">
                  <div className="text-xs text-text3 mb-1">Eye</div>
                  <div className="text-sm font-semibold text-text1 capitalize">
                    {current.eye_side || "—"}
                  </div>
                </div>
              </div>
            </div>

            {/* Letter */}
            <div className="bg-surface border border-white/7 rounded-xl overflow-hidden flex-1">
              <div className="px-5 py-3.5 border-b border-white/7 flex items-center gap-3">
                <span className="text-sm font-semibold text-text1 flex-1">Referral Letter</span>
                <span className="px-3 py-1 rounded-full bg-surface3 border border-white/12 text-xs font-semibold text-accent2">
                  {current.label}
                </span>
              </div>
              <div className="p-5 text-sm text-text1 leading-relaxed whitespace-pre-wrap">
                {current.referral_letter}
              </div>
            </div>

          </div>

          {/* RIGHT COLUMN */}
          <div className="flex flex-col gap-4">

            {/* D5 Scoring */}
            <div className="bg-surface border border-white/7 rounded-xl overflow-hidden">
              <div className="px-5 py-3.5 border-b border-white/7">
                <span className="text-sm font-semibold text-text1">D5 - Professional tone</span>
              </div>
              <div className="p-4">
                <p className="text-xs text-text2 leading-relaxed mb-4">
                  Does this letter read like a professional clinical referral a specialist would take seriously?
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => handleScore(1)}
                    disabled={scoring}
                    className={`py-4 rounded-xl text-sm font-semibold border-2 transition-all cursor-pointer font-sans disabled:opacity-50 ${
                      current.is_scored && current.d5_score === 1
                        ? "border-pos bg-pos/20 text-pos"
                        : "border-pos/30 bg-pos/10 text-pos hover:bg-pos/20"
                    }`}
                  >
                    ✓ Yes (1)
                  </button>
                  <button
                    onClick={() => handleScore(0)}
                    disabled={scoring}
                    className={`py-4 rounded-xl text-sm font-semibold border-2 transition-all cursor-pointer font-sans disabled:opacity-50 ${
                      current.is_scored && current.d5_score === 0
                        ? "border-neg bg-neg/20 text-neg"
                        : "border-white/12 bg-surface2 text-text2 hover:bg-surface3"
                    }`}
                  >
                    ✗ No (0)
                  </button>
                </div>
                {scoring && (
                  <p className="text-xs text-text3 text-center mt-3">Saving...</p>
                )}
              </div>
            </div>

            {/* Auto Scores D1-D4 */}
            <div className="bg-surface border border-white/7 rounded-xl overflow-hidden">
              <div className="px-5 py-3.5 border-b border-white/7">
                <span className="text-sm font-semibold text-text1">Auto scores (D1-D4)</span>
              </div>
              <div className="p-4">
                <AutoScoreRow label="D1 - Clinical finding stated"  value={current.d1_clinical_finding} />
                <AutoScoreRow label="D2 - Referral request clear"   value={current.d2_referral_request} />
                <AutoScoreRow label="D3 - Screening disclaimer"     value={current.d3_screening_disclaimer} />
                <AutoScoreRow label="D4 - No hallucinated values"   value={current.d4_no_hallucination} />
                <div className="flex items-center justify-between mt-3 pt-3 border-t border-white/7">
                  <span className="text-xs font-semibold text-text2">Total</span>
                  <span className="text-sm font-bold font-mono text-text1">
                    {current.auto_quality_score ?? "—"} / 4
                  </span>
                </div>
              </div>
            </div>

            {/* Performance */}
            <div className="bg-surface border border-white/7 rounded-xl overflow-hidden">
              <div className="px-5 py-3.5 border-b border-white/7">
                <span className="text-sm font-semibold text-text1">Performance</span>
              </div>
              <div className="p-4">
                <div className="flex justify-between py-2 border-b border-white/7">
                  <span className="text-xs text-text2">Response time</span>
                  <span className="text-xs font-mono text-text1">
                    {current.response_time_seconds != null
                      ? `${current.response_time_seconds.toFixed(2)}s`
                      : "—"}
                  </span>
                </div>
                <div className="flex justify-between py-2">
                  <span className="text-xs text-text2">Total tokens</span>
                  <span className="text-xs font-mono text-text1">
                    {current.total_tokens != null
                      ? current.total_tokens.toLocaleString()
                      : "—"}
                  </span>
                </div>
              </div>
            </div>

          </div>
        </div>
      )}
    </Layout>
  );
}

export default ResearchEvaluation;

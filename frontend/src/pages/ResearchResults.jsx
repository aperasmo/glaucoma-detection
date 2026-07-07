// src/pages/ResearchResults.jsx
// LLM Evaluation Results Dashboard - Admin only.
// Reveals LLM identities and shows full comparison after scoring is complete.

import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import Layout from "../components/Layout";
import API from "../api/index";

const LLM_ORDER = ["gpt4o", "gpt4o_mini", "llama", "gemini"];
const LLM_DISPLAY = {
  gpt4o:     "GPT-4o",
  gpt4o_mini:"GPT-4o-mini",
  llama:     "LLaMa",
  gemini:    "Gemini",
};

const SCENARIO_LABELS = {
  1: "High confidence + OHTS Critical",
  2: "Low confidence + OHTS Critical",
  3: "High confidence + OHTS Low",
  4: "High confidence + No OHTS",
};

function StatCard({ label, value, sub, valueClass }) {
  return (
    <div className="bg-surface border border-white/7 rounded-xl p-4">
      <div className="text-xs text-text3 uppercase tracking-wider mb-1">{label}</div>
      <div className={`text-2xl font-bold font-mono mb-1 ${valueClass || "text-text1"}`}>{value}</div>
      {sub && <div className="text-xs text-text3">{sub}</div>}
    </div>
  );
}

function ResearchResults() {
  const navigate = useNavigate();

  const [results, setResults]   = useState(null);
  const [kappa, setKappa]       = useState(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [filterScenario, setFilterScenario] = useState("all");
  const [filterLlm, setFilterLlm]           = useState("all");
  const [search, setSearch]     = useState("");

  const [isComplete, setIsComplete] = useState(false);
  

  useEffect(() => {
    let isMounted = true;

    async function loadDashboard() {
      try {
        // Kappa is always safe to load because it contains only study-level progress.
        const resK = await API.get("/evaluation/kappa");

        if (!isMounted) return;

        setKappa(resK.data);

        const evaluationComplete = resK.data?.status === "final";
        setIsComplete(evaluationComplete);

        // Keep LLM identities and results hidden until the blinded evaluation is complete.
        if (!evaluationComplete) {
          setResults(null);
          setLoading(false);
          return;
        }

        const resR = await API.get("/evaluation/results");

        if (!isMounted) return;

        setResults(resR.data);
        setLoading(false);
      } catch (err) {
        if (!isMounted) return;

        setError(
          err?.response?.data?.detail ||
          "Failed to load evaluation results. Admin access is required."
        );
        setLoading(false);
      }
    }

    loadDashboard();

    return () => {
      isMounted = false;
    };
  }, []);

  if (loading) return (
    <Layout title="LLM Evaluation Results">
      <p className="text-text3 text-sm">Loading results...</p>
    </Layout>
  );

  if (error) return (
    <Layout title="LLM Evaluation Results">
      <p className="text-neg text-sm">{error}</p>
    </Layout>
  );

  if (!isComplete) return (
    <Layout title="LLM Evaluation Results">
      <div className="bg-surface border border-white/7 rounded-xl p-6 max-w-2xl">
        <div className="text-base font-semibold text-text1">
          Results remain blinded
        </div>

        <p className="mt-2 text-sm text-text2 leading-relaxed">
          LLM identities, rankings, and detailed results will be available after
          at least {kappa?.minimum_scorers ?? 3} researchers have completed all{" "}
          {kappa?.total_letters ?? 0} evaluation letters.
        </p>

        <div className="grid grid-cols-3 gap-3 mt-5">
          <StatCard
            label="Completed researchers"
            value={kappa?.completed_scorer_count ?? 0}
            sub={`Completed all ${kappa?.total_letters ?? 0} letters`}
            valueClass={
              (kappa?.completed_scorer_count ?? 0) > 0
                ? "text-pos"
                : "text-warn"
            }
          />

          <StatCard
            label="Evaluation letters"
            value={kappa?.total_letters ?? 0}
            sub="Each completed researcher scores every letter"
            valueClass="text-text1"
          />

          <StatCard
            label="Fleiss' Kappa"
            value="Pending"
            sub="Calculated after completion"
            valueClass="text-text3"
          />
        </div>

        <p className="mt-5 text-xs text-text3">
          {kappa?.message || "Awaiting completed researcher ratings."}
        </p>
      </div>
    </Layout>
  );

  const letters = results?.letters || [];
  const summary = results?.summary_per_llm || {};

  // Find max value per column for highlighting
  function maxOf(key) {
    return Math.max(...LLM_ORDER.map(llm => summary[llm]?.[key] ?? 0), 0);
  }

  function cellClass(value, max) {
    return value === max && max > 0
      ? "text-pos font-semibold"
      : "text-text1";
  }

  // Filter letters
  const filtered = letters.filter(l => {
    const matchScenario = filterScenario === "all" || String(l.scenario) === filterScenario;
    const matchLlm      = filterLlm === "all" || l.actual_llm === filterLlm;
    const matchSearch   = !search || l.case_id?.toLowerCase().includes(search.toLowerCase());
    return matchScenario && matchLlm && matchSearch;
  });

  const totalLetters = kappa?.total_letters ?? letters.length;
  const fullyRatedLetters = kappa?.fully_rated_letter_count ?? 0;
  const completedScorers = kappa?.completed_scorer_count ?? 0;
  const includedScorers = kappa?.included_scorer_count ?? completedScorers;

  // Collect all unique scorer keys across all letters for dynamic D5 column headers.
  const allScorerKeys = Array.from(
    new Set(letters.flatMap(l => Object.keys(l.d5_scores_by_scorer || {})))
  );

    const rankedLlms = LLM_ORDER
    .map((llm) => {
      const stats = summary[llm];

      if (!stats || stats.combined_quality_mean == null) {
        return null;
      }

      return {
        key: llm,
        name: LLM_DISPLAY[llm] || llm,
        combinedQuality: stats.combined_quality_mean,
        autoQuality: stats.auto_quality_mean,
        d5Mean: stats.d5_mean,
        averageResponseTime: stats.avg_response_time_seconds,
        averageTokens: stats.avg_total_tokens,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.combinedQuality - a.combinedQuality);

  return (
    <Layout title="LLM Evaluation Results">

      {/* SECTION 1 - Final evaluation summary */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        <StatCard
          label="Fully rated letters"
          value={`${fullyRatedLetters} / ${totalLetters}`}
          sub="Common rating set used for Fleiss' Kappa"
          valueClass={
            fullyRatedLetters === totalLetters ? "text-pos" : "text-warn"
          }
        />

        <StatCard
          label="Completed researchers"
          value={completedScorers}
          sub={`${includedScorers} included in reliability analysis`}
          valueClass="text-pos"
        />

        <StatCard
          label="Fleiss' Kappa"
          value={kappa?.kappa != null ? kappa.kappa.toFixed(3) : "—"}
          sub={kappa?.interpretation || "Not available"}
          valueClass="text-accent2"
        />

        <StatCard
          label="Observed agreement"
          value={
            kappa?.observed_agreement != null
              ? `${(kappa.observed_agreement * 100).toFixed(1)}%`
              : "—"
          }
          sub={`${fullyRatedLetters} letters · ${includedScorers} raters`}
          valueClass="text-text1"
        />
      </div>

      {kappa?.kappa != null && kappa.kappa < 0 && (
        <div className="mb-6 px-4 py-3 bg-warn/10 border border-warn/20 rounded-lg">
          <div className="text-xs font-semibold text-warn mb-1">
            Reliability interpretation note
          </div>

          <p className="text-xs text-text2 leading-relaxed">
            The negative Fleiss&apos; Kappa occurred alongside high observed agreement
            because D5 ratings were heavily concentrated in one response category.
            Kappa should therefore be interpreted alongside observed agreement and
            rating distribution.
          </p>
        </div>
      )}

      {/* SECTION 2 - Per-LLM table */}
      <div className="bg-surface border border-white/7 rounded-xl overflow-hidden mb-6">
        <div className="px-5 py-3.5 border-b border-white/7">
          <span className="text-sm font-semibold text-text1">Per-LLM Comparison</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-white/7 bg-white/[0.02]">
                {["LLM", "D1", "D2", "D3", "D4", "Auto Quality", "D5 (avg)", "Combined", "Avg Time", "Avg Tokens"].map(h => (
                  <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold text-text3 uppercase tracking-wider whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {LLM_ORDER.map(llm => {
                const s = summary[llm] || {};
                return (
                  <tr key={llm} className="border-b border-white/[0.04] hover:bg-accent/[0.04]">
                    <td className="px-4 py-3 text-sm font-semibold text-text1">
                      {LLM_DISPLAY[llm] || llm}
                    </td>
                    <td className={`px-4 py-3 text-xs font-mono ${cellClass(s.d1_mean, maxOf("d1_mean"))}`}>
                      {s.d1_mean != null ? s.d1_mean.toFixed(3) : "—"}
                    </td>
                    <td className={`px-4 py-3 text-xs font-mono ${cellClass(s.d2_mean, maxOf("d2_mean"))}`}>
                      {s.d2_mean != null ? s.d2_mean.toFixed(3) : "—"}
                    </td>
                    <td className={`px-4 py-3 text-xs font-mono ${cellClass(s.d3_mean, maxOf("d3_mean"))}`}>
                      {s.d3_mean != null ? s.d3_mean.toFixed(3) : "—"}
                    </td>
                    <td className={`px-4 py-3 text-xs font-mono ${cellClass(s.d4_mean, maxOf("d4_mean"))}`}>
                      {s.d4_mean != null ? s.d4_mean.toFixed(3) : "—"}
                    </td>
                    <td className={`px-4 py-3 text-xs font-mono ${cellClass(s.auto_quality_mean, maxOf("auto_quality_mean"))}`}>
                      {s.auto_quality_mean != null ? s.auto_quality_mean.toFixed(3) : "—"}
                    </td>
                    <td className={`px-4 py-3 text-xs font-mono ${cellClass(s.d5_mean, maxOf("d5_mean"))}`}>
                      {s.d5_mean != null ? s.d5_mean.toFixed(3) : "—"}
                    </td>
                    <td className={`px-4 py-3 text-xs font-mono ${cellClass(s.combined_quality_mean, maxOf("combined_quality_mean"))}`}>
                      {s.combined_quality_mean != null ? s.combined_quality_mean.toFixed(3) : "—"}
                    </td>
                    <td className="px-4 py-3 text-xs font-mono text-text2">
                      {s.avg_response_time_seconds != null ? `${s.avg_response_time_seconds.toFixed(2)}s` : "—"}
                    </td>
                    <td className="px-4 py-3 text-xs font-mono text-text2">
                      {s.avg_total_tokens != null ? (
                        <span className={s.avg_total_tokens > 10000 ? "text-warn" : ""}>
                          {s.avg_total_tokens.toLocaleString()}
                          {s.avg_total_tokens > 10000 && " ⚠"}
                        </span>
                      ) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="px-5 py-3 border-t border-white/7 text-xs text-text3">
          Green values indicate the highest score per column. ⚠ flags anomalously high token counts (GPT-4o-mini image token quirk - documented and expected).
        </div>
      </div>

        {/* SECTION 2B - Dynamic ranking and study interpretation */}
        <div className="bg-surface border border-white/7 rounded-xl overflow-hidden mb-6">
          <div className="px-5 py-3.5 border-b border-white/7">
            <span className="text-sm font-semibold text-text1">
              Rankings and Study Interpretation
            </span>
          </div>

          <div className="p-5">
            <div className="text-xs text-text3 uppercase tracking-wider mb-3">
              Overall ranking by combined quality score
            </div>

            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-white/7 bg-white/[0.02]">
                    {[
                      "Rank",
                      "LLM",
                      "Combined score",
                      "Auto quality",
                      "D5 mean",
                      "Avg time",
                      "Avg tokens",
                    ].map((heading) => (
                      <th
                        key={heading}
                        className="px-4 py-2.5 text-left text-xs font-semibold text-text3 uppercase tracking-wider whitespace-nowrap"
                      >
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>

                <tbody>
                  {rankedLlms.map((row, index) => {
                    const rank = index + 1;
                    const rankClass =
                      rank === 1
                        ? "text-pos"
                        : rank === 2
                          ? "text-accent2"
                          : "text-text1";

                    return (
                      <tr
                        key={row.key}
                        className="border-b border-white/[0.04] hover:bg-accent/[0.04]"
                      >
                        <td className="px-4 py-3 text-sm font-bold font-mono text-text3">
                          #{rank}
                        </td>

                        <td className={`px-4 py-3 text-sm font-semibold ${rankClass}`}>
                          {row.name}
                        </td>

                        <td className="px-4 py-3 text-sm font-mono text-text1">
                          {row.combinedQuality.toFixed(3)}
                        </td>

                        <td className="px-4 py-3 text-sm font-mono text-text2">
                          {row.autoQuality != null ? row.autoQuality.toFixed(3) : "—"}
                        </td>

                        <td className="px-4 py-3 text-sm font-mono text-text2">
                          {row.d5Mean != null ? row.d5Mean.toFixed(3) : "—"}
                        </td>

                        <td className="px-4 py-3 text-sm font-mono text-text2">
                          {row.averageResponseTime != null
                            ? `${row.averageResponseTime.toFixed(2)}s`
                            : "—"}
                        </td>

                        <td className="px-4 py-3 text-sm font-mono text-text2">
                          {row.averageTokens != null
                            ? row.averageTokens.toLocaleString()
                            : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="grid grid-cols-2 gap-4 mt-6">
              <div className="bg-surface2 rounded-xl border border-white/7 p-4">
                <div className="text-xs font-semibold text-text1 mb-2">
                  Ranking basis
                </div>

                <p className="text-xs text-text2 leading-relaxed">
                  Rankings are ordered by combined quality score. This is calculated
                  as the automated D1-D4 quality score plus the mean D5 professional
                  tone score across completed researchers. Response time and token
                  usage are reported separately and do not affect the ranking.
                </p>
              </div>

              <div className="bg-surface2 rounded-xl border border-white/7 p-4">
                <div className="text-xs font-semibold text-text1 mb-2">
                  Reliability context
                </div>

                <p className="text-xs text-text2 leading-relaxed">
                  Fleiss&apos; Kappa evaluates agreement among the completed researcher
                  cohort for D5 professional-tone ratings. It should be interpreted
                  alongside observed agreement and the distribution of Yes and No
                  ratings.
                </p>
              </div>
            </div>

            {kappa?.kappa != null && kappa.kappa < 0 && (
              <div className="mt-4 px-4 py-3 bg-warn/10 border border-warn/20 rounded-lg">
                <div className="text-xs font-semibold text-warn mb-1">
                  Kappa interpretation note
                </div>

                <div className="text-xs text-text2 leading-relaxed">
                  A negative Fleiss&apos; Kappa should not be interpreted in isolation.
                  Review it together with observed agreement and the rating
                  distribution, particularly when most ratings fall into one category.
                </div>
              </div>
            )}
          </div>
        </div>


      {/* SECTION 3 - Individual letter browser */}
      <div className="bg-surface border border-white/7 rounded-xl overflow-hidden mb-6">
        <div className="px-5 py-3.5 border-b border-white/7 flex items-center gap-3">
          <span className="text-sm font-semibold text-text1 flex-1">Individual Letter Browser</span>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search case ID..."
            className="bg-surface2 border border-white/12 rounded-lg px-3 py-1.5 text-xs text-text1 outline-none placeholder:text-text3 focus:border-accent transition-colors font-sans w-40"
          />
          <select
            value={filterScenario}
            onChange={e => setFilterScenario(e.target.value)}
            className="bg-surface2 border border-white/12 rounded-lg px-3 py-1.5 text-xs text-text2 outline-none cursor-pointer font-sans"
          >
            <option value="all">All scenarios</option>
            {[1, 2, 3, 4, 7].map(s => (
              <option key={s} value={String(s)}>Scenario {s}</option>
            ))}
          </select>
          <select
            value={filterLlm}
            onChange={e => setFilterLlm(e.target.value)}
            className="bg-surface2 border border-white/12 rounded-lg px-3 py-1.5 text-xs text-text2 outline-none cursor-pointer font-sans"
          >
            <option value="all">All LLMs</option>
            {LLM_ORDER.map(llm => (
              <option key={llm} value={llm}>{LLM_DISPLAY[llm]}</option>
            ))}
          </select>
        </div>
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-white/7 bg-white/[0.02]">
              {["Case ID", "Scenario", ...(isComplete ? ["LLM"] : []), "Label", "D1", "D2", "D3", "D4",
                ...allScorerKeys.map((_, i) => `D5 (Rater ${i + 1})`),
                "Combined"].map(h => (
                <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold text-text3 uppercase tracking-wider whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={8 + (isComplete ? 1 : 0) + allScorerKeys.length} className="px-6 py-4 bg-surface2">
                  No letters match the current filters.
                </td>
              </tr>
            ) : (
              filtered.map(l => {
                const scores = l.d5_scores_by_scorer || {};
                const scorerKeys = Object.keys(scores);
                const isExpanded = expandedId === l.case_id;
                return (
                  <>
                    <tr
                      key={l.case_id}
                      onClick={() => setExpandedId(isExpanded ? null : l.case_id)}
                      className="border-b border-white/[0.04] hover:bg-accent/[0.04] cursor-pointer transition-colors"
                    >
                      <td className="px-4 py-3 text-xs font-mono text-text2">
                        {l.case_id?.slice(0, 8)}...
                      </td>
                      <td className="px-4 py-3 text-xs text-text2">{l.scenario}</td>
                      {isComplete && (
                        <td className="px-4 py-3 text-xs font-semibold text-text1">
                          {LLM_DISPLAY[l.actual_llm] || l.actual_llm || "—"}
                        </td>
                      )}
                      
                      <td className="px-4 py-3">
                        <span className="text-xs px-2 py-0.5 rounded-full bg-surface3 border border-white/12 text-accent2 font-semibold">
                          {l.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs font-mono text-text2">{l.d1_clinical_finding ?? "—"}</td>
                      <td className="px-4 py-3 text-xs font-mono text-text2">{l.d2_referral_request ?? "—"}</td>
                      <td className="px-4 py-3 text-xs font-mono text-text2">{l.d3_screening_disclaimer ?? "—"}</td>
                      <td className="px-4 py-3 text-xs font-mono text-text2">{l.d4_no_hallucination ?? "—"}</td>
                        {allScorerKeys.map(key => (
                        <td key={key} className="px-4 py-3 text-xs font-mono text-text2">
                          {scores[key] ?? "—"}
                        </td>
                      ))}
                      <td className="px-4 py-3 text-xs font-mono text-text1 font-semibold">
                        {l.combined_quality_score != null ? l.combined_quality_score.toFixed(2) : "—"}
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr key={`${l.case_id}-expanded`} className="border-b border-white/[0.04]">
                        <td colSpan={8 + (isComplete ? 1 : 0) + allScorerKeys.length} className="px-4 py-8 text-center text-text3 text-sm">
                          <div className="text-xs text-text3 uppercase tracking-wider mb-2">Full letter</div>
                          <div className="text-sm text-text1 leading-relaxed whitespace-pre-wrap">
                            {l.referral_letter}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })
            )}
          </tbody>
        </table>
        <div className="px-5 py-3 border-t border-white/7 text-xs text-text3">
          {filtered.length} of {letters.length} letters shown. Click a row to read the full letter.
        </div>
      </div>

      {/* SECTION 4 - Notes */}
      <div className="bg-surface border border-white/7 rounded-xl p-5 text-xs text-text3 leading-relaxed">
        <div className="font-semibold text-text2 mb-2">Scoring notes</div>
        D5 scores shown are the mean across {includedScorers} completed researcher ratings.
        Fleiss&apos; Kappa measures inter-rater agreement on D5 professional-tone ratings.
        Auto scores D1-D4 were calculated algorithmically.
        Combined quality equals automated quality plus the mean D5 score.
        Response time and token usage are operational metrics and do not affect quality scores.
      </div>

    </Layout>
  );
}

export default ResearchResults;

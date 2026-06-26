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
  const [progress, setProgress] = useState(null);

  useEffect(() => {
    Promise.all([
      API.get("/evaluation/results"),
      API.get("/evaluation/kappa"),
      API.get("/evaluation/progress"),
    ])
      .then(([resR, resK, resP]) => {
        setResults(resR.data);
        setKappa(resK.data);
        setProgress(resP.data);
        setIsComplete(resP.data?.complete === true);
        setLoading(false);
      })
      .catch(() => {
        setError("Failed to load results. Admin access required.");
        setLoading(false);
      });
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

  const totalScored  = progress?.scored ?? 0;
  const totalLetters = progress?.total ?? letters.length;
  const scorersCount = results?.scorer_count ?? results?.scorers_complete ?? 0;

  return (
    <Layout title="LLM Evaluation Results">

      {/* SECTION 1 - Summary cards */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        <StatCard
          label="Total letters scored"
          value={`${totalScored} / ${totalLetters}`}
          sub="Across all scorers"
        />
        <StatCard
          label="Scorers completed"
          value={`${scorersCount} / 2`}
          sub="Allan and Mohammad"
          valueClass={scorersCount === 2 ? "text-pos" : "text-warn"}
        />
        <StatCard
          label="Cohen's Kappa"
          value={kappa?.kappa != null ? kappa.kappa.toFixed(3) : "Pending"}
          sub={kappa?.interpretation || "Awaiting both scorers"}
          valueClass={kappa?.kappa != null ? "text-accent2" : "text-text3"}
        />
        <StatCard
          label="Observed agreement"
          value={kappa?.observed_agreement != null
            ? `${(kappa.observed_agreement * 100).toFixed(1)}%`
            : "—"}
          sub={kappa?.paired_count != null ? `${kappa.paired_count} paired scores` : ""}
        />
      </div>

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

        {/* RANKINGS & ANALYSIS */}
        <div className="bg-surface border border-white/7 rounded-xl overflow-hidden mb-6">
          <div className="px-5 py-3.5 border-b border-white/7">
            <span className="text-sm font-semibold text-text1">Rankings and Analysis</span>
          </div>
          <div className="p-5">

            {/* Overall Ranking Table */}
            <div className="mb-6">
              <div className="text-xs text-text3 uppercase tracking-wider mb-3">Overall ranking by combined score</div>
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-white/7 bg-white/[0.02]">
                    {["Rank", "LLM", "Model", "Combined Score", "Verdict"].map(h => (
                      <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold text-text3 uppercase tracking-wider">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[
                    { rank: 1, llm: "Gemini",        model: "gemini-3.5-flash",     score: "4.257", verdict: "Best overall quality",           color: "text-pos" },
                    { rank: 2, llm: "GPT-4o-mini",   model: "gpt-4o-mini",     score: "4.071", verdict: "Strong quality, high cost",      color: "text-accent2" },
                    { rank: 3, llm: "GPT-4o",        model: "gpt-4o",     score: "4.057", verdict: "Strong quality, best tone",      color: "text-accent2" },
                    { rank: 4, llm: "LLaMa",         model: "openai/gpt-oss-120b",     score: "4.014", verdict: "Fastest, most efficient",        color: "text-text2" },
                  ].map(row => (
                    <tr key={row.rank} className="border-b border-white/[0.04]">
                      <td className="px-4 py-3 text-sm font-bold font-mono text-text3">#{row.rank}</td>
                      <td className={`px-4 py-3 text-sm font-semibold ${row.color}`}>{row.llm}</td>
                      <td className={`px-4 py-3 text-sm font-semibold ${row.color}`}>{row.model}</td>
                      <td className="px-4 py-3 text-sm font-mono text-text1">{row.score}</td>
                      <td className="px-4 py-3 text-xs text-text2">{row.verdict}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Strengths and Weaknesses */}
            <div className="text-xs text-text3 uppercase tracking-wider mb-4">Strengths and weaknesses per LLM</div>
            <div className="grid grid-cols-2 gap-4 mb-6">
              {[
                {
                  llm: "GPT-4o",
                  strengths: [
                    "Perfect professional tone (35/35 rated professional by both scorers) - highest D5 score",
                    "Fast response (2.70s) and low token usage (1,007)",
                  ],
                  weaknesses: [
                    "Rarely includes an explicit screening disclaimer (only 2/35 letters, D3=0.057) - patient safety concern",
                  ],
                },
                {
                  llm: "GPT-4o-mini",
                  strengths: [
                    "High combined quality score (4.071), competitive with GPT-4o",
                  ],
                  weaknesses: [
                    "Anomalously high token usage (22,605 avg) - a known image tokenisation quirk, not a quality issue but a significant cost concern for production deployment",
                    "Same disclaimer weakness as GPT-4o (only 3/35 letters, D3=0.086)",
                  ],
                },
                {
                  llm: "LLaMa (gpt-oss-120b)",
                  strengths: [
                    "By far the fastest (0.69s avg) and most token-efficient (448 avg tokens) - strong case for cost-effective deployment",
                  ],
                  weaknesses: [
                    "Lowest disclaimer rate of all 4 LLMs (only 1/35 letters, D3=0.029) - highest patient safety risk",
                    "Lowest combined score overall (4.014)",
                  ],
                },
                {
                  llm: "Gemini 3.5 Flash",
                  strengths: [
                    "Highest combined score overall (4.257) - best quality across all dimensions",
                    "Best disclaimer rate (12/35 letters, D3=0.343) - most clinically safe framing",
                  ],
                  weaknesses: [
                    "Slowest response time (7.22s avg) - may affect user experience in high-volume clinics",
                    "Occasionally misses the referral request (D2=0.943, 2/35 letters had no explicit referral ask)",
                  ],
                },
              ].map(item => (
                <div key={item.llm} className="bg-surface2 rounded-xl border border-white/7 p-4">
                  <div className="text-sm font-semibold text-text1 mb-3">{item.llm}</div>
                  {item.strengths.map((s, i) => (
                    <div key={i} className="flex gap-2 mb-2">
                      <span className="text-pos text-xs mt-0.5 flex-shrink-0">✓</span>
                      <span className="text-xs text-text2 leading-relaxed">{s}</span>
                    </div>
                  ))}
                  {item.weaknesses.map((w, i) => (
                    <div key={i} className="flex gap-2 mb-2">
                      <span className="text-neg text-xs mt-0.5 flex-shrink-0">✗</span>
                      <span className="text-xs text-text2 leading-relaxed">{w}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>

            {/* Important Notes */}
            <div className="flex flex-col gap-3">
              <div className="px-4 py-3 bg-warn/10 border border-warn/20 rounded-lg">
                <div className="text-xs font-semibold text-warn mb-1">D3 - Screening disclaimer (critical safety dimension)</div>
                <div className="text-xs text-text2 leading-relaxed">
                  All 4 LLMs score very low on D3, with Gemini performing best at only 34.3%. This suggests the referral letter prompt should be updated to explicitly require a disclaimer statement. Flagged as a prompt engineering improvement for future work.
                </div>
              </div>
              <div className="px-4 py-3 bg-accent/10 border border-accent/20 rounded-lg">
                <div className="text-xs font-semibold text-accent2 mb-1">Cohen's Kappa = 0.000 with 97.1% observed agreement</div>
                <div className="text-xs text-text2 leading-relaxed">
                  This seemingly contradictory result occurs when both scorers rate nearly everything the same way (almost all 1s), making the expected agreement by chance also very high. The kappa calculation penalises for this. This is a known limitation of Kappa when rater agreement is uniformly high - the observed agreement (97.1%) is the more meaningful metric here.
                </div>
              </div>
            </div>

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
            {[1, 2, 3, 4].map(s => (
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
              {["Case ID", "Scenario", ...(isComplete ? ["LLM"] : []), "Label", "D1", "D2", "D3", "D4", "D5 (Allan)", "D5 (Mohammad)", "Combined"].map(h => (
                <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold text-text3 uppercase tracking-wider whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={isComplete ? 11 : 10} className="px-4 py-8 text-center text-text3 text-sm">
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
                      <td className="px-4 py-3 text-xs font-mono text-text2">
                        {scorerKeys[0] != null ? scores[scorerKeys[0]] ?? "—" : "—"}
                      </td>
                      <td className="px-4 py-3 text-xs font-mono text-text2">
                        {scorerKeys[1] != null ? scores[scorerKeys[1]] ?? "—" : "—"}
                      </td>
                      <td className="px-4 py-3 text-xs font-mono text-text1 font-semibold">
                        {l.combined_quality_score != null ? l.combined_quality_score.toFixed(2) : "—"}
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr key={`${l.case_id}-expanded`} className="border-b border-white/[0.04]">
                        <td colSpan={isComplete ? 11 : 10} className="px-6 py-4 bg-surface2">
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
        D5 scores shown are the mean of both scorer ratings.
        Cohen's Kappa measures inter-rater agreement on D5.
        Auto scores (D1-D4) were calculated algorithmically.
        Response time and token usage are captured from live API calls.
        GPT-4o-mini token counts are anomalously high due to a known image token processing quirk - this is consistent across all 35 cases and does not affect quality scores.
      </div>

    </Layout>
  );
}

export default ResearchResults;

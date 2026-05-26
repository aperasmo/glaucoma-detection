// src/pages/ScreeningResult.jsx
// Screening Result page - Tailwind CSS implementation.
// Clinical Mode: ensemble result, Grad-CAM++, OHTS score, referral letter.
// Auto-refreshes every 3 seconds until status = complete.

import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import Layout from "../components/Layout";
import API from "../api/index";

const BACKEND = "http://localhost:8000";

const V = {
  surface2: "#1A2840",
  surface3: "#1F3050",
  border:   "rgba(255,255,255,0.07)",
  border2:  "rgba(255,255,255,0.12)",
  accent:   "#3B9EFF",
  accent2:  "#5BB8FF",
  pos:      "#22C994",
  neg:      "#FF6B6B",
  warn:     "#FFB84D",
  text:     "#E8EEF7",
  text2:    "#8FA3BF",
  text3:    "#4E6580",
};

function PredictionBadge({ prediction }) {
  const isGlaucoma = prediction?.toLowerCase() === "glaucoma";
  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-semibold border ${
      isGlaucoma
        ? "bg-neg/10 text-neg border-neg/30"
        : "bg-pos/10 text-pos border-pos/30"
    }`}>
      <span className="w-2 h-2 rounded-full bg-current" />
      {isGlaucoma ? "Glaucoma Positive" : "Normal"}
    </span>
  );
}

function OHTSTierBadge({ tier }) {
  const map = {
    critical: "bg-neg/10 text-neg border-neg/20",
    possible: "bg-warn/10 text-warn border-warn/20",
    low:      "bg-pos/10 text-pos border-pos/20",
  };
  const labels = {
    critical: "Critical - High Risk",
    possible: "Possible in 5 Years",
    low:      "Low Risk",
  };
  const cls = map[tier?.toLowerCase()] || map.low;
  return (
    <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold border ${cls}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-current" />
      {labels[tier?.toLowerCase()] || "Low Risk"}
    </span>
  );
}

function InfoRow({ label, value, valueClass }) {
  return (
    <div className="flex justify-between text-sm mb-2 pb-2 border-b border-white/7">
      <span className="text-text3">{label}</span>
      <span className={valueClass || "text-text1 font-medium"}>{value || "—"}</span>
    </div>
  );
}

function ScreeningResult() {
  const { screeningId } = useParams();
  const navigate = useNavigate();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [inferenceMode, setInferenceMode] = useState("clinical");

  useEffect(() => {
    let interval = null;

    function fetchResult() {
      Promise.all([
        API.get(`/results/${screeningId}/full`),
        API.get("/settings/INFERENCE_MODE"),
      ])
        .then(([resultRes, modeRes]) => {
          setData(resultRes.data);
          setInferenceMode(modeRes.data.set_value || "clinical");
          setLoading(false);
          const status = resultRes.data?.status;
          if (status === "complete" || status === "failed") {
            if (interval) clearInterval(interval);
          }
        })
        .catch(() => {
          setError("Failed to load screening result.");
          setLoading(false);
          if (interval) clearInterval(interval);
        });
    }

    fetchResult();
    interval = setInterval(fetchResult, 3000);
    return () => { if (interval) clearInterval(interval); };
  }, [screeningId]);

  function formatDate(d) {
    if (!d) return "-";
    return new Date(d).toLocaleDateString("en-NZ", {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit",
      timeZone: "Pacific/Auckland",
    });
  }

  if (loading) return (
    <Layout title="Screening Result">
      <div className="loading-overlay">
        <div className="loading-content">
          <div className="spinner" />
          <h3 className="text-text1 text-lg font-semibold mb-2">Analysing Image...</h3>
          <p className="text-text2 text-sm mb-1">AI model is processing your fundus image</p>
          <p className="text-text3 text-xs">Inference → Grad-CAM++ → GPT-4o → PDF</p>
        </div>
      </div>
    </Layout>
  );

  if (error) return (
    <Layout title="Screening Result">
      <p className="text-neg text-sm">{error}</p>
    </Layout>
  );

  const result = data?.results?.find(r => r.model_used === "ensemble") || data?.results?.[0];
  const confidence = parseFloat(result?.confidence_score || 0);
  const confidencePct = (confidence * 100).toFixed(1);
  const isGlaucoma = result?.prediction?.toLowerCase() === "glaucoma";
  const isProcessing = data && (data.status === "pending" || data.status === "processing");

  // LLM referral letters
  const referralResults = data?.results?.filter(r => r.referral_letter != null) || [];
  const gpt4o     = referralResults.find(r => r.llm_used === "gpt4o");
  const gpt4oMini = referralResults.find(r => r.llm_used === "gpt4o_mini");
  const llama     = referralResults.find(r => r.llm_used === "llama");
  const gemini    = referralResults.find(r => r.llm_used === "gemini");

  const actions = (
    <>
      <button onClick={() => navigate(-1)}
        className="px-3 py-1.5 text-xs text-text2 border border-white/12 rounded-lg bg-transparent hover:bg-white/5 transition-colors cursor-pointer font-sans">
        ← Back
      </button>
      <button className="px-3 py-1.5 text-xs text-white bg-accent hover:bg-accent2 rounded-lg border-0 transition-colors cursor-pointer font-sans">
        📄 PDF Report
      </button>
    </>
  );

  return (
    <Layout title="Screening Result" actions={actions}>

      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-xs text-text3 mb-4">
        <span onClick={() => navigate("/patients")}
          className="cursor-pointer hover:text-accent2 transition-colors">Patients</span>
        <span>›</span>
        <span onClick={() => navigate(-1)}
          className="cursor-pointer hover:text-accent2 transition-colors">Screening History</span>
        <span>›</span>
        <span className="text-text2">Result — {formatDate(data?.created_at)}</span>
      </div>

      {/* AI Disclaimer */}
      <div className="px-4 py-3 rounded-lg mb-4 bg-warn/10 border border-warn/20 text-xs text-warn leading-relaxed">
        ⚠ AI-assisted result only. Clinical judgment required before any diagnosis or referral.
      </div>

      {/* Two column layout */}
      <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 300px" }}>

        {/* LEFT */}
        <div className="flex flex-col gap-4">

          {/* Grad-CAM++ Card */}
          <div className="bg-surface border border-white/7 rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-white/7">
              <span className="text-sm font-semibold text-text1">Fundus Image + Grad-CAM++</span>
            </div>
            <div className="p-4">

              {/* Side by side images */}
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div>
                  <div className="text-xs text-text3 text-center mb-2 uppercase tracking-wider">
                    Original Fundus Image
                  </div>
                  <div className="rounded-lg overflow-hidden bg-black min-h-40 flex items-center justify-center">
                    {data?.image_path ? (
                      <img
                        src={`${BACKEND}/${data.image_path.replace(/\\/g, "/")}`}
                        alt="Fundus"
                        className="w-full block"
                      />
                    ) : (
                      <span className="text-text3 text-xs">Not available</span>
                    )}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-text3 text-center mb-2 uppercase tracking-wider">
                    Grad-CAM++ Heatmap
                  </div>
                  <div className="rounded-lg overflow-hidden bg-black min-h-40 flex items-center justify-center">
                    {data?.screening_id && result?.model_used ? (
                      <img
                        src={`${BACKEND}/uploads/gradcam/${data.screening_id}_${result.model_used}_gradcam.png`}
                        alt="Grad-CAM++"
                        className="w-full block"
                        onError={e => {
                          e.target.style.display = "none";
                          e.target.nextSibling.style.display = "flex";
                        }}
                      />
                    ) : null}
                    <div className="hidden flex-col items-center justify-center text-text3 text-xs p-4 w-full h-full">
                      <div className="text-2xl mb-2">🔬</div>
                      <div>Grad-CAM++ not available</div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Confidence bar */}
              <div className="mb-3">
                <div className="flex justify-between text-xs text-text2 mb-1.5">
                  <span>Confidence Score</span>
                  <span className={`font-semibold ${isGlaucoma ? "text-neg" : "text-pos"}`}>
                    {confidencePct}%
                  </span>
                </div>
                <div className="h-2 bg-surface3 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${isGlaucoma ? "bg-neg" : "bg-pos"}`}
                    style={{ width: `${confidencePct}%` }}
                  />
                </div>
              </div>

              {/* Result + threshold */}
              <div className="flex justify-between items-center">
                <span className="text-xs text-text3">
                  Threshold: {parseFloat(result?.threshold_used || 0.5).toFixed(2)}
                </span>
                <PredictionBadge prediction={result?.prediction} />
              </div>
            </div>
          </div>

          {/* OHTS Risk Score */}
          <div className="bg-surface border border-white/7 rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-white/7 flex items-center gap-3">
              <span className="text-sm font-semibold text-text1 flex-1">OHTS Risk Score</span>
              <span className="text-xs text-text3">Ocular Hypertension Treatment Study</span>
            </div>
            <div className="p-4">
              {result?.ohts_score ? (
                <>
                  <div className="flex items-center gap-4 p-4 bg-surface2 rounded-xl mb-4">
                    <div className="text-center">
                      <div className={`text-4xl font-bold font-mono ${
                        result.ohts_tier === "critical" ? "text-neg" :
                        result.ohts_tier === "possible" ? "text-warn" : "text-pos"
                      }`}>
                        {parseFloat(result.ohts_score).toFixed(0)}
                      </div>
                      <div className="text-xs text-text3 mt-1">/ 16 pts</div>
                    </div>
                    <div>
                      <OHTSTierBadge tier={result.ohts_tier} />
                      <div className="text-xs text-text3 mt-2">
                        Estimated 5-year POAG risk: {
                          parseFloat(result.ohts_score) > 12 ? "≥33%" :
                          parseFloat(result.ohts_score) >= 7 ? "10-20%" : "≤4%"
                        }
                      </div>
                    </div>
                  </div>
                  <div className="text-xs text-text3 text-center mb-3">
                    0-6 = Low · 7-12 = Moderate · &gt;12 = High
                  </div>
                  <div className="text-xs text-text3 text-center pt-3 border-t border-white/7">
                    Based on Ocular Hypertension Treatment Study (OHTS) — Kass et al. (2002)
                  </div>
                </>
              ) : (
                <p className="text-text3 text-sm">
                  OHTS score not available. IOP and CCT required.
                </p>
              )}
            </div>
          </div>

          {/* Biomarker Visualization */}
          <div className="bg-surface border border-white/7 rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-white/7 flex items-center gap-3">
              <span className="text-sm font-semibold text-text1 flex-1">Biomarker Visualization</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-warn/10 text-warn border border-warn/20">
                Approximate
              </span>
            </div>
            <div className="p-4">
              {result?.cdr != null && result?.disc_radius != null && result?.cup_radius != null ? (
                <div className="grid grid-cols-2 gap-5 items-center">

                  {/* SVG Diagram */}
                  <div className="flex justify-center">
                    {(() => {
                      const cdr = parseFloat(result.cdr);
                      const discR = parseFloat(result.disc_radius);
                      const cupR = parseFloat(result.cup_radius);
                      const scale = 90 / discR;
                      const scaledDisc = discR * scale;
                      const scaledCup = cupR * scale;
                      const cx = 150;
                      const cy = 110;
                      const discColor = cdr > 0.7 ? V.neg : cdr >= 0.5 ? V.warn : V.pos;
                      const cupColor = cdr > 0.7 ? "#FF4444" : cdr >= 0.5 ? "#FFB84D" : "#44CC88";

                      return (
                        <svg viewBox="0 0 300 220" xmlns="http://www.w3.org/2000/svg"
                          style={{ width: "100%", maxWidth: "280px", height: "220px" }}>
                          <rect width="300" height="220" rx="8" fill="#0C1018" />
                          <circle cx={cx} cy={cy} r={scaledDisc + 20} fill="#1A0803" opacity="0.6" />
                          <circle cx={cx} cy={cy} r={scaledDisc} fill="none" stroke={discColor} strokeWidth="2.5" />
                          <circle cx={cx} cy={cy} r={scaledDisc} fill="#FFEEBB" opacity="0.15" />
                          <circle cx={cx} cy={cy} r={scaledCup} fill="none" stroke={cupColor} strokeWidth="2" />
                          <circle cx={cx} cy={cy} r={scaledCup} fill={cupColor} opacity="0.2" />
                          <line x1={cx - scaledDisc} y1={cy} x2={cx + scaledDisc} y2={cy}
                            stroke="rgba(255,255,255,0.2)" strokeWidth="1" strokeDasharray="3,3" />
                          <line x1={cx - scaledCup} y1={cy} x2={cx + scaledCup} y2={cy}
                            stroke={cupColor} strokeWidth="1.5" opacity="0.6" />
                          <text x={cx} y={cy + 4} textAnchor="middle"
                            fill="white" fontSize="11" fontWeight="700" fontFamily="DM Mono,monospace">
                            {cdr.toFixed(2)}
                          </text>
                          <rect x="168" y="16" width="120" height="88" rx="5"
                            fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.07)" strokeWidth="1" />
                          <text x="178" y="31" fill="rgba(160,180,200,0.8)"
                            fontSize="9.5" fontWeight="600" fontFamily="DM Sans,sans-serif">
                            Segmentation Legend
                          </text>
                          <circle cx="178" cy="46" r="5" fill="none" stroke={discColor} strokeWidth="2" />
                          <text x="188" y="50" fill="rgba(160,200,160,0.9)" fontSize="9.5" fontFamily="DM Sans,sans-serif">Optic Disc</text>
                          <text x="188" y="61" fill="rgba(120,160,120,0.65)" fontSize="9" fontFamily="DM Mono,monospace">r = {discR.toFixed(0)}px</text>
                          <circle cx="178" cy="76" r="5" fill="none" stroke={cupColor} strokeWidth="2" />
                          <text x="188" y="80" fill="rgba(220,140,140,0.9)" fontSize="9.5" fontFamily="DM Sans,sans-serif">Optic Cup</text>
                          <text x="188" y="91" fill="rgba(180,100,100,0.65)" fontSize="9" fontFamily="DM Mono,monospace">r = {cupR.toFixed(0)}px</text>
                          <rect x="168" y="112" width="120" height="18" rx="4"
                            fill={`rgba(${cdr > 0.7 ? "255,60,60" : cdr >= 0.5 ? "255,184,77" : "34,201,148"},0.15)`}
                            stroke={`rgba(${cdr > 0.7 ? "255,80,80" : cdr >= 0.5 ? "255,200,100" : "34,201,148"},0.3)`}
                            strokeWidth="1" />
                          <text x="228" y="125" textAnchor="middle"
                            fill={discColor} fontSize="10" fontWeight="700" fontFamily="DM Mono,monospace">
                            CDR = {cdr.toFixed(2)} {cdr > 0.7 ? "▲ Elevated" : cdr >= 0.5 ? "— Borderline" : "✓ Normal"}
                          </text>
                          {cdr > 0.5 && (
                            <>
                              <text x={cx} y={cy - scaledDisc - 6} textAnchor="middle"
                                fill="#FF9944" fontSize="9" fontFamily="DM Mono,monospace">↓ thin</text>
                              <text x={cx} y={cy + scaledDisc + 14} textAnchor="middle"
                                fill="#FF9944" fontSize="9" fontFamily="DM Mono,monospace">↑ thin</text>
                            </>
                          )}
                          <text x="150" y="210" textAnchor="middle"
                            fill="rgba(140,165,190,0.45)" fontSize="8.5" fontFamily="DM Sans,sans-serif">
                            Approximate CDR — classical image processing
                          </text>
                        </svg>
                      );
                    })()}
                  </div>

                  {/* CDR metrics */}
                  <div>
                    <div className="bg-surface2 rounded-xl p-4 mb-3">
                      <div className="text-xs text-text3 uppercase tracking-wider mb-2">Approximate CDR</div>
                      <div className={`text-3xl font-bold font-mono mb-1 ${
                        parseFloat(result.cdr) > 0.7 ? "text-neg" :
                        parseFloat(result.cdr) >= 0.5 ? "text-warn" : "text-pos"
                      }`}>
                        {parseFloat(result.cdr).toFixed(2)}
                      </div>
                      <div className="text-xs text-text3">
                        {parseFloat(result.cdr) > 0.7 ? "Suspicious — refer for evaluation"
                          : parseFloat(result.cdr) >= 0.5 ? "Borderline — monitor closely"
                          : "Within normal range"}
                      </div>
                    </div>

                    {[
                      { label: "Normal",     range: "CDR < 0.5",     color: "pos", active: parseFloat(result.cdr) < 0.5 },
                      { label: "Borderline", range: "CDR 0.5 - 0.7", color: "warn", active: parseFloat(result.cdr) >= 0.5 && parseFloat(result.cdr) <= 0.7 },
                      { label: "Suspicious", range: "CDR > 0.7",     color: "neg", active: parseFloat(result.cdr) > 0.7 },
                    ].map(r => (
                      <div key={r.label} className={`flex items-center gap-2 px-3 py-2 rounded-lg mb-1.5 border ${
                        r.active
                          ? `bg-${r.color}/10 border-${r.color}/20`
                          : "bg-transparent border-transparent"
                      }`}>
                        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${r.active ? `bg-${r.color}` : "bg-text3"}`} />
                        <span className={`text-xs font-medium ${r.active ? `text-${r.color}` : "text-text3"}`}>
                          {r.label}
                        </span>
                        <span className="text-xs text-text3 ml-auto font-mono">{r.range}</span>
                      </div>
                    ))}

                    <div className="text-xs text-text3 leading-relaxed p-3 bg-surface2 rounded-lg border border-white/7 mt-2">
                      ℹ CDR approximated using classical image processing. A dedicated segmentation model is planned as future work.
                    </div>
                  </div>

                </div>
              ) : (
                <div className="bg-surface2 rounded-xl h-40 flex items-center justify-center border border-dashed border-white/12 text-text3 text-sm">
                  <div className="text-center">
                    <div className="text-3xl mb-2">👁</div>
                    <div>Segmentation pending</div>
                    <div className="text-xs mt-1">CDR not yet available</div>
                  </div>
                </div>
              )}
            </div>
          </div>

        </div>

        {/* RIGHT */}
        <div className="flex flex-col gap-4">

          {/* Screening Info */}
          <div className="bg-surface border border-white/7 rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-white/7">
              <span className="text-sm font-semibold text-text1">Screening Info</span>
            </div>
            <div className="p-4">
              <InfoRow label="Date" value={formatDate(data?.created_at)} />
              <InfoRow label="Eye Side"
                value={data?.eye_side?.charAt(0).toUpperCase() + data?.eye_side?.slice(1)} />
              <InfoRow label="Model"
                value={result?.model_used === "ensemble" ? "Ensemble (All Models)" : result?.model_used} />
              <InfoRow label="Status"
                value={data?.status?.charAt(0).toUpperCase() + data?.status?.slice(1)}
                valueClass={data?.status === "complete" ? "text-pos font-medium" : "text-warn font-medium"} />
              <InfoRow label="Threshold"
                value={parseFloat(result?.threshold_used || 0.5).toFixed(4)} />
            </div>
          </div>

          {/* Referral Letter */}
          <div className="bg-surface border border-white/7 rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-white/7 flex items-center gap-3">
              <span className="text-sm font-semibold text-text1 flex-1">Referral Letter</span>
              {inferenceMode === "research" && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-warn/10 text-warn border border-warn/20">
                  Research Mode
                </span>
              )}
            </div>
            <div className="p-4">
              {referralResults.length === 0 ? (
                <div className="text-center py-4">
                  <div className="text-2xl mb-2">📋</div>
                  <div className="text-sm text-text3">
                    {isGlaucoma ? "Generating referral letter..." : "No referral required — normal result."}
                  </div>
                </div>
              ) : inferenceMode === "clinical" ? (
                <div className="text-xs text-text2 leading-relaxed whitespace-pre-wrap">
                  {gpt4o?.referral_letter || referralResults[0]?.referral_letter}
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {[
                    { key: "gpt4o",      data: gpt4o,     label: "GPT-4o",      dot: "#10a37f" },
                    { key: "gpt4o_mini", data: gpt4oMini, label: "GPT-4o Mini", dot: "#10a37f" },
                    { key: "llama",      data: llama,      label: "LLaMA",       dot: "#ff6b35" },
                    { key: "gemini",     data: gemini,     label: "Gemini",      dot: "#4285f4" },
                  ].filter(m => m.data).map(m => (
                    <div key={m.key} className="bg-surface2 rounded-lg border border-white/7 overflow-hidden">
                      <div className="px-3 py-2 border-b border-white/7 flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: m.dot }} />
                        <span className="text-xs font-semibold text-text1">{m.label}</span>
                      </div>
                      <div className="p-3 text-xs text-text2 leading-relaxed whitespace-pre-wrap max-h-36 overflow-y-auto">
                        {m.data.referral_letter}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="bg-surface border border-white/7 rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-white/7">
              <span className="text-sm font-semibold text-text1">Actions</span>
            </div>
            <div className="p-4 flex flex-col gap-2">
              <button className="w-full py-2.5 text-xs font-medium text-white bg-accent hover:bg-accent2 rounded-lg border-0 transition-colors cursor-pointer font-sans">
                📄 Download PDF Report
              </button>
              <button
                onClick={() => navigate("/screenings/new", { state: { patientId: data?.patient_id } })}
                className="w-full py-2.5 text-xs font-medium text-text2 border border-white/12 rounded-lg bg-transparent hover:bg-white/5 transition-colors cursor-pointer font-sans"
              >
                🔬 Screen Again
              </button>
              <button
                onClick={() => navigate(`/patients/${data?.patient_id}`)}
                className="w-full py-2.5 text-xs font-medium text-text2 border border-white/12 rounded-lg bg-transparent hover:bg-white/5 transition-colors cursor-pointer font-sans"
              >
                👤 View Patient
              </button>
            </div>
          </div>

        </div>
      </div>

      {/* Processing overlay */}
      {isProcessing && (
        <div className="loading-overlay">
          <div className="loading-content">
            <div className="spinner" />
            <h3 className="text-text1 text-lg font-semibold mb-2">Analysing Image...</h3>
            <p className="text-text2 text-sm mb-1">AI model is processing your fundus image</p>
            <p className="text-text3 text-xs">Inference → Grad-CAM++ → GPT-4o → PDF</p>
          </div>
        </div>
      )}

    </Layout>
  );
}

export default ScreeningResult;
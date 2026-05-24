// src/pages/ScreeningResult.jsx
// Screening Result page - Clinical Mode view.
// Fetches GET /results/:screeningId/full from backend.
// Shows: AI disclaimer, Grad-CAM++ heatmap, OHTS risk score, referral letter.
// All values from API - no hardcoded data.

import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import Layout from "../components/Layout";
import API from "../api/index";

const V = {
  surface:   "#131D2E",
  surface2:  "#1A2840",
  surface3:  "#1F3050",
  border:    "rgba(255,255,255,0.07)",
  border2:   "rgba(255,255,255,0.12)",
  accent:    "#3B9EFF",
  accent2:   "#5BB8FF",
  accentDim: "rgba(59,158,255,0.12)",
  pos:       "#22C994",
  posDim:    "rgba(34,201,148,0.12)",
  neg:       "#FF6B6B",
  negDim:    "rgba(255,107,107,0.12)",
  warn:      "#FFB84D",
  warnDim:   "rgba(255,184,77,0.12)",
  text:      "#E8EEF7",
  text2:     "#8FA3BF",
  text3:     "#4E6580",
};

const BACKEND = "http://localhost:8000";

const btnGhost = {
  padding: "6px 13px", borderRadius: "7px",
  fontSize: "12px", fontWeight: "500", cursor: "pointer",
  background: "transparent", color: V.text2,
  border: `1px solid ${V.border2}`,
  fontFamily: "'DM Sans',sans-serif",
  display: "inline-flex", alignItems: "center", gap: "5px",
};

const btnPrimary = {
  padding: "6px 13px", borderRadius: "7px",
  fontSize: "12px", fontWeight: "500", cursor: "pointer",
  background: V.accent, color: "white", border: "none",
  fontFamily: "'DM Sans',sans-serif",
  display: "inline-flex", alignItems: "center", gap: "5px",
};

function InfoRow({ label, value, valueColor }) {
  return (
    <div style={{
      display: "flex", justifyContent: "space-between",
      fontSize: "13px", marginBottom: "8px",
      paddingBottom: "8px", borderBottom: `1px solid ${V.border}`,
    }}>
      <span style={{ color: V.text3 }}>{label}</span>
      <span style={{ color: valueColor || V.text, fontWeight: "500" }}>{value || "—"}</span>
    </div>
  );
}

function PredictionBadge({ prediction }) {
  const isGlaucoma = prediction?.toLowerCase() === "glaucoma";
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: "5px",
      padding: "4px 12px", borderRadius: "20px",
      fontSize: "13px", fontWeight: "600",
      background: isGlaucoma ? V.negDim : V.posDim,
      color: isGlaucoma ? V.neg : V.pos,
      border: `1px solid ${isGlaucoma ? "rgba(255,107,107,0.3)" : "rgba(34,201,148,0.3)"}`,
    }}>
      <span style={{
        width: 7, height: 7, borderRadius: "50%",
        background: "currentColor", display: "inline-block",
      }} />
      {isGlaucoma ? "Glaucoma Positive" : "Normal"}
    </span>
  );
}

function OHTSTierBadge({ tier }) {
  const map = {
    critical: { bg: V.negDim,  color: V.neg,  label: "Critical - High Risk" },
    possible: { bg: V.warnDim, color: V.warn, label: "Possible in 5 Years" },
    low:      { bg: V.posDim,  color: V.pos,  label: "Low Risk" },
  };
  const c = map[tier?.toLowerCase()] || map.low;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: "5px",
      padding: "4px 12px", borderRadius: "20px",
      fontSize: "12px", fontWeight: "600",
      background: c.bg, color: c.color,
    }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: "currentColor", display: "inline-block" }} />
      {c.label}
    </span>
  );
}

function ScreeningResult() {
  const { screeningId } = useParams();
  const navigate = useNavigate();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    API.get(`/results/${screeningId}/full`)
      .then(res => {
        setData(res.data);
        setLoading(false);
      })
      .catch(() => {
        setError("Failed to load screening result.");
        setLoading(false);
      });
  }, [screeningId]);

  function formatDate(d) {
    if (!d) return "-";
    return new Date(d).toLocaleDateString("en-NZ", {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit",
      timeZone: "Pacific/Auckland",
    });
  }

  function formatConfidence(score) {
    if (!score) return "—";
    return `${(parseFloat(score) * 100).toFixed(1)}%`;
  }

  if (loading) return (
    <Layout title="Screening Result">
      <p style={{ color: V.text3, fontSize: "13px" }}>Loading result...</p>
    </Layout>
  );

  if (error) return (
    <Layout title="Screening Result">
      <p style={{ color: V.neg, fontSize: "13px" }}>{error}</p>
    </Layout>
  );

  // Extract ensemble result
  const result = data?.results?.find(r => r.model_used === "ensemble") || data?.results?.[0];
  const confidence = parseFloat(result?.confidence_score || 0);
  const confidencePct = (confidence * 100).toFixed(1);
  const isGlaucoma = result?.prediction?.toLowerCase() === "glaucoma";
  const confidenceColor = isGlaucoma ? V.neg : confidence > 0.6 ? V.warn : V.pos;

  // OHTS points mapping based on real validated scale
  function getOHTSPoints(score) {
    const s = parseFloat(score || 0);
    if (s > 12) return { tier: "High", color: V.neg, pct: "≥33%" };
    if (s >= 7)  return { tier: "Moderate", color: V.warn, pct: "10-20%" };
    return { tier: "Low", color: V.pos, pct: "≤4%" };
  }

  const ohtsInfo = getOHTSPoints(result?.ohts_score);

  // Top bar actions
  const actions = (
    <>
      <button style={btnGhost} onClick={() => navigate(-1)}>
        ← Back
      </button>
      <button style={btnPrimary}>
        📄 PDF Report
      </button>
    </>
  );

  return (
    <Layout title="Screening Result" actions={actions}>

      {/* Breadcrumb */}
      <div style={{
        display: "flex", alignItems: "center", gap: "6px",
        fontSize: "12px", color: V.text3, marginBottom: "16px",
      }}>
        <span onClick={() => navigate("/patients")} style={{ cursor: "pointer" }}
          onMouseEnter={e => e.currentTarget.style.color = V.accent2}
          onMouseLeave={e => e.currentTarget.style.color = V.text3}>
          Patients
        </span>
        <span>›</span>
        <span onClick={() => navigate(-1)} style={{ cursor: "pointer" }}
          onMouseEnter={e => e.currentTarget.style.color = V.accent2}
          onMouseLeave={e => e.currentTarget.style.color = V.text3}>
          Screening History
        </span>
        <span>›</span>
        <span style={{ color: V.text2 }}>Result — {formatDate(data?.created_at)}</span>
      </div>

      {/* AI Disclaimer */}
      <div style={{
        padding: "12px 16px", borderRadius: "8px", marginBottom: "16px",
        background: V.warnDim, border: `1px solid rgba(255,184,77,0.3)`,
        fontSize: "13px", color: V.warn, lineHeight: "1.6",
      }}>
        ⚠ AI-assisted result only. Clinical judgment required before any diagnosis or referral.
      </div>

      {/* Two column layout */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: "16px" }}>

        {/* LEFT COLUMN */}
        <div>

          {/* Grad-CAM++ Card */}
          <div style={{
            background: V.surface, border: `1px solid ${V.border}`,
            borderRadius: "11px", overflow: "hidden", marginBottom: "16px",
          }}>
            <div style={{ padding: "14px 18px", borderBottom: `1px solid ${V.border}` }}>
              <span style={{ fontSize: "13.5px", fontWeight: "600", color: V.text }}>
                Fundus Image + Grad-CAM++
              </span>
            </div>
            <div style={{ padding: "18px" }}>

              {/* Image area */}
              <div style={{
                borderRadius: "10px", overflow: "hidden",
                background: "#060A10", marginBottom: "14px",
                minHeight: "220px", display: "flex",
                alignItems: "center", justifyContent: "center",
              }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
            {/* Fundus Image */}
            <div>
                <div style={{
                fontSize: "11px", color: V.text3, textAlign: "center",
                marginBottom: "6px", textTransform: "uppercase", letterSpacing: "0.7px",
                }}>
                Original Fundus Image
                </div>
                <div style={{
                borderRadius: "8px", overflow: "hidden", background: "#060A10",
                minHeight: "180px", display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                {data?.image_path ? (
                    <img
                    src={`${BACKEND}/${data.image_path.replace(/\\/g, "/")}`}
                    alt="Fundus image"
                    style={{ width: "100%", display: "block" }}
                    />
                ) : (
                    <div style={{ color: V.text3, fontSize: "12px", padding: "16px" }}>
                    Not available
                    </div>
                )}
                </div>
            </div>

            {/* Grad-CAM++ Heatmap */}
            <div>
                <div style={{
                fontSize: "11px", color: V.text3, textAlign: "center",
                marginBottom: "6px", textTransform: "uppercase", letterSpacing: "0.7px",
                }}>
                Grad-CAM++ Heatmap
                </div>
                <div style={{
                borderRadius: "8px", overflow: "hidden", background: "#060A10",
                minHeight: "180px", display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                {data?.screening_id && result?.model_used ? (
                    <img
                    src={`${BACKEND}/uploads/gradcam/${data.screening_id}_${result.model_used}_gradcam.png`}
                    alt="Grad-CAM++ heatmap"
                    style={{ width: "100%", display: "block" }}
                    onError={e => {
                        e.target.style.display = "none";
                        e.target.nextSibling.style.display = "flex";
                    }}
                    />
                ) : null}
                <div style={{
                    display: "none", flexDirection: "column",
                    alignItems: "center", justifyContent: "center",
                    color: V.text3, fontSize: "12px", padding: "16px",
                    width: "100%", height: "100%",
                }}>
                    <div style={{ fontSize: "24px", marginBottom: "6px" }}>🔬</div>
                    <div>Grad-CAM++ not available</div>
                </div>
                </div>
            </div>
            </div>
              </div>

              {/* Confidence bar */}
              <div style={{ marginBottom: "10px" }}>
                <div style={{
                  display: "flex", justifyContent: "space-between",
                  fontSize: "12px", color: V.text2, marginBottom: "6px",
                }}>
                  <span>Confidence Score</span>
                  <span style={{ color: confidenceColor, fontWeight: "600" }}>
                    {confidencePct}%
                  </span>
                </div>
                <div style={{
                  height: "8px", background: V.surface3,
                  borderRadius: "4px", overflow: "hidden",
                }}>
                  <div style={{
                    height: "100%", borderRadius: "4px",
                    width: `${confidencePct}%`,
                    background: `linear-gradient(90deg, ${V.warn}, ${confidenceColor})`,
                    transition: "width 0.5s ease",
                  }} />
                </div>
              </div>

              {/* Result + threshold */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontSize: "12px", color: V.text3 }}>
                  Threshold: {parseFloat(result?.threshold_used || 0.5).toFixed(2)}
                </div>
                <PredictionBadge prediction={result?.prediction} />
              </div>

            </div>
          </div>

          {/* OHTS Risk Score Card */}
          <div style={{
            background: V.surface, border: `1px solid ${V.border}`,
            borderRadius: "11px", overflow: "hidden", marginBottom: "16px",
          }}>
            <div style={{
              padding: "14px 18px", borderBottom: `1px solid ${V.border}`,
              display: "flex", alignItems: "center", gap: "10px",
            }}>
              <span style={{ fontSize: "13.5px", fontWeight: "600", color: V.text, flex: 1 }}>
                OHTS Risk Score
              </span>
              <span style={{ fontSize: "11px", color: V.text3 }}>
                Ocular Hypertension Treatment Study
              </span>
            </div>
            <div style={{ padding: "18px" }}>

              {result?.ohts_score ? (
                <>
                  {/* Score display */}
                  <div style={{
                    display: "flex", alignItems: "center", gap: "16px",
                    marginBottom: "16px", padding: "14px",
                    background: V.surface2, borderRadius: "10px",
                  }}>
                    <div style={{ textAlign: "center" }}>
                      <div style={{
                        fontSize: "36px", fontWeight: "700",
                        color: ohtsInfo.color, fontFamily: "'DM Mono',monospace",
                        lineHeight: 1,
                      }}>
                        {parseFloat(result.ohts_score).toFixed(0)}
                      </div>
                      <div style={{ fontSize: "11px", color: V.text3, marginTop: "4px" }}>
                        / 16 pts
                      </div>
                    </div>
                    <div>
                      <OHTSTierBadge tier={result.ohts_tier} />
                      <div style={{ fontSize: "12px", color: V.text3, marginTop: "6px" }}>
                        Estimated 5-year POAG risk: {ohtsInfo.pct}
                      </div>
                    </div>
                  </div>

                  {/* Tier legend */}
                  <div style={{
                    fontSize: "11px", color: V.text3,
                    textAlign: "center", marginBottom: "12px",
                  }}>
                    0-6 = Low · 7-12 = Moderate · &gt;12 = High
                  </div>

                  {/* Citation */}
                  <div style={{
                    fontSize: "11px", color: V.text3,
                    textAlign: "center",
                    borderTop: `1px solid ${V.border}`,
                    paddingTop: "10px",
                  }}>
                    Based on Ocular Hypertension Treatment Study (OHTS) — Kass et al. (2002)
                  </div>
                </>
              ) : (
                <p style={{ color: V.text3, fontSize: "13px" }}>
                  OHTS score not available. IOP and CCT required.
                </p>
              )}
            </div>
          </div>

          {/* Biomarker Visualization Placeholder */}
          <div style={{
            background: V.surface, border: `1px solid ${V.border}`,
            borderRadius: "11px", overflow: "hidden",
          }}>
            <div style={{ padding: "14px 18px", borderBottom: `1px solid ${V.border}` }}>
              <span style={{ fontSize: "13.5px", fontWeight: "600", color: V.text }}>
                Biomarker Visualization
              </span>
            </div>
            <div style={{ padding: "18px" }}>
              <div style={{
                background: V.surface2, borderRadius: "10px",
                height: "160px", display: "flex",
                alignItems: "center", justifyContent: "center",
                border: `1px dashed ${V.border2}`,
                color: V.text3, fontSize: "13px", textAlign: "center",
              }}>
                <div>
                  <div style={{ fontSize: "28px", marginBottom: "8px" }}>👁</div>
                  <div>Optic Disc/Cup Segmentation</div>
                  <div style={{ fontSize: "11px", marginTop: "4px" }}>Coming soon</div>
                </div>
              </div>
            </div>
          </div>

        </div>

        {/* RIGHT COLUMN */}
        <div>

          {/* Screening Info Card */}
          <div style={{
            background: V.surface, border: `1px solid ${V.border}`,
            borderRadius: "11px", overflow: "hidden", marginBottom: "16px",
          }}>
            <div style={{ padding: "14px 18px", borderBottom: `1px solid ${V.border}` }}>
              <span style={{ fontSize: "13.5px", fontWeight: "600", color: V.text }}>
                Screening Info
              </span>
            </div>
            <div style={{ padding: "18px" }}>
              <InfoRow label="Date" value={formatDate(data?.created_at)} />
              <InfoRow label="Eye Side" value={data?.eye_side?.charAt(0).toUpperCase() + data?.eye_side?.slice(1)} />
              <InfoRow label="Model" value={result?.model_used === "ensemble" ? "Ensemble (All Models)" : result?.model_used} />
              <InfoRow label="Status" value={data?.status?.charAt(0).toUpperCase() + data?.status?.slice(1)}
                valueColor={data?.status === "complete" ? V.pos : V.warn} />
              <InfoRow label="Threshold" value={parseFloat(result?.threshold_used || 0.5).toFixed(4)} />
            </div>
          </div>

          {/* Referral Letter Card */}
          <div style={{
            background: V.surface, border: `1px solid ${V.border}`,
            borderRadius: "11px", overflow: "hidden", marginBottom: "16px",
          }}>
            <div style={{ padding: "14px 18px", borderBottom: `1px solid ${V.border}` }}>
              <span style={{ fontSize: "13.5px", fontWeight: "600", color: V.text }}>
                Referral Letter
              </span>
            </div>
            <div style={{ padding: "18px" }}>
              {result?.referral_letter ? (
                <div style={{
                  fontSize: "12.5px", color: V.text2,
                  lineHeight: "1.7", whiteSpace: "pre-wrap",
                }}>
                  {result.referral_letter}
                </div>
              ) : (
                <div style={{ textAlign: "center", padding: "16px 0" }}>
                  <div style={{ fontSize: "24px", marginBottom: "8px" }}>📋</div>
                  <div style={{ fontSize: "13px", color: V.text3 }}>
                    {isGlaucoma
                      ? "Generating referral letter..."
                      : "No referral required — normal result."}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Actions Card */}
          <div style={{
            background: V.surface, border: `1px solid ${V.border}`,
            borderRadius: "11px", overflow: "hidden",
          }}>
            <div style={{ padding: "14px 18px", borderBottom: `1px solid ${V.border}` }}>
              <span style={{ fontSize: "13.5px", fontWeight: "600", color: V.text }}>
                Actions
              </span>
            </div>
            <div style={{ padding: "18px", display: "flex", flexDirection: "column", gap: "8px" }}>
              <button style={{ ...btnPrimary, justifyContent: "center", padding: "10px" }}>
                📄 Download PDF Report
              </button>
              <button
                style={{ ...btnGhost, justifyContent: "center", padding: "10px" }}
                onClick={() => navigate("/screenings/new", {
                  state: { patientId: data?.patient_id }
                })}
              >
                🔬 Screen Again
              </button>
              <button
                style={{ ...btnGhost, justifyContent: "center", padding: "10px" }}
                onClick={() => navigate(`/patients/${data?.patient_id}`)}
              >
                👤 View Patient
              </button>
            </div>
          </div>

        </div>
      </div>
    </Layout>
  );
}

export default ScreeningResult;
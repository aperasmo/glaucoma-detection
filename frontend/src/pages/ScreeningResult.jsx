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
    let interval = null;

    function fetchResult() {
        API.get(`/results/${screeningId}/full`)
        .then(res => {
            setData(res.data);
            setLoading(false);

            // Stop polling when complete or failed
            const status = res.data?.status;
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

    // Fetch immediately
    fetchResult();

    // Poll every 3 seconds
    interval = setInterval(fetchResult, 3000);

    // Cleanup on unmount
    return () => {
        if (interval) clearInterval(interval);
    };
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

{/* Biomarker Visualization Card */}
<div style={{
  background: V.surface, border: `1px solid ${V.border}`,
  borderRadius: "11px", overflow: "hidden", marginTop: "16px",
}}>
  <div style={{
    padding: "14px 18px", borderBottom: `1px solid ${V.border}`,
    display: "flex", alignItems: "center", gap: "10px",
  }}>
    <span style={{ fontSize: "13.5px", fontWeight: "600", color: V.text, flex: 1 }}>
      Biomarker Visualization
    </span>
    <span style={{
      fontSize: "11px", padding: "2px 8px", borderRadius: "10px",
      background: V.warnDim, color: V.warn, fontWeight: "500",
    }}>
      Approximate
    </span>
  </div>
  <div style={{ padding: "18px" }}>
    {result?.cdr != null && result?.disc_radius != null && result?.cup_radius != null ? (
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px", alignItems: "center" }}>

        {/* SVG Diagram */}
        <div style={{ display: "flex", justifyContent: "center" }}>
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

                {/* Background */}
                <rect width="300" height="220" rx="8" fill="#0C1018" />

                {/* Fundus circle background */}
                <circle cx={cx} cy={cy} r={scaledDisc + 20} fill="#1A0803" opacity="0.6" />

                {/* Optic disc */}
                <circle cx={cx} cy={cy} r={scaledDisc}
                  fill="none" stroke={discColor} strokeWidth="2.5" />
                <circle cx={cx} cy={cy} r={scaledDisc}
                  fill="#FFEEBB" opacity="0.15" />

                {/* Optic cup */}
                <circle cx={cx} cy={cy} r={scaledCup}
                  fill="none" stroke={cupColor} strokeWidth="2" />
                <circle cx={cx} cy={cy} r={scaledCup}
                  fill={cupColor} opacity="0.2" />

                {/* CDR diameter line */}
                <line
                  x1={cx - scaledDisc} y1={cy}
                  x2={cx + scaledDisc} y2={cy}
                  stroke="rgba(255,255,255,0.2)" strokeWidth="1" strokeDasharray="3,3"
                />
                <line
                  x1={cx - scaledCup} y1={cy}
                  x2={cx + scaledCup} y2={cy}
                  stroke={cupColor} strokeWidth="1.5" opacity="0.6"
                />

                {/* CDR label inside */}
                <text x={cx} y={cy + 4} textAnchor="middle"
                  fill="white" fontSize="11" fontWeight="700"
                  fontFamily="DM Mono,monospace">
                  {cdr.toFixed(2)}
                </text>

                {/* Legend */}
                <rect x="168" y="16" width="120" height="88" rx="5"
                  fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.07)" strokeWidth="1" />
                <text x="178" y="31" fill="rgba(160,180,200,0.8)"
                  fontSize="9.5" fontWeight="600" fontFamily="DM Sans,sans-serif">
                  Segmentation Legend
                </text>

                {/* Disc legend */}
                <circle cx="178" cy="46" r="5" fill="none" stroke={discColor} strokeWidth="2" />
                <text x="188" y="50" fill="rgba(160,200,160,0.9)"
                  fontSize="9.5" fontFamily="DM Sans,sans-serif">Optic Disc</text>
                <text x="188" y="61" fill="rgba(120,160,120,0.65)"
                  fontSize="9" fontFamily="DM Mono,monospace">
                  r = {discR.toFixed(0)}px
                </text>

                {/* Cup legend */}
                <circle cx="178" cy="76" r="5" fill="none" stroke={cupColor} strokeWidth="2" />
                <text x="188" y="80" fill="rgba(220,140,140,0.9)"
                  fontSize="9.5" fontFamily="DM Sans,sans-serif">Optic Cup</text>
                <text x="188" y="91" fill="rgba(180,100,100,0.65)"
                  fontSize="9" fontFamily="DM Mono,monospace">
                  r = {cupR.toFixed(0)}px
                </text>

                {/* CDR badge at bottom */}
                <rect x="168" y="112" width="120" height="18" rx="4"
                  fill={`rgba(${cdr > 0.7 ? "255,60,60" : cdr >= 0.5 ? "255,184,77" : "34,201,148"},0.15)`}
                  stroke={`rgba(${cdr > 0.7 ? "255,80,80" : cdr >= 0.5 ? "255,200,100" : "34,201,148"},0.3)`}
                  strokeWidth="1" />
                <text x="228" y="125" textAnchor="middle"
                  fill={discColor} fontSize="10" fontWeight="700"
                  fontFamily="DM Mono,monospace">
                  CDR = {cdr.toFixed(2)} {cdr > 0.7 ? "▲ Elevated" : cdr >= 0.5 ? "— Borderline" : "✓ Normal"}
                </text>

                {/* Thinning indicators */}
                {cdr > 0.5 && (
                  <>
                    <text x={cx} y={cy - scaledDisc - 6} textAnchor="middle"
                      fill="#FF9944" fontSize="9" fontFamily="DM Mono,monospace">
                      ↓ thin
                    </text>
                    <text x={cx} y={cy + scaledDisc + 14} textAnchor="middle"
                      fill="#FF9944" fontSize="9" fontFamily="DM Mono,monospace">
                      ↑ thin
                    </text>
                  </>
                )}

                {/* Bottom note */}
                <text x="150" y="210" textAnchor="middle"
                  fill="rgba(140,165,190,0.45)" fontSize="8.5"
                  fontFamily="DM Sans,sans-serif">
                  Approximate CDR — classical image processing
                </text>
              </svg>
            );
          })()}
        </div>

        {/* Right panel - metrics */}
        <div>
          {/* CDR value */}
          <div style={{
            background: V.surface2, borderRadius: "10px",
            padding: "14px 16px", marginBottom: "12px",
          }}>
            <div style={{ fontSize: "11px", color: V.text3, marginBottom: "6px", textTransform: "uppercase", letterSpacing: "0.7px" }}>
              Approximate CDR
            </div>
            <div style={{
              fontSize: "28px", fontWeight: "700",
              fontFamily: "'DM Mono',monospace",
              color: parseFloat(result.cdr) > 0.7 ? V.neg : parseFloat(result.cdr) >= 0.5 ? V.warn : V.pos,
            }}>
              {parseFloat(result.cdr).toFixed(2)}
            </div>
            <div style={{ fontSize: "12px", color: V.text3, marginTop: "4px" }}>
              {parseFloat(result.cdr) > 0.7 ? "Suspicious — refer for evaluation"
                : parseFloat(result.cdr) >= 0.5 ? "Borderline — monitor closely"
                : "Within normal range"}
            </div>
          </div>

          {/* Clinical ranges */}
          <div style={{ marginBottom: "12px" }}>
            {[
              { label: "Normal", range: "CDR < 0.5", color: V.pos, active: parseFloat(result.cdr) < 0.5 },
              { label: "Borderline", range: "CDR 0.5 - 0.7", color: V.warn, active: parseFloat(result.cdr) >= 0.5 && parseFloat(result.cdr) <= 0.7 },
              { label: "Suspicious", range: "CDR > 0.7", color: V.neg, active: parseFloat(result.cdr) > 0.7 },
            ].map(r => (
              <div key={r.label} style={{
                display: "flex", alignItems: "center", gap: "8px",
                padding: "7px 10px", borderRadius: "7px", marginBottom: "4px",
                background: r.active ? `rgba(${r.color === V.pos ? "34,201,148" : r.color === V.warn ? "255,184,77" : "255,107,107"},0.1)` : "transparent",
                border: `1px solid ${r.active ? r.color + "44" : "transparent"}`,
              }}>
                <span style={{
                  width: 8, height: 8, borderRadius: "50%",
                  background: r.active ? r.color : V.text3,
                  display: "inline-block", flexShrink: 0,
                }} />
                <span style={{ fontSize: "12px", color: r.active ? r.color : V.text3, fontWeight: r.active ? "600" : "400" }}>
                  {r.label}
                </span>
                <span style={{ fontSize: "11px", color: V.text3, marginLeft: "auto", fontFamily: "'DM Mono',monospace" }}>
                  {r.range}
                </span>
              </div>
            ))}
          </div>

          {/* Disclaimer */}
          <div style={{
            fontSize: "11px", color: V.text3, lineHeight: "1.6",
            padding: "10px 12px", borderRadius: "7px",
            background: V.surface2, border: `1px solid ${V.border}`,
          }}>
            ℹ CDR approximated using classical image processing. A dedicated segmentation model is planned as future work.
          </div>
        </div>

      </div>
    ) : (
      <div style={{
        background: V.surface2, borderRadius: "10px",
        height: "160px", display: "flex",
        alignItems: "center", justifyContent: "center",
        border: `1px dashed ${V.border2}`,
        color: V.text3, fontSize: "13px", textAlign: "center",
      }}>
        <div>
          <div style={{ fontSize: "28px", marginBottom: "8px" }}>👁</div>
          <div>Segmentation pending</div>
          <div style={{ fontSize: "11px", marginTop: "4px" }}>CDR not yet available</div>
        </div>
      </div>
    )}
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
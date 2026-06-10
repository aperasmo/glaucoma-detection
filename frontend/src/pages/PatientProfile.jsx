// src/pages/PatientProfile.jsx
// Patient detail page.
// Left panel: patient info. Right panel: screening history + longitudinal risk chart.
//
// Important implementation note:
// /screenings/patient/{patientId} may only return the screening records.
// To display prediction, confidence score, and the risk chart, this page enriches each
// completed screening by calling /results/{screeningId}/full and attaching the primary result.

import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import Layout from "../components/Layout";
import API from "../api/index";

const GRADIENTS = [
  "from-accent to-accent2",
  "from-pos to-emerald-700",
  "from-warn to-amber-700",
  "from-purple-500 to-purple-800",
  "from-neg to-red-800",
];

function getInitials(firstName, lastName) {
  return `${firstName?.[0] ?? ""}${lastName?.[0] ?? ""}`.toUpperCase();
}

function getGradientIndex(name) {
  if (!name) return 0;
  return name.charCodeAt(0) % GRADIENTS.length;
}

function ResultBadge({ prediction }) {
  const map = {
    glaucoma: { cls: "bg-neg/10 text-neg border-neg/20", label: "Positive" },
    positive: { cls: "bg-neg/10 text-neg border-neg/20", label: "Positive" },
    normal: { cls: "bg-pos/10 text-pos border-pos/20", label: "Negative" },
    negative: { cls: "bg-pos/10 text-pos border-pos/20", label: "Negative" },
    complete: { cls: "bg-pos/10 text-pos border-pos/20", label: "Complete" },
    pending: { cls: "bg-warn/10 text-warn border-warn/20", label: "Pending" },
    failed: { cls: "bg-neg/10 text-neg border-neg/20", label: "Failed" },
  };

  const c = map[prediction?.toLowerCase()] || map.pending;

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${c.cls}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-current" />
      {c.label}
    </span>
  );
}

function InfoRow({ label, value, valueClass }) {
  return (
    <div className="flex justify-between text-sm mb-2 pb-2 border-b border-white/7">
      <span className="text-text3">{label}</span>
      <span className={valueClass || "text-text1"}>{value || "-"}</span>
    </div>
  );
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function toPercent(score) {
  if (score === null || score === undefined) return null;

  // Backend may return 0.635 or 63.5. This keeps both safe.
  return score <= 1 ? score * 100 : score;
}

function getPrimaryResultFromResults(results) {
  if (!Array.isArray(results)) return null;

  // Prefer the clinical result: ensemble and not an LLM referral-letter row.
  return (
    results.find(r => r.model_used === "ensemble" && !r.llm_used) ||
    results.find(r => !r.llm_used) ||
    null
  );
}

function getPrimaryResult(screening) {
  const results = Array.isArray(screening?.results) ? screening.results : [];

  return (
    screening?.result ||
    screening?.latest_result ||
    getPrimaryResultFromResults(results) ||
    null
  );
}

function getRiskScore(screening) {
  const result = getPrimaryResult(screening);

  return toNumber(
    result?.confidence_score ??
    screening?.confidence_score ??
    screening?.risk_score
  );
}

function getOhtsScore(screening) {
  const result = getPrimaryResult(screening);

  return toNumber(
    result?.ohts_score ??
    screening?.ohts_score
  );
}

function getScreeningPrediction(screening) {
  const result = getPrimaryResult(screening);

  if (result?.prediction) return result.prediction;
  if (screening?.prediction) return screening.prediction;

  // Do not show completed screenings as Pending.
  // If result details have not been returned or fetched, show Complete instead.
  if (screening?.status === "complete") return "complete";

  return screening?.status || "pending";
}

function formatRiskScore(screening) {
  const score = getRiskScore(screening);
  const percent = toPercent(score);

  return percent === null ? "—" : `${percent.toFixed(1)}%`;
}

function buildRiskChartPoints(screenings) {
  return [...screenings]
    .map(screening => {
      const riskScore = getRiskScore(screening);
      const ohtsScore = getOhtsScore(screening);

      return {
        screening_id: screening.screening_id,
        date: screening.created_at,
        eye_side: screening.eye_side,
        prediction: getScreeningPrediction(screening),
        riskPercent: toPercent(riskScore),
        ohtsScore,
      };
    })
    .filter(point => point.date && (point.riskPercent !== null || point.ohtsScore !== null))
    .sort((a, b) => new Date(a.date) - new Date(b.date));
}

function LongitudinalRiskChart({ screenings, formatDate, onViewResult }) {
  const points = buildRiskChartPoints(screenings);

  if (points.length === 0) {
    return (
      <div className="bg-surface2 rounded-xl h-44 flex flex-col items-center justify-center border border-dashed border-white/12 text-text3 text-sm">
        <div className="text-base font-medium text-text2 mb-1">No risk trend available yet</div>
        <div className="text-xs text-text3">
          Risk chart will appear once screening results include model scores.
        </div>
      </div>
    );
  }

  // Chart layout constants.
  // Adjust these values later if you want more or less chart padding.
  const width = 720;
  const height = 260;
  const pad = { top: 24, right: 28, bottom: 42, left: 54 };
  const innerWidth = width - pad.left - pad.right;
  const innerHeight = height - pad.top - pad.bottom;

  const sortedPoints = [...points].sort(
    (a, b) => new Date(a.date) - new Date(b.date)
  );

  // Group by calendar date so same-day left/right eye screenings do not look
  // like separate time points.
    const getTimeValue = value => {
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? null : date.getTime();
    };

    const validTimeValues = sortedPoints
      .map(point => getTimeValue(point.date))
      .filter(value => value !== null);

    const minTime = Math.min(...validTimeValues);
    const maxTime = Math.max(...validTimeValues);

    const hasSameDayScreenings =
      new Set(
        sortedPoints.map(point => {
          const date = new Date(point.date);
          return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
        })
      ).size === 1;

    const rightEyePoints = sortedPoints.filter(
      point => String(point.eye_side || "").toLowerCase() === "right"
    );

    const leftEyePoints = sortedPoints.filter(
      point => String(point.eye_side || "").toLowerCase() === "left"
    );

  const xForTime = dateValue => {
    const timeValue = getTimeValue(dateValue);

    if (timeValue === null || minTime === maxTime) {
      return pad.left + innerWidth / 2;
    }

    return pad.left + ((timeValue - minTime) / (maxTime - minTime)) * innerWidth;
  };

    const xForPoint = point => {
    const baseX = xForTime(point.date);
    const eyeSide = String(point.eye_side || "").toLowerCase();

    // Small offset only when left and right eyes share the same timestamp.
    // This prevents the markers from sitting directly on top of each other.
    const sameTimestampCount = sortedPoints.filter(
      other => getTimeValue(other.date) === getTimeValue(point.date)
    ).length;

    if (sameTimestampCount > 1) {
      if (eyeSide === "left") return baseX - 12;
      if (eyeSide === "right") return baseX + 12;
    }

    return baseX;
  };

  const formatAxisLabel = value => {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) return "";

    if (hasSameDayScreenings) {
      return date.toLocaleTimeString("en-NZ", {
        hour: "2-digit",
        minute: "2-digit",
      });
    }

    return formatDate(value);
  };
  const yForRisk = percent => {
    const clamped = Math.max(0, Math.min(100, percent));
    return pad.top + innerHeight - (clamped / 100) * innerHeight;
  };

  const getPointIndex = point => sortedPoints.indexOf(point);

  const buildEyePath = eyePoints => {
    const validPoints = eyePoints.filter(point => point.riskPercent !== null);

    if (validPoints.length < 2) return "";

    return validPoints
      .map((point, index) => {
        const x = xForPoint(point);
        const y = yForRisk(point.riskPercent);
        return `${index === 0 ? "M" : "L"} ${x} ${y}`;
      })
      .join(" ");
  };

  const rightEyePath = buildEyePath(rightEyePoints);
  const leftEyePath = buildEyePath(leftEyePoints);

  const latestPoint = sortedPoints[sortedPoints.length - 1];
  const latestRiskText =
    latestPoint.riskPercent === null ? "—" : `${latestPoint.riskPercent.toFixed(1)}%`;

  return (
    <div className="bg-surface2 rounded-xl border border-white/7 overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-white/7">
        <div>
          <div className="text-sm font-semibold text-text1">Patient Risk Over Time</div>
          <div className="text-xs text-text3">
            AI confidence score by eye and screening time, based on completed screening results.
          </div>
        </div>

        <div className="text-right">
          <div className="text-xs text-text3">Latest risk</div>
          <div className="text-lg font-semibold font-mono text-accent2">
            {latestRiskText}
          </div>
        </div>
      </div>

      <div className="p-4">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-64 block"
          role="img"
          aria-label="Longitudinal patient risk chart by eye"
        >
          <rect
            x="0"
            y="0"
            width={width}
            height={height}
            rx="14"
            fill="var(--surface)"
          />

          {[0, 25, 50, 75, 100].map(value => {
            const y = yForRisk(value);

            return (
              <g key={value}>
                <line
                  x1={pad.left}
                  y1={y}
                  x2={width - pad.right}
                  y2={y}
                  stroke="var(--border)"
                  strokeWidth="1"
                />
                <text
                  x={pad.left - 12}
                  y={y + 4}
                  textAnchor="end"
                  fontSize="11"
                  fill="var(--text3)"
                >
                  {value}%
                </text>
              </g>
            );
          })}

          <line
            x1={pad.left}
            y1={yForRisk(50)}
            x2={width - pad.right}
            y2={yForRisk(50)}
            stroke="var(--warn)"
            strokeWidth="1.5"
            strokeDasharray="6 6"
            opacity="0.8"
          />
          <text
            x={width - pad.right}
            y={yForRisk(50) - 8}
            textAnchor="end"
            fontSize="11"
            fill="var(--warn)"
          >
            50% reference
          </text>

          {/* Right-eye trend. Only connects right-eye points. */}
          {rightEyePath && (
            <path
              d={rightEyePath}
              fill="none"
              stroke="var(--accent)"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          {/* Left-eye trend. Only connects left-eye points. */}
          {leftEyePath && (
            <path
              d={leftEyePath}
              fill="none"
              stroke="var(--pos)"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray="7 5"
            />
          )}

          {sortedPoints.map((point, index) => {
            if (point.riskPercent === null) return null;

            const x = xForPoint(point);
            const y = yForRisk(point.riskPercent);
            const isPositive = point.prediction === "glaucoma";
            const eyeLabel = point.eye_side || "Eye not recorded";

            return (
              <g
                key={point.screening_id || `${point.date}-${index}`}
                className="cursor-pointer"
                onClick={() => point.screening_id && onViewResult(point.screening_id)}
              >
                <title>
                  {`${formatDate(point.date)} - ${eyeLabel} eye - ${point.riskPercent.toFixed(1)}%`}
                </title>

                <circle
                  cx={x}
                  cy={y}
                  r="9"
                  fill={isPositive ? "var(--neg)" : "var(--pos)"}
                  opacity="0.18"
                />
                <circle
                  cx={x}
                  cy={y}
                  r="4.8"
                  fill={isPositive ? "var(--neg)" : "var(--pos)"}
                  stroke="var(--surface)"
                  strokeWidth="2"
                />

                <text
                  x={x}
                  y={y - 14}
                  textAnchor="middle"
                  fontSize="10"
                  fill="var(--text3)"
                >
                  {String(eyeLabel).slice(0, 1).toUpperCase()}
                </text>
              </g>
            );
          })}

          {sortedPoints.map((point, index) => {
            const shouldShow =
              sortedPoints.length <= 4 ||
              index === 0 ||
              index === sortedPoints.length - 1;

            if (!shouldShow) return null;

            return (
              <text
                key={`time-label-${point.screening_id || index}`}
                x={xForPoint(point)}
                y={height - 16}
                textAnchor="middle"
                fontSize="11"
                fill="var(--text3)"
              >
                {formatAxisLabel(point.date)}
              </text>
            );
          })}
        </svg>

        <div className="flex flex-wrap items-center justify-between gap-3 mt-3 text-xs text-text3">
          <div className="flex items-center gap-4">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-5 border-t-2 border-accent" />
              Right eye trend
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-5 border-t-2 border-dashed border-pos" />
              Left eye trend
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-pos" />
              No glaucoma signs
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-neg" />
              Possible glaucoma signs
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-5 border-t border-dashed border-warn" />
              50% reference
            </span>
          </div>

          <span>
            {sortedPoints.length} screening record{sortedPoints.length === 1 ? "" : "s"}
          </span>
        </div>
      </div>
    </div>
  );
}

async function enrichScreeningWithResult(screening) {
  // The patient profile endpoint may not include prediction/confidence data.
  // This fetches the same full result data used by the Screening Result page.
  if (!screening?.screening_id || screening?.status !== "complete") {
    return screening;
  }

  try {
    const response = await API.get(`/results/${screening.screening_id}/full`);
    const results = Array.isArray(response.data?.results) ? response.data.results : [];
    const primaryResult = getPrimaryResultFromResults(results);

    return {
      ...screening,
      results,
      result: primaryResult,
    };
  } catch (error) {
    // Do not break the patient profile if one result fails to load.
    // The row will still show Complete, but score/chart data may be blank.
    console.warn("Failed to enrich screening result", screening.screening_id, error);
    return screening;
  }
}

function PatientProfile() {
  const { patientId } = useParams();
  const navigate = useNavigate();

  const [patient, setPatient] = useState(null);
  const [screenings, setScreenings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [exportingReport, setExportingReport] = useState(false);

  useEffect(() => {
    let isMounted = true;

    async function loadPatientProfile() {
      try {
        setLoading(true);
        setError(null);

        const [patientResponse, screeningsResponse] = await Promise.all([
          API.get(`/patients/${patientId}`),
          API.get(`/screenings/patient/${patientId}`),
        ]);

        const baseScreenings = Array.isArray(screeningsResponse.data)
          ? screeningsResponse.data
          : [];

        const enrichedScreenings = await Promise.all(
          baseScreenings.map(screening => enrichScreeningWithResult(screening))
        );

        // Newest first for the table. The chart sorts its own copy oldest to newest.
        const sortedScreenings = enrichedScreenings.sort(
          (a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)
        );

        if (!isMounted) return;

        setPatient(patientResponse.data);
        setScreenings(sortedScreenings);
      } catch (err) {
        if (!isMounted) return;
        console.error("Failed to load patient profile", err);
        setError("Failed to load patient.");
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    loadPatientProfile();

    return () => {
      isMounted = false;
    };
  }, [patientId]);

  async function exportClinicalReport() {
    try {
      setExportingReport(true);

      const response = await API.get("/reports/patient-clinical/pdf", {
        params: { patient_id: patientId },
        responseType: "blob",
      });

      const contentDisposition = response.headers?.["content-disposition"];
      const filenameMatch = contentDisposition?.match(/filename="?([^"]+)"?/);

      const fallbackFilename = `patient_clinical_summary_${patient?.patient_code || patientId}.pdf`;
      const filename = filenameMatch?.[1] || fallbackFilename;

      const blobUrl = window.URL.createObjectURL(new Blob([response.data], {
        type: "application/pdf",
      }));

      const link = document.createElement("a");
      link.href = blobUrl;
      link.setAttribute("download", filename);
      document.body.appendChild(link);
      link.click();
      link.remove();

      window.URL.revokeObjectURL(blobUrl);
    } catch (err) {
      console.error("Failed to export patient clinical report", err);
      alert("Unable to export the patient clinical report. Please try again.");
    } finally {
      setExportingReport(false);
    }
  }

  function calcAge(dob) {
    if (!dob) return "-";
    return Math.floor((Date.now() - new Date(dob).getTime()) / (1000 * 60 * 60 * 24 * 365.25)) + " years";
  }

  function formatDate(d) {
    if (!d) return "-";
    return new Date(d).toLocaleDateString("en-NZ", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      timeZone: "Pacific/Auckland",
    });
  }

  if (loading) {
    return (
      <Layout title="Patient Profile">
        <p className="text-text3 text-sm">Loading...</p>
      </Layout>
    );
  }

  if (error || !patient) {
    return (
      <Layout title="Patient Profile">
        <p className="text-neg text-sm">{error || "Patient not found."}</p>
      </Layout>
    );
  }

  const fullName = `${patient.first_name} ${patient.last_name}`;
  const gradIdx = getGradientIndex(patient.first_name);
  const initials = getInitials(patient.first_name, patient.last_name);

  return (
    <Layout title="Patient Profile">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-xs text-text3 mb-5">
        <span
          onClick={() => navigate("/patients")}
          className="cursor-pointer hover:text-accent2 transition-colors"
        >
          Patients
        </span>
        <span>›</span>
        <span className="text-text2">{fullName}</span>
      </div>

      {/* Two column layout */}
      <div className="grid gap-4" style={{ gridTemplateColumns: "290px 1fr" }}>
        {/* LEFT - Patient Info */}
        <div className="bg-surface border border-white/7 rounded-xl overflow-hidden">
          {/* Avatar + Name */}
          <div className="text-center p-6 border-b border-white/7">
            <div className={`w-14 h-14 rounded-full bg-gradient-to-br ${GRADIENTS[gradIdx]} flex items-center justify-center text-xl font-semibold text-white mx-auto mb-3`}>
              {initials}
            </div>
            <div className="text-base font-semibold text-text1 mb-1">{fullName}</div>
            <div className="text-xs text-text3 font-mono mb-3">#{patient.patient_code}</div>
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${patient.is_active ? "bg-pos/10 text-pos border-pos/20" : "bg-neg/10 text-neg border-neg/20"}`}>
              <span className="w-1.5 h-1.5 rounded-full bg-current" />
              {patient.is_active ? "Active" : "Inactive"}
            </span>
          </div>

          {/* Info rows */}
          <div className="p-4">
            <InfoRow label="Age" value={calcAge(patient.dob)} />
            <InfoRow label="Gender" value={patient.gender ? patient.gender.charAt(0).toUpperCase() + patient.gender.slice(1) : "-"} />
            <InfoRow label="DOB" value={formatDate(patient.dob)} />
            <InfoRow label="Contact" value={patient.mobile_number} />
            <InfoRow label="Email" value={patient.email} />
            <InfoRow label="IOP" value={patient.iop ? `${patient.iop} mmHg` : "-"} />
            <InfoRow label="CCT" value={patient.cct ? `${patient.cct} µm` : "-"} />
            <InfoRow label="Screenings" value={`${screenings.length} total`} valueClass="text-accent2 font-medium" />
          </div>

          {/* Buttons */}
          <div className="flex gap-2 p-4 pt-0">
            <button
              onClick={() => navigate(`/patients/${patientId}/edit`)}
              className="flex-1 py-2 text-xs font-medium text-text2 border border-white/12 rounded-lg bg-transparent hover:bg-white/5 transition-colors cursor-pointer font-sans"
            >
              Edit
            </button>
            <button
              onClick={() => navigate("/screenings/new", { state: { patientId } })}
              className="flex-1 py-2 text-xs font-medium text-white bg-accent hover:bg-accent2 rounded-lg border-0 transition-colors cursor-pointer font-sans"
            >
              Screen
            </button>
          </div>
        </div>

        {/* RIGHT - Screening History + Chart */}
        <div className="flex flex-col gap-4">
          {/* Screening History */}
          <div className="bg-surface border border-white/7 rounded-xl overflow-hidden">
            <div className="flex items-center gap-3 px-5 py-3.5 border-b border-white/7">
              <span className="text-sm font-semibold text-text1 flex-1">Screening History</span>
                <button
                  onClick={exportClinicalReport}
                  disabled={exportingReport}
                  className="px-3 py-1 text-xs text-white bg-accent hover:bg-accent2 disabled:opacity-60 disabled:cursor-not-allowed rounded-lg border-0 transition-colors cursor-pointer font-sans"
                >
                  {exportingReport ? "Exporting..." : "Export Clinical Report"}
                </button>

                <button
                  onClick={() => navigate("/screenings")}
                  className="px-3 py-1 text-xs text-text2 border border-white/12 rounded-lg bg-transparent hover:bg-white/5 transition-colors cursor-pointer font-sans"
                >
                  View All
                </button>
            </div>

            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-white/7">
                  {["Date", "Eye", "Result", "Score", "Actions"].map(header => (
                    <th
                      key={header}
                      className="px-5 py-2.5 text-left text-xs font-semibold text-text3 uppercase tracking-wider bg-white/[0.02]"
                    >
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {screenings.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-5 py-8 text-center text-text3 text-sm">
                      No screenings yet.
                    </td>
                  </tr>
                ) : (
                  screenings.map(screening => (
                    <tr
                      key={screening.screening_id}
                      onClick={() => navigate(`/results/${screening.screening_id}`)}
                      className="border-b border-white/[0.04] hover:bg-accent/[0.06] transition-colors cursor-pointer"
                    >
                      <td className="px-5 py-3 text-xs text-text2 font-mono">
                        {formatDate(screening.created_at)}
                      </td>
                      <td className="px-5 py-3 text-xs text-text2 capitalize">
                        {screening.eye_side || "-"}
                      </td>
                      <td className="px-5 py-3">
                        <ResultBadge prediction={getScreeningPrediction(screening)} />
                      </td>
                      <td className="px-5 py-3 text-xs text-text2 font-mono">
                        {formatRiskScore(screening)}
                      </td>
                      <td className="px-5 py-3">
                        <button
                          onClick={event => {
                            event.stopPropagation();
                            navigate(`/results/${screening.screening_id}`);
                          }}
                          className="px-2.5 py-1 text-xs text-text2 border border-white/12 rounded-lg bg-transparent hover:bg-white/5 transition-colors cursor-pointer font-sans"
                        >
                          View
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Risk Progression */}
          <div className="bg-surface border border-white/7 rounded-xl overflow-hidden">
            <div className="flex items-center gap-3 px-5 py-3.5 border-b border-white/7">
              <span className="text-sm font-semibold text-text1 flex-1">Risk Progression</span>
              <span className="text-xs text-text3">Longitudinal tracking</span>
            </div>
            <div className="p-5">
              <LongitudinalRiskChart
                screenings={screenings}
                formatDate={formatDate}
                onViewResult={screeningId => navigate(`/results/${screeningId}`)}
              />
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}

export default PatientProfile;

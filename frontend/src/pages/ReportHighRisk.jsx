// src/pages/ReportHighRisk.jsx
// High Risk Report browser view.
// Uses GET /screenings/analytics?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD
// High risk logic comes from backend: prediction = glaucoma.

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import Layout from "../components/Layout";
import API from "../api/index";

function toDateInputValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function getTodayInputValue() {
  return toDateInputValue(new Date());
}

function getDaysAgoInputValue(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);

  return toDateInputValue(date);
}

function formatDate(value) {
  if (!value) return "—";

  return new Date(value).toLocaleDateString("en-NZ", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Pacific/Auckland",
  });
}

function calcAge(dob) {
  if (!dob) return "—";

  const birthDate = new Date(dob);
  const today = new Date();

  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();

  if (
    monthDiff < 0 ||
    (monthDiff === 0 && today.getDate() < birthDate.getDate())
  ) {
    age -= 1;
  }

  return age;
}

function formatPercent(value) {
  if (value === null || value === undefined) return "—";
  return `${Math.round(Number(value) * 100)}%`;
}

function formatDecimal(value, digits = 3) {
  if (value === null || value === undefined) return "—";
  return Number(value).toFixed(digits);
}

function SummaryCard({ label, value, sub, icon, tone = "accent" }) {
  const toneClass = {
    accent: "bg-accent/15 text-accent2",
    pos: "bg-pos/15 text-pos",
    warn: "bg-warn/15 text-warn",
    neg: "bg-neg/15 text-neg",
  }[tone];

  return (
    <div className="bg-surface border border-border rounded-xl p-4 flex items-center gap-4">
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-xl ${toneClass}`}>
        {icon}
      </div>

      <div>
        <div className="text-xs text-text3 uppercase tracking-wider mb-1">
          {label}
        </div>

        <div className="text-2xl font-bold font-mono text-text1 leading-none mb-1">
          {value ?? "—"}
        </div>

        {sub && (
          <div className="text-xs text-text3">
            {sub}
          </div>
        )}
      </div>
    </div>
  );
}

function ResultBadge({ prediction }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-neg/20 bg-neg/10 px-2 py-0.5 text-xs font-medium text-neg capitalize">
      <span className="w-1.5 h-1.5 rounded-full bg-current" />
      {prediction || "glaucoma"}
    </span>
  );
}

function OHTSBadge({ tier }) {
  const map = {
    critical: "bg-neg/10 text-neg border-neg/20",
    possible: "bg-warn/10 text-warn border-warn/20",
    low: "bg-pos/10 text-pos border-pos/20",
  };

  if (!tier) {
    return <span className="text-xs text-text3">—</span>;
  }

  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium capitalize ${map[tier] || "bg-surface2 text-text2 border-border"}`}>
      {tier}
    </span>
  );
}

function GradCamBadge({ path }) {
  return path ? (
    <span className="inline-flex items-center rounded-full border border-pos/20 bg-pos/10 px-2 py-0.5 text-xs font-medium text-pos">
      Available
    </span>
  ) : (
    <span className="inline-flex items-center rounded-full border border-border bg-surface2 px-2 py-0.5 text-xs font-medium text-text3">
      Not available
    </span>
  );
}

function ReportHighRisk() {
  const navigate = useNavigate();

  const [startDate, setStartDate] = useState(getDaysAgoInputValue(7));
  const [endDate, setEndDate] = useState(getTodayInputValue());
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const isInvalidDateRange = startDate && endDate && startDate > endDate;
  const highRisk = analytics?.high_risk_screenings || [];

  const averageConfidence = useMemo(() => {
    if (!highRisk.length) return null;

    const total = highRisk.reduce((sum, item) => {
      return sum + Number(item.confidence_score || 0);
    }, 0);

    return total / highRisk.length;
  }, [highRisk]);

  async function loadReport() {
    if (!startDate || !endDate || isInvalidDateRange) {
      return;
    }

    const params = new URLSearchParams();
    params.set("start_date", startDate);
    params.set("end_date", endDate);

    setLoading(true);
    setErrorMessage("");

    try {
      const response = await API.get(`/screenings/analytics?${params.toString()}`);
      setAnalytics(response.data);
    } catch (error) {
      console.error(error);
      setErrorMessage("Unable to load the High Risk Report. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  function resetToLastSevenDays() {
    setStartDate(getDaysAgoInputValue(7));
    setEndDate(getTodayInputValue());
  }

async function downloadPdfFromEndpoint(endpoint, filenamePrefix) {
  if (!startDate || !endDate || isInvalidDateRange) {
    return;
  }

  const params = new URLSearchParams();
  params.set("start_date", startDate);
  params.set("end_date", endDate);

  setLoading(true);
  setErrorMessage("");

  try {
    const response = await API.get(`${endpoint}?${params.toString()}`, {
      responseType: "blob",
    });

    const pdfBlob = new Blob([response.data], {
      type: "application/pdf",
    });

    const pdfUrl = window.URL.createObjectURL(pdfBlob);
    const downloadLink = document.createElement("a");

    downloadLink.href = pdfUrl;
    downloadLink.download = `${filenamePrefix}_${startDate}_to_${endDate}.pdf`;

    document.body.appendChild(downloadLink);
    downloadLink.click();

    downloadLink.remove();
    window.URL.revokeObjectURL(pdfUrl);
  } catch (error) {
    console.error(error);
    setErrorMessage("Unable to export the High Risk Report PDF. Please try again.");
  } finally {
    setLoading(false);
  }
}

function handleExportPdf() {
  downloadPdfFromEndpoint("/reports/high-risk/pdf", "high_risk_report");
}

function handleExportPdfGo() {
  downloadPdfFromEndpoint("/reports/high-risk/pdf-go", "high_risk_report_go");
}  
  

  useEffect(() => {
    loadReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const actions = (
    <div className="flex items-center gap-2">
      <input
        type="date"
        value={startDate}
        max={endDate || undefined}
        onChange={e => setStartDate(e.target.value)}
        className="bg-surface2 border border-border2 rounded-lg px-3 py-1.5 text-xs text-text2 outline-none font-sans"
      />

      <span className="text-xs text-text3">to</span>

      <input
        type="date"
        value={endDate}
        min={startDate || undefined}
        onChange={e => setEndDate(e.target.value)}
        className="bg-surface2 border border-border2 rounded-lg px-3 py-1.5 text-xs text-text2 outline-none font-sans"
      />

      <button
        type="button"
        onClick={loadReport}
        disabled={loading || isInvalidDateRange}
        className="px-3 py-1.5 text-xs font-medium text-white bg-accent rounded-lg hover:bg-accent2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer font-sans"
      >
        {loading ? "Loading..." : "Generate"}
      </button>

      <button
        type="button"
        onClick={resetToLastSevenDays}
        className="px-3 py-1.5 text-xs font-medium text-text2 border border-border2 rounded-lg bg-transparent hover:bg-surface2 transition-colors cursor-pointer font-sans"
      >
        Last 7 days
      </button>
      <button
        type="button"
        onClick={handleExportPdf}
        disabled={loading || !analytics}
        className="px-3 py-1.5 text-xs font-medium text-text2 border border-border2 rounded-lg bg-transparent hover:bg-surface2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer font-sans"
       >
        📄 Export PDF
       </button>     

      <button
        type="button"
        onClick={handleExportPdfGo}
        disabled={loading || !analytics}
        className="px-3 py-1.5 text-xs font-medium text-text2 border border-border2 rounded-lg bg-transparent hover:bg-surface2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer font-sans"
      >
        Export PDF via Go
      </button>        
    </div>
  );

  return (
<Layout title="High Risk Report" actions={actions}>
    <div className="print-area">
        <div className="print-only hidden mb-6 border-b border-border pb-4">
        <h1 className="text-2xl font-semibold text-text1 mb-2">
            High Risk Report
        </h1>

        <p className="text-sm text-text2">
            Report period: {formatDate(startDate)} to {formatDate(endDate)}
        </p>

        <p className="text-sm text-text2">
            Generated: {new Date().toLocaleString("en-NZ", {
            day: "2-digit",
            month: "short",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            timeZone: "Pacific/Auckland",
            })}
        </p>
        </div>        
      <div className="mb-6">
        <button
          type="button"
          onClick={() => navigate("/reports")}    
          className="print-hide text-xs text-text3 hover:text-text1 mb-4 bg-transparent border-0 cursor-pointer"
        >
          ← Back to Reports
        </button>

        <p className="text-xs text-text3 mb-2">
          Clinical Report
        </p>

        <h1 className="text-2xl font-semibold text-text1 mb-2">
          High Risk Report
        </h1>

        <p className="text-sm text-text2 max-w-3xl leading-relaxed">
          This report lists glaucoma-positive screenings within the selected
          date range. It supports clinical review by showing patient details,
          eye side, prediction, confidence score, OHTS tier, CDR, Grad-CAM
          availability, and screening date.
        </p>

        {isInvalidDateRange && (
          <div className="mt-4 rounded-lg border border-neg/20 bg-neg/10 px-4 py-3 text-sm text-neg">
            Start date cannot be after end date.
          </div>
        )}

        {errorMessage && (
          <div className="mt-4 rounded-lg border border-neg/20 bg-neg/10 px-4 py-3 text-sm text-neg">
            {errorMessage}
          </div>
        )}
      </div>

      <div className="grid grid-cols-4 gap-3 mb-5">
        <SummaryCard
          label="High Risk Cases"
          value={highRisk.length}
          sub="Glaucoma-positive screenings"
          icon="🚨"
          tone="neg"
        />

        <SummaryCard
          label="Average Confidence"
          value={averageConfidence === null ? "—" : formatPercent(averageConfidence)}
          sub="Across listed cases"
          icon="📊"
          tone="accent"
        />

        <SummaryCard
          label="Possible OHTS"
          value={analytics?.ohts_distribution?.possible ?? "—"}
          sub="Within selected range"
          icon="🛡"
          tone="warn"
        />

        <SummaryCard
          label="Critical OHTS"
          value={analytics?.ohts_distribution?.critical ?? "—"}
          sub="Within selected range"
          icon="⚠️"
          tone="neg"
        />
      </div>

      <div className="bg-surface border border-border rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-border flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-text1">
              Glaucoma-Positive Screenings
            </h2>
            <p className="text-xs text-text3 mt-1">
              {formatDate(startDate)} to {formatDate(endDate)}
            </p>
          </div>

          <div className="print-hide text-xs text-text3">
            Use Export PDF to download the clinical PDF report.
          </div>
        </div>

        {loading ? (
          <div className="px-5 py-10 text-center text-sm text-text3">
            Loading report...
          </div>
        ) : (
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-border">
                {[
                    { label: "Patient" },
                    { label: "Age / Gender" },
                    { label: "Eye" },
                    { label: "Prediction" },
                    { label: "Confidence" },
                    { label: "OHTS" },
                    { label: "CDR" },
                    { label: "Grad-CAM" },
                    { label: "Screening Date" },
                    { label: "Action", printHide: true },
                ].map(header => (
                  <th
                    key={header.label}
                    className={`px-4 py-2.5 text-left text-xs font-semibold text-text3 uppercase tracking-wider bg-surface2/50 ${
                      header.printHide ? "print-hide" : ""
                    }`}
                  >
                    {header.label}
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {highRisk.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-4 py-10 text-center text-sm text-text3">
                    No glaucoma-positive screenings found for this date range.
                  </td>
                </tr>
              ) : (
                highRisk.map(item => (
                  <tr
                    key={item.screening_id}
                    className="border-b border-border hover:bg-accent/[0.06] transition-colors"
                  >
                    <td className="px-4 py-3">
                      <div className="text-sm font-medium text-text1">
                        {item.patient_name}
                      </div>
                      <div className="text-xs text-text3 font-mono">
                        {item.patient_code}
                      </div>
                    </td>

                    <td className="px-4 py-3 text-xs text-text2">
                      {calcAge(item.dob)} / <span className="capitalize">{item.gender || "—"}</span>
                    </td>

                    <td className="px-4 py-3 text-xs text-text2 capitalize">
                      {item.eye_side || "—"}
                    </td>

                    <td className="px-4 py-3">
                      <ResultBadge prediction={item.prediction} />
                    </td>

                    <td className="px-4 py-3 text-xs text-text2 font-mono">
                      {formatPercent(item.confidence_score)}
                    </td>

                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-1">
                        <OHTSBadge tier={item.ohts_tier} />
                        <span className="text-xs text-text3 font-mono">
                          Score: {item.ohts_score ?? "—"}
                        </span>
                      </div>
                    </td>

                    <td className="px-4 py-3 text-xs text-text2 font-mono">
                      {formatDecimal(item.cdr, 3)}
                    </td>

                    <td className="px-4 py-3">
                      <GradCamBadge path={item.gradcam_path} />
                    </td>

                    <td className="px-4 py-3 text-xs text-text2 font-mono">
                      {formatDate(item.created_at)}
                    </td>

                    <td className="print-hide px-4 py-3">
                      <button
                        type="button"
                        onClick={() => navigate(`/results/${item.screening_id}`)}
                        className="px-2.5 py-1 text-xs text-text2 border border-border2 rounded-lg bg-transparent hover:bg-surface2 transition-colors cursor-pointer font-sans"
                      >
                        View
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
</Layout>
  );
}

export default ReportHighRisk;
// src/pages/Reports.jsx
// AI Report Assistant with report preview on the left and assistant panel on the right.

import { useMemo, useState } from "react";
import Layout from "../components/Layout";
import API from "../api";

const QUICK_PROMPTS = [
  "Active glaucoma patients",
  "Inactive patients",
  "Normal patients this month",
  "High-risk report this week",
];

const INITIAL_MESSAGES = [
  {
    role: "assistant",
    text: "Ask me what report you want to generate. I can prepare reports using filters such as active, inactive, glaucoma, normal, this week, or this month.",
  },
];

const ALL_PATIENTS = [
  {
    id: 1,
    patientId: "PT-001",
    name: "Margaret Thompson",
    dob: "12 Mar 1948",
    status: "active",
    diagnosis: "glaucoma",
    lastScreening: "2026-05-12",
    risk: "High",
    clinician: "Dr. Smith",
  },
  {
    id: 2,
    patientId: "PT-002",
    name: "Robert Williams",
    dob: "5 Jul 1955",
    status: "active",
    diagnosis: "normal",
    lastScreening: "2026-05-28",
    risk: "Low",
    clinician: "Dr. Johnson",
  },
  {
    id: 3,
    patientId: "PT-003",
    name: "Dorothy Chen",
    dob: "22 Nov 1962",
    status: "inactive",
    diagnosis: "glaucoma",
    lastScreening: "2026-01-03",
    risk: "High",
    clinician: "Dr. Smith",
  },
  {
    id: 4,
    patientId: "PT-004",
    name: "James Patterson",
    dob: "14 Apr 1957",
    status: "active",
    diagnosis: "normal",
    lastScreening: "2026-06-01",
    risk: "Low",
    clinician: "Dr. Lee",
  },
  {
    id: 5,
    patientId: "PT-005",
    name: "Helen Morrison",
    dob: "30 Sep 1943",
    status: "active",
    diagnosis: "glaucoma",
    lastScreening: "2026-05-30",
    risk: "High",
    clinician: "Dr. Johnson",
  },
  {
    id: 6,
    patientId: "PT-006",
    name: "William Clarke",
    dob: "8 Feb 1960",
    status: "inactive",
    diagnosis: "normal",
    lastScreening: "2025-11-15",
    risk: "Low",
    clinician: "Dr. Smith",
  },
  {
    id: 7,
    patientId: "PT-007",
    name: "Susan Brown",
    dob: "17 Jan 1952",
    status: "active",
    diagnosis: "glaucoma",
    lastScreening: "2026-05-29",
    risk: "High",
    clinician: "Dr. Lee",
  },
  {
    id: 8,
    patientId: "PT-008",
    name: "Charles Davis",
    dob: "26 Jun 1958",
    status: "active",
    diagnosis: "normal",
    lastScreening: "2026-05-18",
    risk: "Low",
    clinician: "Dr. Johnson",
  },
  {
    id: 9,
    patientId: "PT-009",
    name: "Nancy Wilson",
    dob: "3 Oct 1946",
    status: "inactive",
    diagnosis: "glaucoma",
    lastScreening: "2026-02-08",
    risk: "High",
    clinician: "Dr. Smith",
  },
  {
    id: 10,
    patientId: "PT-010",
    name: "Thomas Anderson",
    dob: "11 May 1953",
    status: "active",
    diagnosis: "normal",
    lastScreening: "2026-05-27",
    risk: "Low",
    clinician: "Dr. Lee",
  },
  {
    id: 11,
    patientId: "PT-011",
    name: "Betty Taylor",
    dob: "19 Aug 1947",
    status: "active",
    diagnosis: "glaucoma",
    lastScreening: "2026-06-01",
    risk: "High",
    clinician: "Dr. Johnson",
  },
  {
    id: 12,
    patientId: "PT-012",
    name: "George Martinez",
    dob: "7 Dec 1961",
    status: "inactive",
    diagnosis: "normal",
    lastScreening: "2025-12-05",
    risk: "Low",
    clinician: "Dr. Smith",
  },
];

function formatDate(iso) {
  return new Date(iso).toLocaleDateString("en-NZ", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatReportType(type) {
  if (type === "high_risk") return "High Risk Report";
  if (type === "screening_summary") return "Screening Summary Report";
  return "Patient List Report";
}

function formatFilterValue(value) {
  const labels = {
    active: "Active",
    inactive: "Inactive",
    glaucoma: "Glaucoma",
    normal: "Normal",
    this_week: "This week",
    this_month: "This month",
  };

  return labels[value] || value;
}

function formatFilterLabel(key) {
  const labels = {
    status: "Patient status",
    diagnosis: "Screening result",
    date_range: "Date range",
  };

  return labels[key] || key;
}

function parseReportRequest(rawText) {
  const text = rawText.toLowerCase().trim();

  if (!text) {
    return {
      ok: false,
      message: "Please enter a report request first.",
    };
  }

  let reportType = "patient_list";

  if (text.includes("high risk") || text.includes("high-risk")) {
    reportType = "high_risk";
  }

  if (text.includes("summary")) {
    reportType = "screening_summary";
  }

  const filters = {};

  if (text.includes("inactive")) {
    filters.status = "inactive";
  } else if (text.includes("active")) {
    filters.status = "active";
  }

  if (
    text.includes("glaucoma") ||
    text.includes("positive") ||
    text.includes("abnormal")
  ) {
    filters.diagnosis = "glaucoma";
  }

  if (text.includes("normal") || text.includes("negative")) {
    filters.diagnosis = "normal";
  }

  if (text.includes("this week")) {
    filters.date_range = "this_week";
  }

  if (text.includes("this month")) {
    filters.date_range = "this_month";
  }

  const hasKnownFilter = Object.keys(filters).length > 0;
  const mentionsPatient =
    text.includes("patient") ||
    text.includes("patients") ||
    text.includes("list");

  if (!hasKnownFilter && !mentionsPatient && reportType === "patient_list") {
    return {
      ok: false,
      message:
        "I could not identify the report filters. Try something like: Active glaucoma patients.",
    };
  }

  return {
    ok: true,
    intent: {
      report_type: reportType,
      filters,
      format: "pdf",
    },
  };
}

function filterPatients(intent) {
  if (!intent) return [];

  const today = new Date("2026-06-01");
  const weekAgo = new Date(today);
  weekAgo.setDate(today.getDate() - 7);

  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

  return ALL_PATIENTS.filter(patient => {
    if (intent.report_type === "high_risk" && patient.risk !== "High") {
      return false;
    }

    if (intent.filters?.status && patient.status !== intent.filters.status) {
      return false;
    }

    if (
      intent.filters?.diagnosis &&
      patient.diagnosis !== intent.filters.diagnosis
    ) {
      return false;
    }

    if (
      intent.filters?.date_range === "this_week" &&
      new Date(patient.lastScreening) < weekAgo
    ) {
      return false;
    }

    if (
      intent.filters?.date_range === "this_month" &&
      new Date(patient.lastScreening) < monthStart
    ) {
      return false;
    }

    return true;
  });
}

function StatusBadge({ value }) {
  const isActive = value === "active";

  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
        isActive
          ? "bg-green-100 text-green-700"
          : "bg-gray-100 text-gray-600"
      }`}
    >
      {isActive ? "Active" : "Inactive"}
    </span>
  );
}

function DiagnosisBadge({ value }) {
  const isGlaucoma = value === "glaucoma";

  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
        isGlaucoma
          ? "bg-red-100 text-red-700"
          : "bg-blue-100 text-blue-700"
      }`}
    >
      {isGlaucoma ? "Glaucoma" : "Normal"}
    </span>
  );
}

function RiskBadge({ value }) {
  const isHigh = value === "High";

  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
        isHigh
          ? "bg-orange-100 text-orange-700"
          : "bg-green-100 text-green-700"
      }`}
    >
      {value}
    </span>
  );
}

function ChatBubble({ message }) {
  const isUser = message.role === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[88%] rounded-2xl px-3 py-2 text-sm leading-relaxed ${
          isUser
            ? "bg-accent text-white"
            : "border border-[var(--color-border)] bg-[var(--color-surface2)] text-[var(--color-text1)]"
        }`}
      >
        {message.text}
      </div>
    </div>
  );
}

function IntentCard({ intent, onGenerate, isGenerating }) {
  if (!intent) return null;

  const filterEntries = getNonEmptyFilters(intent.filters);  

  return (
    <div className="mx-1 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3 shadow-sm">
      <p className="mb-2 text-xs font-semibold text-[var(--color-text3)]">
        Interpreted request
      </p>

      <p className="mb-2 text-sm font-medium text-[var(--color-text1)]">
        {formatReportType(intent.report_type)}
      </p>

      <div className="mb-3 space-y-1">
        {filterEntries.length > 0 ? (
          filterEntries.map(([key, value]) => (
            <div key={key} className="flex justify-between gap-3 text-xs">
              <span className="text-[var(--color-text3)]">
                {formatFilterLabel(key)}
              </span>
              <span className="font-medium text-[var(--color-text2)]">
                {formatFilterValue(value)}
              </span>
            </div>
          ))
        ) : (
          <div className="flex justify-between gap-3 text-xs">
            <span className="text-[var(--color-text3)]">Filters</span>
            <span className="font-medium text-[var(--color-text2)]">
              No specific filters
            </span>
          </div>
        )}

        <div className="flex justify-between gap-3 text-xs">
          <span className="text-[var(--color-text3)]">Output</span>
          <span className="font-medium text-[var(--color-text2)]">PDF</span>
        </div>
      </div>

      <button
        type="button"
        onClick={onGenerate}
        disabled={isGenerating}
        className={`w-full rounded-full py-1.5 text-xs font-semibold text-white transition-colors ${
          isGenerating
            ? "bg-[var(--color-text3)] cursor-not-allowed"
            : "bg-accent hover:bg-accent2"
        }`}
      >
        {isGenerating ? "Generating..." : "Generate Report"}
      </button>
    </div>
  );
}

function EmptyPreview() {
  return (
    <div
        className="flex items-center justify-center rounded-2xl border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] px-6 text-center"
        style={{
          minHeight: "680px",
        }}
      >
      <div className="max-w-md">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/15 text-2xl">
          📄
        </div>

        <h2 className="mb-2 text-lg font-semibold text-[var(--color-text1)]">
          No report generated yet
        </h2>

        <p className="text-sm leading-relaxed text-[var(--color-text2)]">
            Ask the AI Report Assistant to generate a report. 
            A preview will appear here before the PDF is downloaded or printed.
        </p>

        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {QUICK_PROMPTS.slice(0, 3).map(prompt => (
            <span
              key={prompt}
              className="rounded-full bg-[var(--color-surface2)] px-3 py-1.5 text-xs text-[var(--color-text3)]"
            >
              {prompt}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function getNonEmptyFilters(filters) {
  return Object.entries(filters || {}).filter(([, value]) => {
    return value !== null && value !== undefined && value !== "";
  });
}

function getHighRiskSummary(rows) {
  const confidenceValues = [];
  let possibleOhts = 0;
  let criticalOhts = 0;

  rows.forEach(row => {
    const confidenceText = String(row.confidence || "");

    if (confidenceText.endsWith("%")) {
      const value = Number(confidenceText.replace("%", ""));
      if (!Number.isNaN(value)) {
        confidenceValues.push(value);
      }
    }

    const ohtsText = String(row.ohts || "").toLowerCase();

    if (ohtsText.includes("possible")) {
      possibleOhts += 1;
    }

    if (ohtsText.includes("critical")) {
      criticalOhts += 1;
    }
  });

  const averageConfidence =
    confidenceValues.length > 0
      ? `${Math.round(
          confidenceValues.reduce((sum, value) => sum + value, 0) /
            confidenceValues.length
        )}%`
      : "N/A";

  return [
    { label: "High risk cases", value: rows.length },
    { label: "Average confidence", value: averageConfidence },
    { label: "Possible OHTS", value: possibleOhts },
    { label: "Critical OHTS", value: criticalOhts },
  ];
}

function getPatientListSummary(summary) {
  return [
    { label: "Total records", value: summary.total || 0 },
    { label: "Active", value: summary.active || 0 },
    { label: "Inactive", value: summary.inactive || 0 },
    { label: "Glaucoma", value: summary.glaucoma || 0 },
    { label: "Normal", value: summary.normal || 0 },
  ];
}

function getPreviewColumns(reportType) {
  if (reportType === "high_risk") {
    return [
      { key: "patientId", label: "Patient ID" },
      { key: "name", label: "Patient Name" },
      { key: "ageGender", label: "Age / Gender" },
      { key: "eye", label: "Eye" },
      { key: "diagnosis", label: "Prediction" },
      { key: "confidence", label: "Confidence" },
      { key: "ohts", label: "OHTS" },
      { key: "cdr", label: "CDR" },
      { key: "lastScreening", label: "Screening Date" },
      { key: "gradcam", label: "Grad-CAM" },
      { key: "clinician", label: "Clinician" },
    ];
  }

  return [
    { key: "patientId", label: "Patient ID" },
    { key: "name", label: "Patient Name" },
    { key: "dob", label: "Date of Birth" },
    { key: "status", label: "Status" },
    { key: "diagnosis", label: "Diagnosis" },
    { key: "lastScreening", label: "Last Screening" },
    { key: "risk", label: "Risk" },
    { key: "clinician", label: "Clinician" },
  ];
}

function getCellValue(row, key) {
  const value = row[key];

  if (value === null || value === undefined || value === "") {
    return "N/A";
  }

  if (key === "status" || key === "diagnosis") {
    return String(value).charAt(0).toUpperCase() + String(value).slice(1);
  }

  return value;
}

function ReportDocumentPreview({
  title,
  rows,
  intent,
  summary,
  previewPage,
  rowsPerPage,
  onPageChange,
}) {
  if (!intent) {
    return <EmptyPreview />;
  }

  const reportType = intent.report_type;
  const isHighRisk = reportType === "high_risk";

  const filterEntries = getNonEmptyFilters(intent.filters);
  const summaryCards = isHighRisk
    ? getHighRiskSummary(rows)
    : getPatientListSummary(summary);

  const columns = getPreviewColumns(reportType);
  const totalRows = rows.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / rowsPerPage));
  const safePage = Math.min(Math.max(previewPage, 1), totalPages);
  const startIndex = (safePage - 1) * rowsPerPage;
  const endIndex = startIndex + rowsPerPage;
  const visibleRows = rows.slice(startIndex, endIndex);
  const firstVisible = totalRows === 0 ? 0 : startIndex + 1;
  const lastVisible = Math.min(endIndex, totalRows);  

  return (
    <div className="mx-auto max-w-6xl rounded-2xl border border-[var(--color-border)] bg-white p-6 shadow-sm">
      <div className="mb-5 flex flex-col gap-4 border-b border-gray-200 pb-5 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
            GlaucomaAI Clinical System
          </p>

          <h2 className="mt-1 text-2xl font-semibold text-gray-950">
            {title}
          </h2>

          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-gray-600">
            {isHighRisk
              ? "Generated from high-risk screening records using validated report filters."
              : "Generated from patient screening data using validated report filters."}
          </p>
        </div>

        <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm">
          <p className="text-xs text-gray-500">Generated date</p>
          <p className="font-medium text-gray-900">
            {new Date().toLocaleDateString("en-NZ", {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}
          </p>
        </div>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        {summaryCards.map(item => (
          <div
            key={item.label}
            className="rounded-xl border border-gray-200 bg-gray-50 p-3"
          >
            <p className="text-xs text-gray-500">{item.label}</p>
            <p className="mt-1 text-xl font-semibold text-gray-950">
              {item.value}
            </p>
          </div>
        ))}
      </div>

      <div className="mb-5 rounded-xl border border-gray-200 bg-gray-50 p-4">
        <p className="mb-3 text-sm font-semibold text-gray-900">
          Applied filters
        </p>

        <div className="flex flex-wrap gap-2">
          {filterEntries.length > 0 ? (
            filterEntries.map(([key, value]) => (
              <span
                key={key}
                className="rounded-full bg-white px-3 py-1.5 text-xs font-medium text-gray-700 ring-1 ring-gray-200"
              >
                {formatFilterLabel(key)}: {formatFilterValue(value)}
              </span>
            ))
          ) : (
            <span className="rounded-full bg-white px-3 py-1.5 text-xs font-medium text-gray-700 ring-1 ring-gray-200">
              No specific filters
            </span>
          )}
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-gray-200">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
            <tr>
              {columns.map(column => (
                <th key={column.key} className="px-4 py-3 whitespace-nowrap">
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>

          <tbody className="divide-y divide-gray-200">
            {visibleRows.length > 0 ? (
              visibleRows.map((row, rowIndex) => (
                <tr key={`${row.patientId}-${rowIndex}`}>
                  {columns.map(column => (
                    <td
                      key={column.key}
                      className="px-4 py-3 text-gray-700 whitespace-nowrap"
                    >
                      {getCellValue(row, column.key)}
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-4 py-8 text-center text-sm text-gray-500"
                >
                  No records matched the selected filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

        {totalRows > rowsPerPage && (
          <div className="mt-4 flex flex-col gap-3 text-sm text-gray-600 sm:flex-row sm:items-center sm:justify-between">
            <p>
              Showing {firstVisible}-{lastVisible} of {totalRows} records
            </p>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onPageChange(safePage - 1)}
                disabled={safePage === 1}
                className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${
                  safePage === 1
                    ? "cursor-not-allowed border-gray-200 bg-gray-100 text-gray-400"
                    : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                }`}
              >
                Previous
              </button>

              <span className="text-xs text-gray-500">
                Page {safePage} of {totalPages}
              </span>

              <button
                type="button"
                onClick={() => onPageChange(safePage + 1)}
                disabled={safePage === totalPages}
                className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${
                  safePage === totalPages
                    ? "cursor-not-allowed border-gray-200 bg-gray-100 text-gray-400"
                    : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                }`}
              >
                Next
              </button>
            </div>
          </div>
        )}

      <p className="mt-5 text-xs leading-relaxed text-gray-500">
        {isHighRisk
          ? "Clinical note: This report supports glaucoma screening review only. It is not a standalone diagnostic decision."
          : "Clinical note: This report supports review and screening follow-up only. The system does not replace professional clinical assessment."}
      </p>
    </div>
  );
}

function Reports() {
  const [messages, setMessages] = useState(INITIAL_MESSAGES);
  const [inputValue, setInputValue] = useState("");
  const [currentIntent, setCurrentIntent] = useState(null);
  const [generatedIntent, setGeneratedIntent] = useState(null);
  const [reportRows, setReportRows] = useState([]);
  const [reportTitle, setReportTitle] = useState("AI Report Assistant");

  const hasReport = Boolean(generatedIntent);
  const showInitialPrompts = messages.length === 1 && !currentIntent;

  const [isGenerating, setIsGenerating] = useState(false);
  const [reportError, setReportError] = useState("");
  const [isDownloading, setIsDownloading] = useState(false);

  const [previewPage, setPreviewPage] = useState(1);
  const rowsPerPage = 10;

  const summary = useMemo(() => {
    return {
      total: reportRows.length,
      active: reportRows.filter(row => row.status === "active").length,
      inactive: reportRows.filter(row => row.status === "inactive").length,
      glaucoma: reportRows.filter(row => row.diagnosis === "glaucoma").length,
      normal: reportRows.filter(row => row.diagnosis === "normal").length,
    };
  }, [reportRows]);

  function submitPrompt(text) {
    const trimmedText = text.trim();

    if (!trimmedText) return;

    const result = parseReportRequest(trimmedText);

    setMessages(prev => [
      ...prev,
      {
        role: "user",
        text: trimmedText,
      },
    ]);

    if (!result.ok) {
      setCurrentIntent(null);
      setMessages(prev => [
        ...prev,
        {
          role: "assistant",
          text: result.message,
        },
      ]);
      return;
    }

    setCurrentIntent(result.intent);
    setGeneratedIntent(null);
    setReportRows([]);
    setReportTitle("AI Report Assistant");

    setMessages(prev => [
      ...prev,
      {
        role: "assistant",
        text:
          "I understood your request. Please review the report type and filters below before generating the report.",
      },
    ]);
  }

  function handleSubmit(event) {
    event.preventDefault();
    submitPrompt(inputValue);
    setInputValue("");
  }

  async function handleGenerate() {
  if (!currentIntent || isGenerating) return;

  setIsGenerating(true);
  setReportError("");

  try {
    const response = await API.post("/reports/assistant/preview", currentIntent);
    const data = response.data;

    setReportRows(data.rows || []);
    setPreviewPage(1);
    setGeneratedIntent({
      report_type: data.report_type,
      filters: data.filters || currentIntent.filters,
      format: "pdf",
    });
    setReportTitle(data.title || formatReportType(currentIntent.report_type));
    setCurrentIntent(null);

    setMessages(prev => [
      ...prev,
      {
        role: "assistant",
        text: `Report preview generated. ${(data.rows || []).length} record${
          (data.rows || []).length === 1 ? "" : "s"
        } matched the selected filters.`,
      },
    ]);
  } catch (error) {
    const message =
      error.response?.data?.detail ||
      "Unable to generate the report preview. Please try again.";

    setReportError(message);

    setMessages(prev => [
      ...prev,
      {
        role: "assistant",
        text: message,
      },
    ]);
  } finally {
    setIsGenerating(false);
  }
}
  function handleClear() {
    setMessages(INITIAL_MESSAGES);
    setInputValue("");
    setCurrentIntent(null);
    setGeneratedIntent(null);
    setReportRows([]);
    setReportTitle("AI Report Assistant");
    setPreviewPage(1);
  }

async function handleDownload() {
  if (!hasReport || !generatedIntent || isDownloading) return;

  setIsDownloading(true);
  setReportError("");

  try {
    const response = await API.post(
      "/reports/assistant/pdf-go",
      generatedIntent,
      {
        responseType: "blob",
      }
    );

    const blob = new Blob([response.data], {
      type: "application/pdf",
    });

    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = `${generatedIntent.report_type}_report.pdf`;
    document.body.appendChild(link);
    link.click();

    link.remove();
    window.URL.revokeObjectURL(url);
  } catch (error) {
    const message =
      error.response?.data?.detail ||
      error.message ||
      "Unable to download the PDF report.";

    setReportError(message);

    setMessages(prev => [
      ...prev,
      {
        role: "assistant",
        text: message,
      },
    ]);
  } finally {
    setIsDownloading(false);
  }
}

  function handlePrint() {
    if (!hasReport) return;
    window.print();
  }

  return (
    <Layout title="Reports">
      <div className="space-y-5">
        <div className="flex flex-col gap-4 border-b border-[var(--color-border)] pb-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-xl font-semibold text-[var(--color-text1)]">
              {reportTitle}
            </h1>

            <p className="mt-1 text-sm text-[var(--color-text3)]">
              Generate clinical, administrative, and research reports using
              natural language.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleDownload}
              disabled={!hasReport || isDownloading}
              className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                hasReport
                  ? "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text1)] hover:bg-[var(--color-surface2)]"
                  : "border-transparent bg-[var(--color-surface2)] text-[var(--color-text3)] cursor-not-allowed"
              }`}
            >
              {isDownloading ? "Downloading..." : "Download PDF"}
            </button>

            <button
              type="button"
              onClick={handlePrint}
              disabled={!hasReport}
              className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                hasReport
                  ? "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text1)] hover:bg-[var(--color-surface2)]"
                  : "border-transparent bg-[var(--color-surface2)] text-[var(--color-text3)] cursor-not-allowed"
              }`}
            >
              Print
            </button>

            <button
              type="button"
              onClick={handleClear}
              className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-xs font-medium text-[var(--color-text1)] transition-colors hover:bg-[var(--color-surface2)]"
            >
              Generate New Report
            </button>
          </div>
        </div>

        {reportError && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {reportError}
          </div>
        )}


        <div
          style={{
            display: "flex",
            gap: "20px",
            alignItems: "flex-start",
            width: "100%",
          }}
        >
          <main
            style={{
              flex: "1 1 auto",
              minWidth: 0,
            }}
          >
            <ReportDocumentPreview
              title={reportTitle}
              rows={reportRows}
              intent={generatedIntent}
              summary={summary}
              previewPage={previewPage}
              rowsPerPage={rowsPerPage}
              onPageChange={setPreviewPage}
            />
          </main>

          <aside
            className="flex flex-col rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]"
            style={{
              width: "380px",
              minWidth: "380px",
              minHeight: "680px",
              maxHeight: "calc(100vh - 170px)",
              flexShrink: 0,
              position: "sticky",
              top: "20px",
            }}
          >
            <div className="flex shrink-0 items-center gap-2.5 border-b border-[var(--color-border)] px-4 py-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-accent/15 text-base">
                🤖
              </div>

              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold leading-tight text-[var(--color-text1)]">
                  AI Report Assistant
                </p>
                <p className="text-[10px] leading-tight text-[var(--color-text3)]">
                  Natural language report builder
                </p>
              </div>
            </div>

            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-4">
              {showInitialPrompts ? (
                <div className="flex min-h-[360px] flex-col items-center justify-center px-3 text-center">
                  <p className="mb-4 text-sm font-semibold text-[var(--color-text1)]">
                    What report do you need?
                  </p>

                  <div className="flex w-full flex-col gap-2">
                    {QUICK_PROMPTS.map(prompt => (
                      <button
                        key={prompt}
                        type="button"
                        onClick={() => submitPrompt(prompt)}
                        className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface2)] px-4 py-2 text-xs text-[var(--color-text2)] transition-colors hover:border-accent/30 hover:bg-accent/10 hover:text-accent"
                      >
                        {prompt}
                      </button>
                    ))}
                  </div>

                  <p className="mt-5 text-[11px] leading-relaxed text-[var(--color-text3)]">
                    You can also type a custom request below, such as active
                    glaucoma patients.
                  </p>
                </div>
              ) : (
                <>
                  {messages.map((message, index) => (
                    <ChatBubble
                      key={`${message.role}-${index}`}
                      message={message}
                    />
                  ))}
                  <IntentCard
                    intent={currentIntent}
                    onGenerate={handleGenerate}
                    isGenerating={isGenerating}
                  />
                </>
              )}
            </div>

            <div className="shrink-0 border-t border-[var(--color-border)] px-3 py-3">
              <form onSubmit={handleSubmit}>
                <div className="flex items-center gap-2 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface2)] py-1.5 pl-3 pr-1.5">
                  <input
                    type="text"
                    value={inputValue}
                    onChange={event => setInputValue(event.target.value)}
                    placeholder="Ask for a report"
                    className="min-w-0 flex-1 bg-transparent text-sm text-[var(--color-text1)] placeholder:text-[var(--color-text3)] focus:outline-none"
                  />

                  <button
                    type="submit"
                    disabled={!inputValue.trim()}
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-colors ${
                      inputValue.trim()
                        ? "bg-accent text-white hover:bg-accent2"
                        : "text-[var(--color-text3)] cursor-not-allowed"
                    }`}
                    aria-label="Send report request"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      className="h-3.5 w-3.5"
                      fill="currentColor"
                    >
                      <path d="M2.01 21 23 12 2.01 3 2 10l15 2-15 2z" />
                    </svg>
                  </button>
                </div>
              </form>
            </div>
          </aside>
        </div>
      </div>
    </Layout>
  );
}

export default Reports;
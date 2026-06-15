// src/pages/Reports.jsx
// AI Report Assistant with report preview on the left and assistant panel on the right.

import { useMemo, useState } from "react";
import Layout from "../components/Layout";
import API from "../api";

import { useTheme } from "../theme/ThemeProvider";

const QUICK_PROMPTS = [
  "Active glaucoma patients",
  "Inactive patients",
  "Normal patients last month",
  "High-risk report this week",
  "Screening summary last month",
  "Referral letters this month",
  "Patient clinical summary report",
  "Longitudinal risk report by patient",
  "Active users",
  // "Doctor user list",
];

const INITIAL_MESSAGES = [
  {
    role: "assistant",
    text: "Ask me what report you want to generate. I can prepare patient, screening, referral, follow-up, user, and patient clinical summary reports using filters such as active, inactive, glaucoma, normal, doctor, nurse, this week, this month, or a patient name.",
  },
];


function formatDate(iso) {
  return new Date(iso).toLocaleDateString("en-NZ", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}


function formatDateTime(value) {
  if (!value) return "N/A";

  const valueText = String(value);
  const hasTimezone = /Z$|[+-]\d{2}:\d{2}$/.test(valueText);
  const normalisedValue = hasTimezone ? valueText : `${valueText}Z`;
  const parsedDate = new Date(normalisedValue);

  if (Number.isNaN(parsedDate.getTime())) {
    return "N/A";
  }

  return parsedDate.toLocaleString("en-NZ", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatFileName(value) {
  if (!value) return "N/A";
  return value;
}

function formatReportType(type) {
  if (type === "high_risk") return "High Risk Report";
  if (type === "screening_summary") return "Screening Summary Report";
  if (type === "referral_list") return "Referral List Report";
  if (type === "follow_up_list") return "Follow-up List Report";
  if (type === "user_list") return "User List Report";
  if (type === "patient_clinical_summary") return "Patient Clinical Summary Report";
  return "Patient List Report";
}

function formatFilterValue(value) {
  const labels = {
    active: "Active",
    inactive: "Inactive",
    glaucoma: "Glaucoma",
    normal: "Normal",
    left: "Left eye",
    right: "Right eye",
    admin: "Admin",
    doctor: "Doctor",
    nurse: "Nurse",
    days_since_last_screening: "Days since last screening",
    this_week: "This week",
    this_month: "This month",
    last_week: "Last week",
    last_month: "Last month",
  };

  return labels[value] || value;
}

function formatFilterLabel(key) {
  const labels = {
    status: "Patient status",
    diagnosis: "Screening result",
    eye_side: "Eye",
    role: "Role",
    patient_query: "Patient",
    patient_name: "Patient",
    patient_code: "Patient ID",
    patient_id: "Patient UUID",
    days_since_last_screening: "No follow-up within",
    date_range: "Date range",
    date_label: "Date range",
    date_phrase: "Date phrase",
    date_from: "Date from",
    date_to: "Date to",    
  };

  return labels[key] || key;
}

function extractDatePhrase(rawText) {
  const text = rawText.toLowerCase().trim();

  const exactPhrases = [
    "today",
    "yesterday",
    "this week",
    "last week",
    "this month",
    "last month",
    "this quarter",
    "last quarter",
    "this year",
    "last year",
  ];

  for (const phrase of exactPhrases) {
    if (text.includes(phrase)) {
      return phrase;
    }
  }

  const lastDaysMatch = text.match(/last\s+\d+\s+days?/);
  if (lastDaysMatch) {
    return lastDaysMatch[0];
  }

  const lastMonthsMatch = text.match(/last\s+\d+\s+months?/);
  if (lastMonthsMatch) {
    return lastMonthsMatch[0];
  }

  const quarterMatch = text.match(/q[1-4]\s+(this\s+year|\d{4})/);
  if (quarterMatch) {
    return quarterMatch[0];
  }

  const nzDateRangeMatch = text.match(
    /(?:from|between)\s+\d{1,2}\/\d{1,2}\/\d{4}\s+(?:to|and)\s+\d{1,2}\/\d{1,2}\/\d{4}/
  );
  if (nzDateRangeMatch) {
    return nzDateRangeMatch[0];
  }

  const isoRangeMatch = text.match(
    /(?:from|between)\s+\d{4}-\d{2}-\d{2}\s+(?:to|and)\s+\d{4}-\d{2}-\d{2}/
  );
  if (isoRangeMatch) {
    return isoRangeMatch[0];
  }

  const monthNameRangeMatch = text.match(
    /(?:from|between)\s+[a-z]+\s+\d{1,2}(?:,\s*\d{4})?\s+(?:to|and)\s+[a-z]+\s+\d{1,2}(?:,\s*\d{4})?/
  );
  if (monthNameRangeMatch) {
    return monthNameRangeMatch[0];
  }

  return "";
}

function extractPatientQuery(rawText) {
  const text = rawText.trim();

  const patterns = [
    /(?:all\s+)?patients?\s+(?:with\s+name|named)\s+(.+)$/i,
    /patient\s+name\s+(.+)$/i,
    /(?:patient clinical summary|patient clinical report|clinical summary|clinical report|patient report|longitudinal report|longitudinal risk report|risk report|screening history)\s+(?:for|of)\s+(.+)$/i,
    /(?:for|of)\s+([a-z0-9][a-z0-9\s.'-]+)$/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);

    if (!match?.[1]) continue;

    let value = match[1].trim();

    value = value
      .replace(/\b(today|yesterday|this week|last week|this month|last month|this year|last year)\b/gi, "")
      .replace(/\b(active|inactive|glaucoma|normal|positive|negative|left eye|right eye)\b/gi, "")
      .replace(/[?.!,]+$/g, "")
      .trim();

    if (value) return value;
  }

  const patientCodeMatch = text.match(/\b(PAT\d{4,}|PT-\d{3,})\b/i);
  return patientCodeMatch?.[1] || "";
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

  const mentionsUserReport =
    text.includes("user") ||
    text.includes("users") ||
    text.includes("staff") ||
    text.includes("doctor list") ||
    text.includes("doctor report") ||
    text.includes("nurse list") ||
    text.includes("nurse report") ||
    text.includes("admin list") ||
    text.includes("admin report");

  const mentionsReferralReport =
    text.includes("referral") ||
    text.includes("referral letter") ||
    text.includes("referrals") ||
    text.includes("letters generated") ||
    text.includes("generated letters");

  const mentionsFollowUpReport =
    text.includes("follow-up") ||
    text.includes("follow up") ||
    text.includes("followup") ||
    text.includes("follow-up report") ||
    text.includes("follow-up list") ||
    text.includes("due for follow");

  const mentionsPatientClinicalReport =
    text.includes("patient clinical") ||
    text.includes("clinical summary for") ||
    text.includes("clinical report for") ||
    text.includes("patient report for") ||
    text.includes("longitudinal report") ||
    text.includes("longitudinal risk report") ||
    text.includes("risk report for") ||
    text.includes("screening history for");

  const patientQuery = extractPatientQuery(rawText);

  if (mentionsPatientClinicalReport) {
    reportType = "patient_clinical_summary";
  }

  if (text.includes("high risk") || text.includes("high-risk")) {
    reportType = "high_risk";
  }

  if (
    reportType !== "patient_clinical_summary" &&
    (text.includes("screening summary") ||
      text.includes("screening report") ||
      text.includes("summary"))
  ) {
    reportType = "screening_summary";
  }

  if (
    text.includes("follow-up") ||
    text.includes("follow up") ||
    text.includes("followup")
  ) {
    reportType = "follow_up_list";
  }

  if (reportType !== "patient_clinical_summary" && mentionsReferralReport) {
    reportType = "referral_list";
  }

  if (reportType !== "patient_clinical_summary" && mentionsFollowUpReport) {
    reportType = "follow_up_list";
  }

  if (reportType !== "patient_clinical_summary" && mentionsUserReport) {
    reportType = "user_list";
  }

  const filters = {};


  if (patientQuery && reportType !== "user_list") {
    filters.patient_query = patientQuery;
  }

  if (reportType === "patient_clinical_summary") {
    if (!filters.patient_query) {
      return {
        ok: false,
        message: "Please include the patient name or patient ID. Example: Patient clinical report for [patient name or patient ID].",
      };
    }
  }

  if (reportType === "follow_up_list") {
    const daysMatch = text.match(/(\d{1,3})\s*[- ]?\s*(day|days|d)\b/);

    filters.days_since_last_screening = daysMatch ? Number(daysMatch[1]) : 1;
  }

  if (text.includes("inactive")) {
    filters.status = "inactive";
  } else if (text.includes("active")) {
    filters.status = "active";
  }

  if (reportType === "user_list") {
    if (text.includes("admin")) {
      filters.role = "admin";
    } else if (text.includes("doctor")) {
      filters.role = "doctor";
    } else if (text.includes("nurse")) {
      filters.role = "nurse";
    }
  }

  if (reportType === "follow_up_list") {    
    const daysMatch = text.match(/(\d{1,3})\s*[- ]?\s*(day|days|d)\b/);    

    if (daysMatch) {
      filters.days_since_last_screening = Number(daysMatch[1]);
    } else {
      filters.days_since_last_screening = 7;
    }
  }

  if (reportType !== "user_list" && reportType !== "patient_clinical_summary") {
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

    if (text.includes("left eye") || text.includes("left-eye")) {
      filters.eye_side = "left";
    }

    if (text.includes("right eye") || text.includes("right-eye")) {
      filters.eye_side = "right";
    }
  }

  const datePhrase = extractDatePhrase(text);

  if (datePhrase && reportType !== "patient_clinical_summary") {
    filters.date_phrase = datePhrase;
  }

  const hasKnownFilter = Object.keys(filters).length > 0;
  const mentionsPatient =
    text.includes("patient") ||
    text.includes("patients") ||
    text.includes("list");

  if (
    !hasKnownFilter &&
    !mentionsPatient &&
    !mentionsUserReport &&
    reportType === "patient_list"
  ) {
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

function AssistantProgress({ label }) {
  return (
    <div className="flex justify-start">
      <div className="max-w-[88%] rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface2)] px-3 py-2 text-sm text-[var(--color-text1)]">
        <div className="flex items-center gap-2">
          <span>{label}</span>

          <span className="flex items-center gap-1">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--color-text3)]" />
            <span
              className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--color-text3)]"
              style={{ animationDelay: "150ms" }}
            />
            <span
              className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--color-text3)]"
              style={{ animationDelay: "300ms" }}
            />
          </span>
        </div>
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
  const entries = Object.entries(filters || {}).filter(([, value]) => {
    return value !== null && value !== undefined && value !== "";
  });

  const hiddenKeys = new Set(["date_phrase", "date_from", "date_to", "patient_id"]);

  return entries.filter(([key]) => !hiddenKeys.has(key));
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

function getScreeningSummary(summary) {
  return [
    { label: "Total screenings", value: summary.total || 0 },
    { label: "Glaucoma", value: summary.glaucoma || 0 },
    { label: "Normal", value: summary.normal || 0 },
    { label: "High risk", value: summary.highRisk || 0 },
    { label: "Average confidence", value: summary.averageConfidence || "N/A" },
    { label: "Grad-CAM generated", value: summary.gradcamGenerated || 0 },
  ];
}



function getFollowUpListSummary(summary) {
  return [
    { label: "Follow-up needed", value: summary.total || 0 },
    { label: "Glaucoma", value: summary.glaucoma || 0 },
    { label: "Possible OHTS", value: summary.possibleOhts || 0 },
    { label: "Critical OHTS", value: summary.criticalOhts || 0 },
    { label: "With referral", value: summary.withReferral || 0 },
    { label: "Without referral", value: summary.withoutReferral || 0 },
    { label: "Average days elapsed", value: summary.averageDaysElapsed || "N/A" },
  ];
}

function getReferralListSummary(summary) {
  return [
    { label: "Total referrals", value: summary.total || 0 },
    { label: "Glaucoma", value: summary.glaucoma || 0 },
    { label: "Normal", value: summary.normal || 0 },
    { label: "Signed", value: summary.signed || 0 },
    { label: "Unsigned", value: summary.unsigned || 0 },
    { label: "GPT-4o", value: summary.gpt4o || 0 },
    { label: "Gemini", value: summary.gemini || 0 },
  ];
}


function getUserListSummary(summary) {
  return [
    { label: "Total users", value: summary.total || 0 },
    { label: "Active", value: summary.active || 0 },
    { label: "Inactive", value: summary.inactive || 0 },
    { label: "Admin", value: summary.admin || 0 },
    { label: "Doctor", value: summary.doctor || 0 },
    { label: "Nurse", value: summary.nurse || 0 },
  ];
}

function getPatientClinicalSummary(summary) {
  return [
    { label: "Total screenings", value: summary?.total || 0 },
    { label: "Latest result", value: summary?.latestResult || "N/A" },
    { label: "Latest confidence", value: summary?.latestConfidence || "N/A" },
    { label: "Highest confidence", value: summary?.highestConfidence || "N/A" },
    { label: "Latest screening", value: summary?.latestScreening || "N/A" },
    { label: "Eyes screened", value: summary?.eyesScreened || "N/A" },
  ];
}

function getPreviewColumns(reportType) {
  if (reportType === "patient_clinical_summary") {
    return [
      { key: "screening_date", label: "Date / Time" },
      { key: "eye", label: "Eye" },
      { key: "result", label: "Result" },
      { key: "confidence", label: "Confidence" },
      { key: "ohts", label: "OHTS" },
      { key: "cdr", label: "CDR" },
      { key: "clinician", label: "Screened By" },
    ];
  }

  if (reportType === "follow_up_list") {
    return [
      { key: "lastScreening", label: "Last Screening" },
      { key: "patientId", label: "Patient ID" },
      { key: "name", label: "Patient Name" },
      { key: "ageGender", label: "Age / Gender" },
      { key: "eye", label: "Eye" },
      { key: "diagnosis", label: "Prediction" },
      { key: "confidence", label: "Confidence" },
      { key: "ohts", label: "OHTS" },
      { key: "cdr", label: "CDR" },
      { key: "daysElapsed", label: "Days" },
      { key: "referralStatus", label: "Referral" },
      { key: "clinician", label: "Screened By" },
      { key: "followUpReason", label: "Follow-up Reason" },
    ];
  }

  if (reportType === "referral_list") {
    return [
      { key: "referralDate", label: "Referral Date" },
      { key: "patientId", label: "Patient ID" },
      { key: "name", label: "Patient Name" },
      { key: "ageGender", label: "Age / Gender" },
      { key: "eye", label: "Eye" },
      { key: "diagnosis", label: "Prediction" },
      { key: "confidence", label: "Confidence" },
      { key: "cdr", label: "CDR" },
      { key: "ohts", label: "OHTS" },
      { key: "llm", label: "LLM" },
      { key: "signedBy", label: "Signed By" },
      { key: "clinician", label: "Screened By" },
    ];
  }

  if (reportType === "user_list") {
    return [
      { key: "userId", label: "User ID" },
      { key: "name", label: "Name" },
      { key: "role", label: "Role" },
      { key: "email", label: "Email" },
      { key: "mobile", label: "Mobile" },
      { key: "status", label: "Status" },
      { key: "createdAt", label: "Created Date" },
    ];
  }

  if (reportType === "screening_summary") {
    return [
      { key: "screeningDate", label: "Screening Date" },
      { key: "patientId", label: "Patient ID" },
      { key: "name", label: "Patient Name" },
      { key: "ageGender", label: "Age / Gender" },
      { key: "eye", label: "Eye" },
      { key: "diagnosis", label: "Prediction" },
      { key: "confidence", label: "Confidence" },
      { key: "cdr", label: "CDR" },
      { key: "ohts", label: "OHTS" },
      { key: "risk", label: "Risk" },
      { key: "gradcam", label: "Grad-CAM" },
      { key: "clinician", label: "Screened By" },
    ];
  }

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
      { key: "clinician", label: "Screened By" },
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
    { key: "clinician", label: "Screened By" },
  ];
}

function getCellValue(row, key) {
  const value = row[key];

  if (value === null || value === undefined || value === "") {
    return "N/A";
  }

  if (key === "status" || key === "diagnosis" || key === "role") {
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
  const isPatientClinical = reportType === "patient_clinical_summary";
  const isScreeningSummary = reportType === "screening_summary";
  const isReferralList = reportType === "referral_list";
  const isFollowUpList = reportType === "follow_up_list";
  const isUserList = reportType === "user_list";

  const filterEntries = getNonEmptyFilters(intent.filters);
  const summaryCards = isPatientClinical
    ? getPatientClinicalSummary(summary)
    : isHighRisk
    ? getHighRiskSummary(rows)
    : isScreeningSummary
      ? getScreeningSummary(summary)
      : isReferralList
        ? getReferralListSummary(summary)
        : isFollowUpList
          ? getFollowUpListSummary(summary)
          : isUserList
          ? getUserListSummary(summary)
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
            {isPatientClinical
              ? "Generated from one patient's screening profile with longitudinal risk tracking."
              : isHighRisk
              ? "Generated from high-risk screening records using validated report filters."
              : isScreeningSummary
                ? "Generated from completed screening activity using validated report filters."
                : isReferralList
                  ? "Generated from referral letter records using validated report filters."
                  : isFollowUpList
                    ? "Generated from high-risk screening records with no recent follow-up screening."
                    : isUserList
                    ? "Generated from user account records using validated report filters."
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
                {formatFilterLabel(key)}: {key === "days_since_last_screening"
                  ? `${value} ${Number(value) === 1 ? "day" : "days"}`
                  : formatFilterValue(value)}
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
        {isPatientClinical
          ? "Clinical note: This patient-level report supports glaucoma screening review only. It is not a standalone diagnostic decision."
          : isHighRisk
          ? "Clinical note: This report supports glaucoma screening review only. It is not a standalone diagnostic decision."
          : isScreeningSummary
            ? "Clinical note: This report summarises glaucoma screening activity and supports review or follow-up planning only."
            : "Clinical note: This report supports review and screening follow-up only. The system does not replace professional clinical assessment."}
      </p>
    </div>
  );
}


function ReportHistoryPanel({ items, isLoading, error, onRefresh }) {
  function renderFilters(filters) {
    return getNonEmptyFilters(filters);
  }

  function statusClassName(status) {
    if (status === "success") return "bg-green-100 text-green-700";
    if (status === "failed") return "bg-red-100 text-red-700";

    return "bg-[var(--color-surface2)] text-[var(--color-text3)]";
  }

  return (
    <div className="mx-auto max-w-6xl rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-sm">
      <div className="mb-5 flex flex-col gap-3 border-b border-[var(--color-border)] pb-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
            Report audit trail
          </p>

          <h2 className="mt-1 text-2xl font-semibold text-[var(--color-text1)]">
            Report History
          </h2>

          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--color-text3)]">
            Shows generated PDF reports, including report type, filters, record count, status, and user.
          </p>
        </div>

        <button
          type="button"
          onClick={onRefresh}
          disabled={isLoading}
          className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
            isLoading
              ? "cursor-not-allowed border-transparent bg-[var(--color-surface2)] text-[var(--color-text3)]"
              : "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text1)] hover:bg-[var(--color-surface2)]"
          }`}
        >
          {isLoading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-[var(--color-border)]">
        <table className="w-full text-sm">
          <thead className="bg-[var(--color-surface2)] text-left text-xs font-semibold uppercase tracking-wide text-[var(--color-text3)]">
            <tr>
              <th className="px-4 py-3 whitespace-nowrap">Generated</th>
              <th className="px-4 py-3 whitespace-nowrap">Report</th>
              <th className="px-4 py-3 whitespace-nowrap">Generated By</th>
              <th className="px-4 py-3 whitespace-nowrap">Filters</th>
              <th className="px-4 py-3 whitespace-nowrap">Records</th>
              <th className="px-4 py-3 whitespace-nowrap">Status</th>
              <th className="px-4 py-3 whitespace-nowrap">File</th>
            </tr>
          </thead>

          <tbody className="divide-y divide-[var(--color-border)]">
            {isLoading ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-sm text-[var(--color-text3)]">
                  Loading report history...
                </td>
              </tr>
            ) : items.length > 0 ? (
              items.map(item => {
                const filterEntries = renderFilters(item.filters || {});
                const visibleFilters = filterEntries.slice(0, 3);
                const hiddenFilterCount = Math.max(filterEntries.length - visibleFilters.length, 0);

                return (
                  <tr key={item.reportHistoryId}>
                    <td className="px-4 py-3 text-[var(--color-text2)] whitespace-nowrap">
                      {formatDateTime(item.createdAt)}
                    </td>

                    <td className="px-4 py-3 text-[var(--color-text2)] whitespace-nowrap">
                      <div className="font-medium text-[var(--color-text1)]">
                        {item.reportTitle || formatReportType(item.reportType)}
                      </div>
                      <div className="text-xs text-[var(--color-text3)]">
                        {formatReportType(item.reportType)}
                      </div>
                    </td>

                    <td className="px-4 py-3 text-[var(--color-text2)] whitespace-nowrap">
                      {item.generatedByName || "N/A"}
                    </td>

                    <td className="px-4 py-3 text-[var(--color-text2)]">
                      <div className="flex max-w-md flex-wrap gap-1.5">
                        {filterEntries.length > 0 ? (
                          <>
                            {visibleFilters.map(([key, value]) => (
                              <span
                                key={`${item.reportHistoryId}-${key}`}
                                className="rounded-full bg-[var(--color-surface2)] px-2 py-1 text-[11px] text-[var(--color-text2)] ring-1 ring-[var(--color-border)]"
                              >
                                {formatFilterLabel(key)}: {key === "days_since_last_screening"
                                  ? `${value} ${Number(value) === 1 ? "day" : "days"}`
                                  : formatFilterValue(value)}                                
                              </span>
                            ))}

                            {hiddenFilterCount > 0 && (
                              <span className="rounded-full bg-[var(--color-surface2)] px-2 py-1 text-[11px] text-[var(--color-text3)] ring-1 ring-[var(--color-border)]">
                                +{hiddenFilterCount} more
                              </span>
                            )}
                          </>
                        ) : (
                          <span className="text-xs text-[var(--color-text3)]">
                            No filters
                          </span>
                        )}
                      </div>
                    </td>

                    <td className="px-4 py-3 text-[var(--color-text2)] whitespace-nowrap">
                      {item.recordCount ?? 0}
                    </td>

                    <td className="px-4 py-3 whitespace-nowrap">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${statusClassName(item.status)}`}
                      >
                        {String(item.status || "unknown").toUpperCase()}
                      </span>
                    </td>

                    <td className="px-4 py-3 text-xs text-[var(--color-text3)]">
                      <div
                        className="max-w-[260px] truncate"
                        title={formatFileName(item.fileName)}
                      >
                        {formatFileName(item.fileName)}
                      </div>
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-sm text-[var(--color-text3)]">
                  No report history yet. Generate and download a PDF report first.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

  function extractPatientQueryFromPrompt(rawText) {
    const text = String(rawText || "").trim();

    if (!text) return "";

    const patterns = [
      /(?:patients?\s+with\s+name|patients?\s+named|patient\s+name)\s+(.+)$/i,
      /(?:patient clinical summary|patient clinical report|clinical summary|clinical report|patient report|longitudinal report|longitudinal risk report|screening history)\s+(?:for|of)\s+(.+)$/i,
      /(?:for|of)\s+([A-Za-z0-9][A-Za-z0-9\s._-]*)$/i,
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);

      if (match?.[1]) {
        return match[1]
          .replace(/[?.!,]+$/g, "")
          .replace(/\b(this week|this month|last week|last month|today|yesterday)\b/gi, "")
          .trim();
      }
    }

    return "";
  }

function normaliseAssistantIntent(rawText, data) {
  const rawPrompt = String(rawText || "").trim();
  const text = rawPrompt.toLowerCase();
  const filters = { ...(data?.filters || {}) };

  const patientQuery =
    data?.patient_query ||
    data?.patient_name ||
    data?.patient_code ||
    data?.patient_id ||
    filters.patient_query ||
    filters.patient_name ||
    filters.patient_code ||
    filters.patient_id ||
    extractPatientQueryFromPrompt(rawText);

  if (patientQuery) {
    filters.patient_query = patientQuery;
  }

  delete filters.patient_name;
  delete filters.patient_code;
  delete filters.patient_id;

  let reportType = data?.report_type || "patient_list";

  const asksForPatientClinicalReport =
    text.includes("longitudinal") ||
    text.includes("clinical summary") ||
    text.includes("clinical report") ||
    text.includes("patient clinical") ||
    text.includes("screening history");

  const asksForScreeningSummary =
    text.includes("screening summary") ||
    text.includes("screening report");

  const asksForPatientListByName =
    text.includes("all patients") ||
    text.includes("patients with name") ||
    text.includes("patients named") ||
    text.includes("patient name");

  const isSimplePatientSearch =
    /^patients?\s+[a-z0-9][a-z0-9\s.'-]*$/i.test(rawPrompt);

  if (asksForPatientClinicalReport) {
    reportType = "patient_clinical_summary";
  } else if (asksForScreeningSummary) {
    reportType = "screening_summary";
  } else if (asksForPatientListByName || isSimplePatientSearch) {
    reportType = "patient_list";
  }

  const hasEnoughInformation =
    reportType !== "patient_clinical_summary" || Boolean(filters.patient_query);

  if (data?.needs_clarification && !hasEnoughInformation) {
    return {
      ok: false,
      message:
        data?.clarification_question ||
        "Please provide more detail so I can prepare the correct report.",
    };
  }

  if (reportType === "patient_clinical_summary" && !filters.patient_query) {
    return {
      ok: false,
      message:
        "Please provide the patient name or patient ID for the patient clinical summary report.",
    };
  }

  return {
    ok: true,
    intent: {
      report_type: reportType,
      filters,
      format: "pdf",
    },
    llmMeta: {
      llm_used: data?.llm_used,
      model_used: data?.model_used,
      duration_ms: data?.duration_ms,
      token_usage: data?.token_usage,
    },
  };
}

function Reports() {
  const [messages, setMessages] = useState(INITIAL_MESSAGES);
  const [inputValue, setInputValue] = useState("");
  const [isInterpreting, setIsInterpreting] = useState(false);
  const [currentIntent, setCurrentIntent] = useState(null);
  const [generatedIntent, setGeneratedIntent] = useState(null);
  const [reportRows, setReportRows] = useState([]);
  const [reportSummary, setReportSummary] = useState(null);
  const [reportTitle, setReportTitle] = useState("AI Report Assistant");
  const [reportPreviewData, setReportPreviewData] = useState(null);

  const hasReport = Boolean(generatedIntent);
  const showInitialPrompts = messages.length === 1 && !currentIntent;

  const [isGenerating, setIsGenerating] = useState(false);
  const [reportError, setReportError] = useState("");
  const [isDownloading, setIsDownloading] = useState(false);
  const [isPrinting, setIsPrinting] = useState(false);

  const [previewPage, setPreviewPage] = useState(1);
  const rowsPerPage = 10;

  const [activeView, setActiveView] = useState("current");
  const [reportHistory, setReportHistory] = useState([]);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");

  const [patientSelection, setPatientSelection] = useState(null);

  {/* THEME */}
  const { currentTheme, themes } = useTheme();
  const isDarkTheme = themes[currentTheme]?.mode === "dark";
  const logoSrc = "/assets/ai-report-logo.png";

  const previewSummary = useMemo(() => {
    if (
      (generatedIntent?.report_type === "patient_clinical_summary" ||
        generatedIntent?.report_type === "screening_summary" ||
        generatedIntent?.report_type === "referral_list" ||
        generatedIntent?.report_type === "follow_up_list" ||
        generatedIntent?.report_type === "user_list") &&
      reportSummary
    ) {
      return reportSummary;
    }

    return {
      total: reportRows.length,
      active: reportRows.filter(row => row.status === "active").length,
      inactive: reportRows.filter(row => row.status === "inactive").length,
      glaucoma: reportRows.filter(row => row.diagnosis === "glaucoma").length,
      normal: reportRows.filter(row => row.diagnosis === "normal").length,
    };
  }, [generatedIntent, reportRows, reportSummary]);

  async function handleSelectPatientForReport(patient) {
    if (!patient || isGenerating) return;

    setPatientSelection(null);

    const intent = {
      report_type: "patient_clinical_summary",
      filters: {
        patient_id: patient.patient_id,
        patient_code: patient.patient_code,
        patient_name: patient.patient_name,
      },
      format: "pdf",
    };

    setMessages(prev => [
      ...prev,
      {
        role: "user",
        text: `${patient.patient_name} (${patient.patient_code})`,
      },
    ]);

    await generateReportPreview(intent);
  }

  async function fetchReportHistory({ silent = false } = {}) {
    if (!silent) {
      setIsHistoryLoading(true);
    }

    setHistoryError("");

    try {
      const response = await API.get("/reports/history?limit=20&offset=0");
      setReportHistory(response.data?.items || []);
    } catch (error) {
      const message =
        error.response?.data?.detail ||
        error.message ||
        "Unable to load report history.";

      setHistoryError(message);
    } finally {
      if (!silent) {
        setIsHistoryLoading(false);
      }
    }
  }

  function handleOpenHistory() {
    setActiveView("history");
    fetchReportHistory();
  }

  async function interpretPromptWithAssistant(trimmedText) {
    try {
      const response = await API.post("/reports/assistant/interpret", {
        prompt: trimmedText,
      });

      const data = response.data || {};

      if (data.needs_clarification) {
        return {
          ok: false,
          message:
            data.clarification_question ||
            "Please provide more detail so I can prepare the correct report.",
        };
      }

      if (!data.report_type) {
        return {
          ok: false,
          message: "I could not identify the report type. Please rephrase your request.",
        };
      }

      return {
        ok: true,
        source: data.llm_used ? "llm" : "parser",
        modelUsed: data.model_used || null,
        durationMs: data.duration_ms || null,
        intent: {
          report_type: data.report_type,
          filters: data.filters || {},
          format: "pdf",
        },
      };
    } catch (error) {
      console.warn("LLM report interpretation unavailable. Falling back to rule parser.", error);
      return parseReportRequest(trimmedText);
    }
  }

  async function submitPrompt(text) {
    const trimmedText = text.trim();

    if (!trimmedText) return;

    setActiveView("current");

    setMessages(prev => [
      ...prev,
      {
        role: "user",
        text: trimmedText,
      },
    ]);
    setIsInterpreting(true);
    let result;

    setIsInterpreting(true);

    try {
      const response = await API.post("/reports/assistant/interpret", {
        prompt: trimmedText,
      });

      result = normaliseAssistantIntent(trimmedText, response.data);
    } catch (error) {
      console.warn("LLM report interpretation failed. Falling back to rule parser.", error);
      result = parseReportRequest(trimmedText);
    } finally {
      setIsInterpreting(false);
    }

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
    setPatientSelection(null);
    setCurrentIntent(null);
    setGeneratedIntent(null);
    setReportRows([]);
    setReportSummary(null);
    setReportPreviewData(null);
    setReportTitle("AI Report Assistant");

    setMessages(prev => [
      ...prev,
      {
        role: "assistant",
        text:
          result.llmMeta?.llm_used
            ? "I used the report assistant LLM to organise your request. Please review the report type and filters below before generating the report."
            : "I understood your request. Please review the report type and filters below before generating the report.",
      },
    ]);

    await generateReportPreview(result.intent);
  }

  function handleSubmit(event) {
    event.preventDefault();

    const submittedText = inputValue;
    setInputValue("");

    void submitPrompt(submittedText);
  }

async function generateReportPreview(intent) {
  if (!intent || isGenerating) return;

  setIsGenerating(true);
  setReportError("");

  try {
    const response = await API.post("/reports/assistant/preview", intent);
    const data = response.data;

    const mergedFilters = {
      ...(intent.filters || {}),
      ...(data.filters || {}),
    };

    const previewData = {
      ...data,
      report_type: data.report_type,
      title: data.title || formatReportType(intent.report_type),
      filters: mergedFilters,
      rows: data.rows || [],
      summary: data.summary || null,
    };

    setReportRows(previewData.rows);
    setReportSummary(previewData.summary);
    setReportPreviewData(previewData);
    setPatientSelection(null);
    setPreviewPage(1);

    setGeneratedIntent({
      report_type: previewData.report_type,
      filters: mergedFilters,
      format: "pdf",
    });

    setReportTitle(previewData.title);
    setCurrentIntent(null);
    setActiveView("current");

    setMessages(prev => [
      ...prev,
      {
        role: "assistant",
        text: `Report preview generated. ${previewData.rows.length} record${
          previewData.rows.length === 1 ? "" : "s"
        } matched the selected filters.`,
      },
    ]);
  } catch (error) {
    const detail = error.response?.data?.detail;

    if (
      detail &&
      typeof detail === "object" &&
      detail.needs_patient_selection
    ) {
      setPatientSelection({
        report_type: detail.report_type || "patient_clinical_summary",
        matches: detail.matches || [],
      });

      setReportError("");

      setMessages(prev => [
        ...prev,
        {
          role: "assistant",
          text:
            detail.message ||
            "Multiple patients matched. Please choose one patient.",
        },
      ]);

      return;
    }

    const message =
      typeof detail === "string"
        ? detail
        : error.message ||
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

  async function handleGenerate() {
    await generateReportPreview(currentIntent);
  }

  function handleClear() {
    setPatientSelection(null);
    setMessages(INITIAL_MESSAGES);
    setInputValue("");
    setCurrentIntent(null);
    setGeneratedIntent(null);
    setReportRows([]);
    setReportSummary(null);
    setReportTitle("AI Report Assistant");
    setReportPreviewData(null);
    setPreviewPage(1);
    setActiveView("current");
    setHistoryError("");
  }

function buildPdfPayload() {
  return {
    ...generatedIntent,
    preview_data: {
      ...(reportPreviewData || {}),
      report_type: generatedIntent.report_type,
      title: reportTitle,
      filters: generatedIntent.filters || {},
      summary: reportSummary || previewSummary,
      rows: reportRows,
    },
  };
}

async function handleDownload() {
  if (!hasReport || !generatedIntent || isDownloading) return;

  setIsDownloading(true);
  setReportError("");

  try {
    const response = await API.post(
      "/reports/assistant/pdf-go",
      buildPdfPayload(),
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

    fetchReportHistory({ silent: true });
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

  async function handlePrint() {
    if (!hasReport || !generatedIntent || isPrinting) return;

    setIsPrinting(true);
    setReportError("");

    try {
      const response = await API.post(
        "/reports/assistant/pdf-go",
        buildPdfPayload(),
        {
          responseType: "blob",
        }
      );

      const blob = new Blob([response.data], {
        type: "application/pdf",
      });

      const url = window.URL.createObjectURL(blob);
      const printWindow = window.open(url, "_blank");

      if (!printWindow) {
        throw new Error("Popup blocked. Please allow popups to print the report.");
      }

      printWindow.onload = () => {
        printWindow.focus();
        printWindow.print();
      };

      fetchReportHistory({ silent: true });
    } catch (error) {
      const message =
        error.response?.data?.detail ||
        error.message ||
        "Unable to print the PDF report.";

      setReportError(message);

      setMessages(prev => [
        ...prev,
        {
          role: "assistant",
          text: message,
        },
      ]);
    } finally {
      setIsPrinting(false);
    }
  }

  return (
    <Layout title="Reports">
      <div className="space-y-5">
        <div className="flex flex-col gap-4 border-b border-[var(--color-border)] pb-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-xl font-semibold text-[var(--color-text1)]">
              {activeView === "history" ? "Report History" : reportTitle}
            </h1>

            <p className="mt-1 text-sm text-[var(--color-text3)]">
              {activeView === "history"
                ? "Review generated PDF reports, filters, status, record count, and user audit details."
                : "Generate clinical, administrative, and research reports using natural language."}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveView("current")}
              className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                activeView === "current"
                  ? "border-accent bg-accent/10 text-accent"
                  : "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text1)] hover:bg-[var(--color-surface2)]"
              }`}
            >
              Current Report
            </button>

            <button
              type="button"
              onClick={handleOpenHistory}
              className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                activeView === "history"
                  ? "border-accent bg-accent/10 text-accent"
                  : "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text1)] hover:bg-[var(--color-surface2)]"
              }`}
            >
              Report History
            </button>

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
              disabled={!hasReport || isPrinting}
              className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                hasReport
                  ? "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text1)] hover:bg-[var(--color-surface2)]"
                  : "border-transparent bg-[var(--color-surface2)] text-[var(--color-text3)] cursor-not-allowed"
              }`}
            >
              {isPrinting ? "Preparing..." : "Print"}
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
            {activeView === "history" ? (
              <ReportHistoryPanel
                items={reportHistory}
                isLoading={isHistoryLoading}
                error={historyError}
                onRefresh={() => fetchReportHistory()}
              />
            ) : (
              <ReportDocumentPreview
                title={reportTitle}
                rows={reportRows}
                intent={generatedIntent}
                summary={previewSummary}
                previewPage={previewPage}
                rowsPerPage={rowsPerPage}
                onPageChange={setPreviewPage}
              />
            )}
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
                <img
                  src={logoSrc}
                  alt="Glaucoma AI"
                  className="h-8 w-auto max-w-[190px] object-contain"
                />                
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
                    glaucoma patients, screening summary last month, or patient clinical report for a patient name or patient ID.
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
                  {(isInterpreting || isGenerating) && (
                    <AssistantProgress
                      label={
                        isInterpreting
                          ? "Interpreting request . . ."
                          : "Preparing report preview . . ."
                      }
                    />
                  )}                  
                  {patientSelection?.matches?.length > 0 && (
                    <div className="mx-1 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3 shadow-sm">
                      <p className="mb-2 text-xs font-semibold text-[var(--color-text3)]">
                        Choose patient
                      </p>

                      <div className="space-y-2">
                        {patientSelection.matches.map(patient => (
                          <button
                            key={patient.patient_id}
                            type="button"
                            onClick={() => handleSelectPatientForReport(patient)}
                            className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface2)] px-3 py-2 text-left text-xs text-[var(--color-text1)] transition-colors hover:border-accent/40 hover:bg-accent/10"
                          >
                            <span className="block font-semibold">
                              {patient.patient_name}
                            </span>
                            <span className="text-[var(--color-text3)]">
                              {patient.patient_code}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}                  
                  {/* <IntentCard
                    intent={currentIntent}
                    onGenerate={handleGenerate}
                    isGenerating={isGenerating}
                  /> */}
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
                    placeholder={isInterpreting ? "Organising request..." : "Ask for a report"}
                    disabled={isInterpreting}
                    className="min-w-0 flex-1 bg-transparent text-sm text-[var(--color-text1)] placeholder:text-[var(--color-text3)] disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none"
                  />

                  <button
                    type="submit"
                    disabled={!inputValue.trim() || isInterpreting}
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-colors ${
                      inputValue.trim() && !isInterpreting
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
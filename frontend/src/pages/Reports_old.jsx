// src/pages/Reports.jsx
// Reports landing page.
// Shows available clinical, admin, and research reports.

import { useNavigate } from "react-router-dom";
import Layout from "../components/Layout";

const REPORT_GROUPS = [
  {
    title: "Clinical Reports",
    description: "Reports used for patient review, screening follow-up, and clinical workflow.",
    reports: [
      {
        title: "Patient List Report",
        icon: "👥",
        status: "coming-soon",
        description:
          "View patient demographics, latest screening date, latest result, and OHTS tier.",
      },
      {
        title: "Patient Screening History",
        icon: "📋",
        status: "coming-soon",
        description:
          "Review all screenings for one patient, including eye side, prediction, confidence, CDR, and OHTS score.",
      },
      {
        title: "High Risk Report",
        icon: "🚨",
        status: "available",
        path: "/reports/high-risk",
        description:
          "View glaucoma-positive screenings within a selected date range, including patient details, confidence score, OHTS tier, CDR, and Grad-CAM availability.",
      },
      {
        title: "Screening Summary Report",
        icon: "📊",
        status: "coming-soon",
        description:
          "Summarise total screenings, glaucoma-positive cases, normal cases, pending screenings, and failed screenings.",
      },
    ],
  },
  {
    title: "Admin Reports",
    description: "Reports for user management and system administration.",
    reports: [
      {
        title: "User List Report",
        icon: "🔐",
        status: "coming-soon",
        description:
          "View user code, name, role, email, active status, and created date.",
      },
    ],
  },
  {
    title: "Research Reports",
    description: "Reports for model comparison and research-mode evaluation.",
    reports: [
      {
        title: "LLM Comparison Report",
        icon: "🤖",
        status: "coming-soon",
        description:
          "Compare referral letter outputs, response times, and model behaviour across supported LLMs.",
      },
    ],
  },
];

function StatusBadge({ status }) {
  const isAvailable = status === "available";

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${
        isAvailable
          ? "bg-pos/10 text-pos border-pos/20"
          : "bg-warn/10 text-warn border-warn/20"
      }`}
    >
      {isAvailable ? "Available" : "Coming soon"}
    </span>
  );
}

function ReportCard({ report }) {
  const navigate = useNavigate();
  const isAvailable = report.status === "available";

  function handleOpen() {
    if (!isAvailable || !report.path) return;
    navigate(report.path);
  }

  return (
    <div className="bg-surface border border-border rounded-xl p-5 flex flex-col min-h-[210px]">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="w-11 h-11 rounded-xl bg-accent/15 flex items-center justify-center text-xl">
          {report.icon}
        </div>

        <StatusBadge status={report.status} />
      </div>

      <h3 className="text-base font-semibold text-text1 mb-2">
        {report.title}
      </h3>

      <p className="text-sm text-text2 leading-relaxed flex-1">
        {report.description}
      </p>

      <button
        type="button"
        onClick={handleOpen}
        disabled={!isAvailable}
        className={`mt-5 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
          isAvailable
            ? "bg-accent text-white hover:bg-accent2 cursor-pointer"
            : "bg-surface2 text-text3 cursor-not-allowed"
        }`}
      >
        {isAvailable ? "Open Report" : "Coming soon"}
      </button>
    </div>
  );
}

function ReportGroup({ group }) {
  return (
    <section className="mb-8">
      <div className="mb-4">
        <h2 className="text-sm font-semibold text-text1">
          {group.title}
        </h2>
        <p className="text-xs text-text3 mt-1">
          {group.description}
        </p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
        {group.reports.map(report => (
          <ReportCard key={report.title} report={report} />
        ))}
      </div>
    </section>
  );
}

function Reports() {
  return (
    <Layout title="Reports">
      <div className="mb-6">
        <p className="text-xs text-text3 mb-2">
          Clinical reporting centre
        </p>

        <h1 className="text-2xl font-semibold text-text1 mb-2">
          Reports
        </h1>

        <p className="text-sm text-text2 max-w-3xl leading-relaxed">
          Generate clinical, administrative, and research reports from patient
          screening data. Start with the High Risk Report, then add the other
          report types as the workflow grows.
        </p>
      </div>

      {REPORT_GROUPS.map(group => (
        <ReportGroup key={group.title} group={group} />
      ))}
    </Layout>
  );
}

export default Reports;
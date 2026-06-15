// src/pages/PatientList.jsx
// Patient list page - Tailwind CSS implementation.

import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import Layout from "../components/Layout";
import API from "../api/index";

const GRADIENTS = [
  "from-accent to-accent2",
  "from-pos to-emerald-700",
  "from-warn to-amber-700",
  "from-purple-500 to-purple-800",
  "from-neg to-red-800",
];

function Avatar({ name, index }) {
  const initials = name
    ? name.trim().split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2)
    : "?";
  return (
    <div className={`w-8 h-8 rounded-full bg-gradient-to-br ${GRADIENTS[index % GRADIENTS.length]} flex items-center justify-center text-white text-xs font-semibold flex-shrink-0`}>
      {initials}
    </div>
  );
}

function ResultBadge({ prediction }) {
  const map = {
    glaucoma: { cls: "bg-neg/10 text-neg border-neg/20",   label: "Positive" },
    normal:   { cls: "bg-pos/10 text-pos border-pos/20",   label: "Negative" },
    pending:  { cls: "bg-warn/10 text-warn border-warn/20", label: "No Record" },
  };
  const c = map[prediction?.toLowerCase()] || map.pending;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${c.cls}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-current" />
      {c.label}
    </span>
  );
}

function RiskBar({ score }) {
  const hasScore = score !== null && score !== undefined && !Number.isNaN(score);
  const pct = hasScore ? Math.round(score * 100) : 0;
  const color = pct > 70 ? "bg-neg" : pct > 50 ? "bg-warn" : "bg-pos";

  return (
    <div className="flex items-center gap-2">
      <div className="w-16 h-1 bg-surface3 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full ${color}`}
          style={{ width: hasScore ? `${pct}%` : "0%" }}
        />
      </div>
      <span className="text-xs text-text2 font-mono">
        {hasScore ? score.toFixed(2) : "-"}
      </span>
    </div>
  );
}

const TABS = ["All Patients", "High Risk", "Recent", "Pending"];

function PatientList() {
  const navigate = useNavigate();
  const [patients, setPatients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("All Patients");
  const [search, setSearch] = useState("");

  useEffect(() => {
    API.get("/patients/")
      .then(res => { setPatients(res.data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  function calcAge(dob) {
    if (!dob) return "-";
    return Math.floor((Date.now() - new Date(dob).getTime()) / (1000 * 60 * 60 * 24 * 365.25));
  }

  function formatDate(d) {
    if (!d) return "-";
    return new Date(d).toLocaleDateString("en-NZ", {
      day: "2-digit", month: "short", year: "numeric",
      timeZone: "Pacific/Auckland",
    });
  }

function getLatestResult(p) {
  return p.latest_screening?.result || null;
}

function getPrediction(p) {
  return getLatestResult(p)?.prediction || "pending";
}

function getRiskScore(p) {
  const score = getLatestResult(p)?.confidence_score;
  return score === null || score === undefined ? null : Number(score);
}

function getModelName(p) {
  return getLatestResult(p)?.model_used || "—";
}

function getLastScreeningDate(p) {
  return p.latest_screening?.created_at || p.created_at;
}

function isRecentScreening(p, days = 7) {
  const dateValue = p.latest_screening?.created_at;

  if (!dateValue) return false;

  const screeningDate = new Date(dateValue);
  const now = new Date();

  const diffMs = now - screeningDate;
  const diffDays = diffMs / (1000 * 60 * 60 * 24);

  return diffDays <= days;
}

const filtered = patients.filter(p => {
  const name = `${p.first_name} ${p.last_name}`.toLowerCase();
  const code = p.patient_code?.toLowerCase() || "";
  const q = search.toLowerCase();

  const matchesSearch = name.includes(q) || code.includes(q);

  const prediction = getPrediction(p).toLowerCase();
  const hasResult = !!p.latest_screening?.result;

  const matchesTab =
    activeTab === "All Patients" ||
    (activeTab === "High Risk" && prediction === "glaucoma") ||
    (activeTab === "Recent" && isRecentScreening(p)) ||
    (activeTab === "Pending" && !hasResult);

  return matchesSearch && matchesTab;
});

const patientStats = {
  total: patients.length,

  highRisk: patients.filter(
    p => getPrediction(p).toLowerCase() === "glaucoma"
  ).length,

  normal: patients.filter(
    p => getPrediction(p).toLowerCase() === "normal"
  ).length,

  pending: patients.filter(
    p => !p.latest_screening?.result
  ).length,
};


  const actions = (
    <>
      <div className="flex items-center gap-2 bg-surface2 border border-white/12 rounded-lg px-3 py-1.5 w-48">
        <span className="text-text3 text-sm">🔍</span>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search patients..."
          className="bg-transparent border-0 outline-none text-text1 text-xs w-full font-sans placeholder:text-text3"
        />
      </div>
      <button
        onClick={() => navigate("/patients/new")}
        className="flex items-center gap-1.5 px-3 py-1.5 bg-accent text-white text-xs font-medium rounded-lg hover:bg-accent2 transition-colors cursor-pointer border-0 font-sans"
      >
        + New Patient
      </button>
    </>
  );

  return (
    <Layout title="Patient Management" actions={actions}>

      {/* TABS */}
      <div className="flex gap-1 mb-5 bg-surface border border-white/7 rounded-xl p-1 w-fit">
        {TABS.map(tab => (
          <div
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-all ${
              activeTab === tab
                ? "bg-surface3 text-text1"
                : "text-text2 hover:text-text1"
            }`}
          >
            {tab}
          </div>
        ))}
      </div>

      {/* STAT CARDS */}
      <div className="grid grid-cols-4 gap-3 mb-5">
        {[
          { label: "Total", value: loading ? "-" : patientStats.total, color: "text-accent2" },
          { label: "High Risk", value: loading ? "-" : patientStats.highRisk, color: "text-neg" },
          { label: "Normal", value: loading ? "-" : patientStats.normal, color: "text-pos" },
          { label: "Pending", value: loading ? "-" : patientStats.pending, color: "text-warn" },
        ].map(card => (
          <div key={card.label} className="bg-surface border border-white/7 rounded-xl p-4">
            <div className="text-xs text-text3 uppercase tracking-wider mb-2">{card.label}</div>
            <div className={`text-2xl font-semibold font-mono ${card.color}`}>{card.value}</div>
          </div>
        ))}
      </div>

      {/* PATIENT TABLE */}
      <div className="bg-surface border border-white/7 rounded-xl overflow-hidden">
        <div className="flex items-center gap-3 px-5 py-3.5 border-b border-white/7">
          <span className="text-sm font-semibold text-text1 flex-1">Patient List</span>
          <span className="text-xs text-text3">{filtered.length} patients</span>
          <button className="px-3 py-1 text-xs text-text2 border border-white/12 rounded-lg bg-transparent hover:bg-white/5 transition-colors cursor-pointer font-sans">
            ⚙ Filter
          </button>
        </div>

        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-white/7">
              {["Patient", "Age/Gender", "Last Screening", "Result", "Risk Score", "Model", "Actions"].map(h => (
                <th key={h} className="px-5 py-2.5 text-left text-xs font-semibold text-text3 uppercase tracking-wider bg-white/[0.02]">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="px-5 py-8 text-center text-text3 text-sm">
                  Loading patients...
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-5 py-8 text-center text-text3 text-sm">
                  No patients found.
                </td>
              </tr>
            ) : (
              filtered.map((p, i) => (
                <tr
                  key={p.patient_id}
                  onClick={() => navigate(`/patients/${p.patient_id}`)}
                  className="border-b border-white/[0.04] hover:bg-accent/[0.06] transition-colors cursor-pointer"
                >
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2.5">
                      <Avatar name={`${p.first_name} ${p.last_name}`} index={i} />
                      <div>
                        <div className="text-sm font-medium text-text1">
                          {p.first_name} {p.last_name}
                        </div>
                        <div className="text-xs text-text3 font-mono">#{p.patient_code}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-3 text-sm text-text2">
                    {calcAge(p.dob)} / {p.gender?.[0]?.toUpperCase() || "-"}
                  </td>
                  <td className="px-5 py-3 text-xs text-text2 font-mono">
                    {formatDate(getLastScreeningDate(p))}
                  </td>
                  <td className="px-5 py-3">
                    <ResultBadge prediction={getPrediction(p)} />
                  </td>
                  <td className="px-5 py-3">
                    <RiskBar score={getRiskScore(p)} />
                  </td>
                  <td className="px-5 py-3 text-xs text-text3">{getModelName(p)}</td>
                  <td className="px-5 py-3">
                    <button
                      onClick={e => { e.stopPropagation(); navigate(`/patients/${p.patient_id}`); }}
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

    </Layout>
  );
}

export default PatientList;
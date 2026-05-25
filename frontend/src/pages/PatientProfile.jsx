// src/pages/PatientProfile.jsx
// Patient detail page - Tailwind CSS implementation.
// Left panel: patient info. Right panel: screening history + risk chart.

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
    glaucoma: { cls: "bg-neg/10 text-neg border-neg/20",  label: "Positive" },
    normal:   { cls: "bg-pos/10 text-pos border-pos/20",  label: "Negative" },
    pending:  { cls: "bg-warn/10 text-warn border-warn/20", label: "Pending" },
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

function PatientProfile() {
  const { patientId } = useParams();
  const navigate = useNavigate();

  const [patient, setPatient] = useState(null);
  const [screenings, setScreenings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    Promise.all([
      API.get(`/patients/${patientId}`),
      API.get(`/screenings/patient/${patientId}`),
    ])
      .then(([pRes, sRes]) => {
        setPatient(pRes.data);
        setScreenings(sRes.data);
        setLoading(false);
      })
      .catch(() => {
        setError("Failed to load patient.");
        setLoading(false);
      });
  }, [patientId]);

  function calcAge(dob) {
    if (!dob) return "-";
    return Math.floor((Date.now() - new Date(dob).getTime()) / (1000 * 60 * 60 * 24 * 365.25)) + " years";
  }

  function formatDate(d) {
    if (!d) return "-";
    return new Date(d).toLocaleDateString("en-NZ", {
      day: "2-digit", month: "short", year: "numeric",
      timeZone: "Pacific/Auckland",
    });
  }

  if (loading) return (
    <Layout title="Patient Profile">
      <p className="text-text3 text-sm">Loading...</p>
    </Layout>
  );

  if (error) return (
    <Layout title="Patient Profile">
      <p className="text-neg text-sm">{error}</p>
    </Layout>
  );

  const fullName = `${patient.first_name} ${patient.last_name}`;
  const gradIdx = getGradientIndex(patient.first_name);
  const initials = getInitials(patient.first_name, patient.last_name);

  return (
    <Layout title="Patient Profile">

      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-xs text-text3 mb-5">
        <span onClick={() => navigate("/patients")}
          className="cursor-pointer hover:text-accent2 transition-colors">
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
            <InfoRow label="Age"        value={calcAge(patient.dob)} />
            <InfoRow label="Gender"     value={patient.gender ? patient.gender.charAt(0).toUpperCase() + patient.gender.slice(1) : "-"} />
            <InfoRow label="DOB"        value={formatDate(patient.dob)} />
            <InfoRow label="Contact"    value={patient.mobile_number} />
            <InfoRow label="Email"      value={patient.email} />
            <InfoRow label="IOP"        value={patient.iop ? `${patient.iop} mmHg` : "-"} />
            <InfoRow label="CCT"        value={patient.cct ? `${patient.cct} µm` : "-"} />
            <InfoRow label="Screenings" value={`${screenings.length} total`} valueClass="text-accent2 font-medium" />
          </div>

          {/* Buttons */}
          <div className="flex gap-2 p-4 pt-0">
            <button
              onClick={() => navigate(`/patients/${patientId}/edit`)}
              className="flex-1 py-2 text-xs font-medium text-text2 border border-white/12 rounded-lg bg-transparent hover:bg-white/5 transition-colors cursor-pointer font-sans"
            >
              ✏️ Edit
            </button>
            <button
              onClick={() => navigate("/screenings/new", { state: { patientId } })}
              className="flex-1 py-2 text-xs font-medium text-white bg-accent hover:bg-accent2 rounded-lg border-0 transition-colors cursor-pointer font-sans"
            >
              🔬 Screen
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
                onClick={() => navigate("/screenings")}
                className="px-3 py-1 text-xs text-text2 border border-white/12 rounded-lg bg-transparent hover:bg-white/5 transition-colors cursor-pointer font-sans"
              >
                View All
              </button>
            </div>

            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-white/7">
                  {["Date", "Eye", "Result", "Score", "Actions"].map(h => (
                    <th key={h} className="px-5 py-2.5 text-left text-xs font-semibold text-text3 uppercase tracking-wider bg-white/[0.02]">
                      {h}
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
                  screenings.map(s => (
                    <tr
                      key={s.screening_id}
                      onClick={() => navigate(`/results/${s.screening_id}`)}
                      className="border-b border-white/[0.04] hover:bg-accent/[0.06] transition-colors cursor-pointer"
                    >
                      <td className="px-5 py-3 text-xs text-text2 font-mono">
                        {formatDate(s.created_at)}
                      </td>
                      <td className="px-5 py-3 text-xs text-text2 capitalize">
                        {s.eye_side}
                      </td>
                      <td className="px-5 py-3">
                        <ResultBadge prediction={s.status === "complete" ? "pending" : s.status} />
                      </td>
                      <td className="px-5 py-3 text-xs text-text2 font-mono">—</td>
                      <td className="px-5 py-3">
                        <button
                          onClick={e => { e.stopPropagation(); navigate(`/results/${s.screening_id}`); }}
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
              <div className="bg-surface2 rounded-xl h-44 flex items-center justify-center border border-dashed border-white/12 text-text3 text-sm">
                📈 Longitudinal Risk Chart — Plotly
              </div>
            </div>
          </div>

        </div>
      </div>
    </Layout>
  );
}

export default PatientProfile;
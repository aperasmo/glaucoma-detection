// src/pages/PatientProfile.jsx
// Patient detail page - matches mock UI pg-patient-detail exactly.
// Left panel: avatar, patient info, edit and screen buttons.
// Right panel: screening history table, longitudinal risk chart placeholder.
// All data from API - no hardcoded values.

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

const GRADIENTS = [
  "linear-gradient(135deg,#3B9EFF,#1A5FBB)",
  "linear-gradient(135deg,#22C994,#0F7A58)",
  "linear-gradient(135deg,#FFB84D,#A06B00)",
  "linear-gradient(135deg,#9B59B6,#6C3483)",
  "linear-gradient(135deg,#E74C3C,#922B21)",
];

function getInitials(firstName, lastName) {
  return `${firstName?.[0] ?? ""}${lastName?.[0] ?? ""}`.toUpperCase();
}

function getGradient(name) {
  if (!name) return GRADIENTS[0];
  const i = name.charCodeAt(0) % GRADIENTS.length;
  return GRADIENTS[i];
}

function ResultBadge({ prediction }) {
  const map = {
    glaucoma: { bg: V.negDim,  color: V.neg,  label: "Positive" },
    normal:   { bg: V.posDim,  color: V.pos,  label: "Negative" },
    pending:  { bg: V.warnDim, color: V.warn, label: "Pending"  },
  };
  const c = map[prediction?.toLowerCase()] || map.pending;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: "4px",
      padding: "3px 8px", borderRadius: "20px",
      fontSize: "11.5px", fontWeight: "500",
      background: c.bg, color: c.color,
    }}>
      <span style={{ width: 5, height: 5, borderRadius: "50%", background: "currentColor", display: "inline-block" }} />
      {c.label}
    </span>
  );
}

function InfoRow({ label, value }) {
  return (
    <div style={{
      display: "flex", justifyContent: "space-between",
      fontSize: "13px", marginBottom: "8px",
    }}>
      <span style={{ color: V.text3 }}>{label}</span>
      <span style={{ color: V.text }}>{value || "-"}</span>
    </div>
  );
}

const btnGhost = {
  padding: "6px 13px", borderRadius: "7px",
  fontSize: "12px", fontWeight: "500", cursor: "pointer",
  background: "transparent", color: V.text2,
  border: `1px solid ${V.border2}`,
  fontFamily: "'DM Sans',sans-serif",
  display: "inline-flex", alignItems: "center",
  justifyContent: "center", gap: "5px",
};

const btnPrimary = {
  padding: "6px 13px", borderRadius: "7px",
  fontSize: "12px", fontWeight: "500", cursor: "pointer",
  background: V.accent, color: "white", border: "none",
  fontFamily: "'DM Sans',sans-serif",
  display: "inline-flex", alignItems: "center",
  justifyContent: "center", gap: "5px",
};

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
      .then(([patientRes, screeningsRes]) => {
        setPatient(patientRes.data);
        setScreenings(screeningsRes.data);
        setLoading(false);
      })
      .catch(() => {
        setError("Failed to load patient.");
        setLoading(false);
      });
  }, [patientId]);

  function calcAge(dob) {
    if (!dob) return "-";
    const diff = Date.now() - new Date(dob).getTime();
    return Math.floor(diff / (1000 * 60 * 60 * 24 * 365.25)) + " years";
  }

  function formatDate(d) {
    if (!d) return "-";
    return new Date(d).toLocaleDateString("en-NZ", {
      day: "2-digit", month: "short", year: "numeric",
      timeZone: "Pacific/Auckland",
    });
  }

  function formatGender(g) {
    if (!g) return "-";
    return g.charAt(0).toUpperCase() + g.slice(1);
  }

  if (loading) return (
    <Layout title="Patient Profile">
      <p style={{ color: V.text3, fontSize: "13px" }}>Loading...</p>
    </Layout>
  );

  if (error) return (
    <Layout title="Patient Profile">
      <p style={{ color: V.neg, fontSize: "13px" }}>{error}</p>
    </Layout>
  );

  const fullName = `${patient.first_name} ${patient.last_name}`;
  const gradient = getGradient(patient.first_name);
  const initials = getInitials(patient.first_name, patient.last_name);

  return (
    <Layout title="Patient Profile">

      {/* Breadcrumb */}
      <div style={{
        display: "flex", alignItems: "center", gap: "6px",
        fontSize: "12px", color: V.text3, marginBottom: "18px",
      }}>
        <span
          onClick={() => navigate("/patients")}
          style={{ cursor: "pointer" }}
          onMouseEnter={e => e.currentTarget.style.color = V.accent2}
          onMouseLeave={e => e.currentTarget.style.color = V.text3}
        >
          Patients
        </span>
        <span>›</span>
        <span style={{ color: V.text2 }}>{fullName}</span>
      </div>

      {/* Two column layout */}
      <div style={{ display: "grid", gridTemplateColumns: "290px 1fr", gap: "16px" }}>

        {/* LEFT - Patient Info Card */}
        <div>
          <div style={{
            background: V.surface,
            border: `1px solid ${V.border}`,
            borderRadius: "11px",
            overflow: "hidden",
          }}>
            {/* Avatar + Name */}
            <div style={{ textAlign: "center", padding: "24px 18px" }}>
              <div style={{
                width: "56px", height: "56px",
                borderRadius: "50%",
                background: gradient,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: "20px", fontWeight: "600", color: "white",
                margin: "0 auto 12px",
              }}>
                {initials}
              </div>
              <div style={{ fontSize: "16px", fontWeight: "600", marginBottom: "3px", color: V.text }}>
                {fullName}
              </div>
              <div style={{
                fontSize: "12px", color: V.text3,
                fontFamily: "'DM Mono',monospace", marginBottom: "12px",
              }}>
                #{patient.patient_code}
              </div>
              <span style={{
                display: "inline-flex", alignItems: "center", gap: "4px",
                padding: "3px 8px", borderRadius: "20px",
                fontSize: "11.5px", fontWeight: "500",
                background: patient.is_active ? V.posDim : V.negDim,
                color: patient.is_active ? V.pos : V.neg,
              }}>
                <span style={{ width: 5, height: 5, borderRadius: "50%", background: "currentColor", display: "inline-block" }} />
                {patient.is_active ? "Active" : "Inactive"}
              </span>
            </div>

            {/* Info Rows */}
            <div style={{ padding: "0 18px 16px", borderTop: `1px solid ${V.border}` }}>
              <div style={{ paddingTop: "14px" }}>
                <InfoRow label="Age"       value={calcAge(patient.dob)} />
                <InfoRow label="Gender"    value={formatGender(patient.gender)} />
                <InfoRow label="DOB"       value={formatDate(patient.dob)} />
                <InfoRow label="Contact"   value={patient.mobile_number} />
                <InfoRow label="Email"     value={patient.email} />
                <InfoRow label="IOP"       value={patient.iop ? `${patient.iop} mmHg` : "-"} />
                <InfoRow label="CCT"       value={patient.cct ? `${patient.cct} µm` : "-"} />
                <InfoRow label="Screenings" value={`${screenings.length} total`} />
              </div>
            </div>

            {/* Action Buttons */}
            <div style={{
              padding: "0 18px 18px",
              display: "flex", gap: "8px",
            }}>
              <button
                style={{ ...btnGhost, flex: 1 }}
                onClick={() => navigate(`/patients/${patientId}/edit`)}
              >
                ✏️ Edit
              </button>
              <button
                style={{ ...btnPrimary, flex: 1 }}
                onClick={() => navigate("/screenings/new", { state: { patientId } })}
              >
                🔬 Screen
              </button>
            </div>
          </div>
        </div>

        {/* RIGHT - Screening History + Chart */}
        <div>

          {/* Screening History */}
          <div style={{
            background: V.surface,
            border: `1px solid ${V.border}`,
            borderRadius: "11px",
            overflow: "hidden",
            marginBottom: "16px",
          }}>
            <div style={{
              padding: "14px 18px",
              borderBottom: `1px solid ${V.border}`,
              display: "flex", alignItems: "center", gap: "10px",
            }}>
              <span style={{ fontSize: "13.5px", fontWeight: "600", color: V.text, flex: 1 }}>
                Screening History
              </span>
              <button style={btnGhost} onClick={() => navigate("/screenings")}>
                View All
              </button>
            </div>

            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${V.border}` }}>
                  {["Date", "Result", "Score", "Model", "Actions"].map(h => (
                    <th key={h} style={{
                      padding: "10px 14px", textAlign: "left",
                      fontSize: "11px", fontWeight: "600",
                      color: V.text3, textTransform: "uppercase",
                      letterSpacing: "0.7px",
                      background: "rgba(255,255,255,.02)",
                    }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {screenings.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{
                      padding: "32px", textAlign: "center",
                      color: V.text3, fontSize: "13px",
                    }}>
                      No screenings yet.
                    </td>
                  </tr>
                ) : (
                  screenings.map(s => (
                    <tr
                      key={s.screening_id}
                      onClick={() => navigate(`/results/${s.screening_id}`)}
                      style={{ borderBottom: `1px solid ${V.border}`, cursor: "pointer", transition: "background .1s" }}
                      onMouseEnter={e => e.currentTarget.style.background = V.accentDim}
                      onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                    >
                      <td style={{ padding: "12px 14px", fontFamily: "'DM Mono',monospace", fontSize: "12px", color: V.text2 }}>
                        {formatDate(s.created_at)}
                      </td>
                      <td style={{ padding: "12px 14px" }}>
                        <ResultBadge prediction={s.status === "complete" ? "pending" : s.status} />
                      </td>
                      <td style={{ padding: "12px 14px", fontFamily: "'DM Mono',monospace", fontSize: "12px", color: V.text }}>
                        —
                      </td>
                      <td style={{ padding: "12px 14px", color: V.text3, fontSize: "12px" }}>
                        —
                      </td>
                      <td style={{ padding: "12px 14px" }}>
                        <button
                          onClick={e => { e.stopPropagation(); navigate(`/results/${s.screening_id}`); }}
                          style={{ ...btnGhost, fontSize: "11px", padding: "4px 10px" }}
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

          {/* Longitudinal Chart Placeholder */}
          <div style={{
            background: V.surface,
            border: `1px solid ${V.border}`,
            borderRadius: "11px",
            overflow: "hidden",
          }}>
            <div style={{
              padding: "14px 18px",
              borderBottom: `1px solid ${V.border}`,
              display: "flex", alignItems: "center", gap: "10px",
            }}>
              <span style={{ fontSize: "13.5px", fontWeight: "600", color: V.text, flex: 1 }}>
                Risk Progression
              </span>
              <span style={{ fontSize: "12px", color: V.text3 }}>
                Longitudinal tracking
              </span>
            </div>
            <div style={{ padding: "18px" }}>
              <div style={{
                background: V.surface2,
                borderRadius: "10px",
                height: "180px",
                display: "flex", alignItems: "center", justifyContent: "center",
                color: V.text3, fontSize: "13px",
                border: `1px dashed ${V.border2}`,
              }}>
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
// src/pages/PatientList.jsx
// Patient list page - matches mock UI pg-patients exactly.
// Tabs: All Patients, High Risk, Recent, Pending.
// Stats: Total, High Risk, Normal, Pending.
// Table: Patient, Age/Gender, Last Screening, Result, Risk Score, Model, Actions.

import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import Layout from "../components/Layout";
import API from "../api/index";

const V = {
  surface:    "#131D2E",
  surface2:   "#1A2840",
  surface3:   "#1F3050",
  border:     "rgba(255,255,255,0.07)",
  border2:    "rgba(255,255,255,0.12)",
  accent:     "#3B9EFF",
  accent2:    "#5BB8FF",
  accentDim:  "rgba(59,158,255,0.12)",
  accentDim2: "rgba(59,158,255,0.2)",
  pos:        "#22C994",
  posDim:     "rgba(34,201,148,0.12)",
  neg:        "#FF6B6B",
  negDim:     "rgba(255,107,107,0.12)",
  warn:       "#FFB84D",
  warnDim:    "rgba(255,184,77,0.12)",
  text:       "#E8EEF7",
  text2:      "#8FA3BF",
  text3:      "#4E6580",
};

const GRADIENTS = [
  "linear-gradient(135deg,#3B9EFF,#1A5FBB)",
  "linear-gradient(135deg,#22C994,#0F7A58)",
  "linear-gradient(135deg,#FFB84D,#A06B00)",
  "linear-gradient(135deg,#9B59B6,#6C3483)",
  "linear-gradient(135deg,#E74C3C,#922B21)",
];

function Avatar({ name, size = 28 , index = 0 }) {
  const initials = name
    ? name.trim().split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2)
    : "?";
  return (
    <div style={{
      width: size, height: size,
      borderRadius: "50%",
      background: GRADIENTS[index % GRADIENTS.length],
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: size * 0.38, fontWeight: "600", color: "white",
      flexShrink: 0,
    }}>
      {initials}
    </div>
  );
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

function RiskBar({ score }) {
  const pct = Math.round((score || 0) * 100);
  const color = pct > 70 ? V.neg : pct > 50 ? V.warn : V.pos;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "7px" }}>
      <div style={{ width: 70, height: 4, background: V.surface3, borderRadius: 3, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 3 }} />
      </div>
      <span style={{ fontSize: "11.5px", color: V.text2, fontFamily: "'DM Mono',monospace" }}>
        {score?.toFixed(2) ?? "-"}
      </span>
    </div>
  );
}

function StatCard({ label, value, color }) {
  return (
    <div style={{
      background: V.surface, border: `1px solid ${V.border}`,
      borderRadius: "11px", padding: "16px 18px", flex: 1,
    }}>
      <div style={{ fontSize: "11px", color: V.text3, textTransform: "uppercase", letterSpacing: "0.8px", marginBottom: "7px" }}>
        {label}
      </div>
      <div style={{ fontSize: "26px", fontWeight: "600", color: color || V.text, fontFamily: "'DM Mono',monospace", lineHeight: 1 }}>
        {value}
      </div>
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
    const diff = Date.now() - new Date(dob).getTime();
    return Math.floor(diff / (1000 * 60 * 60 * 24 * 365.25));
  }

  function formatDate(d) {
    if (!d) return "-";
    return new Date(d).toLocaleDateString("en-NZ", {
      day: "2-digit", month: "short", year: "numeric",
      timeZone: "Pacific/Auckland",
    });
  }

  function genderShort(g) {
    if (!g) return "-";
    return g.charAt(0).toUpperCase();
  }

  const filtered = patients.filter(p => {
    const name = `${p.first_name} ${p.last_name}`.toLowerCase();
    const code = p.patient_code?.toLowerCase();
    const q = search.toLowerCase();
    return name.includes(q) || code.includes(q);
  });

  // Top bar actions
  const actions = (
    <>
      <div style={{
        display: "flex", alignItems: "center", gap: "7px",
        background: V.surface2, border: `1px solid ${V.border}`,
        borderRadius: "7px", padding: "5px 11px", width: "200px",
      }}>
        <span style={{ color: V.text3 }}>🔍</span>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search patients..."
          style={{
            background: "none", border: "none", outline: "none",
            color: V.text, fontSize: "12.5px",
            fontFamily: "'DM Sans',sans-serif", width: "100%",
          }}
        />
      </div>
      <button
        onClick={() => navigate("/patients/new")}
        style={{
          padding: "6px 13px", borderRadius: "7px", fontSize: "12.5px",
          fontWeight: "500", cursor: "pointer", border: "none",
          fontFamily: "'DM Sans',sans-serif",
          background: V.accent, color: "white",
          display: "inline-flex", alignItems: "center", gap: "5px",
        }}
      >
        + New Patient
      </button>
    </>
  );

  return (
    <Layout title="Patient Management" actions={actions}>

      {/* TABS */}
      <div style={{
        display: "flex", gap: "3px", marginBottom: "18px",
        background: V.surface, border: `1px solid ${V.border}`,
        borderRadius: "9px", padding: "3px", width: "fit-content",
      }}>
        {TABS.map(tab => (
          <div
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              padding: "6px 14px", borderRadius: "7px",
              fontSize: "12.5px", cursor: "pointer",
              fontWeight: "500", transition: "all .15s",
              color: activeTab === tab ? V.text : V.text2,
              background: activeTab === tab ? V.surface3 : "transparent",
            }}
          >
            {tab}
          </div>
        ))}
      </div>

      {/* STAT CARDS */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "14px", marginBottom: "20px" }}>
        <StatCard label="Total"     value={loading ? "-" : patients.length} color={V.accent} />
        <StatCard label="High Risk" value="—" color={V.neg} />
        <StatCard label="Normal"    value="—" color={V.pos} />
        <StatCard label="Pending"   value="—" color={V.warn} />
      </div>

      {/* PATIENT TABLE */}
      <div style={{ background: V.surface, border: `1px solid ${V.border}`, borderRadius: "11px", overflow: "hidden" }}>
        <div style={{
          padding: "14px 18px", borderBottom: `1px solid ${V.border}`,
          display: "flex", alignItems: "center", gap: "10px",
        }}>
          <span style={{ fontSize: "13.5px", fontWeight: "600", color: V.text, flex: 1 }}>
            Patient List
          </span>
          <span style={{ fontSize: "12px", color: V.text3 }}>
            {filtered.length} patients
          </span>
          <button style={{
            padding: "6px 13px", borderRadius: "7px", fontSize: "12.5px",
            fontWeight: "500", cursor: "pointer",
            background: "transparent", color: V.text2,
            border: `1px solid ${V.border2}`,
            fontFamily: "'DM Sans',sans-serif",
          }}>
            ⚙ Filter
          </button>
        </div>

        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${V.border}` }}>
              {["Patient", "Age/Gender", "Last Screening", "Result", "Risk Score", "Model", "Actions"].map(h => (
                <th key={h} style={{
                  padding: "10px 14px", textAlign: "left",
                  fontSize: "11px", fontWeight: "600",
                  color: V.text3, textTransform: "uppercase",
                  letterSpacing: "0.7px",
                  background: "rgba(255,255,255,.02)",
                  borderBottom: `1px solid ${V.border}`,
                }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} style={{ padding: "32px", textAlign: "center", color: V.text3, fontSize: "13px" }}>
                  Loading patients...
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ padding: "32px", textAlign: "center", color: V.text3, fontSize: "13px" }}>
                  No patients found.
                </td>
              </tr>
            ) : (
              filtered.map((p, i) => (
                <tr
                  key={p.patient_id}
                  onClick={() => navigate(`/patients/${p.patient_id}`)}                  
                  style={{ borderBottom: `1px solid ${V.border}`, cursor: "pointer", transition: "background .1s" }}
                  onMouseEnter={e => e.currentTarget.style.background = V.accentDim}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                >
                  {/* Patient */}
                  <td style={{ padding: "12px 14px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "9px" }}>
                      <Avatar name={`${p.first_name} ${p.last_name}`} index={i} />
                      <div>
                        <div style={{ fontWeight: "500", fontSize: "13px", color: V.text }}>
                          {p.first_name} {p.last_name}
                        </div>
                        <div style={{ fontSize: "11px", color: V.text3, fontFamily: "'DM Mono',monospace" }}>
                          #{p.patient_code}
                        </div>
                      </div>
                    </div>
                  </td>

                  {/* Age/Gender */}
                  <td style={{ padding: "12px 14px", color: V.text2, fontSize: "13px" }}>
                    {calcAge(p.dob)} / {genderShort(p.gender)}
                  </td>

                  {/* Last Screening */}
                  <td style={{ padding: "12px 14px", color: V.text2, fontSize: "12px", fontFamily: "'DM Mono',monospace" }}>
                    {formatDate(p.created_at)}
                  </td>

                  {/* Result */}
                  <td style={{ padding: "12px 14px" }}>
                    <ResultBadge prediction="pending" />
                  </td>

                  {/* Risk Score */}
                  <td style={{ padding: "12px 14px" }}>
                    <RiskBar score={null} />
                  </td>

                  {/* Model */}
                  <td style={{ padding: "12px 14px", color: V.text3, fontSize: "12px" }}>
                    —
                  </td>

                  {/* Actions */}
                  <td style={{ padding: "12px 14px" }}>
                    <button
                      onClick={() => { console.log(p); navigate(`/patients/${p.patient_id}`); }}
                      
                      style={{
                        fontSize: "11px", padding: "4px 10px",
                        borderRadius: "7px", cursor: "pointer",
                        background: "transparent", color: V.text2,
                        border: `1px solid ${V.border2}`,
                        fontFamily: "'DM Sans',sans-serif",
                      }}
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
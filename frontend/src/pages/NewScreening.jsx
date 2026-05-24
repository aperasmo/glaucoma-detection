// src/pages/NewScreening.jsx
// New screening page - matches mock UI pg-screening exactly.
// Step 1: Select patient. Step 2: Upload fundus image. Step 3: Select eye side.
// Right panel: summary card with Run Screening button.
// Connects to POST /screenings/ with multipart form data.

import { useState, useEffect, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
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

function getInitials(p) {
  if (!p) return "?";
  return `${p.first_name?.[0] ?? ""}${p.last_name?.[0] ?? ""}`.toUpperCase();
}

function calcAge(dob) {
  if (!dob) return "-";
  return Math.floor((Date.now() - new Date(dob).getTime()) / (1000 * 60 * 60 * 24 * 365.25));
}

function SummaryRow({ label, value, valueColor }) {
  return (
    <div style={{
      display: "flex", justifyContent: "space-between",
      fontSize: "13px", marginBottom: "8px",
    }}>
      <span style={{ color: V.text3 }}>{label}</span>
      <span style={{ color: valueColor || V.text }}>{value || "—"}</span>
    </div>
  );
}

function NewScreening() {
  const navigate = useNavigate();
  const location = useLocation();
  const fileInputRef = useRef(null);

  const [patients, setPatients] = useState([]);
  const [search, setSearch] = useState("");
  const [selectedPatient, setSelectedPatient] = useState(null);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [eyeSide, setEyeSide] = useState("left");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const [inferenceMode, setInferenceMode] = useState("clinical");
  const [selectedModel, setSelectedModel] = useState("ensemble");

  // If navigated from patient profile with patientId in state
  useEffect(() => {
    API.get("/patients/").then(res => {
      setPatients(res.data);
      // Auto-select patient if passed via navigation state
      const preselectedId = location.state?.patientId;
      if (preselectedId) {
        const found = res.data.find(p => p.patient_id === preselectedId);
        if (found) setSelectedPatient(found);
      }
    });
    API.get("/settings/INFERENCE_MODE")
      .then(res => setInferenceMode(res.data.set_value))
      .catch(() => setInferenceMode("clinical"));    
  }, []);


  function handleFileChange(e) {
    const f = e.target.files[0];
    if (!f) return;
    setFile(f);
    setPreview(URL.createObjectURL(f));
  }

  function handleDrop(e) {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (!f) return;
    setFile(f);
    setPreview(URL.createObjectURL(f));
  }

  const filtered = patients.filter(p => {
    const name = `${p.first_name} ${p.last_name}`.toLowerCase();
    const code = p.patient_code?.toLowerCase();
    const q = search.toLowerCase();
    return name.includes(q) || code.includes(q);
  });

  const canRun = selectedPatient && file;

  async function handleRun() {
    if (!canRun) return;
    setLoading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("patient_id", selectedPatient.patient_id);
      formData.append("eye_side", eyeSide);

      const res = await API.post("/screenings/", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      navigate(`/results/${res.data.screening_id}`);
    } catch (err) {
      setError(err.response?.data?.detail || "Screening failed. Please try again.");
      setLoading(false);
    }
  }

  return (
    <Layout title="Run Screening">

      <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: "16px" }}>

        {/* LEFT - Steps */}
        <div>

          {/* Step 1 - Select Patient */}
          <div style={{
            background: V.surface, border: `1px solid ${V.border}`,
            borderRadius: "11px", overflow: "hidden", marginBottom: "14px",
          }}>
            <div style={{ padding: "14px 18px", borderBottom: `1px solid ${V.border}` }}>
              <span style={{ fontSize: "13.5px", fontWeight: "600", color: V.text }}>
                Step 1 — Select Patient
              </span>
            </div>
            <div style={{ padding: "18px" }}>

              {/* Search */}
              <div style={{
                display: "flex", alignItems: "center", gap: "7px",
                background: V.surface2, border: `1px solid ${V.border}`,
                borderRadius: "7px", padding: "5px 11px",
                marginBottom: "12px",
              }}>
                <span style={{ color: V.text3 }}>🔍</span>
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search patient by name or ID..."
                  style={{
                    background: "none", border: "none", outline: "none",
                    color: V.text, fontSize: "12.5px",
                    fontFamily: "'DM Sans',sans-serif", width: "100%",
                  }}
                />
              </div>

              {/* Selected patient display */}
              {selectedPatient && (
                <div style={{
                  background: V.accentDim2,
                  border: `1px solid ${V.accent}`,
                  borderRadius: "8px", padding: "12px",
                  display: "flex", alignItems: "center", gap: "10px",
                  marginBottom: "12px",
                }}>
                  <div style={{
                    width: "28px", height: "28px", borderRadius: "50%",
                    background: GRADIENTS[0],
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: "11px", fontWeight: "600", color: "white", flexShrink: 0,
                  }}>
                    {getInitials(selectedPatient)}
                  </div>
                  <div>
                    <div style={{ fontWeight: "500", fontSize: "13px", color: V.text }}>
                      {selectedPatient.first_name} {selectedPatient.last_name}
                    </div>
                    <div style={{ fontSize: "11px", color: V.text3, fontFamily: "'DM Mono',monospace" }}>
                      #{selectedPatient.patient_code} · {calcAge(selectedPatient.dob)}{selectedPatient.gender?.[0]?.toUpperCase()}
                    </div>
                  </div>
                  <span style={{ marginLeft: "auto", color: V.accent2, fontSize: "12px" }}>
                    ✓ Selected
                  </span>
                  <button
                    onClick={() => setSelectedPatient(null)}
                    style={{
                      background: "none", border: "none",
                      color: V.text3, cursor: "pointer", fontSize: "12px",
                    }}
                  >
                    ✕
                  </button>
                </div>
              )}

              {/* Patient list */}
              {!selectedPatient && (
                <div style={{ maxHeight: "200px", overflowY: "auto" }}>
                  {filtered.map((p, i) => (
                    <div
                      key={p.patient_id}
                      onClick={() => { setSelectedPatient(p); setSearch(""); }}
                      style={{
                        display: "flex", alignItems: "center", gap: "10px",
                        padding: "10px 12px", borderRadius: "8px",
                        cursor: "pointer", marginBottom: "4px",
                        transition: "background .1s",
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = V.accentDim}
                      onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                    >
                      <div style={{
                        width: "28px", height: "28px", borderRadius: "50%",
                        background: GRADIENTS[i % GRADIENTS.length],
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: "11px", fontWeight: "600", color: "white", flexShrink: 0,
                      }}>
                        {getInitials(p)}
                      </div>
                      <div>
                        <div style={{ fontSize: "13px", fontWeight: "500", color: V.text }}>
                          {p.first_name} {p.last_name}
                        </div>
                        <div style={{ fontSize: "11px", color: V.text3, fontFamily: "'DM Mono',monospace" }}>
                          #{p.patient_code}
                        </div>
                      </div>
                    </div>
                  ))}
                  {filtered.length === 0 && (
                    <p style={{ color: V.text3, fontSize: "13px", textAlign: "center", padding: "16px" }}>
                      No patients found.
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Step 2 - Upload Fundus Image */}
          <div style={{
            background: V.surface, border: `1px solid ${V.border}`,
            borderRadius: "11px", overflow: "hidden", marginBottom: "14px",
          }}>
            <div style={{ padding: "14px 18px", borderBottom: `1px solid ${V.border}` }}>
              <span style={{ fontSize: "13.5px", fontWeight: "600", color: V.text }}>
                Step 2 — Upload Fundus Image
              </span>
            </div>
            <div style={{ padding: "18px" }}>
              <input
                type="file"
                accept="image/jpeg,image/png"
                ref={fileInputRef}
                onChange={handleFileChange}
                style={{ display: "none" }}
              />

              {preview ? (
                <div style={{ position: "relative" }}>
                  <img
                    src={preview}
                    alt="Fundus preview"
                    style={{
                      width: "100%", maxHeight: "240px",
                      objectFit: "contain", borderRadius: "8px",
                      background: "#060A10",
                    }}
                  />
                  <button
                    onClick={() => { setFile(null); setPreview(null); }}
                    style={{
                      position: "absolute", top: "8px", right: "8px",
                      background: V.negDim, border: `1px solid ${V.neg}`,
                      color: V.neg, borderRadius: "6px",
                      padding: "4px 10px", fontSize: "11px", cursor: "pointer",
                      fontFamily: "'DM Sans',sans-serif",
                    }}
                  >
                    ✕ Remove
                  </button>
                  <p style={{ fontSize: "12px", color: V.pos, marginTop: "8px" }}>
                    ✓ {file?.name}
                  </p>
                </div>
              ) : (
                <div
                  onClick={() => fileInputRef.current.click()}
                  onDrop={handleDrop}
                  onDragOver={e => e.preventDefault()}
                  style={{
                    border: `2px dashed ${V.border2}`,
                    borderRadius: "10px", padding: "32px",
                    textAlign: "center", cursor: "pointer",
                    background: V.surface2, transition: "all .2s",
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.borderColor = V.accent;
                    e.currentTarget.style.background = V.accentDim;
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.borderColor = V.border2;
                    e.currentTarget.style.background = V.surface2;
                  }}
                >
                  <div style={{ fontSize: "32px", marginBottom: "10px" }}>📤</div>
                  <div style={{ fontSize: "14px", fontWeight: "500", marginBottom: "5px", color: V.text }}>
                    Drop fundus image here or click to upload
                  </div>
                  <div style={{ fontSize: "12px", color: V.text3 }}>
                    Supported: JPG, PNG · Max 10MB
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Step 3 - Eye Side */}
          <div style={{
            background: V.surface, border: `1px solid ${V.border}`,
            borderRadius: "11px", overflow: "hidden",
          }}>
            <div style={{ padding: "14px 18px", borderBottom: `1px solid ${V.border}` }}>
              <span style={{ fontSize: "13.5px", fontWeight: "600", color: V.text }}>
                Step 3 — Select Eye Side
              </span>
            </div>
            <div style={{ padding: "18px", display: "flex", gap: "12px" }}>
              {["left", "right"].map(side => (
                <div
                  key={side}
                  onClick={() => setEyeSide(side)}
                  style={{
                    flex: 1, padding: "14px", borderRadius: "10px",
                    border: `2px solid ${eyeSide === side ? V.accent : V.border}`,
                    background: eyeSide === side ? V.accentDim : V.surface2,
                    cursor: "pointer", textAlign: "center",
                    transition: "all .15s",
                  }}
                >
                  <div style={{ fontSize: "20px", marginBottom: "6px" }}>
                    {side === "left" ? "👁" : "👁"}
                  </div>
                  <div style={{
                    fontSize: "13px", fontWeight: "600",
                    color: eyeSide === side ? V.accent2 : V.text,
                    textTransform: "capitalize",
                  }}>
                    {side} Eye
                  </div>
                </div>
              ))}
            </div>
          </div>

        {/* Step 4 - Model Selection (Research Mode only) */}
        {inferenceMode === "research" && (
          <div style={{
            background: V.surface, border: `1px solid ${V.border}`,
            borderRadius: "11px", overflow: "hidden", marginTop: "14px",
          }}>
            <div style={{ padding: "14px 18px", borderBottom: `1px solid ${V.border}` }}>
              <span style={{ fontSize: "13.5px", fontWeight: "600", color: V.text }}>
                Step 4 — Select Model
              </span>
              <span style={{
                marginLeft: "10px", fontSize: "11px",
                background: V.warnDim, color: V.warn,
                padding: "2px 8px", borderRadius: "10px",
              }}>
                Research Mode
              </span>
            </div>
            <div style={{ padding: "18px" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px", marginBottom: "12px" }}>
                {[
                  { id: "efficientnetb0", label: "EfficientNetB0", icon: "🏆", desc: "Default · AUC 0.9108" },
                  { id: "vgg16",          label: "VGG16",          icon: "🔷", desc: "AUC 0.9198" },
                  { id: "efficientnetv2", label: "EfficientNetV2", icon: "⚡", desc: "AUC 0.9091" },
                ].map(m => (
                  <div
                    key={m.id}
                    onClick={() => setSelectedModel(m.id)}
                    style={{
                      padding: "14px", borderRadius: "10px", textAlign: "center",
                      border: `2px solid ${selectedModel === m.id ? V.accent : V.border}`,
                      background: selectedModel === m.id ? V.accentDim : V.surface2,
                      cursor: "pointer", transition: "all .15s",
                    }}
                  >
                    <div style={{ fontSize: "20px", marginBottom: "6px" }}>{m.icon}</div>
                    <div style={{ fontSize: "13px", fontWeight: "600", color: selectedModel === m.id ? V.accent2 : V.text }}>
                      {m.label}
                    </div>
                    <div style={{ fontSize: "11px", color: V.text3, marginTop: "3px" }}>{m.desc}</div>
                  </div>
                ))}
              </div>

              {/* Ensemble / Consensus option */}
              <div
                onClick={() => setSelectedModel("ensemble")}
                style={{
                  padding: "14px 16px", borderRadius: "10px",
                  border: `2px solid ${selectedModel === "ensemble" ? V.warn : V.border}`,
                  background: selectedModel === "ensemble" ? V.warnDim : V.surface2,
                  cursor: "pointer", transition: "all .15s",
                }}
              >
                <div style={{ fontSize: "13px", fontWeight: "600", color: V.warn, marginBottom: "4px" }}>
                  🔀 Run All Three Models — Consensus Mode
                </div>
                <div style={{ fontSize: "12px", color: V.text3 }}>
                  Flags disagreement between models for closer clinical review
                </div>
              </div>
            </div>
          </div>
        )}

        </div>

        {/* RIGHT - Summary */}
        <div>
          <div style={{
            background: V.surface, border: `1px solid ${V.border}`,
            borderRadius: "11px", overflow: "hidden",
            position: "sticky", top: "0",
          }}>
            <div style={{ padding: "14px 18px", borderBottom: `1px solid ${V.border}` }}>
              <span style={{ fontSize: "13.5px", fontWeight: "600", color: V.text }}>
                Summary
              </span>
            </div>
            <div style={{ padding: "18px" }}>
              <p style={{ fontSize: "12px", color: V.text3, marginBottom: "12px" }}>
                Review before running
              </p>

              <SummaryRow
                label="Patient"
                value={selectedPatient ? `${selectedPatient.first_name} ${selectedPatient.last_name}` : "—"}
              />
              <SummaryRow
                label="ID"
                value={selectedPatient ? `#${selectedPatient.patient_code}` : "—"}
              />
              <SummaryRow
                label="Eye Side"
                value={eyeSide.charAt(0).toUpperCase() + eyeSide.slice(1)}
              />
              <SummaryRow
                label="Model"
                value={inferenceMode === "research"
                  ? selectedModel === "ensemble" ? "All Models (Consensus)" : selectedModel
                  : "Ensemble (Auto)"}
              />              
              <SummaryRow
                label="Image"
                value={file ? "✓ Ready" : "Not uploaded"}
                valueColor={file ? V.pos : V.text3}
              />

              <div style={{ marginBottom: "16px" }} />

              {error && (
                <div style={{
                  padding: "10px 12px", borderRadius: "8px",
                  fontSize: "12px", marginBottom: "12px",
                  background: V.negDim,
                  border: `1px solid rgba(255,107,107,.2)`,
                  color: V.neg,
                }}>
                  {error}
                </div>
              )}

              <button
                onClick={handleRun}
                disabled={!canRun || loading}
                style={{
                  width: "100%", padding: "12px",
                  borderRadius: "7px", fontSize: "14px",
                  fontWeight: "500", cursor: canRun && !loading ? "pointer" : "not-allowed",
                  background: canRun && !loading ? V.accent : V.surface3,
                  color: canRun && !loading ? "white" : V.text3,
                  border: "none", fontFamily: "'DM Sans',sans-serif",
                  justifyContent: "center", display: "flex", alignItems: "center",
                  transition: "all .15s",
                }}
              >
                {loading ? "Running..." : "▶ Run Screening"}
              </button>

              <p style={{
                fontSize: "11px", color: V.text3,
                textAlign: "center", marginTop: "10px",
              }}>
                Inference → Grad-CAM++ → GPT-4o → PDF
              </p>
            </div>
          </div>
        </div>

      </div>
    </Layout>
  );
}

export default NewScreening;
// src/pages/NewScreening.jsx
// New screening page - Tailwind CSS implementation.
// Step 1: Select patient. Step 2: Upload fundus image.
// Step 3: Select eye side. Step 4: Model selection (Research Mode only).

import { useState, useEffect, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import Layout from "../components/Layout";
import API from "../api/index";

import { useSettings } from "../context/SettingsContext";

const GRADIENTS = [
  "from-accent to-accent2",
  "from-pos to-emerald-700",
  "from-warn to-amber-700",
  "from-purple-500 to-purple-800",
  "from-neg to-red-800",
];

function getInitials(p) {
  if (!p) return "?";
  return `${p.first_name?.[0] ?? ""}${p.last_name?.[0] ?? ""}`.toUpperCase();
}

function calcAge(dob) {
  if (!dob) return "-";
  return Math.floor((Date.now() - new Date(dob).getTime()) / (1000 * 60 * 60 * 24 * 365.25));
}

function SummaryRow({ label, value, valueClass }) {
  return (
    <div className="flex justify-between text-sm mb-2 pb-2 border-b border-white/7">
      <span className="text-text3">{label}</span>
      <span className={valueClass || "text-text1"}>{value || "—"}</span>
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

  const [selectedModel, setSelectedModel] = useState("ensemble");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const { getSetting } = useSettings();
  const activeMode = getSetting("INFERENCE_MODE", "clinical");    

  useEffect(() => {
    API.get("/patients/").then(res => {
      setPatients(res.data);
      const preselectedId = location.state?.patientId;
      if (preselectedId) {
        const found = res.data.find(p => p.patient_id === preselectedId);
        if (found) setSelectedPatient(found);
      }
    });

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
      formData.append("image", file);
      const res = await API.post(
        `/screenings/?patient_id=${selectedPatient.patient_id}&eye_side=${eyeSide}`,
        formData,
        { headers: { "Content-Type": "multipart/form-data" } }
      );
      navigate(`/results/${res.data.screening_id}`);
    } catch (err) {
      const detail = err.response?.data?.detail;
      setError(Array.isArray(detail) ? detail.map(d => d.msg).join(", ") : detail || "Screening failed. Please try again.");
      setLoading(false);
    }
  }

  return (
    <Layout title="Run Screening">
      <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 300px" }}>

        {/* LEFT - Steps */}
        <div className="flex flex-col gap-3">

          {/* Step 1 - Select Patient */}
          <div className="bg-surface border border-white/7 rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-white/7">
              <span className="text-sm font-semibold text-text1">Step 1 — Select Patient</span>
            </div>
            <div className="p-4">

              {/* Search */}
              <div className="flex items-center gap-2 bg-surface2 border border-white/7 rounded-lg px-3 py-2 mb-3">
                <span className="text-text3">🔍</span>
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search patient by name or ID..."
                  className="bg-transparent border-0 outline-none text-text1 text-xs w-full font-sans placeholder:text-text3"
                />
              </div>

              {/* Selected patient */}
              {selectedPatient && (
                <div className="flex items-center gap-3 p-3 bg-accent/10 border border-accent rounded-lg mb-3">
                  <div className={`w-7 h-7 rounded-full bg-gradient-to-br ${GRADIENTS[0]} flex items-center justify-center text-xs font-semibold text-white flex-shrink-0`}>
                    {getInitials(selectedPatient)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-text1">
                      {selectedPatient.first_name} {selectedPatient.last_name}
                    </div>
                    <div className="text-xs text-text3 font-mono">
                      #{selectedPatient.patient_code} · {calcAge(selectedPatient.dob)}{selectedPatient.gender?.[0]?.toUpperCase()}
                    </div>
                  </div>
                  <span className="text-xs text-accent2">✓ Selected</span>
                  <button
                    onClick={() => setSelectedPatient(null)}
                    className="text-text3 hover:text-text2 bg-transparent border-0 cursor-pointer text-sm"
                  >
                    ✕
                  </button>
                </div>
              )}

              {/* Patient list */}
              {!selectedPatient && (
                <div className="max-h-48 overflow-y-auto">
                  {filtered.map((p, i) => (
                    <div
                      key={p.patient_id}
                      onClick={() => { setSelectedPatient(p); setSearch(""); }}
                      className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer hover:bg-accent/[0.08] transition-colors mb-1"
                    >
                      <div className={`w-7 h-7 rounded-full bg-gradient-to-br ${GRADIENTS[i % GRADIENTS.length]} flex items-center justify-center text-xs font-semibold text-white flex-shrink-0`}>
                        {getInitials(p)}
                      </div>
                      <div>
                        <div className="text-sm font-medium text-text1">{p.first_name} {p.last_name}</div>
                        <div className="text-xs text-text3 font-mono">#{p.patient_code}</div>
                      </div>
                    </div>
                  ))}
                  {filtered.length === 0 && (
                    <p className="text-text3 text-sm text-center py-4">No patients found.</p>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Step 2 - Upload Fundus Image */}
          <div className="bg-surface border border-white/7 rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-white/7">
              <span className="text-sm font-semibold text-text1">Step 2 — Upload Fundus Image</span>
            </div>
            <div className="p-4">
              <input
                type="file"
                accept="image/jpeg,image/png"
                ref={fileInputRef}
                onChange={handleFileChange}
                className="hidden"
              />

              {preview ? (
                <div className="relative">
                  <img
                    src={preview}
                    alt="Fundus preview"
                    className="w-full max-h-56 object-contain rounded-lg bg-black"
                  />
                  <button
                    onClick={() => { setFile(null); setPreview(null); }}
                    className="absolute top-2 right-2 px-2.5 py-1 text-xs text-neg bg-neg/10 border border-neg/20 rounded-lg cursor-pointer font-sans"
                  >
                    ✕ Remove
                  </button>
                  <p className="text-xs text-pos mt-2">✓ {file?.name}</p>
                </div>
              ) : (
                <div
                  onClick={() => fileInputRef.current.click()}
                  onDrop={handleDrop}
                  onDragOver={e => e.preventDefault()}
                  className="border-2 border-dashed border-white/12 rounded-xl p-8 text-center cursor-pointer hover:border-accent hover:bg-accent/[0.06] transition-all bg-surface2"
                >
                  <div className="text-3xl mb-2">📤</div>
                  <div className="text-sm font-medium text-text1 mb-1">
                    Drop fundus image here or click to upload
                  </div>
                  <div className="text-xs text-text3">Supported: JPG, PNG · Max 10MB</div>
                </div>
              )}
            </div>
          </div>

          {/* Step 3 - Eye Side */}
          <div className="bg-surface border border-white/7 rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-white/7">
              <span className="text-sm font-semibold text-text1">Step 3 — Select Eye Side</span>
            </div>
            <div className="p-4 flex gap-3">
              {["left", "right"].map(side => (
                <div
                  key={side}
                  onClick={() => setEyeSide(side)}
                  className={`flex-1 p-4 rounded-xl text-center cursor-pointer transition-all border-2 ${
                    eyeSide === side
                      ? "border-accent bg-accent/10"
                      : "border-white/7 bg-surface2 hover:border-white/20"
                  }`}
                >
                  <div className="text-xl mb-2">👁</div>
                  <div className={`text-sm font-semibold capitalize ${eyeSide === side ? "text-accent2" : "text-text1"}`}>
                    {side} Eye
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Step 4 - Model Selection (Research Mode only) */}
          {activeMode === "research" && (
            <div className="bg-surface border border-white/7 rounded-xl overflow-hidden">
              <div className="px-5 py-3.5 border-b border-white/7 flex items-center gap-3">
                <span className="text-sm font-semibold text-text1">Step 4 — Select Model</span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-warn/10 text-warn border border-warn/20">
                  Research Mode
                </span>
              </div>
              <div className="p-4">
                <div className="grid grid-cols-3 gap-3 mb-3">
                  {[
                    { id: "efficientnetb0", label: "EfficientNetB0", icon: "🏆", desc: "Default · AUC 0.9108" },
                    { id: "vgg16",          label: "VGG16",          icon: "🔷", desc: "AUC 0.9198" },
                    { id: "efficientnetv2", label: "EfficientNetV2", icon: "⚡", desc: "AUC 0.9091" },
                  ].map(m => (
                    <div
                      key={m.id}
                      onClick={() => setSelectedModel(m.id)}
                      className={`p-3 rounded-xl text-center cursor-pointer transition-all border-2 ${
                        selectedModel === m.id
                          ? "border-accent bg-accent/10"
                          : "border-white/7 bg-surface2 hover:border-white/20"
                      }`}
                    >
                      <div className="text-xl mb-1">{m.icon}</div>
                      <div className={`text-xs font-semibold ${selectedModel === m.id ? "text-accent2" : "text-text1"}`}>
                        {m.label}
                      </div>
                      <div className="text-xs text-text3 mt-0.5">{m.desc}</div>
                    </div>
                  ))}
                </div>
                <div
                  onClick={() => setSelectedModel("ensemble")}
                  className={`p-3 rounded-xl cursor-pointer transition-all border-2 ${
                    selectedModel === "ensemble"
                      ? "border-warn bg-warn/10"
                      : "border-white/7 bg-surface2 hover:border-white/20"
                  }`}
                >
                  <div className="text-sm font-semibold text-warn mb-1">
                    🔀 Run All Three Models — Consensus Mode
                  </div>
                  <div className="text-xs text-text3">
                    Flags disagreement between models for closer clinical review
                  </div>
                </div>
              </div>
            </div>
          )}

        </div>

        {/* RIGHT - Summary */}
        <div>
          <div className="bg-surface border border-white/7 rounded-xl overflow-hidden sticky top-0">
            <div className="px-5 py-3.5 border-b border-white/7">
              <span className="text-sm font-semibold text-text1">Summary</span>
            </div>
            <div className="p-4">
              <p className="text-xs text-text3 mb-4">Review before running</p>

              <SummaryRow label="Patient"
                value={selectedPatient ? `${selectedPatient.first_name} ${selectedPatient.last_name}` : "—"} />
              <SummaryRow label="ID"
                value={selectedPatient ? `#${selectedPatient.patient_code}` : "—"} />
              <SummaryRow label="Eye Side"
                value={eyeSide.charAt(0).toUpperCase() + eyeSide.slice(1)} />
              <SummaryRow label="Image"
                value={file ? "✓ Ready" : "Not uploaded"}
                valueClass={file ? "text-pos" : "text-text3"} />
              <SummaryRow label="Model"
                value={activeMode === "research"
                  ? selectedModel === "ensemble" ? "All Models (Consensus)" : selectedModel
                  : "Ensemble (Auto)"} />

              <div className="mt-4" />

              {error && (
                <div className="px-3 py-2.5 bg-neg/10 border border-neg/20 rounded-lg text-xs text-neg mb-3">
                  {error}
                </div>
              )}

                <button
                  onClick={handleRun}
                  disabled={!canRun || loading}
                  className={`w-full py-3 rounded-lg text-sm font-medium border-0 transition-all font-sans ${
                    canRun
                      ? "bg-accent hover:bg-accent2 text-white cursor-pointer"
                      : "bg-surface3 text-text3 cursor-not-allowed"
                  }`}
                >
                  {loading ? "Running..." : "▶ Run Screening"}
                </button>

              <p className="text-xs text-text3 text-center mt-3">
                Inference → Grad-CAM++ → GPT-4o → PDF
              </p>
            </div>
          </div>
        </div>

      </div>

    {/* Loading Overlay */}
    {loading && (
      <div className="loading-overlay">
        <div className="loading-content">
          <div className="spinner" />
          <h3 className="text-text1 text-lg font-semibold mb-2">Analysing Image...</h3>
          <p className="text-text2 text-sm mb-1">AI model is processing your fundus image</p>
          <p className="text-text3 text-xs">Inference → Grad-CAM++ → GPT-4o → PDF</p>
        </div>
      </div>
    )}

    </Layout>
  );
}

export default NewScreening;
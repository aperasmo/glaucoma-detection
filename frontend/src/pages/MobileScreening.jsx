// src/pages/MobileScreening.jsx
// Mobile conference screening flow - screening form.
// Route: /mobile/screening - reached after picking Clinical or Research mode.
// Single name field, sample image picker (reused pattern from NewScreening.jsx),
// eye side defaulted to "left" (no UI - booth visitors don't need to choose).

import { useState, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import API from "../api/index";

function MobileScreening() {
  const navigate = useNavigate();
  const location = useLocation();
  const fileInputRef = useRef(null);

  // Mode picked on the landing page - UI framing only, redirect back if missing.
  const mobileMode = location.state?.mobileMode;

  const [name, setName] = useState("");
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const [showSamplePicker, setShowSamplePicker] = useState(false);
  const [selectedSample, setSelectedSample] = useState(null);
  const [loadingSample, setLoadingSample] = useState(false);
  const [sampleImages] = useState(() => {
    // Same 20-image pool as NewScreening.jsx - filenames stay internal, no labels shown.
    const normals = Array.from({ length: 10 }, (_, i) =>
      `/assets/sample-fundus/normal-${String(i + 1).padStart(2, "0")}`
    );
    const glaucomas = Array.from({ length: 10 }, (_, i) =>
      `/assets/sample-fundus/glaucoma-${String(i + 1).padStart(2, "0")}`
    );
    const all = [...normals, ...glaucomas];
    for (let i = all.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [all[i], all[j]] = [all[j], all[i]];
    }
    return all;
  });

  // Redirect back to landing if someone lands here without picking a mode first.
  if (!mobileMode) {
    navigate("/mobile", { replace: true });
    return null;
  }

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

  async function handleUseSample() {
    if (!selectedSample) return;
    setLoadingSample(true);
    try {
      // Sample filenames use mixed extensions (.jpg / .png) - try both.
      let res, ext;
      try {
        res = await fetch(`${selectedSample}.jpg`);
        if (!res.ok) throw new Error();
        ext = "jpg";
      } catch {
        res = await fetch(`${selectedSample}.png`);
        ext = "png";
      }
      const blob = await res.blob();
      const filename = `${selectedSample.split("/").pop()}.${ext}`;
      const sampleFile = new File([blob], filename, { type: blob.type || `image/${ext}` });
      setFile(sampleFile);
      setPreview(URL.createObjectURL(sampleFile));
      setShowSamplePicker(false);
      setSelectedSample(null);
    } catch {
      setError("Failed to load sample image. Please try again.");
    } finally {
      setLoadingSample(false);
    }
  }

  const canRun = name.trim().length > 0 && file;

  async function handleRun() {
    if (!canRun) return;
    setLoading(true);
    setError(null);

    try {
      // Split single name field into first/last for the patients endpoint.
      const trimmed = name.trim();
      const spaceIndex = trimmed.indexOf(" ");
      const first_name = spaceIndex === -1 ? trimmed : trimmed.slice(0, spaceIndex);
      const last_name = spaceIndex === -1 ? "" : trimmed.slice(spaceIndex + 1);

      const patientRes = await API.post("/patients/", { first_name, last_name });
      const patientId = patientRes.data.patient_id;

      const formData = new FormData();
      formData.append("image", file);
      const screeningRes = await API.post(
        `/screenings/?patient_id=${patientId}&eye_side=left`,
        formData,
        { headers: { "Content-Type": "multipart/form-data" } }
      );

      navigate(`/mobile/result/${screeningRes.data.screening_id}`, {
        state: { mobileMode },
      });
    } catch (err) {
      const detail = err.response?.data?.detail;
      setError(
        Array.isArray(detail) ? detail.map(d => d.msg).join(", ") : detail || "Something went wrong. Please try again."
      );
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-bg px-5 py-8">
      <div className="w-full max-w-sm mx-auto">

        {/* Mode indicator */}
        <div className="flex items-center justify-center mb-6">
          <span
            className={`text-xs px-3 py-1 rounded-full border font-medium ${
              mobileMode === "research"
                ? "bg-warn/10 text-warn border-warn/20"
                : "bg-accent/10 text-accent2 border-accent/20"
            }`}
          >
            {mobileMode === "research" ? "🔬 Research Mode" : "🏥 Clinical Mode"}
          </span>
        </div>

        {/* Name */}
        <div className="mb-5">
          <label className="block text-xs font-medium text-text2 mb-2">
            Your name
          </label>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. John Visitor"
            className="w-full bg-surface2 border border-white/12 rounded-xl px-4 py-3 text-sm text-text1 outline-none placeholder:text-text3 focus:border-accent transition-colors font-sans"
          />
        </div>

        {/* Fundus image */}
        <div className="mb-6">
          <label className="block text-xs font-medium text-text2 mb-2">
            Fundus image
          </label>

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
                className="w-full aspect-square object-contain rounded-xl bg-black"
              />
              <button
                onClick={() => { setFile(null); setPreview(null); }}
                className="absolute top-2 right-2 px-2.5 py-1 text-xs text-neg bg-neg/10 border border-neg/20 rounded-lg cursor-pointer font-sans"
              >
                ✕ Remove
              </button>
            </div>
          ) : (
            <>
              <div
                onClick={() => fileInputRef.current.click()}
                onDrop={handleDrop}
                onDragOver={e => e.preventDefault()}
                className="border-2 border-dashed border-white/12 rounded-xl p-8 text-center cursor-pointer bg-surface2"
              >
                <div className="text-3xl mb-2">📤</div>
                <div className="text-sm font-medium text-text1 mb-1">
                  Tap to upload a fundus image
                </div>
                <div className="text-xs text-text3">JPG or PNG</div>
              </div>

              <button
                onClick={() => setShowSamplePicker(true)}
                className="w-full mt-3 flex items-center justify-center gap-2 px-3 py-3 text-xs text-text2 border border-white/7 rounded-xl bg-surface2 cursor-pointer font-sans"
              >
                🖼 Or try a sample image
              </button>
            </>
          )}
        </div>

        {error && (
          <div className="px-3 py-2.5 bg-neg/10 border border-neg/20 rounded-lg text-xs text-neg mb-4">
            {error}
          </div>
        )}

        {/* Run button */}
        <button
          onClick={handleRun}
          disabled={!canRun || loading}
          className={`w-full py-4 rounded-xl text-sm font-semibold border-0 transition-all font-sans ${
            canRun
              ? "bg-accent text-white cursor-pointer active:scale-[0.98]"
              : "bg-surface3 text-text3 cursor-not-allowed"
          }`}
        >
          {loading ? "Analysing..." : "▶ Run Screening"}
        </button>

      </div>

      {/* SAMPLE IMAGE PICKER MODAL */}
      {showSamplePicker && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center z-50">
          <div className="bg-surface border border-white/12 rounded-t-2xl sm:rounded-xl w-full sm:max-w-lg overflow-hidden max-h-[85vh] flex flex-col">

            <div className="px-5 py-4 border-b border-white/7 flex items-center justify-between flex-shrink-0">
              <span className="text-sm font-semibold text-text1">Choose a sample image</span>
              <button
                onClick={() => { setShowSamplePicker(false); setSelectedSample(null); }}
                className="text-text3 hover:text-text2 bg-transparent border-0 cursor-pointer text-lg leading-none font-sans"
              >
                ✕
              </button>
            </div>

            <div className="p-5 overflow-y-auto flex-1">
              <div className="grid grid-cols-4 gap-2">
                {sampleImages.map(src => {
                  const isSelected = selectedSample === src;
                  return (
                    <div
                      key={src}
                      onClick={() => setSelectedSample(src)}
                      className={`relative rounded-lg overflow-hidden cursor-pointer border-2 transition-all aspect-square bg-black ${
                        isSelected ? "border-accent" : "border-transparent"
                      }`}
                    >
                      {/* Preview tries jpg first via CSS background fallback handled at select time */}
                      <img
                        src={`${src}.jpg`}
                        alt=""
                        className="w-full h-full object-cover"
                        onError={e => { e.currentTarget.src = `${src}.png`; }}
                      />
                      {isSelected && (
                        <div className="absolute top-1 right-1 w-4 h-4 rounded-full bg-accent flex items-center justify-center">
                          <span className="text-white text-[10px] leading-none">✓</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="flex justify-end gap-2.5 p-5 pt-3 border-t border-white/7 flex-shrink-0">
              <button
                onClick={() => { setShowSamplePicker(false); setSelectedSample(null); }}
                className="px-4 py-2.5 text-xs font-medium text-text2 border border-white/12 rounded-lg bg-transparent cursor-pointer font-sans"
              >
                Cancel
              </button>
              <button
                onClick={handleUseSample}
                disabled={!selectedSample || loadingSample}
                className="px-4 py-2.5 text-xs font-medium text-white bg-accent disabled:bg-surface3 disabled:text-text3 rounded-lg border-0 cursor-pointer font-sans"
              >
                {loadingSample ? "Loading..." : "Use this image"}
              </button>
            </div>

          </div>
        </div>
      )}

      {/* Loading overlay */}
      {loading && (
        <div className="fixed inset-0 bg-bg/95 flex flex-col items-center justify-center z-50 px-6 text-center">
          <div className="w-8 h-8 border-2 border-white/10 border-t-accent rounded-full animate-spin mb-4" />
          <h3 className="text-text1 text-base font-semibold mb-1">Analysing image...</h3>
          <p className="text-text3 text-xs">This takes a few seconds.</p>
        </div>
      )}

    </div>
  );
}

export default MobileScreening;
// src/pages/MIPR2026Screening.jsx
// Mobile conference screening flow - single entry page.
// Route: /MIPR2026 - reached by scanning the QR code at the booth.
// Auto-logs in silently (demo-login pattern), then shows name + image form.
// Always runs the full research pipeline via force_mode=research - the
// visitor never sees the word "Research", it's just "Screening" to them.

import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import API from "../api/index";
import { useTheme } from "../theme/ThemeProvider";

function MIPR2026Screening() {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);
  const { login, token } = useAuth();
  const { currentTheme, themes } = useTheme();
  const isDarkTheme = themes[currentTheme]?.mode === "dark";
  const logoSrc = isDarkTheme
    ? "/assets/glaucoma-ai-logo-dark.png"
    : "/assets/glaucoma-ai-logo-light.png";

  const [authStatus, setAuthStatus] = useState(token ? "ready" : "loading"); // loading | ready | failed

  const [name, setName] = useState("");
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const [showSamplePicker, setShowSamplePicker] = useState(false);
  const [selectedSample, setSelectedSample] = useState(null);
  const [loadingSample, setLoadingSample] = useState(false);
  const [sampleImages] = useState(() => {
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

  useEffect(() => {
    if (token) return;
    let cancelled = false;

    async function autoLogin() {
      try {
        const res = await API.post("/auth/demo-login");
        const accessToken = res.data.access_token;
        const userRes = await API.get("/auth/me", {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (cancelled) return;
        login(accessToken, userRes.data);
        setAuthStatus("ready");
      } catch {
        if (cancelled) return;
        setAuthStatus("failed");
      }
    }

    autoLogin();
    return () => { cancelled = true; };
  }, [login, token]);

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
      let res, ext;
      res = await fetch(`${selectedSample}.jpg`);
      if (res.ok && res.headers.get("content-type")?.startsWith("image/")) {
        ext = "jpg";
      } else {
        res = await fetch(`${selectedSample}.png`);
        ext = "png";
      }
      if (!res.ok) {
        throw new Error("Sample image not found.");
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
      const trimmed = name.trim();
      const spaceIndex = trimmed.indexOf(" ");
      const first_name = spaceIndex === -1 ? trimmed : trimmed.slice(0, spaceIndex);
      const last_name = spaceIndex === -1 ? "" : trimmed.slice(spaceIndex + 1);

      const patientRes = await API.post("/patients/", { first_name, last_name });
      const patientId = patientRes.data.patient_id;

      const formData = new FormData();
      formData.append("image", file);
      const screeningRes = await API.post(
        `/screenings/?patient_id=${patientId}&eye_side=left&force_mode=research`,
        formData,
        { headers: { "Content-Type": "multipart/form-data" } }
      );

      navigate(`/MIPR2026/result/${screeningRes.data.screening_id}`);
    } catch (err) {
      const detail = err.response?.data?.detail;
      setError(
        Array.isArray(detail) ? detail.map(d => d.msg).join(", ") : detail || "Something went wrong. Please try again."
      );
      setLoading(false);
    }
  }

  if (authStatus === "loading") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-bg px-6">
        <div className="w-8 h-8 border-2 border-white/10 border-t-accent rounded-full animate-spin mb-4" />
        <p className="text-sm text-text3">Loading, please wait...</p>
      </div>
    );
  }

  if (authStatus === "failed") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-bg px-6 text-center">
        <p className="text-sm text-text3 mb-2">Something went wrong.</p>
        <p className="text-xs text-text3">Please try scanning the code again.</p>
      </div>
    );
  }

  return (
    <div className="h-screen bg-bg overflow-y-auto px-5 py-8">
      <div className="w-full max-w-sm mx-auto">

        <div className="flex flex-col items-center text-center mb-8">
          <img src={logoSrc} alt="GlaucomaAI" className="h-12 w-auto object-contain mb-3" />
          <h1 className="text-base font-semibold text-text1">Health-MM • IEEE MIPR 2026</h1>
          <p className="text-xs text-text3 mt-1">Explainable Fundus-Based AI Glaucoma Screening</p>
        </div>

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

        <p className="text-xs text-text3 text-center mt-6 leading-relaxed">
          Research prototype for IEEE MIPR 2026. Not for clinical diagnosis or medical decision-making.
        </p>
      </div>

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

export default MIPR2026Screening;
// src/pages/MobileLanding.jsx
// Mobile conference screening flow - landing page.
// Route: /mobile - reached by scanning a QR code at the booth.
// Auto-logs in silently (same demo-login pattern as DemoLogin.jsx), then
// presents a Clinical / Research mode choice. This choice is UI framing only -
// it does not touch the INFERENCE_MODE setting, it just decides which mobile
// result view renders after the screening completes.

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import API from "../api/index";
import { useTheme } from "../theme/ThemeProvider";

function MobileLanding() {
  const navigate = useNavigate();
  const { login, token } = useAuth();
  const [status, setStatus] = useState(token ? "ready" : "loading"); // loading | ready | failed
  const { currentTheme, themes } = useTheme();
  const isDarkTheme = themes[currentTheme]?.mode === "dark";
  const logoSrc = isDarkTheme
    ? "/assets/glaucoma-ai-logo-dark.png"
    : "/assets/glaucoma-ai-logo-light.png";

  useEffect(() => {
    // Already logged in (e.g. tapped "Change mode" from a later screen) -
    // skip the login call entirely, go straight to the mode picker.
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
        setStatus("ready");
      } catch {
        if (cancelled) return;
        setStatus("failed");
      }
    }

    autoLogin();

    return () => {
      cancelled = true;
    };
  }, [login]);

  function pickMode(mode) {
    // Mode is passed via router state - UI framing only for the mobile flow.
    navigate("/mobile/screening", { state: { mobileMode: mode } });
  }

  if (status === "loading") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-bg px-6">
        <div className="w-8 h-8 border-2 border-white/10 border-t-accent rounded-full animate-spin mb-4" />
        <p className="text-sm text-text3">Loading, please wait...</p>
      </div>
    );
  }

  if (status === "failed") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-bg px-6 text-center">
        <p className="text-sm text-text3 mb-2">Something went wrong.</p>
        <p className="text-xs text-text3">Please try scanning the code again.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-bg px-6 py-10">
      <div className="w-full max-w-sm">

        {/* Logo */}
        <div className="flex flex-col items-center text-center mb-10">
          <img
            src={logoSrc}
            alt="GlaucomaAI"
            className="h-14 w-auto object-contain mb-4"
          />
          <h1 className="text-lg font-semibold text-text1 mb-1">
            Try a screening
          </h1>
          <p className="text-xs text-text3 leading-relaxed">
            Choose how you'd like to view the AI screening result.
          </p>
        </div>

        {/* Mode cards */}
        <div className="flex flex-col gap-3">

          <div
            onClick={() => pickMode("clinical")}
            className="p-5 rounded-2xl border-2 border-white/7 bg-surface hover:border-accent hover:bg-accent/[0.06] transition-all cursor-pointer active:scale-[0.98]"
          >
            <div className="flex items-center gap-3 mb-2">
              <span className="text-2xl">🏥</span>
              <span className="text-base font-semibold text-text1">Clinical Mode</span>
            </div>
            <p className="text-xs text-text3 leading-relaxed">
              A single, clear result — the way a clinician would see it. Prediction,
              confidence, and referral letter, no extra detail.
            </p>
          </div>

          <div
            onClick={() => pickMode("research")}
            className="p-5 rounded-2xl border-2 border-white/7 bg-surface hover:border-warn hover:bg-warn/[0.06] transition-all cursor-pointer active:scale-[0.98]"
          >
            <div className="flex items-center gap-3 mb-2">
              <span className="text-2xl">🔬</span>
              <span className="text-base font-semibold text-text1">Research Mode</span>
            </div>
            <p className="text-xs text-text3 leading-relaxed">
              See all three AI models individually, side by side, plus the
              ensemble consensus and model agreement.
            </p>
          </div>

        </div>

        <p className="text-xs text-text3 text-center mt-8 leading-relaxed">
          Demo system — for illustration only. Not for clinical use.
        </p>
      </div>
    </div>
  );
}

export default MobileLanding;
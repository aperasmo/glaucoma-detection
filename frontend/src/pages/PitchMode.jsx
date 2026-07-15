// src/pages/PitchMode.jsx
// Pitch Mode - full-screen guided walkthrough for demos and presentations.
// Triggered from Login page via "Enter pitch mode after sign in" checkbox.
// Six sequential steps. Click anywhere to advance. Step 6 redirects to dashboard.
// Uses existing app theme tokens - feels native to the product.

import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useTheme } from "../theme/ThemeProvider";

const STEPS = [
  {
    id: 1,
    eyebrow: "The Problem",
    headline: "Two tools. One gap.",
    body: [
      "OCT scanning is the gold standard for glaucoma detection. It is precise, detailed, and largely confined to specialist clinics with the budget and space to run it.",
      "Fundus photography is different. The equipment is affordable, portable, and already in use across primary care. The problem is that reading a fundus image accurately takes training most general practitioners do not have.",
      "That gap - between what a fundus image contains and what a clinician can reliably extract from it - is exactly what this system is built to close.",
    ],
    aside: null,
  },
  {
    id: 2,
    eyebrow: "The System",
    headline: "One image in.\nOne referral letter out.",
    body: [
      "The workflow is deliberately simple. A fundus photograph is uploaded. The AI ensemble reads it, produces a prediction with a confidence score, and generates a Grad-CAM++ heatmap showing where it looked.",
      "If the result warrants referral, a clinical letter is drafted automatically - signed, formatted, and ready for the clinician to review.",
      "No research notebook. No manual scoring. One workflow, end to end.",
    ],
    flow: ["Fundus Photo", "AI Ensemble", "Grad-CAM++", "Referral Letter"],
    aside: null,
  },
  {
    id: 3,
    eyebrow: "Clinical Mode",
    headline: "What a clinician sees.",
    body: [
      "Clinical Mode runs the full ensemble automatically and presents a single result. The clinician sees the prediction, confidence score, Grad-CAM++ heatmap, OHTS risk score, and referral letter - nothing more.",
      "When models disagree, an amber flag appears with a prompt to request a second opinion letter. The clinician does not need to understand the underlying models to act on the result.",
    ],
    screenshot: "/assets/pitch/clinical-mode.png",
    screenshotLabel: "Clinical Mode - live system",
    aside: null,
  },
  {
    id: 4,
    eyebrow: "Research Mode",
    headline: "What the models show individually.",
    body: [
      "Research Mode surfaces all three models side by side - EfficientNetB0, VGG16, EfficientNetV2 - each with its own prediction, confidence score, and Grad-CAM++ heatmap.",
      "This view is designed for model evaluation and clinical audit, not routine screening. The ensemble consensus is still the authoritative clinical output.",
    ],
    screenshot: "/assets/pitch/research-mode.png",
    screenshotLabel: "Research Mode - live system",
    aside: null,
  },
  {
    id: 5,
    eyebrow: "The Evidence",
    headline: "Evaluated on 415 held-out images.",
    body: [
      "The locked test set was never seen during training or validation. Results are from a single evaluation run - no cherry-picking, no retraining after the fact.",
    ],
    metrics: [
      { label: "AUC", value: "0.93", note: "Area under ROC curve" },
      { label: "Sensitivity", value: "0.85", note: "True positive rate" },
      { label: "Specificity", value: "0.80", note: "True negative rate" },
      { label: "NPV", value: "0.93", note: "Negative predictive value" },
    ],
    aside: "Sensitivity is the priority metric for a screening tool. Missing a glaucoma case is worse than a false referral.",
  },
  {
    id: 6,
    eyebrow: "Live System",
    headline: "Built end to end.\nRunning in production.",
    body: [
      "This is not a prototype. The system is deployed on AWS, served over HTTPS, and accessible right now at glaucoma-ai-screening.com.",
      "From the CNN ensemble to the referral letter a clinician reads - every layer was designed, built, and evaluated as part of this project.",
      "Early detection. Explainable AI. Better decisions. Smarter referrals.",
    ],
    aside: null,
    closing: true,
  },
];

function PitchMode() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [fading, setFading] = useState(false);
  const { currentTheme, themes } = useTheme();
  const isDarkTheme = themes[currentTheme]?.mode === "dark";
  const logoSrc = isDarkTheme
    ? "/assets/glaucoma-ai-logo-dark.png"
    : "/assets/glaucoma-ai-logo-light.png";

  const advance = useCallback(() => {
    if (fading) return;
    if (step >= STEPS.length - 1) {
      navigate("/dashboard");
      return;
    }
    setFading(true);
    setTimeout(() => {
      setStep(prev => prev + 1);
      setFading(false);
    }, 250);
  }, [step, fading, navigate]);

  useEffect(() => {
    function handleKey(e) {
      if (e.key === " " || e.key === "ArrowRight") {
        e.preventDefault();
        advance();
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [advance]);

  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;

  return (
    <div
      className="fixed inset-0 bg-bg flex flex-col select-none cursor-pointer"
      onClick={advance}
      style={{ userSelect: "none" }}
    >
      {/* Top bar */}
      <div className="flex items-center justify-between px-12 pt-7 pb-0 flex-shrink-0">
        <img
          src={logoSrc}
          alt="GlaucomaAI"
          className="h-9 w-auto object-contain opacity-80"
        />
        <div className="font-mono text-sm text-text3 tracking-widest">
          {String(step + 1).padStart(2, "0")} / {String(STEPS.length).padStart(2, "0")}
        </div>
      </div>

      {/* Step indicator dots */}
      <div className="flex items-center justify-center gap-2.5 pt-5 flex-shrink-0">
        {STEPS.map((_, i) => (
          <div
            key={i}
            className={`rounded-full transition-all duration-300 ${
              i === step
                ? "w-8 h-2 bg-accent"
                : i < step
                  ? "w-2 h-2 bg-accent/40"
                  : "w-2 h-2 bg-white/10"
            }`}
          />
        ))}
      </div>

      {/* Main content - vertically and horizontally centred */}
      <div
              className={`flex-1 flex px-12 py-6 ${
                (current.id === 3 || current.id === 4)
                  ? "flex-col justify-start"
                  : "items-center justify-center"
              }`}
              style={{
                opacity: fading ? 0 : 1,
                transition: "opacity 0.25s ease",
              }}
            >
              {/* Auto-height container so flexbox centres the whole slide as one unit */}
              <div className={`${(current.id === 3 || current.id === 4) ? "w-full" : "w-full max-w-3xl"}`}>

          {/* Eyebrow */}
          <div className="text-base font-semibold text-accent2 uppercase tracking-widest mb-5">
            {current.eyebrow}
          </div>

          {/* Headline */}
          <h1
            className="text-text1 font-bold mb-10 leading-tight whitespace-pre-line"
            style={{ fontSize: "clamp(3rem, 6vw, 5.5rem)" }}
          >
            {current.headline}
          </h1>

          {/* Steps 1 and 2 - single column text */}
          {(current.id === 1 || current.id === 2) && (
            <div className="flex flex-col gap-6">
              {current.body.map((para, i) => (
                <p key={i} className="text-xl text-text2 leading-relaxed">
                  {para}
                </p>
              ))}

              {/* Step 2 flow diagram */}
              {current.flow && (
                <div className="flex items-center gap-0 mt-6">
                  {current.flow.map((label, i) => (
                    <div key={i} className="flex items-center">
                      <div className="px-6 py-4 bg-surface border border-white/12 rounded-xl text-base font-semibold text-text1 whitespace-nowrap">
                        {label}
                      </div>
                      {i < current.flow.length - 1 && (
                        <div className="flex items-center mx-3">
                          <div className="w-8 h-px bg-accent/40" />
                          <div className="text-accent/60 text-base">›</div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Steps 3 and 4 - screenshot fills width, body text aligned to top of card */}
          {(current.id === 3 || current.id === 4) && (
            <div
              className="grid gap-6"
              style={{ gridTemplateColumns: "1fr 900px", alignItems: "start" }}
            >
              {/* Screenshot card */}
                <div className="bg-surface border border-white/7 rounded-xl overflow-y-auto">
                <div className="px-5 py-4 border-b border-white/7 flex items-center gap-2">
                  <span className="text-sm font-semibold text-text1 flex-1">
                    {current.screenshotLabel}
                  </span>
                  <span className={`text-sm px-3 py-1 rounded-full border font-medium ${
                    current.id === 3
                      ? "bg-accent/10 text-accent2 border-accent/20"
                      : "bg-warn/10 text-warn border-warn/20"
                  }`}>
                    {current.id === 3 ? "Clinical Mode" : "Research Mode"}
                  </span>
                </div>
                <div className="bg-black/20 w-full overflow-hidden flex-1">
                  <img
                    src={current.screenshot}
                    alt={current.screenshotLabel}
                    className="w-full h-auto"
                    onError={e => {
                      e.currentTarget.style.display = "none";
                      e.currentTarget.nextElementSibling.style.display = "flex";
                    }}
                  />
                  <div
                    className="hidden flex-col items-center justify-center text-text3 text-sm p-8 gap-2 w-full h-full"
                  >
                    <div className="text-3xl mb-1">🖼</div>
                    <div>Screenshot goes here</div>
                    <div className="text-text3/60 font-mono text-xs mt-1">{current.screenshot}</div>
                  </div>
                </div>
              </div>

              {/* Body text - top aligned, matches card top */}
              <div className="flex flex-col gap-5 pt-2">
                {current.body.map((para, i) => (
                  <p key={i} className="text-xl text-text2 leading-relaxed">
                    {para}
                  </p>
                ))}
              </div>
            </div>
          )}

          {/* Step 5 - metrics */}
          {current.id === 5 && (
            <div className="flex flex-col gap-6">
              {current.body.map((para, i) => (
                <p key={i} className="text-xl text-text2 leading-relaxed">
                  {para}
                </p>
              ))}
              <div className="grid grid-cols-4 gap-5 mt-2">
                {current.metrics.map(m => (
                  <div
                    key={m.label}
                    className="bg-surface border border-white/7 rounded-xl p-6"
                  >
                    <div className="text-sm text-text3 uppercase tracking-wider mb-3">
                      {m.label}
                    </div>
                    <div className="text-6xl font-bold font-mono text-accent2 mb-2">
                      {m.value}
                    </div>
                    <div className="text-sm text-text3 leading-relaxed">
                      {m.note}
                    </div>
                  </div>
                ))}
              </div>
              {current.aside && (
                <div className="px-5 py-4 bg-accent/10 border border-accent/20 rounded-lg text-base text-accent2 leading-relaxed">
                  ℹ {current.aside}
                </div>
              )}
            </div>
          )}

          {/* Step 6 - closing */}
          {current.id === 6 && (
            <div className="flex flex-col gap-6">
              {current.body.map((para, i) => (
                <p
                  key={i}
                  className={`leading-relaxed ${
                    i === current.body.length - 1
                      ? "text-xl font-semibold text-accent2"
                      : "text-xl text-text2"
                  }`}
                >
                  {para}
                </p>
              ))}
              <div className="mt-3 inline-flex items-center gap-2.5 px-5 py-3 bg-accent/10 border border-accent/20 rounded-lg w-fit">
                <span className="w-2.5 h-2.5 rounded-full bg-pos animate-pulse" />
                <span className="text-base font-semibold text-accent2">
                  Live at glaucoma-ai-screening.com
                </span>
              </div>
            </div>
          )}

        </div>
      </div>

      {/* Bottom hint */}
      <div className="flex items-center justify-between px-12 pb-7 flex-shrink-0">
        <div className="text-sm text-text3 font-mono">
          {current.eyebrow.toUpperCase()}
        </div>
        <div className="text-sm text-text3 flex items-center gap-1.5">
          {isLast ? (
            <span className="text-accent2">Click to enter the system →</span>
          ) : (
            <>
              <span>Click anywhere to continue</span>
              <span className="opacity-50">·</span>
              <span className="opacity-50">Space or → also works</span>
            </>
          )}
        </div>
      </div>

    </div>
  );
}

export default PitchMode;
// src/pages/MIPR2026Result.jsx
// Mobile conference screening flow - result view.
// Route: /MIPR2026/result/:screeningId
// Always renders the full research-style layout (4 models, 4 LLM letters) -
// backend always ran force_mode=research for this screening, so this data
// always exists. The word "Research" is never shown to the visitor.
// Confusion matrix and AUC/Sensitivity/Specificity are hardcoded - locked,
// static evaluation results from the 415-image test set.
//
// has_model_disagreement from the backend is currently unreliable for
// force_mode=research screenings (known backend bug, flagged separately).
// Disagreement and the disagreeing model name are therefore computed
// client-side from the four model predictions already on screen, so the
// feature works correctly regardless of that backend issue.

import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import API from "../api/index";
import {
  getClinicalResult,
  getModelResult,
  getReferralResult,
  getGradcamUrl,
  BACKEND,
} from "../components/screening-results/ResultShared";

// const CONFUSION_MATRIX = { tp: 177, fn: 31, fp: 39, tn: 168 };
const CONFUSION_MATRIX = { tp: 105, fn: 18, fp: 59, tn: 233 };
const EVAL_METRICS = { auc: "0.93", sensitivity: "0.85", specificity: "0.80" };

const MODEL_LABELS = {
  efficientnetb0: "EfficientNetB0",
  vgg16: "VGG16",
  efficientnetv2: "EfficientNetV2",
  ensemble: "Ensemble",
};

const LETTER_TABS = [
  { keys: ["gpt4o", "gpt4o_mini"], labels: ["GPT-4o", "GPT-4o-mini"] },
  { keys: ["llama", "gemini"], labels: ["GPT-OSS 120B", "Gemini 3.5 Flash"] },
];

// ---------------------------------------------------------------------------
// Small reusable accordion/expandable section. Collapsed by default unless
// told otherwise. Fully keyboard accessible - a real <button> drives it,
// aria-expanded and aria-controls tie it to the panel it reveals.
// ---------------------------------------------------------------------------
function ExpandableSection({ id, title, badge, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  const buttonId = `${id}-toggle`;
  const panelId = `${id}-panel`;

  return (
    <div className="bg-surface2 rounded-xl overflow-hidden mb-4">
      <button
        id={buttonId}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between gap-2 px-3.5 py-3 text-left bg-transparent border-0 cursor-pointer font-sans"
      >
        <span className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-medium text-text1 truncate">{title}</span>
          {badge}
        </span>
        <span
          aria-hidden="true"
          className={`text-text3 text-xs flex-shrink-0 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        >
          ▾
        </span>
      </button>
      {open && (
        <div
          id={panelId}
          role="region"
          aria-labelledby={buttonId}
          className="px-3.5 pb-3.5 pt-0 border-t border-white/7 animate-[fadeIn_0.15s_ease]"
        >
          {children}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// A single referral letter, collapsed by default. Shows the LLM name and
// generation time in the header; tapping "Preview referral letter" reveals
// the full text. Never auto-expands.
// ---------------------------------------------------------------------------
function LetterCard({ letterKey, label, result }) {
  const [open, setOpen] = useState(false);
  const buttonId = `letter-${letterKey}-toggle`;
  const panelId = `letter-${letterKey}-panel`;
  const hasLetter = Boolean(result?.referral_letter);

  return (
    <div className="bg-surface2 rounded-xl overflow-hidden flex flex-col">
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-white/7">
        <span className="text-xs font-semibold text-text1">{label}</span>
        {hasLetter && result?.generation_time_ms != null && (
          <span className="text-xs text-text3 font-mono">
            {(result.generation_time_ms / 1000).toFixed(1)}s
          </span>
        )}
      </div>

      {!hasLetter ? (
        <div className="px-3 py-2.5 text-xs text-text3">
          No referral required - normal result.
        </div>
      ) : (
        <>
          <button
            id={buttonId}
            type="button"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setOpen(o => !o)}
            className="px-3 py-2.5 text-xs font-medium text-accent2 bg-transparent border-0 cursor-pointer text-left font-sans flex items-center justify-between"
          >
            <span>{open ? "Hide referral letter" : "Preview referral letter"}</span>
            <span aria-hidden="true" className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`}>▾</span>
          </button>
          {open && (
            <div
              id={panelId}
              role="region"
              aria-labelledby={buttonId}
              className="px-3 pb-3 text-xs text-text2 leading-relaxed max-h-56 overflow-y-auto border-t border-white/7 pt-2.5"
            >
              {result.referral_letter}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ConfusionMatrixPanel() {
  return (
    <div className="bg-surface2 rounded-xl p-3.5 mb-4">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-text3 uppercase tracking-wider">Model Evaluation Performance</span>
        <span className="text-xs text-text3">415-image test set</span>
      </div>
      <p className="text-xs text-text3/80 mb-2.5 leading-relaxed">
        Performance measured on the held-out evaluation dataset.
      </p>
      <div className="grid grid-cols-2 gap-1.5">
        <div className="bg-pos/10 border border-pos/20 rounded-lg p-2 text-center">
          <div className="text-xs text-pos/80 mb-0.5">True positive</div>
          <div className="text-sm font-bold text-pos font-mono">{CONFUSION_MATRIX.tp}</div>
        </div>
        <div className="bg-neg/10 border border-neg/20 rounded-lg p-2 text-center">
          <div className="text-xs text-neg/80 mb-0.5">False negative</div>
          <div className="text-sm font-bold text-neg font-mono">{CONFUSION_MATRIX.fn}</div>
        </div>
        <div className="bg-neg/10 border border-neg/20 rounded-lg p-2 text-center">
          <div className="text-xs text-neg/80 mb-0.5">False positive</div>
          <div className="text-sm font-bold text-neg font-mono">{CONFUSION_MATRIX.fp}</div>
        </div>
        <div className="bg-pos/10 border border-pos/20 rounded-lg p-2 text-center">
          <div className="text-xs text-pos/80 mb-0.5">True negative</div>
          <div className="text-sm font-bold text-pos font-mono">{CONFUSION_MATRIX.tn}</div>
        </div>
      </div>
      <div className="flex justify-between mt-2.5 pt-2.5 border-t border-white/7 text-xs text-text3">
        <span>AUC {EVAL_METRICS.auc}</span>
        <span>Sensitivity {EVAL_METRICS.sensitivity}</span>
        <span>Specificity {EVAL_METRICS.specificity}</span>
      </div>
    </div>
  );
}

function ImagePair({ data, result }) {
  const gradcamUrl = getGradcamUrl(data, result);
  return (
    <div className="grid grid-cols-2 gap-2 mb-4">
      <div>
        <div className="text-xs text-text3 text-center mb-1.5 uppercase tracking-wider">Original</div>
        <div className="w-full aspect-square rounded-lg overflow-hidden bg-black flex items-center justify-center">
          {data?.image_path ? (
            <img
              src={`${BACKEND}/${data.image_path.replace(/\\/g, "/")}`}
              alt="Fundus"
              className="w-full h-full object-contain"
            />
          ) : (
            <span className="text-text3 text-xs">Not available</span>
          )}
        </div>
      </div>
      <div>
        <div className="text-xs text-text3 text-center mb-1.5 uppercase tracking-wider">Grad-CAM++</div>
        <div className="w-full aspect-square rounded-lg overflow-hidden bg-black flex items-center justify-center">
          {gradcamUrl ? (
            <img src={gradcamUrl} alt="Grad-CAM++" className="w-full h-full object-contain" />
          ) : (
            <span className="text-text3 text-xs">Not available</span>
          )}
        </div>
        <div className="text-[10px] text-text3 text-center mt-1.5 leading-snug">
          Model attention visualisation
          <br />
          <span className="text-text3/70">
            Shows regions that influenced the model, not confirmed clinical abnormalities.
          </span>
        </div>
      </div>
    </div>
  );
}

function MIPR2026Result() {
  const { screeningId } = useParams();
  const navigate = useNavigate();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [letterTab, setLetterTab] = useState(0);

  useEffect(() => {
    let intervalId = null;

    async function fetchResult() {
      try {
        const res = await API.get(`/results/${screeningId}/full`);
        setData(res.data);

        const status = String(res.data?.status || "").toLowerCase();
        if (status === "complete" || status === "failed") {
          setLoading(false);
          if (intervalId) clearInterval(intervalId);
        }
      } catch {
        setError("Failed to load result.");
        setLoading(false);
        if (intervalId) clearInterval(intervalId);
      }
    }

    fetchResult();
    intervalId = setInterval(fetchResult, 3000);
    return () => { if (intervalId) clearInterval(intervalId); };
  }, [screeningId]);

  function scanAnother() {
    navigate("/MIPR2026");
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-bg flex flex-col items-center justify-center px-6 text-center">
        <div className="w-8 h-8 border-2 border-white/10 border-t-accent rounded-full animate-spin mb-4" />
        <h3 className="text-text1 text-base font-semibold mb-1">Analysing image...</h3>
        <p className="text-text3 text-xs">This takes a few seconds.</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-bg flex flex-col items-center justify-center px-6 text-center">
        <p className="text-sm text-neg mb-4">{error}</p>
        <button
          onClick={scanAnother}
          className="px-4 py-2.5 text-xs font-medium text-white bg-accent rounded-lg border-0 cursor-pointer font-sans"
        >
          Try again
        </button>
      </div>
    );
  }

  const results = data?.results || [];
  const clinicalResult = getClinicalResult(results);
  const isGlaucoma = clinicalResult?.prediction?.toLowerCase() === "glaucoma";
  const confidencePct = clinicalResult?.confidence_score != null
    ? (Number(clinicalResult.confidence_score) * 100).toFixed(1)
    : "-";
  const thresholdPct = clinicalResult?.threshold_used != null
    ? (Number(clinicalResult.threshold_used) * 100).toFixed(0)
    : "50";

  const models = [
    { key: "efficientnetb0", result: getModelResult(results, "efficientnetb0") },
    { key: "vgg16", result: getModelResult(results, "vgg16") },
    { key: "efficientnetv2", result: getModelResult(results, "efficientnetv2") },
    { key: "ensemble", result: clinicalResult, reference: true },
  ];

  // Disagreement computed client-side from the four predictions already on
  // screen. This is deliberate - the backend's has_model_disagreement flag
  // is currently unreliable for force_mode=research screenings, so we do not
  // rely on it here. The comparison itself is equivalent to the backend's
  // own rule (any individual model's prediction differing from Ensemble).
  const ensemblePrediction = clinicalResult?.prediction?.toLowerCase();
  const disagreeingModels = models.filter(
    m => m.result && !m.reference && m.result.prediction?.toLowerCase() !== ensemblePrediction
  );
  const hasDisagreement = disagreeingModels.length > 0;
  const disagreeingNames = disagreeingModels.map(m => MODEL_LABELS[m.key]).join(" and ");

  const activePair = LETTER_TABS[letterTab];
  const activeLetters = activePair.keys.map((key, i) => ({
    key,
    label: activePair.labels[i],
    result: getReferralResult(results, key),
  }));

  // Real workflow states - never claim a step completed unless it actually did.
  const gradcamUrl = getGradcamUrl(data, clinicalResult);
  const anyLetterExists = LETTER_TABS
    .flatMap(tab => tab.keys)
    .some(key => getReferralResult(results, key)?.referral_letter);

  const workflowSteps = [
    { label: "Fundus image analysed", done: Boolean(data?.image_path) },
    { label: "CNN ensemble inference completed", done: Boolean(clinicalResult) },
    { label: "Grad-CAM++ explanation generated", done: Boolean(gradcamUrl) },
    { label: "Model agreement evaluated", done: models.some(m => m.result) },
    {
      label: anyLetterExists ? "Referral support generated" : "Referral support not required for this result",
      done: anyLetterExists,
      neutral: !anyLetterExists,
    },
  ];

  return (    
    <div className="h-screen bg-bg overflow-y-auto pb-8">

      {/* Header */}
      <div className="px-5 py-3.5 border-b border-white/7 sticky top-0 bg-bg z-10 relative">
        <button
          onClick={() => navigate("/MIPR2026")}
          className="absolute left-5 top-1/2 -translate-y-1/2 text-xs text-text3 flex items-center gap-1 bg-transparent border-0 cursor-pointer font-sans"
        >
          ← Home
        </button>

        <div className="flex flex-col items-center">
          <h1 className="text-sm font-semibold text-text1 mb-1.5">Screening Result</h1>
          <div className="inline-flex flex-col items-center gap-0.5 px-3 py-1 rounded-full bg-warn/10 border border-warn/20">
            <span className="text-[9px] font-medium text-warn leading-tight">
              IEEE MIPR 2026 Research Prototype
            </span>
            <span className="text-[9px] text-warn/80 leading-tight">
              Not for Clinical Diagnosis
            </span>
          </div>
        </div>
      </div>

      <div className="px-5 py-5 max-w-sm mx-auto">

        <ImagePair data={data} result={clinicalResult} />

        {/* Primary screening result - strengthened, threshold-based wording */}
        <div className="bg-surface2 rounded-xl p-4 mb-4 border border-white/7">
          <div className="text-xs text-text3 uppercase tracking-wider mb-2">
            Ensemble Screening Result
          </div>
          <div className={`text-base font-bold mb-2 ${isGlaucoma ? "text-neg" : "text-pos"}`}>
            {isGlaucoma ? "Above Glaucoma Screening Threshold" : "Below Glaucoma Screening Threshold"}
          </div>
          <div className="flex items-center gap-4 mb-2.5">
            <div>
              <div className="text-[10px] text-text3 mb-0.5">Confidence</div>
              <div className={`text-lg font-bold font-mono ${isGlaucoma ? "text-neg" : "text-pos"}`}>
                {confidencePct}%
              </div>
            </div>
            <div>
              <div className="text-[10px] text-text3 mb-0.5">Threshold</div>
              <div className="text-lg font-bold font-mono text-text1">{thresholdPct}%</div>
            </div>
          </div>
          <p className="text-xs text-text3 leading-relaxed">
            The ensemble score is checked against a {thresholdPct}% cutoff - scores above that
            line are classified as possible glaucoma signs. This is a screening indicator, not a diagnosis.
          </p>
        </div>

        {/* Model comparison - 4 colour-coded cards */}
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-text3 uppercase tracking-wider">Model comparison</span>
          {hasDisagreement && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-warn/15 text-warn border border-warn/25">
              Model disagreement detected
            </span>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2 mb-4">
          {models.map(({ key, result, reference }) => {
            if (!result) return null;
            const positive = result.prediction?.toLowerCase() === "glaucoma";
            const conf = result.confidence_score != null
              ? (Number(result.confidence_score) * 100).toFixed(1)
              : "-";
            return (
              <div
                key={key}
                className={`rounded-xl p-3 border relative ${
                  positive ? "bg-neg/10 border-neg/25" : "bg-pos/10 border-pos/25"
                }`}
              >
                {reference && (
                  <span className="absolute top-2 right-2 text-[9px] px-1.5 py-0.5 rounded-full bg-warn/20 text-warn border border-warn/30">
                    Reference
                  </span>
                )}
                <div className={`text-xs font-medium mb-1 ${positive ? "text-neg" : "text-pos"}`}>
                  {MODEL_LABELS[key]}
                </div>
                <div className={`text-lg font-bold font-mono mb-0.5 ${positive ? "text-neg" : "text-pos"}`}>
                  {conf}%
                </div>
                <div className={`text-xs ${positive ? "text-neg/80" : "text-pos/80"}`}>
                  {positive ? "Possible glaucoma signs" : "No glaucoma signs"}
                </div>
              </div>
            );
          })}
        </div>

        {hasDisagreement && (
          <div className="flex items-start gap-2 px-3.5 py-3 rounded-xl bg-warn/10 border border-warn/25 mb-4">
            <span className="text-warn text-sm mt-0.5" aria-hidden="true">⚠</span>
            <span className="text-xs text-warn/90 leading-relaxed">
              The ensemble result was {isGlaucoma ? "above" : "below"} the glaucoma screening
              threshold, but {disagreeingNames || "a supporting model"} flagged the image
              {isGlaucoma ? " differently" : " as suspicious"}. Neither result should be read
              as clinically correct on its own.
            </span>
          </div>
        )}

        <ConfusionMatrixPanel />

        {/* Referral letters - tabs, collapsed accordion per letter */}
        <div className="text-xs text-text3 uppercase tracking-wider mb-2">Referral Support</div>
        <div className="flex gap-1.5 mb-3 bg-surface2 p-1 rounded-lg">
          {LETTER_TABS.map((pair, i) => (
            <button
              key={i}
              onClick={() => setLetterTab(i)}
              className={`flex-1 py-2.5 rounded-md text-xs font-medium transition-colors border-0 cursor-pointer font-sans ${
                letterTab === i ? "bg-accent text-white" : "bg-transparent text-text3"
              }`}
            >
              {pair.labels.join(" / ")}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-2.5 mb-4">
          {activeLetters.map(({ key, label, result }) => (
            <LetterCard key={key} letterKey={key} label={label} result={result} />
          ))}
        </div>

        {/* Why this result? */}
        <ExpandableSection id="why-this-result" title="Why this result?">
          <p className="text-xs text-text2 leading-relaxed">
            This result comes from a CNN ensemble combining three individual models against a
            configured screening threshold ({thresholdPct}%). Each model's individual prediction
            is also shown above for comparison. When an individual model's prediction differs
            from the ensemble, that disagreement is flagged rather than hidden. The Grad-CAM++
            heatmap shows which regions of the image most influenced the model's output. None of
            this - model agreement, disagreement, or heatmap attention - confirms a clinical
            diagnosis; it is intended to support, not replace, specialist judgement.
          </p>
        </ExpandableSection>

        {/* Workflow completed summary */}
        <ExpandableSection id="workflow-summary" title="Workflow completed">
          <ul className="flex flex-col gap-2 mt-1">
            {workflowSteps.map((step, i) => (
              <li key={i} className="flex items-center gap-2 text-xs">
                <span
                  aria-hidden="true"
                  className={`w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0 text-[10px] font-bold ${
                    step.done
                      ? "bg-pos/15 text-pos"
                      : step.neutral
                        ? "bg-white/7 text-text3"
                        : "bg-surface3 text-text3"
                  }`}
                >
                  {step.done ? "✓" : "–"}
                </span>
                <span className={step.done ? "text-text2" : "text-text3"}>{step.label}</span>
              </li>
            ))}
          </ul>
        </ExpandableSection>

        {/* Scan another */}
        <button
          onClick={scanAnother}
          className="w-full py-3.5 rounded-xl text-sm font-semibold border-0 bg-accent text-white cursor-pointer active:scale-[0.98] font-sans"
        >
          🔄 Scan Another
        </button>

        <p className="text-xs text-text3 text-center mt-6 leading-relaxed">
          Research prototype developed for IEEE MIPR 2026.
          <br />
          Not intended for clinical diagnosis or medical decision-making.
        </p>
      </div>
    </div>
  );
}

export default MIPR2026Result;
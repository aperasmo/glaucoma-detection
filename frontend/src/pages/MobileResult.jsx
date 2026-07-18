// src/pages/MobileResult.jsx
// Mobile conference screening flow - result view.
// Route: /mobile/result/:screeningId
// Renders Clinical or Research layout based on mobileMode passed via router state.
// Reuses ResultShared helpers where possible. Confusion matrix and AUC/Sensitivity/
// Specificity are hardcoded - locked evaluation results from the 415-image test set,
// already published on the IEEE poster, no backend endpoint needed.

import { useEffect, useState } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import API from "../api/index";
import {
  getClinicalResult,
  getModelResult,
  getGradcamUrl,
  BACKEND,
} from "../components/screening-results/ResultShared";

// Locked evaluation results - 415-image held-out test set. Static, never changes
// per screening. See IEEE MIPR poster for source.
const CONFUSION_MATRIX = { tp: 177, fn: 31, fp: 39, tn: 168 };
const EVAL_METRICS = { auc: "0.93", sensitivity: "0.85", specificity: "0.80" };

const MODEL_LABELS = {
  efficientnetb0: "EfficientNetB0",
  vgg16: "VGG16",
  efficientnetv2: "EfficientNetV2",
  ensemble: "Ensemble",
};

function ConfusionMatrixPanel() {
  return (
    <div className="bg-surface2 rounded-xl p-3.5 mb-4">
      <div className="flex items-center justify-between mb-2.5">
        <span className="text-xs text-text3 uppercase tracking-wider">Model evidence</span>
        <span className="text-xs text-text3">415-image test set</span>
      </div>
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

function ImagePair({ data, result, label }) {
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
            <img src={gradcamUrl} alt={`${label} Grad-CAM++`} className="w-full h-full object-contain" />
          ) : (
            <span className="text-text3 text-xs">Not available</span>
          )}
        </div>
      </div>
    </div>
  );
}

function MobileResult() {
  const { screeningId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const mobileMode = location.state?.mobileMode || "clinical";

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

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
    navigate("/mobile/screening", { state: { mobileMode } });
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
  const hasDisagreement = clinicalResult?.has_model_disagreement === true;
  const confidencePct = clinicalResult?.confidence_score != null
    ? (Number(clinicalResult.confidence_score) * 100).toFixed(1)
    : "—";

  const primaryReferral =
    results.find(item => item.referral_letter != null && item.llm_used === "gpt4o") ||
    results.find(item => item.referral_letter != null && item.llm_used !== null) ||
    null;

  return (
    <div className="min-h-screen bg-bg pb-8">

      {/* Header */}
      <div className="px-5 py-4 border-b border-white/7 flex items-center justify-between sticky top-0 bg-bg z-10">
        <span className="text-sm font-semibold text-text1">Screening result</span>
        <span
          className={`text-xs px-2.5 py-1 rounded-full border font-medium ${
            mobileMode === "research"
              ? "bg-warn/10 text-warn border-warn/20"
              : "bg-accent/10 text-accent2 border-accent/20"
          }`}
        >
          {mobileMode === "research" ? "Research" : "Clinical"}
        </span>
      </div>

      <div className="px-5 py-5 max-w-sm mx-auto">

        {mobileMode === "clinical" ? (
          <>
            <ImagePair data={data} result={clinicalResult} label="Ensemble" />

            <div className={`flex items-center gap-2 px-3.5 py-3 rounded-xl border mb-4 ${
              isGlaucoma
                ? "bg-neg/10 border-neg/30"
                : hasDisagreement
                  ? "bg-warn/10 border-warn/30"
                  : "bg-pos/10 border-pos/30"
            }`}>
              <span className={`w-2 h-2 rounded-full ${
                isGlaucoma ? "bg-neg" : hasDisagreement ? "bg-warn" : "bg-pos"
              }`} />
              <span className={`text-sm font-medium ${
                isGlaucoma ? "text-neg" : hasDisagreement ? "text-warn" : "text-pos"
              }`}>
                {isGlaucoma
                  ? "Possible glaucoma signs detected"
                  : hasDisagreement
                    ? "No glaucoma signs detected — model disagreement detected"
                    : "No glaucoma signs detected"}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2.5 mb-4">
              <div className="bg-surface2 rounded-xl p-3.5">
                <div className="text-xs text-text3 mb-1">Confidence</div>
                <div className={`text-lg font-bold font-mono ${isGlaucoma ? "text-neg" : "text-pos"}`}>
                  {confidencePct}%
                </div>
              </div>
              <div className="bg-surface2 rounded-xl p-3.5">
                <div className="text-xs text-text3 mb-1">OHTS</div>
                <div className="text-lg font-bold text-text1">
                  {clinicalResult?.ohts_score != null ? `${Number(clinicalResult.ohts_score).toFixed(0)}/16` : "N/A"}
                </div>
              </div>
            </div>

            <ConfusionMatrixPanel />

            <div className="bg-surface2 rounded-xl p-3.5 mb-5">
              <div className="text-xs text-text3 mb-2">Referral letter</div>
              {primaryReferral ? (
                <div className="text-xs text-text1 leading-relaxed whitespace-pre-wrap max-h-48 overflow-y-auto">
                  {primaryReferral.referral_letter}
                </div>
              ) : (
                <div className="text-xs text-text3 text-center py-3">
                  No referral required — normal result.
                </div>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="text-xs text-text3 uppercase tracking-wider mb-2">Model comparison</div>
            <div className="flex flex-col gap-2 mb-4">
              {["efficientnetb0", "vgg16", "efficientnetv2"].map(key => {
                const r = getModelResult(results, key);
                if (!r) return null;
                const modelIsGlaucoma = r.prediction?.toLowerCase() === "glaucoma";
                const conf = r.confidence_score != null ? (Number(r.confidence_score) * 100).toFixed(1) : "—";
                return (
                  <div key={key} className="bg-surface2 rounded-xl p-3 flex items-center justify-between">
                    <div>
                      <div className="text-xs font-semibold text-text1">{MODEL_LABELS[key]}</div>
                      <div className={`text-xs ${modelIsGlaucoma ? "text-neg" : "text-pos"}`}>
                        {modelIsGlaucoma ? "Possible glaucoma signs" : "No glaucoma signs"}
                      </div>
                    </div>
                    <div className={`text-sm font-bold font-mono ${modelIsGlaucoma ? "text-neg" : "text-pos"}`}>
                      {conf}%
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="bg-surface border border-warn/30 rounded-xl p-3 mb-4">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-semibold text-text1">Ensemble</span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-warn/15 text-warn border border-warn/20">
                  Clinical reference
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className={`text-xs ${isGlaucoma ? "text-neg" : "text-pos"}`}>
                  {isGlaucoma ? "Possible glaucoma signs detected" : "No glaucoma signs detected"}
                </span>
                <span className={`text-sm font-bold font-mono ${isGlaucoma ? "text-neg" : "text-pos"}`}>
                  {confidencePct}%
                </span>
              </div>
            </div>

            <ImagePair data={data} result={clinicalResult} label="Ensemble" />

            {hasDisagreement && (
              <div className="flex items-start gap-2 px-3.5 py-3 rounded-xl bg-warn/10 border border-warn/25 mb-4">
                <span className="text-warn text-xs mt-0.5">⚠</span>
                <span className="text-xs text-warn/90 leading-relaxed">
                  Model disagreement detected — {MODEL_LABELS[clinicalResult?.disagreement_model] || "a supporting model"} flagged this image as suspicious.
                </span>
              </div>
            )}

            <ConfusionMatrixPanel />
          </>
        )}

        {/* Scan another - same pattern as "Screen Again" on desktop */}
        <button
          onClick={scanAnother}
          className="w-full py-3.5 rounded-xl text-sm font-semibold border-0 bg-accent text-white cursor-pointer active:scale-[0.98] font-sans"
        >
          🔄 Scan Another
        </button>

        <p className="text-xs text-text3 text-center mt-6 leading-relaxed">
          Demo system — for illustration only. Not for clinical use.
        </p>
      </div>
    </div>
  );
}

export default MobileResult;
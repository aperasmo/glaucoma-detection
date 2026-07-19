// src/pages/MobileResult.jsx
// Mobile conference screening flow - result view.
// Route: /mobile/result/:screeningId
// Always renders the full research-style layout (4 models, 4 LLM letters) -
// backend always ran force_mode=research for this screening, so this data
// always exists. The word "Research" is never shown to the visitor.
// Confusion matrix and AUC/Sensitivity/Specificity are hardcoded - locked,
// static evaluation results from the 415-image test set.

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

const CONFUSION_MATRIX = { tp: 177, fn: 31, fp: 39, tn: 168 };
const EVAL_METRICS = { auc: "0.93", sensitivity: "0.85", specificity: "0.80" };

const MODEL_LABELS = {
  efficientnetb0: "EfficientNetB0",
  vgg16: "VGG16",
  efficientnetv2: "EfficientNetV2",
  ensemble: "Ensemble",
};

const LETTER_TABS = [
  { keys: ["gpt4o", "gpt4o_mini"], labels: ["GPT-4o", "GPT-4o-mini"] },
  { keys: ["llama", "gemini"], labels: ["LLaMA", "Gemini 3.5 Flash"] },
];

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
      </div>
    </div>
  );
}

function MobileResult() {
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
    navigate("/mobile");
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
    : "—";
  const thresholdPct = clinicalResult?.threshold_used != null
    ? (Number(clinicalResult.threshold_used) * 100).toFixed(0)
    : "50";

  const models = [
    { key: "efficientnetb0", result: getModelResult(results, "efficientnetb0") },
    { key: "vgg16", result: getModelResult(results, "vgg16") },
    { key: "efficientnetv2", result: getModelResult(results, "efficientnetv2") },
    { key: "ensemble", result: clinicalResult, reference: true },
  ];

    const predictionSet = new Set(
    models
        .filter(item => item.result)
        .map(item => item.result.prediction?.toLowerCase())
        .filter(Boolean)
    );
  //const hasDisagreement = clinicalResult?.has_model_disagreement === true;
  const hasDisagreement = predictionSet.size > 1;

  const activePair = LETTER_TABS[letterTab];
  const activeLetters = activePair.keys.map((key, i) => ({
    key,
    label: activePair.labels[i],
    result: getReferralResult(results, key),
  }));

  return (
    <div className="min-h-screen bg-bg pb-8">

      {/* Header */}
      <div className="px-5 py-4 border-b border-white/7 flex items-center justify-between sticky top-0 bg-bg z-10">
        <button
          onClick={() => navigate("/mobile")}
          className="text-xs text-text3 flex items-center gap-1 bg-transparent border-0 cursor-pointer font-sans"
        >
          ← Home
        </button>
        <span className="text-sm font-semibold text-text1">Screening result</span>
        <span className="w-10" />
      </div>

      <div className="px-5 py-5 max-w-sm mx-auto">

        <ImagePair data={data} result={clinicalResult} />

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
              : "—";
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

        <ConfusionMatrixPanel />

        {hasDisagreement && (
          <div className="flex items-start gap-2 px-3.5 py-3 rounded-xl bg-warn/10 border border-warn/25 mb-4">
            <span className="text-warn text-sm mt-0.5">⚠</span>
            <span className="text-xs text-warn/90 leading-relaxed">
              The main result found no glaucoma signs, but {MODEL_LABELS[clinicalResult?.disagreement_model] || "a supporting model"} flagged this image as suspicious.
            </span>
          </div>
        )}

        {/* Confidence card with threshold explanation */}
        <div className="bg-surface2 rounded-xl p-3.5 mb-4">
          <div className="text-xs text-text3 mb-1">Confidence</div>
          <div className={`text-lg font-bold font-mono mb-1.5 ${isGlaucoma ? "text-neg" : "text-pos"}`}>
            {confidencePct}%
          </div>
          <div className="text-xs text-text3 leading-relaxed">
            Checked against a {thresholdPct}% cutoff — above that line, the result leans toward possible glaucoma signs.
          </div>
        </div>

        {/* Referral letters - tabs, 2 letters side by side per tab */}
        <div className="text-xs text-text3 uppercase tracking-wider mb-2">Referral letters</div>
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

        <div className="grid grid-cols-2 gap-2.5 mb-5">
          {activeLetters.map(({ key, label, result }) => (
            <div key={key} className="bg-surface2 rounded-xl overflow-hidden flex flex-col">
              <div className="flex items-center justify-between px-3 py-2.5 border-b border-white/7">
                <span className="text-xs font-semibold text-text1">{label}</span>
                {result?.generation_time_ms != null && (
                  <span className="text-xs text-text3 font-mono">
                    {(result.generation_time_ms / 1000).toFixed(1)}s
                  </span>
                )}
              </div>
              <div className="px-3 py-2.5 text-xs text-text2 leading-relaxed max-h-56 overflow-y-auto">
                {result?.referral_letter || (
                  <span className="text-text3">No referral required — normal result.</span>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Scan another */}
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
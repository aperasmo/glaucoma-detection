// src/pages/ModelPerformance.jsx
// Model Performance page - Tailwind CSS implementation.
// Matches mock UI pg-models exactly.
// Static data from evaluation_results.json - no API calls needed.

import { useEffect, useState } from "react";
import Layout from "../components/Layout";
import API from "../api/index";

const FALLBACK_MODELS = {
  efficientnetb0: {
    label: "EfficientNetB0",
    auc: 0.9108, sensitivity: 85.4, specificity: 76.4,
    f1: 0.707, npv: 92.5, accuracy: 79.0,
    tp: 105, tn: 223, fp: 69, fn: 18,
    bestFor: "Explainability — clearest Grad-CAM++ heatmaps",
    description: "A deep learning model pre-trained on millions of general images, then re-trained on 4,148 fundus photographs to detect glaucoma. It has 5.3 million internal parameters fine-tuned to recognise glaucoma patterns in eye images. Best choice when the clinician needs to understand why the AI made its decision.",
    thresholds: [
      { label: "Default (0.5)", value: "0.50", sens: "Lower", spec: "Higher", active: false },
      { label: "Youden's J (optimal balance)", value: "0.512", sens: "~87%", spec: "~79%", active: false },
      { label: "Sensitivity-first reference", value: "0.52", sens: "85.4%", spec: "~76%", active: true },
    ],
  },
  vgg16: {
    label: "VGG16",
    auc: 0.9198, sensitivity: 85.4, specificity: 79.1,
    f1: 0.727, npv: 92.8, accuracy: 80.9,
    tp: 105, tn: 231, fp: 61, fn: 18,
    bestFor: "Highest individual AUC",
    description: "An older but highly reliable architecture with 138 million parameters, originally developed by Oxford University. Despite its age, it achieves the highest individual AUC of 0.9198 on our dataset. Its depth and conservative prediction style make it excellent at minimising false alarms while maintaining high sensitivity.",
    thresholds: [
      { label: "Default (0.5)", value: "0.50", sens: "Lower", spec: "Higher", active: false },
      { label: "Youden's J (optimal balance)", value: "0.468", sens: "~87%", spec: "~79%", active: false },
      { label: "Sensitivity-first reference", value: "0.47", sens: "85.4%", spec: "~79%", active: true },
    ],
  },
  efficientnetv2: {
    label: "EfficientNetV2",
    auc: 0.9091, sensitivity: 85.4, specificity: 74.3,
    f1: 0.693, npv: 92.3, accuracy: 77.6,
    tp: 105, tn: 217, fp: 75, fn: 18,
    bestFor: "Highest specificity at Youden threshold",
    description: "A newer architecture with 513 layers that focuses on efficiency and accuracy. It has the highest specificity at the Youden threshold (89.7%), meaning it is the best at correctly clearing normal eyes. Useful when reducing unnecessary referrals is the clinical priority.",
    thresholds: [
      { label: "Default (0.5)", value: "0.50", sens: "Lower", spec: "Higher", active: false },
      { label: "Youden's J (optimal balance)", value: "0.609", sens: "~87%", spec: "~79%", active: false },
      { label: "Sensitivity-first reference", value: "0.47", sens: "85.4%", spec: "~74%", active: true },
    ],
  },
  ensemble: {
    label: "Ensemble",
    auc: 0.9270, sensitivity: 85.4, specificity: 79.8,
    f1: 0.732, npv: 92.8, accuracy: 81.5,
    tp: 105, tn: 233, fp: 59, fn: 18,
    bestFor: "Best overall — used for all predictions",
    isActive: true,
    description: "The system combines predictions from all three models by averaging their probability scores. Where all three models agree that a case shows possible glaucoma signs, confidence is highest. This approach provides a more stable screening output than relying on a single model and is used as the clinical reference model for screening outputs. An AUC of 0.9270 indicates excellent discrimination between glaucoma-sign and no-glaucoma-sign cases in the held-out test set.",
    thresholds: [
      { label: "Default (0.5)", value: "0.50", sens: "Lower", spec: "Higher", active: false },
      { label: "Youden's J (optimal balance)", value: "0.516", sens: "~87%", spec: "~80%", active: false },
      { label: "Sensitivity-first reference", value: "0.50", sens: "85.4%", spec: "~80%", active: true },
    ],
  },
};

const MODEL_KEYS = ["efficientnetb0", "vgg16", "efficientnetv2", "ensemble"];

function formatPercent(value, digits = 2) {
  // Keeps metric display clean, e.g. 83.74% instead of 83.74000000000001%.
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "N/A";
  }

  return `${Number(value).toFixed(digits)}%`;
}

function formatNumber(value, digits = 2) {
  // Used for F1 and other decimal metrics.
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "N/A";
  }

  return Number(value).toFixed(digits);
}


const GLOSSARY = [
  { term: "AUC — Area Under the Curve", def: "Measures how well the model separates glaucoma-sign from no-glaucoma-sign eyes. Score of 1.0 = perfect, 0.5 = random guessing. Above 0.90 is considered excellent for medical AI screening." },
  { term: "Sensitivity (Recall)", def: "Out of all glaucoma-sign cases in the test set, how many did the model catch? The most important metric for a screening tool — missing glaucoma is more dangerous than a false alarm." },
  { term: "Specificity", def: "Out of all no-glaucoma-sign eyes in the test set, how many did the model correctly clear? High specificity means fewer patients are sent for unnecessary follow-up examinations." },
  { term: "F1 Score", def: "A single number balancing precision (when it says glaucoma, how often is it right?) and sensitivity. Range 0 to 1, higher is better." },
  { term: "NPV — Negative Predictive Value", def: "When the model predicts no glaucoma signs, how confident can we be? NPV describes how often negative predictions were correct in the test set." },
  { term: "Ensemble", def: "Combines predictions from multiple models by averaging their probability scores. More reliable than any single model alone." },
  { term: "Grad-CAM++", def: "Gradient-weighted Class Activation Mapping Plus Plus. Generates a visual heatmap showing which regions of the eye image the AI focused on when making its prediction. Essential for clinical transparency and trust." },
  { term: "Youden's J Threshold", def: "The mathematically optimal decision threshold that maximises the balance between sensitivity and specificity. Named after statistician William J. Youden." },
  { term: "McNemar's Test", def: "A statistical test that confirms whether performance differences between models are real or just by chance. p<0.05 means the difference is statistically significant." },
];

function mapApiModelToUiModel(model) {
  return {
    label: model.model_name,
    auc: model.auc,
    sensitivity: Number(model.sensitivity || 0) * 100,
    specificity: Number(model.specificity || 0) * 100,
    f1: model.f1,
    npv: Number(model.npv || 0) * 100,
    accuracy: Number(model.accuracy || 0) * 100,
    tp: model.tp,
    tn: model.tn,
    fp: model.fp,
    fn: model.fn,
    bestFor:
      model.model_key === "ensemble"
        ? "Clinical reference model"
        : FALLBACK_MODELS[model.model_key]?.bestFor || "",
    isActive: model.model_key === "ensemble",
    description: FALLBACK_MODELS[model.model_key]?.description || "",
    thresholds: [
      {
        label: "Youden's J threshold",
        value: Number(model.threshold || 0).toFixed(3),
        sens: `${(Number(model.sensitivity || 0) * 100).toFixed(1)}%`,
        spec: `${(Number(model.specificity || 0) * 100).toFixed(1)}%`,
        active: model.model_key === "ensemble",
      },
    ],
  };
}

function MetricCard({ label, value, sub, color, highlight }) {
  return (
    <div className={`border rounded-xl p-4 ${highlight ? "bg-pos/10 border-pos/20" : "bg-surface2 border-white/7"}`}>
      <div className="text-xs text-text3 uppercase tracking-wider mb-2">{label}</div>
      <div className={`text-2xl font-bold font-mono mb-1 ${color || "text-text1"}`}>{value}</div>
      {sub && <div className="text-xs text-text3 leading-relaxed">{sub}</div>}
    </div>
  );
}

function GlossaryItem({ term, def }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-white/7 py-3 last:border-0">
      <div
        onClick={() => setOpen(!open)}
        className="flex items-center justify-between cursor-pointer"
      >
        <span className="text-sm font-semibold text-text1">{term}</span>
        <span className={`text-text3 text-sm transition-transform ${open ? "rotate-180" : ""}`}>▾</span>
      </div>
      {open && (
        <div className="text-sm text-text2 leading-relaxed mt-3">{def}</div>
      )}
    </div>
  );
}

function ModelPerformance() {
  const [activeTab, setActiveTab] = useState("ensemble");
  const [models, setModels] = useState(FALLBACK_MODELS);
  const [performanceInfo, setPerformanceInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    let isMounted = true;

    async function loadPerformance() {
      try {
        const response = await API.get("/models/performance");

        const nextModels = { ...FALLBACK_MODELS };

        response.data.models.forEach(model => {
          nextModels[model.model_key] = mapApiModelToUiModel(model);
        });

        if (isMounted) {
          setModels(nextModels);
          setPerformanceInfo(response.data);
          setLoadError("");
        }
      } catch (err) {
        console.error("Failed to load model performance:", err);

        if (isMounted) {
          setLoadError("Using fallback model performance values.");
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    loadPerformance();

    return () => {
      isMounted = false;
    };
  }, []);

  const m = models[activeTab] || FALLBACK_MODELS[activeTab];
  const isEns = activeTab === "ensemble";

  return (
    <Layout title="Model Performance">
      <div className="rounded-xl border border-warn/30 bg-warn/5 p-4 text-sm text-text2 leading-relaxed mb-5">
        <span className="font-semibold text-text1">Test-set only:</span>{" "}
        {performanceInfo?.disclaimer ||
          "These metrics are based on a held-out test set and do not represent live clinical performance."}
        {loading && <span className="ml-2 text-text3">Loading latest metrics...</span>}
        {loadError && <span className="ml-2 text-warn">{loadError}</span>}
      </div>
      {/* OVERVIEW TABLE */}
      <div className="bg-surface border border-white/7 rounded-xl overflow-hidden mb-5">
        <div className="px-5 py-3.5 border-b border-white/7">
          <div className="text-sm font-semibold text-text1">AI Model Performance Overview</div>
          <div className="text-xs text-text3 mt-0.5">
            Evaluated on 415 held-out test images · Higher AUC and sensitivity indicate stronger test-set screening performance
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-white/7">
                {["Model", "AUC", "Sensitivity", "Specificity", "F1 Score", "Best Use"].map(h => (
                  <th key={h} className="px-5 py-2.5 text-left text-xs font-semibold text-text3 uppercase tracking-wider bg-white/[0.02]">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {MODEL_KEYS.map(key => {
                const ms = models[key] || FALLBACK_MODELS[key];
                const ens = key === "ensemble";
                return (
                  <tr key={key} className={`border-b border-white/[0.04] cursor-pointer hover:bg-white/[0.02] ${ens ? "bg-pos/[0.05]" : ""}`}
                    onClick={() => setActiveTab(key)}>
                    <td className="px-5 py-3">
                      <span className={`text-sm font-semibold flex items-center gap-2 ${ens ? "text-pos" : "text-text1"}`}>
                        {ms.label}
                        {ens && <span className="text-xs px-2 py-0.5 rounded-full bg-pos/20 text-pos">ACTIVE</span>}
                      </span>
                    </td>
                    <td className={`px-5 py-3 font-mono text-sm font-semibold ${ens ? "text-pos" : "text-text1"}`}>{ms.auc.toFixed(4)}</td>
                    <td className={`px-5 py-3 font-mono text-sm ${ens ? "text-pos font-semibold" : "text-text1"}`}>{formatPercent(ms.sensitivity)}</td>
                    <td className={`px-5 py-3 font-mono text-sm ${ens ? "text-pos font-semibold" : "text-text1"}`}>{formatPercent(ms.specificity)}</td>
                    <td className={`px-5 py-3 font-mono text-sm ${ens ? "text-pos font-semibold" : "text-text1"}`}>{formatNumber(ms.f1)}</td>
                    <td className={`px-5 py-3 text-xs ${ens ? "text-pos font-medium" : "text-text3"}`}>{ms.bestFor}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="px-5 py-3 bg-surface2 border-t border-white/7 border-l-2 border-l-text3">
            <p className="text-xs text-text3 leading-relaxed">
              All models are shown at their Youden threshold, which balances sensitivity and specificity.
              Ensemble combines predictions from all three models and is used as the clinical reference model.
              These figures are from the held-out test set, not live clinical performance.
            </p>
        </div>
      </div>

      {/* MODEL TABS */}
      <div className="flex gap-1 mb-4 bg-surface border border-white/7 rounded-xl p-1 w-fit">
        {MODEL_KEYS.map(key => (
          <div 
            key={key} 
            onClick={() => setActiveTab(key)}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-all flex items-center gap-1.5 ${
              activeTab === key ? "bg-surface3 text-text1" : "text-text2 hover:text-text1"
            }`}>
            {key === "ensemble" && <span className="text-pos">★</span>}
            {(models[key] || FALLBACK_MODELS[key]).label}            
          </div>
        ))}
      </div>

      {/* MODEL DETAIL */}
      <div className="flex flex-col gap-4">

        {/* Description */}
        <div className={`bg-surface border rounded-xl overflow-hidden ${isEns ? "border-pos/30" : "border-white/7"}`}>
          <div className={`px-5 py-3.5 border-b flex items-center gap-3 ${isEns ? "border-pos/15" : "border-white/7"}`}>
            <span className={`text-sm font-semibold flex-1 ${isEns ? "text-pos" : "text-text1"}`}>
              What is {m.label}?
            </span>
            <span className="text-xs text-text3">Plain language explanation</span>
            {m.isActive && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-pos/20 text-pos border border-pos/20 font-semibold">
                Currently Active
              </span>
            )}
          </div>
          <div className="p-5 text-sm text-text2 leading-relaxed">{m.description}</div>
        </div>

        {/* 6 Metric Cards */}
        <div className="grid grid-cols-3 gap-3">
          <MetricCard label="AUC" value={m.auc.toFixed(4)}
            sub="Ability to distinguish glaucoma-sign from no-glaucoma-sign cases. Above 0.90 = excellent."
            color={isEns ? "text-pos" : "text-accent2"} highlight={isEns} />
          <MetricCard label="Sensitivity" value={formatPercent(m.sensitivity)}
            sub="Glaucoma-sign cases correctly detected. Priority metric for screening."
            color="text-pos" highlight={isEns} />
          <MetricCard label="Specificity" value={formatPercent(m.specificity)}
            sub="No-glaucoma-sign cases correctly cleared. High = fewer unnecessary referrals."
            color={isEns ? "text-pos" : "text-accent2"} highlight={isEns} />
          <MetricCard label="F1 Score" value={formatNumber(m.f1)}
            sub="Balance of precision and sensitivity. Closer to 1.0 = better balance."
            color={isEns ? "text-pos" : "text-warn"} highlight={isEns} />
          <MetricCard label="NPV" value={formatPercent(m.npv)}
            sub="Confidence when no glaucoma signs are predicted. High NPV supports screening reassurance."
            color="text-pos" highlight={isEns} />
          <MetricCard label="Accuracy" value={formatPercent(m.accuracy)}
            sub="Overall correct predictions across all 415 test images."
            color={isEns ? "text-pos" : "text-accent2"} highlight={isEns} />
        </div>

        {/* Test Set Confusion Matrix */}
        <div className={`bg-surface border rounded-xl overflow-hidden ${isEns ? "border-pos/25" : "border-white/7"}`}>
          <div className="px-5 py-3.5 border-b border-white/7 flex items-center gap-3">
            <span className="text-sm font-semibold text-text1 flex-1">Test Set Confusion Matrix</span>
            <span className="text-xs text-text3">415 images · 123 glaucoma-sign · 292 no-glaucoma-sign</span>
          </div>
          <div className="p-5">
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="bg-pos/10 border border-pos/30 rounded-xl p-4 text-center">
                <div className="text-4xl font-bold font-mono text-pos leading-tight mb-1">{m.tp}</div>
                <div className="text-sm font-semibold text-pos mb-1">True Positives</div>
                <div className="text-xs text-text3">Glaucoma signs correctly detected</div>
              </div>
              <div className="bg-accent/[0.08] border border-accent/25 rounded-xl p-4 text-center">
                <div className="text-4xl font-bold font-mono text-accent leading-tight mb-1">{m.tn}</div>
                <div className="text-sm font-semibold text-accent mb-1">True Negatives</div>
                <div className="text-xs text-text3">No-glaucoma-sign cases correctly cleared</div>
              </div>
              <div className="bg-neg/10 border-2 border-neg/40 rounded-xl p-4 text-center">
                <div className="text-4xl font-bold font-mono text-neg leading-tight mb-1">{m.fn}</div>
                <div className="text-sm font-semibold text-neg mb-1">False Negatives ⚠</div>
                <div className="text-xs text-text3">Glaucoma-sign cases missed</div>
              </div>
              <div className="bg-warn/[0.08] border border-warn/30 rounded-xl p-4 text-center">
                <div className="text-4xl font-bold font-mono text-warn leading-tight mb-1">{m.fp}</div>
                <div className="text-sm font-semibold text-warn mb-1">False Positives</div>
                <div className="text-xs text-text3">No-glaucoma-sign cases flagged</div>
              </div>
            </div>
            <div className="px-4 py-3 bg-neg/10 border border-neg/20 rounded-lg text-sm text-text2 leading-relaxed">
              ⚠ False negatives, or missed glaucoma-sign cases, are the most clinically significant errors.
              This page shows held-out test-set results. These figures support model evaluation but do not represent live clinical performance.
            </div>
          </div>
        </div>

        {/* Decision Threshold */}
        <div className="bg-surface border border-white/7 rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-white/7">
            <span className="text-sm font-semibold text-text1">How the decision threshold works</span>
          </div>
          <div className="p-5">
            <div className="px-4 py-3 bg-accent/10 border border-accent/20 rounded-lg text-sm text-text2 leading-relaxed mb-4">
              The threshold is the confidence cutoff. If the model outputs a probability above this number,
              it flags possible glaucoma signs. A lower threshold catches more cases but may also raise
              more false alarms. This page shows each model at its Youden threshold, which balances
              sensitivity and specificity on the held-out test set.
            </div>
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-white/7">
                  {["Threshold Type", "Value", "Sensitivity", "Specificity"].map(h => (
                    <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold text-text3 uppercase tracking-wider bg-white/[0.02]">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {m.thresholds.map((t, i) => (
                  <tr key={i} className={`border-b border-white/[0.04] ${
                    t.active ? isEns ? "bg-pos/10" : "bg-accent/10" : ""
                  }`}>
                    <td className={`px-4 py-3 text-sm font-medium ${t.active ? isEns ? "text-pos" : "text-accent2" : "text-text1"}`}>
                      {t.label}
                    </td>
                    <td className={`px-4 py-3 font-mono text-sm ${t.active ? isEns ? "text-pos" : "text-accent2" : "text-text1"}`}>
                      {t.value}
                    </td>
                    <td className={`px-4 py-3 text-sm font-semibold ${t.active ? "text-pos" : "text-text3"}`}>
                      {t.sens}
                    </td>
                    <td className={`px-4 py-3 text-sm ${t.active ? "text-text2" : "text-text3"}`}>
                      {t.spec}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

      </div>

      {/* GRAD-CAM GUIDE */}
      <div className="bg-surface border border-white/7 rounded-xl overflow-hidden mt-5">
        <div className="px-5 py-3.5 border-b border-white/7 flex items-center gap-3">
          <span className="text-sm font-semibold text-text1 flex-1">How to read the AI explanation heatmap</span>
          <span className="text-xs text-text3">Grad-CAM++ · Applies to all models</span>
        </div>
        <div className="p-5">
          <div className="h-4 rounded-full mb-2" style={{
            background: "linear-gradient(to right,#0000FF,#00CCFF,#00FF88,#FFFF00,#FF8800,#FF0000)"
          }} />
          <div className="flex justify-between text-xs text-text3 mb-5">
            <span>Low activation — model did not focus here</span>
            <span>High activation — model focused here</span>
          </div>
          <div className="grid grid-cols-2 gap-5">
            <div>
              <div className="text-xs font-semibold text-accent2 uppercase tracking-wider mb-2">
                What good looks like (glaucoma detected)
              </div>
              <div className="text-sm text-text2 leading-relaxed">
                When the model detects glaucoma, red and yellow regions should appear over the optic disc
                and cup area — the bright circular region visible in the centre of the fundus image.
                This confirms the AI is looking at the same clinical features a human ophthalmologist would examine.
              </div>
            </div>
            <div>
              <div className="text-xs font-semibold text-accent2 uppercase tracking-wider mb-2">
                Clinical significance
              </div>
              <div className="text-sm text-text2 leading-relaxed">
                If red or yellow appears in random locations unrelated to the optic disc, the prediction
                should be treated with more caution. The ensemble heatmap (average of all three models)
                is the most reliable — it shows only regions where all three models independently agreed.
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* TRAINING SUMMARY */}
      <div className="bg-surface border border-white/7 rounded-xl overflow-hidden mt-4">
        <div className="px-5 py-3.5 border-b border-white/7 flex items-center gap-3">
          <span className="text-sm font-semibold text-text1 flex-1">Training Summary</span>
          <span className="text-xs text-text3">How the models were built and validated</span>
        </div>
        <div className="p-5 grid grid-cols-2 gap-3">
          {[
            {
              label: "Datasets",
              value: "6 public datasets: ORIGA, PAPILA, REFUGE, RIM-ONE DL, ACRIMA, G1020. Total 4,148 fundus images. 1,227 glaucoma (29.6%), 2,921 normal (70.4%).",
            },
            {
              label: "Data Split",
              value: "75% training (3,110 images), 15% validation (623 images), 10% test (415 images). Stratified split ensures equal class distribution.",
            },
            {
              label: "Preprocessing",
              value: "CLAHE contrast enhancement applied to all images. Backbone-specific normalisation per model. Class weights applied to handle 1:2.4 glaucoma-to-normal imbalance.",
            },
            {
              label: "Statistical Validation",
              value: "McNemar's test (mid-p method) was used to compare paired model predictions on the held-out test set. Reference: Fagerland et al. 2013, BMC Medical Research Methodology.",
            },
          ].map(item => (
            <div key={item.label} className="bg-surface2 border border-white/12 rounded-xl p-4">
              <div className="text-xs font-semibold text-accent2 uppercase tracking-wider mb-2">{item.label}</div>
              <div className="text-sm text-text2 leading-relaxed">{item.value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* GLOSSARY */}
      <div className="bg-surface border border-white/7 rounded-xl overflow-hidden mt-4 mb-4">
        <div className="px-5 py-3.5 border-b border-white/7 flex items-center gap-3">
          <span className="text-sm font-semibold text-text1 flex-1">Glossary — Key Terms</span>
          <span className="text-xs text-text3">Plain language definitions for clinical staff</span>
        </div>
        <div className="px-5">
          {GLOSSARY.map(item => (
            <GlossaryItem key={item.term} term={item.term} def={item.def} />
          ))}
        </div>
      </div>

    </Layout>
  );
}

export default ModelPerformance;
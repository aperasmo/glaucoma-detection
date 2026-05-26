// src/pages/ModelPerformance.jsx
// Model Performance page - Tailwind CSS implementation.
// Matches mock UI pg-models exactly.
// Static data from evaluation_results.json - no API calls needed.

import { useState } from "react";
import Layout from "../components/Layout";

const MODELS = {
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
      { label: "Sensitivity-first ★ used clinically", value: "0.52", sens: "85.4%", spec: "~76%", active: true },
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
      { label: "Sensitivity-first ★ used clinically", value: "0.47", sens: "85.4%", spec: "~79%", active: true },
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
      { label: "Sensitivity-first ★ used clinically", value: "0.47", sens: "85.4%", spec: "~74%", active: true },
    ],
  },
  ensemble: {
    label: "Ensemble",
    auc: 0.9270, sensitivity: 85.4, specificity: 79.8,
    f1: 0.732, npv: 92.8, accuracy: 81.5,
    tp: 105, tn: 233, fp: 59, fn: 18,
    bestFor: "Best overall — used for all predictions",
    isActive: true,
    description: "The system combines predictions from all three models by averaging their probability scores. Where all three models agree a case is glaucoma, confidence is highest. This approach consistently outperforms any individual model and is what the system uses for all clinical predictions. AUC of 0.9270 means the system has a 92.7% chance of ranking a true glaucoma case higher than a normal case.",
    thresholds: [
      { label: "Default (0.5)", value: "0.50", sens: "Lower", spec: "Higher", active: false },
      { label: "Youden's J (optimal balance)", value: "0.516", sens: "~87%", spec: "~80%", active: false },
      { label: "Sensitivity-first ★ used clinically", value: "0.50", sens: "85.4%", spec: "~80%", active: true },
    ],
  },
};

const MODEL_KEYS = ["efficientnetb0", "vgg16", "efficientnetv2", "ensemble"];

const GLOSSARY = [
  { term: "AUC — Area Under the Curve", def: "Measures how well the model separates glaucoma from normal eyes. Score of 1.0 = perfect, 0.5 = random guessing. Above 0.90 is considered excellent for medical AI screening." },
  { term: "Sensitivity (Recall)", def: "Out of all real glaucoma cases, how many did the model catch? The most important metric for a screening tool — missing glaucoma is more dangerous than a false alarm." },
  { term: "Specificity", def: "Out of all normal eyes, how many did the model correctly clear? High specificity means fewer patients are sent for unnecessary follow-up examinations." },
  { term: "F1 Score", def: "A single number balancing precision (when it says glaucoma, how often is it right?) and sensitivity. Range 0 to 1, higher is better." },
  { term: "NPV — Negative Predictive Value", def: "When the model says normal — how confident can we be? NPV of 92.5% means if the system clears a patient, there is a 92.5% chance they truly do not have glaucoma." },
  { term: "Ensemble", def: "Combines predictions from multiple models by averaging their probability scores. More reliable than any single model alone." },
  { term: "Grad-CAM++", def: "Gradient-weighted Class Activation Mapping Plus Plus. Generates a visual heatmap showing which regions of the eye image the AI focused on when making its prediction. Essential for clinical transparency and trust." },
  { term: "Youden's J Threshold", def: "The mathematically optimal decision threshold that maximises the balance between sensitivity and specificity. Named after statistician William J. Youden." },
  { term: "McNemar's Test", def: "A statistical test that confirms whether performance differences between models are real or just by chance. p<0.05 means the difference is statistically significant." },
];

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
  const [activeTab, setActiveTab] = useState("efficientnetb0");
  const m = MODELS[activeTab];
  const isEns = activeTab === "ensemble";

  return (
    <Layout title="Model Performance">

      {/* OVERVIEW TABLE */}
      <div className="bg-surface border border-white/7 rounded-xl overflow-hidden mb-5">
        <div className="px-5 py-3.5 border-b border-white/7">
          <div className="text-sm font-semibold text-text1">AI Model Performance Overview</div>
          <div className="text-xs text-text3 mt-0.5">
            Evaluated on 415 unseen fundus images · Higher AUC and Sensitivity = better clinical performance
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-white/7">
                {["Model", "AUC", "Sensitivity", "Specificity", "F1 Score", "Best For"].map(h => (
                  <th key={h} className="px-5 py-2.5 text-left text-xs font-semibold text-text3 uppercase tracking-wider bg-white/[0.02]">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {MODEL_KEYS.map(key => {
                const md = MODELS[key];
                const ens = key === "ensemble";
                return (
                  <tr key={key} className={`border-b border-white/[0.04] cursor-pointer hover:bg-white/[0.02] ${ens ? "bg-pos/[0.05]" : ""}`}
                    onClick={() => setActiveTab(key)}>
                    <td className="px-5 py-3">
                      <span className={`text-sm font-semibold flex items-center gap-2 ${ens ? "text-pos" : "text-text1"}`}>
                        {md.label}
                        {ens && <span className="text-xs px-2 py-0.5 rounded-full bg-pos/20 text-pos">ACTIVE</span>}
                      </span>
                    </td>
                    <td className={`px-5 py-3 font-mono text-sm font-semibold ${ens ? "text-pos" : "text-text1"}`}>{md.auc.toFixed(4)}</td>
                    <td className={`px-5 py-3 font-mono text-sm ${ens ? "text-pos font-semibold" : "text-text1"}`}>{md.sensitivity}%</td>
                    <td className={`px-5 py-3 font-mono text-sm ${ens ? "text-pos font-semibold" : "text-text1"}`}>{md.specificity}%</td>
                    <td className={`px-5 py-3 font-mono text-sm ${ens ? "text-pos font-semibold" : "text-text1"}`}>{md.f1.toFixed(3)}</td>
                    <td className={`px-5 py-3 text-xs ${ens ? "text-pos font-medium" : "text-text3"}`}>{md.bestFor}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="px-5 py-3 bg-surface2 border-t border-white/7 border-l-2 border-l-text3">
          <p className="text-xs text-text3 leading-relaxed">
            All models evaluated at sensitivity-first threshold (≥85.4% sensitivity). Ensemble combines predictions from all three models.
            Statistical significance confirmed by McNemar's test (p&lt;0.05 for all model pairs).
          </p>
        </div>
      </div>

      {/* MODEL TABS */}
      <div className="flex gap-1 mb-4 bg-surface border border-white/7 rounded-xl p-1 w-fit">
        {MODEL_KEYS.map(key => (
          <div key={key} onClick={() => setActiveTab(key)}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-all flex items-center gap-1.5 ${
              activeTab === key ? "bg-surface3 text-text1" : "text-text2 hover:text-text1"
            }`}>
            {key === "ensemble" && <span className="text-pos">★</span>}
            {MODELS[key].label}
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
            sub="Ability to distinguish glaucoma from normal. Above 0.90 = excellent."
            color={isEns ? "text-pos" : "text-accent2"} highlight={isEns} />
          <MetricCard label="Sensitivity" value={`${m.sensitivity}%`}
            sub="Glaucoma cases correctly detected. Priority metric for screening."
            color="text-pos" highlight={isEns} />
          <MetricCard label="Specificity" value={`${m.specificity}%`}
            sub="Normal eyes correctly cleared. High = fewer unnecessary referrals."
            color={isEns ? "text-pos" : "text-accent2"} highlight={isEns} />
          <MetricCard label="F1 Score" value={m.f1.toFixed(3)}
            sub="Balance of precision and sensitivity. Closer to 1.0 = better balance."
            color={isEns ? "text-pos" : "text-warn"} highlight={isEns} />
          <MetricCard label="NPV" value={`${m.npv}%`}
            sub="Confidence when result is normal. High NPV = safe to clear patients."
            color="text-pos" highlight={isEns} />
          <MetricCard label="Accuracy" value={`${m.accuracy}%`}
            sub="Overall correct predictions across all 415 test images."
            color={isEns ? "text-pos" : "text-accent2"} highlight={isEns} />
        </div>

        {/* Test Results Breakdown */}
        <div className={`bg-surface border rounded-xl overflow-hidden ${isEns ? "border-pos/25" : "border-white/7"}`}>
          <div className="px-5 py-3.5 border-b border-white/7 flex items-center gap-3">
            <span className="text-sm font-semibold text-text1 flex-1">Test Results Breakdown</span>
            <span className="text-xs text-text3">415 images · 123 glaucoma · 292 normal</span>
          </div>
          <div className="p-5">
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="bg-pos/10 border border-pos/30 rounded-xl p-4 text-center">
                <div className="text-4xl font-bold font-mono text-pos leading-tight mb-1">{m.tp}</div>
                <div className="text-sm font-semibold text-pos mb-1">True Positives</div>
                <div className="text-xs text-text3">Glaucoma correctly detected</div>
              </div>
              <div className="bg-accent/[0.08] border border-accent/25 rounded-xl p-4 text-center">
                <div className="text-4xl font-bold font-mono text-accent leading-tight mb-1">{m.tn}</div>
                <div className="text-sm font-semibold text-accent mb-1">True Negatives</div>
                <div className="text-xs text-text3">Normal eyes correctly cleared</div>
              </div>
              <div className="bg-neg/10 border-2 border-neg/40 rounded-xl p-4 text-center">
                <div className="text-4xl font-bold font-mono text-neg leading-tight mb-1">{m.fn}</div>
                <div className="text-sm font-semibold text-neg mb-1">False Negatives ⚠</div>
                <div className="text-xs text-text3">Glaucoma missed — most dangerous</div>
              </div>
              <div className="bg-warn/[0.08] border border-warn/30 rounded-xl p-4 text-center">
                <div className="text-4xl font-bold font-mono text-warn leading-tight mb-1">{m.fp}</div>
                <div className="text-sm font-semibold text-warn mb-1">False Positives</div>
                <div className="text-xs text-text3">Normal flagged as glaucoma</div>
              </div>
            </div>
            <div className="px-4 py-3 bg-neg/10 border border-neg/20 rounded-lg text-sm text-text2 leading-relaxed">
              ⚠ False Negatives (missed glaucoma cases) are the most clinically significant errors.
              All models are tuned to keep this number at 18 or below, prioritising patient safety over reducing false alarms.
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
              it flags the eye as glaucoma. A lower threshold catches more cases (higher sensitivity) but
              also raises more false alarms. We use a sensitivity-first threshold that guarantees at least
              85.4% of glaucoma cases are caught, accepting some unnecessary referrals to ensure no serious
              cases are missed.
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
              value: "McNemar's test (mid-p method) confirmed all performance differences are statistically significant (p<0.05). Reference: Fagerland et al. 2013, BMC Medical Research Methodology.",
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
// frontend/src/components/screening-results/ModelPerformanceReference.jsx
// Compact held-out test-set model performance reference for Screening Result.
// This component does not use live patient outcomes.
// It only displays frozen evaluation metrics returned by /models/performance.

import { useEffect, useMemo, useState } from "react";
import API from "../../api";

const MODEL_LABELS = {
  efficientnetb0: "EfficientNetB0",
  vgg16: "VGG16",
  efficientnetv2: "EfficientNetV2",
  ensemble: "Ensemble",
};

function formatPercent(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "N/A";
  }

  return `${(Number(value) * 100).toFixed(2)}%`;
}

function formatDecimal(value, digits = 4) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "N/A";
  }

  return Number(value).toFixed(digits);
}

function MetricBox({ label, value, tooltip = "" }) {
  return (
    <div
      className="bg-surface2 rounded-lg p-3 border border-white/7"
      title={tooltip}
    >
      <div className="text-xs text-text3 mb-1 flex items-center gap-1">
        {label}

        {tooltip && (
          <span className="text-[10px] text-text3 cursor-help">ⓘ</span>
        )}
      </div>

      <div className="text-sm font-semibold font-mono text-text1">
        {value}
      </div>
    </div>
  );
}

function MatrixCell({ label, value, tone = "neutral" }) {
  const toneClass =
    tone === "good"
      ? "text-pos"
      : tone === "warn"
        ? "text-warn"
        : tone === "bad"
          ? "text-neg"
          : "text-text1";

  return (
    <div className="bg-surface2 rounded-lg p-3 border border-white/7 min-h-[72px]">
      <div className="text-xs text-text3 mb-1">{label}</div>
      <div className={`text-xl font-bold font-mono ${toneClass}`}>
        {value ?? "N/A"}
      </div>
    </div>
  );
}

function ModelPerformanceReference({ modelKey = "ensemble" }) {
  const [performanceData, setPerformanceData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState("");

  useEffect(() => {
    let isMounted = true;

    async function loadPerformance() {
      try {
        setLoading(true);
        setErrorText("");

        const response = await API.get("/models/performance");

        if (isMounted) {
          setPerformanceData(response.data);
        }
      } catch (error) {
        console.error("Unable to load model performance reference:", error);

        if (isMounted) {
          setErrorText("Model performance reference is not available.");
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

  const selectedModel = useMemo(() => {
    const models = performanceData?.models || [];

    return (
      models.find(item => item.model_key === modelKey) ||
      performanceData?.primary_result ||
      null
    );
  }, [performanceData, modelKey]);

  const modelLabel =
    selectedModel?.model_name ||
    MODEL_LABELS[modelKey] ||
    "Selected model";

  if (loading) {
    return (
      <div className="bg-surface border border-white/7 rounded-xl overflow-hidden mt-4">
        <div className="px-5 py-3.5 border-b border-white/7">
          <span className="text-sm font-semibold text-text1">
            Model Performance Reference
          </span>
        </div>

        <div className="p-4 text-sm text-text3">
          Loading held-out test-set metrics...
        </div>
      </div>
    );
  }

  if (errorText || !selectedModel) {
    return (
      <div className="bg-surface border border-white/7 rounded-xl overflow-hidden mt-4">
        <div className="px-5 py-3.5 border-b border-white/7">
          <span className="text-sm font-semibold text-text1">
            Model Performance Reference
          </span>
        </div>

        <div className="p-4 text-sm text-text3">
          {errorText || "Model performance reference is not available."}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-surface border border-white/7 rounded-xl overflow-hidden mt-4">
      <div className="px-5 py-3.5 border-b border-white/7 flex items-start justify-between gap-3">
        <div>
          <span className="text-sm font-semibold text-text1">
            Model Performance Reference
          </span>

          <p className="text-xs text-text3 mt-1">
            Held-out test-set metrics for {modelLabel}. These values do not
            represent live clinical performance for this patient.
          </p>
        </div>

        <span className="text-[10px] px-2 py-0.5 rounded-full bg-warn/10 text-warn border border-warn/20 whitespace-nowrap">
          Test-set only
        </span>
      </div>

      <div className="p-4">
        <div className="grid grid-cols-5 gap-3">
          <MetricBox label="AUC" value={formatPercent(selectedModel.auc)} />
          <MetricBox label="Sensitivity" value={formatPercent(selectedModel.sensitivity)} />
          <MetricBox label="Specificity" value={formatPercent(selectedModel.specificity)} />
          <MetricBox label="NPV" value={formatPercent(selectedModel.npv)} />
          <MetricBox label="Youden Threshold" value={formatPercent(selectedModel.threshold)} 
            tooltip="Threshold selected during held-out test-set evaluation using Youden's J statistic.
            It may differ from the threshold used for this saved screening result."
          />
            

        </div>

        <div className="mt-4">
          <div className="flex items-center justify-between gap-3 mb-2">
            <div>
              <div className="text-xs font-semibold text-text1">
                Confusion Matrix
              </div>
              <div className="text-xs text-text3 mt-0.5">
                Out of {selectedModel.tp + selectedModel.fn} (TP+FN) glaucoma-sign test images, the Ensemble caught {selectedModel.tp} and missed {selectedModel.fn}.
                
              </div>
              <div className="text-xs text-text3 mt-0.5">
                Out of {selectedModel.fp + selectedModel.tn} (FP+TN) no-glaucoma-sign test images, it correctly cleared {selectedModel.tn} and incorrectly flagged {selectedModel.fp}.
              </div>
            </div>

            <div className="text-xs text-text3">
              {performanceData?.dataset_label || "Held-out test set"}
              {performanceData?.test_size ? `, n=${performanceData.test_size}` : ""}
            </div>
          </div>

          <div className="grid grid-cols-[160px_1fr_1fr] gap-2 text-xs">
            <div className="bg-surface3 rounded-lg p-3 border border-white/7 text-text3">
              Actual / Predicted
            </div>
            <div className="bg-surface3 rounded-lg p-3 border border-white/7 text-text1 font-semibold text-center">
              Glaucoma signs
            </div>
            <div className="bg-surface3 rounded-lg p-3 border border-white/7 text-text1 font-semibold text-center">
              No glaucoma signs
            </div>

            <div className="bg-surface3 rounded-lg p-3 border border-white/7 text-text1 font-semibold">
              Glaucoma-sign cases
            </div>
            <MatrixCell label="True Positive" value={selectedModel.tp} tone="good" />
            <MatrixCell label="False Negative" value={selectedModel.fn} tone="bad" />

            <div className="bg-surface3 rounded-lg p-3 border border-white/7 text-text1 font-semibold">
              No-glaucoma-sign cases
            </div>
            <MatrixCell label="False Positive" value={selectedModel.fp} tone="warn" />
            <MatrixCell label="True Negative" value={selectedModel.tn} tone="good" />
          </div>
        </div>

        <div className="mt-4 text-xs text-text3 leading-relaxed bg-surface2 border border-white/7 rounded-lg p-3">
          This is test-set model performance, not a live result for this patient.
          Live performance tracking requires clinician-confirmed ground truth for
          screened patients.
        </div>
      </div>
    </div>
  );
}

export default ModelPerformanceReference;
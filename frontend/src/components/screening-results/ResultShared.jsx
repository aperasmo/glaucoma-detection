// frontend/src/components/screening-results/ResultShared.jsx
// Shared helpers and presentational components for Screening Result views.

export const BACKEND = import.meta.env.VITE_API_URL || "http://localhost:8000";

export const MODEL_OPTIONS = [
  { key: "efficientnetb0", label: "EfficientNetB0" },
  { key: "vgg16", label: "VGG16" },
  { key: "efficientnetv2", label: "EfficientNetV2" },
  { key: "ensemble", label: "Ensemble", clinical: true },
];

export const LLM_OPTIONS = [
  { key: "gpt4o", label: "GPT-4o", dot: "#10a37f" },
  { key: "gpt4o_mini", label: "GPT-4o Mini", dot: "#10a37f" },
  { key: "llama", label: "GPT-OSS 120B", dot: "#ff6b35" },
  { key: "gemini", label: "Gemini", dot: "#4285f4" },
];

export function normaliseSignatoryText(value) {
  const text = String(value || "").trim();

  if (!text) return "";

  if (!text.includes("\n") && text.includes(",")) {
    const [name, ...titleParts] = text.split(",");
    const title = titleParts.join(",").trim();

    return title ? `${name.trim()}\n${title}` : name.trim();
  }

  return text;
}

export function formatDate(value) {
  if (!value) return "-";

  // Backend datetime values are stored as UTC but may arrive without "Z".
  // If no timezone is included, append "Z" so JavaScript treats it as UTC,
  // then convert to New Zealand time for display.
  const valueText = String(value);
  const hasTimezone =
    valueText.endsWith("Z") ||
    /[+-]\d{2}:\d{2}$/.test(valueText);

  const normalizedValue = hasTimezone ? valueText : `${valueText}Z`;

  return new Date(normalizedValue).toLocaleDateString("en-NZ", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Pacific/Auckland",
  });
}

export function formatDob(value) {
  if (!value) return "-";

  return new Date(value).toLocaleDateString("en-NZ", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Pacific/Auckland",
  });
}

export function formatPercent(value) {
  const number = Number(value || 0);
  return `${(number * 100).toFixed(1)}%`;
}

export function titleCase(value) {
  if (!value) return "—";

  return String(value).charAt(0).toUpperCase() + String(value).slice(1);
}

export function getClinicalResult(results) {
  return (
    results?.find(item => item.model_used === "ensemble" && item.llm_used === null) ||
    results?.find(item => item.llm_used === null) ||
    results?.[0] ||
    null
  );
}

export function getModelResult(results, modelKey) {
  return results?.find(item => item.model_used === modelKey && item.llm_used === null) || null;
}

export function getReferralResult(results, llmKey) {
  return results?.find(item => item.referral_letter != null && item.llm_used === llmKey) || null;
}

export function getGradcamUrl(data, result) {
  if (!data || !result) return null;

  if (result.gradcam_path) {
    return `${BACKEND}/${String(result.gradcam_path).replace(/\\/g, "/")}`;
  }

  return `${BACKEND}/uploads/gradcam/${data.screening_id}_${result.model_used}_gradcam.png`;
}

export function getScreeningPredictionLabel(prediction) {
  return prediction?.toLowerCase() === "glaucoma"
    ? "Possible glaucoma signs detected"
    : "No glaucoma signs detected";
}

export function PredictionBadge({ prediction, hasDisagreement = false }) {
  const isGlaucoma = prediction?.toLowerCase() === "glaucoma";
  // Amber badge when normal but model disagreement detected.
  // hasDisagreement is only passed from Clinical Mode - Research Mode is unaffected.
  const isDisagreement = !isGlaucoma && hasDisagreement;

  const badgeClass = isGlaucoma
    ? "bg-neg/10 text-neg border-neg/30"
    : isDisagreement
      ? "bg-warn/10 text-warn border-warn/30"
      : "bg-pos/10 text-pos border-pos/30";

  const label = isGlaucoma
    ? "Possible glaucoma signs detected"
    : isDisagreement
      ? "No glaucoma signs detected — model disagreement detected"
      : "No glaucoma signs detected";

  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-semibold border ${badgeClass}`}>
      <span className="w-2 h-2 rounded-full bg-current" />
      {label}
    </span>
  );
}

export function OHTSTierBadge({ tier }) {
  const map = {
    critical: "bg-neg/10 text-neg border-neg/20",
    possible: "bg-warn/10 text-warn border-warn/20",
    low: "bg-pos/10 text-pos border-pos/20",
  };

  const labels = {
    critical: "Critical - High Risk",
    possible: "Possible in 5 Years",
    low: "Low Risk",
  };

  const cls = map[tier?.toLowerCase()] || map.low;

  return (
    <span
      className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold border ${cls}`}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-current" />
      {labels[tier?.toLowerCase()] || "Low Risk"}
    </span>
  );
}

export function InfoRow({ label, value, valueClass }) {
  return (
    <div className="flex justify-between gap-3 text-sm mb-2 pb-2 border-b border-white/7">
      <span className="text-text3">{label}</span>
      <span className={valueClass || "text-text1 font-medium text-right"}>
        {value || "—"}
      </span>
    </div>
  );
}

export function ScreeningContext({ data, clinicalResult, modeLabel }) {
  const isResearch = modeLabel === "research";

  return (
    <div className="bg-surface border border-white/7 rounded-xl overflow-hidden mb-4">
      <div className="px-5 py-3.5 border-b border-white/7 flex items-center justify-between gap-3">
        <span className="text-sm font-semibold text-text1">Screening Context</span>
        <span
          className={`text-xs px-2 py-0.5 rounded-full border ${
            isResearch
              ? "bg-warn/10 text-warn border-warn/20"
              : "bg-accent/10 text-accent border-accent/20"
          }`}
        >
          {isResearch ? "Research Mode View" : "Clinical Mode View"}
        </span>
      </div>

      <div className="p-4 grid grid-cols-4 gap-3">
        <InfoRow label="Patient" value={`${data?.patient_name || "—"} (${data?.patient_code || "—"})`} />
        <InfoRow label="DOB" value={formatDob(data?.patient_dob)} />
        <InfoRow label="Gender" value={titleCase(data?.patient_gender)} />
        <InfoRow label="Eye" value={titleCase(data?.eye_side)} />
        <InfoRow label="Date" value={formatDate(data?.created_at)} />
        <InfoRow
          label="Status"
          value={titleCase(data?.status)}
          valueClass={
            data?.status === "complete"
              ? "text-pos font-medium text-right"
              : "text-warn font-medium text-right"
          }
        />
        <InfoRow
          label="Clinical Result"
          value={
            clinicalResult ? (
              <span
                className={`font-medium ${
                  clinicalResult.prediction?.toLowerCase() === "glaucoma"
                    ? "text-neg"
                    : "text-pos"
                }`}
              >
                {getScreeningPredictionLabel(clinicalResult.prediction)}
              </span>
            ) : (
              "—"
            )
          }
        />
        <InfoRow label="Clinical Model" value="Ensemble" />
      </div>
    </div>
  );
}

export function ImagePair({ data, result, selectedModelLabel }) {
  const gradcamUrl = getGradcamUrl(data, result);

  return (
    <div className="grid grid-cols-2 gap-3">
      <div>
        <div className="text-xs text-text3 text-center mb-2 uppercase tracking-wider">
          Original Fundus Image
        </div>
          <div className="rounded-lg overflow-hidden bg-black aspect-[4/3] flex items-center justify-center">
            {data?.image_path ? (
              <img
                src={`${BACKEND}/${data.image_path.replace(/\\/g, "/")}`}
                alt="Fundus"
                className="w-full h-full object-contain block"
              />
            ) : (
              <span className="text-text3 text-xs">Not available</span>
            )}
          </div>
      </div>

      <div>
        <div className="text-xs text-text3 text-center mb-2 uppercase tracking-wider">
          {selectedModelLabel} Grad-CAM++
        </div>
          <div className="rounded-lg overflow-hidden bg-black aspect-[4/3] flex items-center justify-center">
            {gradcamUrl ? (
              <img
                src={gradcamUrl}
                alt={`${selectedModelLabel} Grad-CAM++`}
                className="w-full h-full object-contain block"
                onError={e => {
                  e.currentTarget.style.display = "none";
                  const fallback = e.currentTarget.nextElementSibling;
                  if (fallback) fallback.style.display = "flex";
                }}
              />
            ) : null}
            <div className="hidden flex-col items-center justify-center text-text3 text-xs p-4 w-full h-full">
              <div className="text-2xl mb-2">🔬</div>
              <div>Grad-CAM++ not available</div>
            </div>
          </div>
      </div>
    </div>
  );
}

  export function SelectedModelDetail({ data, result, label, hasDisagreement = false }) {
  const confidence = Number(result?.confidence_score || 0);
  const confidencePct = (confidence * 100).toFixed(1);
  const isGlaucoma = result?.prediction?.toLowerCase() === "glaucoma";

  return (
    <div className="bg-surface border border-white/7 rounded-xl overflow-hidden">
      <div className="px-5 py-3.5 border-b border-white/7 flex items-center justify-between gap-3">
        <div>
          <span className="text-sm font-semibold text-text1">{label} Detail</span>
          {result?.model_used === "ensemble" && (
            <span className="ml-2 text-[10px] px-2 py-0.5 rounded-full bg-accent/10 text-accent border border-accent/20">
              Clinical reference
            </span>
          )}
        </div>
        {result && <PredictionBadge prediction={result.prediction} hasDisagreement={hasDisagreement} />}
      </div>

      <div className="p-4">
        <ImagePair data={data} result={result} selectedModelLabel={label} />

        <div className="grid grid-cols-4 gap-3 mt-4">
          <div className="bg-surface2 rounded-lg p-3 border border-white/7">
            <div className="text-xs text-text3 mb-1">Prediction</div>
            <div className={`text-sm font-semibold ${isGlaucoma ? "text-neg" : "text-pos"}`}>
              {isGlaucoma ? "Possible glaucoma signs detected" : "No glaucoma signs detected"}
            </div>
          </div>

          <div className="bg-surface2 rounded-lg p-3 border border-white/7">
            <div className="text-xs text-text3 mb-1">Confidence</div>
            <div className={`text-sm font-semibold font-mono ${isGlaucoma ? "text-neg" : "text-pos"}`}>
              {confidencePct}%
            </div>
          </div>

          <div className="bg-surface2 rounded-lg p-3 border border-white/7">
            <div className="text-xs text-text3 mb-1">OHTS</div>
            <div className="text-sm font-semibold text-text1">
              {result?.ohts_score != null
                ? `${Number(result.ohts_score).toFixed(0)} / 16`
                : "N/A"}
            </div>
            {result?.ohts_tier && (
              <div className="text-xs text-text3 mt-1">{titleCase(result.ohts_tier)}</div>
            )}
          </div>

          <div className="bg-surface2 rounded-lg p-3 border border-white/7">
            <div className="text-xs text-text3 mb-1">Approximate CDR</div>
            <div className="text-sm font-semibold text-text1">
              {result?.cdr != null ? Number(result.cdr).toFixed(2) : "N/A"}
            </div>
            {result?.cdr != null && (
              <div className="text-xs text-text3 mt-1">
                {Number(result.cdr) > 0.7
                  ? "Suspicious"
                  : Number(result.cdr) >= 0.5
                    ? "Borderline"
                    : "Normal"}
              </div>
            )}
          </div>
        </div>

        <div className="mt-3">
          <div className="flex justify-between text-xs text-text2 mb-1.5">
            <span>Confidence Score</span>
            <span className={`font-semibold ${isGlaucoma ? "text-neg" : "text-pos"}`}>
              {confidencePct}%
            </span>
          </div>
          <div className="h-2 bg-surface3 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${isGlaucoma ? "bg-neg" : "bg-pos"}`}
              style={{ width: `${confidencePct}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export function SignatoryEditor({
  effectiveSignedBy,
  editingSignatory,
  setEditingSignatory,
  signatoryInput,
  setSignatoryInput,
  savingSignatory,
  signatoryMessage,
  setSignatoryMessage,
  handleSaveSignatory,
}) {
  if (editingSignatory) {
    return (
      <div className="flex flex-col gap-2 mt-1">
        <textarea
          value={signatoryInput}
          onChange={event => setSignatoryInput(event.target.value)}
          rows={2}
          className="w-full bg-surface2 border border-white/12 rounded-lg px-3 py-2 text-xs text-text1 outline-none focus:border-accent transition-colors font-sans resize-none leading-relaxed"
          placeholder={"Dr. Smith\nGeneral Ophthalmologist"}
        />

        <div className="flex items-center gap-2">
          <button
            onClick={handleSaveSignatory}
            disabled={savingSignatory || !signatoryInput.trim()}
            className="px-3 py-1.5 text-xs text-white bg-accent hover:bg-accent2 disabled:bg-surface3 disabled:text-text3 rounded-lg border-0 cursor-pointer font-sans"
          >
            {savingSignatory ? "Saving..." : "Save"}
          </button>

          <button
            onClick={() => {
              setEditingSignatory(false);
              setSignatoryInput(effectiveSignedBy || "");
              setSignatoryMessage("");
            }}
            className="px-3 py-1.5 text-xs text-text2 border border-white/12 rounded-lg bg-transparent hover:bg-white/5 cursor-pointer font-sans"
          >
            Cancel
          </button>
        </div>

        {signatoryMessage && (
          <div className={`text-xs mt-1 ${signatoryMessage.includes("Unable") ? "text-neg" : "text-pos"}`}>
            {signatoryMessage}
          </div>
        )}
      </div>
    );
  }

  return (
    <>
      <div className="flex items-start gap-2 mt-1">
        <span className="text-xs font-medium text-text1 flex-1 whitespace-pre-wrap">
          {effectiveSignedBy || "No signatory set"}
        </span>

        <button
          onClick={() => {
            setSignatoryInput(effectiveSignedBy || "");
            setSignatoryMessage("");
            setEditingSignatory(true);
          }}
          className="px-2.5 py-1 text-xs text-text3 hover:text-text2 border border-white/7 hover:border-white/12 rounded-lg bg-transparent cursor-pointer font-sans transition-colors"
        >
          Edit
        </button>
      </div>

      {signatoryMessage && (
        <div className={`text-xs mt-2 ${signatoryMessage.includes("Unable") ? "text-neg" : "text-pos"}`}>
          {signatoryMessage}
        </div>
      )}
    </>
  );
}

export function ReferralActions({
  canExportReferral,
  isPrintingPdf,
  isDownloadingPdf,
  handlePrintReferralPdf,
  handleDownloadReferralPdf,
  actionError,
  navigate,
  data,
  compact = false,
  pdfPayload = {},
  printLabel,
  downloadLabel,
}) {
  const buttonClass = compact
    ? "px-4 py-2.5 text-xs font-medium rounded-lg transition-colors cursor-pointer font-sans"
    : "w-full py-2.5 text-xs font-medium rounded-lg transition-colors cursor-pointer font-sans";

  return (
    <div className={compact ? "flex flex-wrap gap-2" : "flex flex-col gap-2"}>
      <button
        onClick={() => handlePrintReferralPdf(pdfPayload)}
        disabled={!canExportReferral || isPrintingPdf}
        className={`${buttonClass} text-white bg-accent hover:bg-accent2 disabled:bg-surface3 disabled:text-text3 border-0`}
      >
        {isPrintingPdf
          ? "Preparing print..."
          : printLabel || (compact ? "Print Clinical Referral" : "Print")}
      </button>

      <button
        onClick={() => handleDownloadReferralPdf(pdfPayload)}
        disabled={!canExportReferral || isDownloadingPdf}
        className={`${buttonClass} text-text2 border border-white/12 bg-transparent hover:bg-white/5 disabled:opacity-50`}
      >
        {isDownloadingPdf
          ? "Downloading..."
          : downloadLabel || (compact ? "Download Clinical Referral" : "Download")}
      </button>

      <button
        onClick={() => navigate("/screenings/new", { state: { patientId: data?.patient_id } })}
        className={`${buttonClass} text-text2 border border-white/12 bg-transparent hover:bg-white/5`}
      >
        Screen Again
      </button>

      <button
        onClick={() => navigate(`/patients/${data?.patient_id}`)}
        className={`${buttonClass} text-text2 border border-white/12 bg-transparent hover:bg-white/5`}
      >
        View Patient
      </button>

      {actionError && (
        <div className={`${compact ? "basis-full" : ""} text-xs text-neg leading-relaxed px-1`}>
          {actionError}
        </div>
      )}
    </div>
  );
}

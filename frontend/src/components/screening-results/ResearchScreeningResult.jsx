// frontend/src/components/screening-results/ResearchScreeningResult.jsx
// Research view for Screening Result.
// Shows model comparison and LLM referral comparison.

import { useEffect, useMemo, useState } from "react";
import {
  getClinicalResult,
  getModelResult,
  getReferralResult,
  LLM_OPTIONS,
  MODEL_OPTIONS,
  ReferralActions,
  ScreeningContext,
  SelectedModelDetail,
  SignatoryEditor,
  formatPercent,
} from "./ResultShared";

import ModelPerformanceReference from "./ModelPerformanceReference";
import BiomarkerVisualisation from "./BiomarkerVisualisation";

function ModelCard({ option, result, selected, onClick }) {
  const isAvailable = Boolean(result);
  const isGlaucoma = result?.prediction?.toLowerCase() === "glaucoma";
  const confidenceText = isAvailable ? formatPercent(result.confidence_score) : "Not available";

  const confidence = Number(result?.confidence_score || 0);
  const threshold = Number(result?.threshold_used || 0.5);
  const margin = confidence - threshold;

  const thresholdText = `${(threshold * 100).toFixed(1)}%`;
  const marginText = `${margin >= 0 ? "+" : ""}${(margin * 100).toFixed(1)}%`;  

  return (
    <button
      type="button"
      onClick={isAvailable ? onClick : undefined}
      disabled={!isAvailable}
      className={`text-left rounded-xl border p-4 transition-all font-sans ${
        selected
          ? "bg-accent/10 border-accent/40"
          : "bg-surface border-white/7 hover:border-white/20"
      } ${!isAvailable ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
    >
      <div className="flex items-center justify-between gap-2 mb-3">
        <span className="text-sm font-semibold text-text1">{option.label}</span>
        {option.clinical && (
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-accent/10 text-accent border border-accent/20">
            Clinical reference
          </span>
        )}
      </div>


      {isAvailable ? (
        <>
          <div className={`text-xs font-semibold mb-1 ${isGlaucoma ? "text-neg" : "text-pos"}`}>
            {isGlaucoma ? "Possible glaucoma signs detected" : "No glaucoma signs detected"}
          </div>

          <div className="text-2xl font-bold font-mono text-text1 mb-2">
            {confidenceText}
          </div>

          <div className="h-1.5 bg-surface3 rounded-full overflow-hidden">
            <div
              className={`h-full ${isGlaucoma ? "bg-neg" : "bg-pos"}`}
              style={{ width: confidenceText }}
            />
          </div>

          <div className="text-xs text-text3 mt-2">
            Threshold: {thresholdText}
          </div>

          <div className={`text-xs font-semibold ${margin >= 0 ? "text-pos" : "text-neg"}`}>
            Margin: {marginText}
          </div>

        </>
      ) : (
        <div className="text-xs text-text3 leading-relaxed">
          This result was not saved for this screening.
        </div>
      )}
    </button>
  );
}

function LlmCard({ option, result, selected, onClick }) {
  const isAvailable = Boolean(result);

  return (
    <button
      type="button"
      onClick={isAvailable ? onClick : undefined}
      disabled={!isAvailable}
      className={`text-left rounded-xl border p-4 transition-all font-sans ${
        selected
          ? "bg-accent/10 border-accent/40"
          : "bg-surface border-white/7 hover:border-white/20"
      } ${!isAvailable ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
    >
      <div className="flex items-center gap-2 mb-2">
        <span className="w-2 h-2 rounded-full" style={{ background: option.dot }} />
        <span className="text-sm font-semibold text-text1">{option.label}</span>
      </div>

      {isAvailable ? (
        <>
          <div className="text-xs text-pos mb-2">Generated</div>
          <div className="text-xs text-text3 mb-2">
            {result.generation_time_ms
              ? `${Number(result.generation_time_ms).toFixed(0)} ms`
              : "Generation time not recorded"}
          </div>
          <div className="text-xs text-text2 leading-relaxed line-clamp-3">
            {result.referral_letter}
          </div>
        </>
      ) : (
        <div className="text-xs text-text3 leading-relaxed">
          Not generated for this screening.
        </div>
      )}
    </button>
  );
}

function ResearchScreeningResult(props) {
  const {
    data,
    results,
    primaryReferral,
    effectiveSignedBy,
    editingSignatory,
    setEditingSignatory,
    signatoryInput,
    setSignatoryInput,
    savingSignatory,
    signatoryMessage,
    setSignatoryMessage,
    handleSaveSignatory,
    canExportReferral,
    isPrintingPdf,
    isDownloadingPdf,
    handlePrintReferralPdf,
    handleDownloadReferralPdf,
    actionError,
    navigate,
  } = props;

  const [selectedModelKey, setSelectedModelKey] = useState("ensemble");
  const [selectedLlmKey, setSelectedLlmKey] = useState("gpt4o");

  const clinicalResult = getClinicalResult(results);

  const modelResults = useMemo(() => {
    return MODEL_OPTIONS.map(option => ({
      ...option,
      result: getModelResult(results, option.key),
    }));
  }, [results]);

  const referralResults = useMemo(() => {
    return LLM_OPTIONS.map(option => ({
      ...option,
      result: getReferralResult(results, option.key),
    }));
  }, [results]);

  useEffect(() => {
    const selectedModelExists = modelResults.some(
      item => item.key === selectedModelKey && item.result
    );

    if (!selectedModelExists) {
      const ensemble = modelResults.find(item => item.key === "ensemble" && item.result);
      const firstAvailable = modelResults.find(item => item.result);
      setSelectedModelKey((ensemble || firstAvailable)?.key || "ensemble");
    }

    const selectedLlmExists = referralResults.some(
      item => item.key === selectedLlmKey && item.result
    );

    if (!selectedLlmExists) {
      const gpt4o = referralResults.find(item => item.key === "gpt4o" && item.result);
      const firstLlm = referralResults.find(item => item.result);
      setSelectedLlmKey((gpt4o || firstLlm)?.key || "gpt4o");
    }
  }, [modelResults, referralResults, selectedModelKey, selectedLlmKey]);

  const selectedModel =
    modelResults.find(item => item.key === selectedModelKey) ||
    modelResults.find(item => item.result);

  const selectedResult = selectedModel?.result || clinicalResult;
  const selectedModelLabel = selectedModel?.label || "Ensemble";

  const predictionSet = new Set(
    modelResults
      .filter(item => item.result)
      .map(item => item.result.prediction?.toLowerCase())
      .filter(Boolean)
  );

  const hasModelDisagreement = predictionSet.size > 1;

  return (
    <>
      <ScreeningContext
        data={data}
        clinicalResult={clinicalResult}
        modeLabel="research"
      />

      <div className="mb-4">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div>
            <h2 className="text-base font-semibold text-text1">Model Comparison</h2>
            <p className="text-xs text-text3 mt-1">
              Compare saved model outputs for this screening. Ensemble remains the clinical reference.
            </p>
          </div>

          {hasModelDisagreement && (
            <span className="text-xs px-3 py-1 rounded-full bg-warn/10 text-warn border border-warn/20">
              Model disagreement detected
            </span>
          )}
        </div>

        <div className="grid grid-cols-4 gap-3">
          {modelResults.map(item => (
            <ModelCard
              key={item.key}
              option={item}
              result={item.result}
              selected={selectedModelKey === item.key}
              onClick={() => setSelectedModelKey(item.key)}
            />
          ))}
        </div>
      </div>

      {selectedResult && (
        <SelectedModelDetail
          data={data}
          result={selectedResult}
          label={selectedModelLabel}
        />
      )}
      {selectedResult && (
        <BiomarkerVisualisation result={selectedResult} />
      )}
      {selectedResult && (
        <ModelPerformanceReference modelKey={selectedModelKey} />
      )}
      <div className="bg-surface border border-white/7 rounded-xl overflow-hidden mt-4">
        <div className="px-5 py-3.5 border-b border-white/7">
          <span className="text-sm font-semibold text-text1">LLM Referral Comparison</span>
          <p className="text-xs text-text3 mt-1">
            Compare generated referral letters. GPT-4o is used as the clinical reference.
          </p>
        </div>

        <div className="p-4">
          <div className="grid grid-cols-4 gap-3">
            {referralResults.map(item => (
              <div
                key={item.key}
                className={`rounded-xl border overflow-hidden ${
                  selectedLlmKey === item.key
                    ? "bg-accent/5 border-accent/30"
                    : "bg-surface border-white/7"
                }`}
              >
                <button
                  type="button"
                  onClick={item.result ? () => setSelectedLlmKey(item.key) : undefined}
                  disabled={!item.result}
                  className={`w-full text-left p-4 border-0 bg-transparent font-sans ${
                    item.result ? "cursor-pointer" : "cursor-not-allowed opacity-50"
                  }`}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <span
                      className="w-2 h-2 rounded-full"
                      style={{ background: item.dot }}
                    />
                    <span className="text-md font-semibold text-text1">
                      {item.label}
                    </span>
                  </div>

                  {item.result ? (
                    <>
                      <div className="text-xs text-pos mb-2">Generated</div>
                      <div className="text-xs text-text1 mb-2">
                        {item.result.generation_time_ms
                          ? `${Number(item.result.generation_time_ms).toFixed(0)/1000} secs.`
                          : "Generation time not recorded"}
                      </div>
                    </>
                  ) : (
                    <div className="text-xs text-text3 leading-relaxed">
                      Not generated for this screening.
                    </div>
                  )}
                </button>

                <div className="border-t border-white/7 bg-surface2 p-4">
                  {item.result ? (
                    <div className="text-sm text-text1 leading-relaxed whitespace-pre-wrap min-h-[260px] max-h-[420px] overflow-y-auto pr-1">
                      {item.result.referral_letter}
                    </div>
                  ) : (
                    <div className="text-xs text-text3 leading-relaxed min-h-[260px] flex items-center justify-center text-center">
                      No referral letter available.
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {primaryReferral && (
            <div className="mt-4 pt-4 border-t border-white/7">
              <div className="text-xs text-text2 mb-1">Clinical signatory</div>

              <SignatoryEditor
                effectiveSignedBy={effectiveSignedBy}
                editingSignatory={editingSignatory}
                setEditingSignatory={setEditingSignatory}
                signatoryInput={signatoryInput}
                setSignatoryInput={setSignatoryInput}
                savingSignatory={savingSignatory}
                signatoryMessage={signatoryMessage}
                setSignatoryMessage={setSignatoryMessage}
                handleSaveSignatory={handleSaveSignatory}
              />
            </div>
          )}
        </div>
      </div>

      <div className="bg-surface border border-white/7 rounded-xl overflow-hidden mt-4">
        <div className="px-5 py-3.5 border-b border-white/7">
          <span className="text-sm font-semibold text-text1">Actions</span>
        </div>

        <div className="p-4">
          <ReferralActions
            canExportReferral={canExportReferral}
            isPrintingPdf={isPrintingPdf}
            isDownloadingPdf={isDownloadingPdf}
            handlePrintReferralPdf={handlePrintReferralPdf}
            handleDownloadReferralPdf={handleDownloadReferralPdf}
            actionError={actionError}
            navigate={navigate}
            data={data}
            compact
            pdfPayload={{ pdf_type: "llm_comparison" }}
            printLabel="Print LLM Comparison"
            downloadLabel="Download LLM Comparison"
          />
        </div>
      </div>
    </>
  );
}

export default ResearchScreeningResult;

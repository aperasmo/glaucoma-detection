// frontend/src/components/screening-results/ClinicalScreeningResult.jsx
// Clinical view for Screening Result.
// Keeps the clinical workflow simple: ensemble, GPT-4o referral, actions.

import {
  formatDate,
  getClinicalResult,
  InfoRow,
  OHTSTierBadge,
  ReferralActions,
  SelectedModelDetail,
  SignatoryEditor,
  titleCase,
} from "./ResultShared";

import ModelPerformanceReference from "./ModelPerformanceReference";
import BiomarkerVisualisation from "./BiomarkerVisualisation";

function ClinicalScreeningResult(props) {
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
      // Disagreement letter props from ScreeningResult controller.
      isRequestingDisagreement,
      disagreementLetterDone,
      handleRequestDisagreementLetter,
    } = props;

  const clinicalResult = getClinicalResult(results);

    // Model disagreement fields from the ensemble screening result.
    // Backend computes and saves these at inference time - frontend just reads them.
    const hasDisagreement = clinicalResult?.has_model_disagreement === true;
    const disagreementModel = clinicalResult?.disagreement_model || null;
    const disagreementConfidence = clinicalResult?.disagreement_confidence || null;

    // Display name map for disagreement model - matches backend model key names.
    const MODEL_DISPLAY_NAMES = {
      efficientnetb0: "EfficientNetB0",
      vgg16: "VGG16",
      efficientnetv2: "EfficientNetV2",
      ensemble: "Ensemble",
    };
    
  return (
    <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 320px" }}>
    <div className="flex flex-col gap-4">
      {clinicalResult && (
          <SelectedModelDetail
            data={data}
            result={clinicalResult}
            label="Ensemble"
            hasDisagreement={hasDisagreement}
          />
        )}

        {/* MODEL DISAGREEMENT NOTICE */}
        {/* Shown when ensemble says normal but at least one individual model */}
        {/* crossed its own sensitivity threshold. Backend sets has_model_disagreement. */}
        {hasDisagreement && disagreementModel && (
          <div className="flex items-start gap-3 px-4 py-3.5 bg-warn/10 border border-warn/30 rounded-xl">
            <span className="text-warn mt-0.5 text-base leading-none">⚠</span>
            <div className="flex-1">
              <div className="text-sm font-semibold text-warn mb-1">
                Model Disagreement Detected
              </div>
              <div className="text-xs text-warn/80 leading-relaxed mb-3">
                  The ensemble model found no glaucoma signs, but one of the supporting
                  models ({MODEL_DISPLAY_NAMES[disagreementModel] || disagreementModel}) flagged
                  this image as suspicious with{" "}
                  {disagreementConfidence != null
                    ? (Number(disagreementConfidence) * 100).toFixed(1)
                    : "—"}% confidence. This does not confirm glaucoma, but a clinician
                  should review this result before closing the case.
              </div>
              <button
                onClick={handleRequestDisagreementLetter}
                disabled={isRequestingDisagreement || disagreementLetterDone}
                className="px-3 py-1.5 text-xs font-medium text-white bg-warn hover:bg-warn/80 disabled:bg-surface3 disabled:text-text3 rounded-lg border-0 transition-colors cursor-pointer font-sans flex items-center gap-2"
              >
                {isRequestingDisagreement ? (
                  <>
                    <span className="w-3 h-3 border border-white/40 border-t-white rounded-full animate-spin" />
                    Generating...
                  </>
                ) : disagreementLetterDone ? (
                  "Second opinion letter generated"
                ) : (
                  "Request second opinion letter"
                )}
              </button>
            </div>
          </div>
        )}
        {clinicalResult && (
          <ModelPerformanceReference modelKey="ensemble" />
        )}
        <div className="bg-surface border border-white/7 rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-white/7 flex items-center gap-3">
            <span className="text-sm font-semibold text-text1 flex-1">OHTS Risk Score</span>
            <span className="text-xs text-text3">Ocular Hypertension Treatment Study</span>
          </div>

          <div className="p-4">
            {clinicalResult?.ohts_score ? (
              <>
                <div className="flex items-center justify-center gap-4 p-4 bg-surface2 rounded-xl">
                  <div className="text-center">
                    <div
                      className={`text-4xl font-bold font-mono ${
                        clinicalResult.ohts_tier === "critical"
                          ? "text-neg"
                          : clinicalResult.ohts_tier === "possible"
                            ? "text-warn"
                            : "text-pos"
                      }`}
                    >
                      {Number(clinicalResult.ohts_score).toFixed(0)}
                    </div>
                    <div className="text-xs text-text3 mt-1">/ 16 pts</div>
                  </div>

                  <div>
                    <OHTSTierBadge tier={clinicalResult.ohts_tier} />
                    <div className="text-xs text-text3 mt-2">
                      Estimated 5-year POAG risk:{" "}
                      {Number(clinicalResult.ohts_score) > 12
                        ? "≥33%"
                        : Number(clinicalResult.ohts_score) >= 7
                          ? "10-20%"
                          : "≤4%"}
                    </div>
                  </div>
                </div>

                <div className="text-xs text-text3 text-center mt-3 pt-3 border-t border-white/7">
                  Based on Ocular Hypertension Treatment Study (OHTS) — Kass et al. (2002)
                </div>
              </>
            ) : (
              <p className="text-text3 text-sm">
                OHTS score not available. IOP and CCT required.
              </p>
            )}
          </div>
        </div>
          {clinicalResult && (
            <BiomarkerVisualisation result={clinicalResult} />
          )}        
      </div>

      <div className="flex flex-col gap-4">
        <div className="bg-surface border border-white/7 rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-white/7">
            <span className="text-sm font-semibold text-text1">Screening Info</span>
          </div>

          <div className="p-4">
            <InfoRow label="Date" value={formatDate(data?.created_at)} />
            <InfoRow label="Eye Side" value={titleCase(data?.eye_side)} />
            <InfoRow label="Model" value="Ensemble (All Models)" />
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
              label="Threshold"
              value={Number(clinicalResult?.threshold_used || 0.5).toFixed(4)}
            />
          </div>
        </div>

        <div className="bg-surface border border-white/7 rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-white/7">
            <span className="text-sm font-semibold text-text1">Referral Letter</span>
          </div>

          <div className="p-4">
            {!primaryReferral ? (
              <div className="text-center py-4">
                <div className="text-sm text-text3">
                  {clinicalResult?.prediction?.toLowerCase() === "glaucoma"
                    ? "Generating referral letter..."
                    : "No referral required — normal result."}
                </div>
              </div>
            ) : (
              <>
                {/* Single letter slot - standard referral or disagreement letter. */}
                {/* These two states never coexist on the same screening. */}
                <div className="text-xs text-text1 leading-relaxed whitespace-pre-wrap mb-4 max-h-96 overflow-y-auto pr-1">
                  {primaryReferral.referral_letter}
                </div>

                <div className="pt-3 border-t border-white/7">
                  <div className="text-xs text-text2 mb-1">Sincerely,</div>

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
              </>
            )}
          </div>
        </div>

        <div className="bg-surface border border-white/7 rounded-xl overflow-hidden">
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
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export default ClinicalScreeningResult;

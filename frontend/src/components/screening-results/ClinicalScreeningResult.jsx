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
  } = props;

  const clinicalResult = getClinicalResult(results);

  return (
    <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 320px" }}>
      <div className="flex flex-col gap-4">
        {clinicalResult && (
          <SelectedModelDetail
            data={data}
            result={clinicalResult}
            label="Ensemble"
          />
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

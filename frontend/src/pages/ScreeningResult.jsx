// frontend/src/pages/ScreeningResult.jsx
// Page controller for Screening Result.
// Fetches data once and renders either Clinical or Research view.

import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import Layout from "../components/Layout";
import API from "../api/index";
import ClinicalScreeningResult from "../components/screening-results/ClinicalScreeningResult";
import ResearchScreeningResult from "../components/screening-results/ResearchScreeningResult";
import {
  formatDate,
  getReferralResult,
  normaliseSignatoryText,
} from "../components/screening-results/ResultShared";

import { useSettings } from "../context/SettingsContext";

function ScreeningResult() {
  const { screeningId } = useParams();
  const navigate = useNavigate();

  const [data, setData] = useState(null);
  
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [signedBy, setSignedBy] = useState("");
  const [editingSignatory, setEditingSignatory] = useState(false);
  const [signatoryInput, setSignatoryInput] = useState("");
  const [savingSignatory, setSavingSignatory] = useState(false);
  const [signatoryMessage, setSignatoryMessage] = useState("");

  const [isPrintingPdf, setIsPrintingPdf] = useState(false);
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);
  const [actionError, setActionError] = useState("");

  const { getSetting } = useSettings();

  useEffect(() => {
    let intervalId = null;

    async function fetchResult() {
      try {
          const resultRes = await API.get(`/results/${screeningId}/full`);
          const resultData = resultRes.data;

          // Use the mode saved on the screening record.
          // The global setting is only a fallback for older records.
          setData(resultData);
          

        const gpt4oReferral =
          resultData?.results?.find(
            item => item.referral_letter != null && item.llm_used === "gpt4o"
          ) ||
          resultData?.results?.find(
            item => item.referral_letter != null && item.llm_used !== null
          );

        if (gpt4oReferral?.signed_by) {
          setSignedBy(normaliseSignatoryText(gpt4oReferral.signed_by));
        } else if (!signedBy) {
          try {
            const name = getSetting("REFERRING_CLINICIAN_NAME", "");
            const title = getSetting("REFERRING_CLINICIAN_TITLE", "");

            setSignedBy(title ? `${name}\n${title}` : name);
          } catch {
            // Keep screen usable even if settings are unavailable.
          }
        }

      const status = String(resultData?.status || "").toLowerCase();

      // Keep the spinner page while inference is still running.
      // Only show the result UI once the screening is complete or failed.
      if (status === "complete" || status === "failed") {
        setLoading(false);

        if (intervalId) clearInterval(intervalId);
      } else {
        setLoading(true);
      }
      } catch (err) {
    console.error("Failed to load screening result:", {
      status: err?.response?.status,
      data: err?.response?.data,
      message: err?.message,
    });

    setError("Failed to load screening result.");
    setLoading(false);

    if (intervalId) clearInterval(intervalId);
  }
    }

    fetchResult();
    intervalId = setInterval(fetchResult, 3000);

    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [screeningId]);

  const results = data?.results || [];
  // Screening Result page uses the saved mode of this screening.
  // It does not use the current global INFERENCE_MODE setting.
  const inferenceMode = data?.inference_mode || "clinical";

  const primaryReferral =
    getReferralResult(results, "gpt4o") ||
    results.find(item => item.referral_letter != null && item.llm_used !== null) ||
    null;

  const effectiveSignedBy = normaliseSignatoryText(
    primaryReferral?.signed_by || signedBy || ""
  );

  const canExportReferral = Boolean(primaryReferral?.referral_letter);

  async function handleSaveSignatory() {
    const nextSignedBy = normaliseSignatoryText(signatoryInput);

    if (!nextSignedBy || savingSignatory) return;

    setSavingSignatory(true);
    setSignatoryMessage("");

    try {
      await API.put(`/results/${screeningId}/sign`, {
        signed_by: nextSignedBy,
      });

      setSignedBy(nextSignedBy);
      setEditingSignatory(false);
      setSignatoryMessage("Signatory updated.");

      setData(prev => {
        if (!prev?.results) return prev;

        return {
          ...prev,
          results: prev.results.map(item =>
            item.referral_letter != null && item.llm_used !== null
              ? { ...item, signed_by: nextSignedBy }
              : item
          ),
        };
      });
    } catch {
      setSignatoryMessage("Unable to update signatory.");
    } finally {
      setSavingSignatory(false);
    }
  }

  async function getReferralPdfBlob(payload = {}) {
    const response = await API.post(
      `/results/${screeningId}/pdf`,
      payload,
      { responseType: "blob" }
    );

    return new Blob([response.data], { type: "application/pdf" });
  }

  async function handleDownloadReferralPdf(payload = {}) {
    if (!canExportReferral || isDownloadingPdf) return;

    setIsDownloadingPdf(true);
    setActionError("");

    try {
      const blob = await getReferralPdfBlob(payload);
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");

      anchor.href = url;
      anchor.download = payload?.pdf_type === "llm_comparison"
        ? `llm-comparison-${screeningId}.pdf`
        : `referral-${screeningId}.pdf`;
      anchor.click();

      window.URL.revokeObjectURL(url);
    } catch {
      setActionError("Unable to download referral PDF.");
    } finally {
      setIsDownloadingPdf(false);
    }
  }

  async function handlePrintReferralPdf(payload = {}) {
    if (!canExportReferral || isPrintingPdf) return;

    setIsPrintingPdf(true);
    setActionError("");

    try {
      const blob = await getReferralPdfBlob(payload);
      const url = window.URL.createObjectURL(blob);
      const printWindow = window.open(url, "_blank");

      if (!printWindow) {
        throw new Error("Popup blocked. Please allow popups to print the referral PDF.");
      }

      printWindow.onload = () => {
        printWindow.focus();
        printWindow.print();
      };
    } catch (err) {
      setActionError(err.message || "Unable to prepare referral PDF for printing.");
    } finally {
      setIsPrintingPdf(false);
    }
  }

  const sharedProps = {
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
  };

  if (loading) {
    return (
      <Layout title="Screening Result">
        <div className="loading-overlay">
          <div className="loading-content">
            <div className="spinner" />
            <h3 className="text-text1 text-lg font-semibold mb-2">Analysing Fundus Image...</h3>
            <p className="text-text2 text-sm mb-1">AI model is processing your fundus image</p>
            <p className="text-text3 text-xs">Inference → Grad-CAM++ → Referral Letter</p>
          </div>
        </div>
      </Layout>
    );
  }

  if (error) {
    return (
      <Layout title="Screening Result">
        <p className="text-neg text-sm">{error}</p>
      </Layout>
    );
  }

  const isResearchView = inferenceMode === "research";

  const actions = (
    <button
      onClick={() => navigate(-1)}
      className="px-3 py-1.5 text-xs text-text2 border border-white/12 rounded-lg bg-transparent hover:bg-white/5 transition-colors cursor-pointer font-sans"
    >
      ← Back
    </button>
  );

  return (
    <Layout
      title={isResearchView ? "Research Mode Screening Result" : "Clinical Screening Result"}
      actions={actions}
    >
      <div className="flex items-center gap-1.5 text-xs text-text3 mb-4">
        <span
          onClick={() => navigate("/patients")}
          className="cursor-pointer hover:text-accent2 transition-colors"
        >
          Patients
        </span>
        <span>›</span>
        <span
          onClick={() => navigate(-1)}
          className="cursor-pointer hover:text-accent2 transition-colors"
        >
          Screening History
        </span>
        <span>›</span>
        <span className="text-text2">Result — {formatDate(data?.created_at)}</span>
      </div>

      <div className="px-4 py-3 rounded-lg mb-4 bg-warn/10 border border-warn/20 text-xs text-warn leading-relaxed">
        AI-assisted screening result only. Clinical judgment is required before diagnosis or referral.
      </div>

      {isResearchView ? (
        <ResearchScreeningResult {...sharedProps} />
      ) : (
        <ClinicalScreeningResult {...sharedProps} />
      )}
    </Layout>
  );
}

export default ScreeningResult;

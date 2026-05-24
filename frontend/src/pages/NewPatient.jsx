// src/pages/NewPatient.jsx
// Create new patient form - matches mock UI pg-create-patient exactly.
// Sections: Personal Information, Medical Information, Ocular Hypertension Risk (Optional).
// Connects to POST /patients/ endpoint.

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import Layout from "../components/Layout";
import API from "../api/index";

const V = {
  surface:  "#131D2E",
  surface2: "#1A2840",
  border:   "rgba(255,255,255,0.07)",
  border2:  "rgba(255,255,255,0.12)",
  accent:   "#3B9EFF",
  accent2:  "#5BB8FF",
  neg:      "#FF6B6B",
  negDim:   "rgba(255,107,107,0.12)",
  text:     "#E8EEF7",
  text2:    "#8FA3BF",
  text3:    "#4E6580",
};

// Reusable input style
const inputStyle = {
  width: "100%",
  background: V.surface2,
  border: `1px solid ${V.border2}`,
  borderRadius: "8px",
  padding: "9px 13px",
  color: V.text,
  fontSize: "13px",
  fontFamily: "'DM Sans',sans-serif",
  outline: "none",
  boxSizing: "border-box",
};

const labelStyle = {
  fontSize: "12px",
  color: V.text2,
  marginBottom: "6px",
  display: "block",
  fontWeight: "500",
};

const sectionDivider = (label) => (
  <div style={{
    fontSize: "11px",
    color: V.text3,
    textTransform: "uppercase",
    letterSpacing: "1px",
    margin: "20px 0 14px",
    paddingBottom: "6px",
    borderBottom: `1px solid ${V.border}`,
  }}>
    {label}
  </div>
);

function FormField({ label, children }) {
  return (
    <div>
      <label style={labelStyle}>{label}</label>
      {children}
    </div>
  );
}

function NewPatient() {
  const navigate = useNavigate();

  const [form, setForm] = useState({
    first_name: "",
    last_name: "",
    dob: "",
    gender: "female",
    mobile_number: "",
    email: "",
    nhi_number: "",
    referring_doctor: "",
    iop: "",
    cct: "",
    medical_notes: "",
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  function handleChange(e) {
    setForm({ ...form, [e.target.name]: e.target.value });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const payload = {
        first_name:    form.first_name,
        last_name:     form.last_name,
        dob:           form.dob || null,
        gender:        form.gender,
        mobile_number: form.mobile_number || null,
        email:         form.email || null,
        iop:           form.iop ? parseFloat(form.iop) : null,
        cct:           form.cct ? parseFloat(form.cct) : null,
      };

      const res = await API.post("/patients/", payload);
      /*navigate(`/patients/${res.data.patient_id}`);*/
      navigate("/patients"); 
    } catch (err) {
      setError(err.response?.data?.detail || "Failed to create patient. Please try again.");
      setLoading(false);
    }
  }

  return (
    <Layout title="New Patient">

      {/* Breadcrumb */}
      <div style={{
        display: "flex", alignItems: "center", gap: "6px",
        fontSize: "12px", color: V.text3, marginBottom: "18px",
      }}>
        <span
          onClick={() => navigate("/patients")}
          style={{ cursor: "pointer" }}
          onMouseEnter={e => e.currentTarget.style.color = V.accent2}
          onMouseLeave={e => e.currentTarget.style.color = V.text3}
        >
          Patients
        </span>
        <span>›</span>
        <span style={{ color: V.text2 }}>New Patient</span>
      </div>

      {/* Form Card */}
      <div style={{
        background: V.surface,
        border: `1px solid ${V.border}`,
        borderRadius: "11px",
        overflow: "hidden",
      }}>
        <div style={{
          padding: "14px 18px",
          borderBottom: `1px solid ${V.border}`,
        }}>
          <span style={{ fontSize: "13.5px", fontWeight: "600", color: V.text }}>
            Create New Patient
          </span>
        </div>

        <div style={{ padding: "18px" }}>
          <form onSubmit={handleSubmit}>

            {/* Personal Information */}
            {sectionDivider("Personal Information")}

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "16px" }}>
              <FormField label="First Name *">
                <input
                  name="first_name"
                  value={form.first_name}
                  onChange={handleChange}
                  placeholder="Maria"
                  required
                  style={inputStyle}
                />
              </FormField>
              <FormField label="Last Name *">
                <input
                  name="last_name"
                  value={form.last_name}
                  onChange={handleChange}
                  placeholder="Santos"
                  required
                  style={inputStyle}
                />
              </FormField>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "16px" }}>
              <FormField label="Date of Birth *">
                <input
                  name="dob"
                  type="date"
                  value={form.dob}
                  onChange={handleChange}
                  required
                  style={inputStyle}
                />
              </FormField>
              <FormField label="Gender *">
                <select
                  name="gender"
                  value={form.gender}
                  onChange={handleChange}
                  style={inputStyle}
                >
                  <option value="female">Female</option>
                  <option value="male">Male</option>
                  <option value="other">Other</option>
                </select>
              </FormField>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "16px" }}>
              <FormField label="Contact Number">
                <input
                  name="mobile_number"
                  value={form.mobile_number}
                  onChange={handleChange}
                  placeholder="+64 21 555 0000"
                  style={inputStyle}
                />
              </FormField>
              <FormField label="Email Address">
                <input
                  name="email"
                  type="email"
                  value={form.email}
                  onChange={handleChange}
                  placeholder="patient@email.com"
                  style={inputStyle}
                />
              </FormField>
            </div>

            {/* Medical Information */}
            {sectionDivider("Medical Information")}

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "16px" }}>
              <FormField label="NHI Number">
                <input
                  name="nhi_number"
                  value={form.nhi_number}
                  onChange={handleChange}
                  placeholder="ABC1234"
                  style={inputStyle}
                />
              </FormField>
              <FormField label="Referring Doctor">
                <input
                  name="referring_doctor"
                  value={form.referring_doctor}
                  onChange={handleChange}
                  placeholder="Dr. Reyes"
                  style={inputStyle}
                />
              </FormField>
            </div>

            {/* Ocular Hypertension Risk */}
            {sectionDivider("Ocular Hypertension Risk (Optional)")}

            <div style={{ fontSize: "12px", color: V.text3, marginBottom: "4px" }}>
              IOP measured using tonometer
            </div>
            <div style={{ fontSize: "12px", color: V.text3, marginBottom: "16px" }}>
              CCT measured using ultrasound pachymetry
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "8px" }}>
              <FormField label="IOP — Intraocular Pressure (mmHg)">
                <input
                  name="iop"
                  type="number"
                  value={form.iop}
                  onChange={handleChange}
                  placeholder="e.g. 22"
                  style={inputStyle}
                />
              </FormField>
              <FormField label="CCT — Central Corneal Thickness (µm)">
                <input
                  name="cct"
                  type="number"
                  value={form.cct}
                  onChange={handleChange}
                  placeholder="e.g. 555"
                  style={inputStyle}
                />
              </FormField>
            </div>

            <div style={{ fontSize: "12px", color: V.text3, marginBottom: "16px" }}>
              If provided, the system will calculate the OHTS 5-year glaucoma risk score alongside the AI result.
            </div>

            {/* Medical Notes */}
            <div style={{ marginBottom: "16px" }}>
              <label style={labelStyle}>Medical History / Notes</label>
              <textarea
                name="medical_notes"
                value={form.medical_notes}
                onChange={handleChange}
                placeholder="Known conditions, medications, family history..."
                style={{
                  ...inputStyle,
                  resize: "vertical",
                  minHeight: "80px",
                }}
              />
            </div>

            {/* Error */}
            {error && (
              <div style={{
                padding: "12px 16px", borderRadius: "8px",
                fontSize: "13px", marginBottom: "16px",
                background: V.negDim,
                border: "1px solid rgba(255,107,107,.2)",
                color: V.neg,
              }}>
                {error}
              </div>
            )}

            {/* Actions */}
            <div style={{
              display: "flex", gap: "10px", justifyContent: "flex-end",
              marginTop: "20px", paddingTop: "16px",
              borderTop: `1px solid ${V.border}`,
            }}>
              <button
                type="button"
                onClick={() => navigate("/patients")}
                style={{
                  padding: "6px 13px", borderRadius: "7px",
                  fontSize: "12.5px", fontWeight: "500", cursor: "pointer",
                  background: "transparent", color: V.text2,
                  border: `1px solid ${V.border2}`,
                  fontFamily: "'DM Sans',sans-serif",
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                style={{
                  padding: "6px 13px", borderRadius: "7px",
                  fontSize: "12.5px", fontWeight: "500", cursor: loading ? "not-allowed" : "pointer",
                  background: loading ? "#374151" : V.accent,
                  color: "white", border: "none",
                  fontFamily: "'DM Sans',sans-serif",
                }}
              >
                {loading ? "Creating..." : "Create Patient"}
              </button>
            </div>

          </form>
        </div>
      </div>

    </Layout>
  );
}

export default NewPatient;
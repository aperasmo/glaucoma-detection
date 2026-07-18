// posts to /patients/
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import Layout from "../components/Layout";
import API from "../api/index";

function SectionDivider({ label }) {
  return (
    <div className="text-xs text-text3 uppercase tracking-widest mt-5 mb-3.5 pb-1.5 border-b border-white/7">
      {label}
    </div>
  );
}

function FormField({ label, children }) {
  return (
    <div>
      <label className="block text-xs font-medium text-text2 mb-1.5">
        {label}
      </label>
      {children}
    </div>
  );
}

const inputClass = "w-full bg-surface2 border border-white/12 rounded-lg px-3 py-2.5 text-sm text-text1 outline-none placeholder:text-text3 focus:border-accent transition-colors font-sans";
const selectClass = `${inputClass} cursor-pointer`;

function NewPatient() {
  const navigate = useNavigate();

  const [form, setForm] = useState({
    first_name:       "",
    last_name:        "",
    dob:              "",
    gender:           "female",
    mobile_number:    "",
    email:            "",
    nhi_number:       "",
    referring_doctor: "",
    iop:              "",
    cct:              "",
    medical_notes:    "",
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

      await API.post("/patients/", payload);
      navigate("/patients");
    } catch (err) {
      const detail = err.response?.data?.detail;
      setError(Array.isArray(detail) ? detail.map(d => d.msg).join(", ") : detail || "Failed to create patient.");
      setLoading(false);
    }
  }

  return (
    <Layout title="New Patient">

      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-xs text-text3 mb-5">
        <span
          onClick={() => navigate("/patients")}
          className="cursor-pointer hover:text-accent2 transition-colors"
        >
          Patients
        </span>
        <span>›</span>
        <span className="text-text2">New Patient</span>
      </div>

      {/* Form Card */}
      <div className="bg-surface border border-white/7 rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-white/7">
          <span className="text-sm font-semibold text-text1">Create New Patient</span>
        </div>

        <div className="p-5">
          <form onSubmit={handleSubmit}>

            <SectionDivider label="Personal Information" />

            <div className="grid grid-cols-2 gap-4 mb-4">
              <FormField label="First Name *">
                <input name="first_name" value={form.first_name} onChange={handleChange}
                  placeholder="Maria" required className={inputClass} />
              </FormField>
              <FormField label="Last Name *">
                <input name="last_name" value={form.last_name} onChange={handleChange}
                  placeholder="Santos" required className={inputClass} />
              </FormField>
            </div>

            <div className="grid grid-cols-2 gap-4 mb-4">
              <FormField label="Date of Birth *">
                <input name="dob" type="date" value={form.dob} onChange={handleChange}
                  required className={inputClass} />
              </FormField>
              <FormField label="Gender *">
                <select name="gender" value={form.gender} onChange={handleChange}
                  className={selectClass}>
                  <option value="female">Female</option>
                  <option value="male">Male</option>
                  <option value="other">Other</option>
                </select>
              </FormField>
            </div>

            <div className="grid grid-cols-2 gap-4 mb-4">
              <FormField label="Contact Number">
                <input name="mobile_number" value={form.mobile_number} onChange={handleChange}
                  placeholder="+64 21 555 0000" className={inputClass} />
              </FormField>
              <FormField label="Email Address">
                <input name="email" type="email" value={form.email} onChange={handleChange}
                  placeholder="patient@email.com" className={inputClass} />
              </FormField>
            </div>

            <SectionDivider label="Medical Information" />

            <div className="grid grid-cols-2 gap-4 mb-4">
              <FormField label="NHI Number">
                <input name="nhi_number" value={form.nhi_number} onChange={handleChange}
                  placeholder="ABC1234" className={inputClass} />
              </FormField>
              <FormField label="Referring Doctor">
                <input name="referring_doctor" value={form.referring_doctor} onChange={handleChange}
                  placeholder="Dr. Reyes" className={inputClass} />
              </FormField>
            </div>

            <SectionDivider label="Ocular Hypertension Risk (Optional)" />

            <p className="text-xs text-text3 mb-4 leading-relaxed">
              IOP measured using tonometer · CCT measured using ultrasound pachymetry.
              If provided, the system will calculate the OHTS 5-year glaucoma risk score alongside the AI result.
            </p>

            <div className="grid grid-cols-2 gap-4 mb-4">
              <FormField label="IOP — Intraocular Pressure (mmHg)">
                <input name="iop" type="number" value={form.iop} onChange={handleChange}
                  placeholder="e.g. 22" className={inputClass} />
              </FormField>
              <FormField label="CCT — Central Corneal Thickness (µm)">
                <input name="cct" type="number" value={form.cct} onChange={handleChange}
                  placeholder="e.g. 555" className={inputClass} />
              </FormField>
            </div>

            <div className="mb-4">
              <label className="block text-xs font-medium text-text2 mb-1.5">
                Medical History / Notes
              </label>
              <textarea
                name="medical_notes"
                value={form.medical_notes}
                onChange={handleChange}
                placeholder="Known conditions, medications, family history..."
                rows={3}
                className={`${inputClass} resize-y`}
              />
            </div>

            {/* Error */}
            {error && (
              <div className="px-3 py-2.5 bg-neg/10 border border-neg/20 rounded-lg text-xs text-neg mb-4">
                {error}
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-2.5 justify-end mt-5 pt-4 border-t border-white/7">
              <button
                type="button"
                onClick={() => navigate("/patients")}
                className="px-4 py-2 text-xs font-medium text-text2 border border-white/12 rounded-lg bg-transparent hover:bg-white/5 transition-colors cursor-pointer font-sans"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="px-4 py-2 text-xs font-medium text-white bg-accent hover:bg-accent2 disabled:bg-surface3 disabled:cursor-not-allowed rounded-lg border-0 transition-colors cursor-pointer font-sans"
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
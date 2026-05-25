// src/App.jsx
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";

import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import PatientList from "./pages/PatientList";
import NewPatient from "./pages/NewPatient";
import PatientProfile from "./pages/PatientProfile";

import NewScreening from "./pages/NewScreening";
import ScreeningResult from "./pages/ScreeningResult";
import ScreeningHistory from "./pages/ScreeningHistory";

import Settings from "./pages/Settings";

import UserManagement from "./pages/UserManagement";
import NewUser from "./pages/NewUser";


function ProtectedRoute({ children }) {
  const { token } = useAuth();
  if (!token) return <Navigate to="/" replace />;
  return children;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Login />} />
      {/* DASHBOARD */}
      <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
      {/* PATIENTS */}
      <Route path="/patients" element={<ProtectedRoute><PatientList /></ProtectedRoute>} />
      <Route path="/patients/new" element={<ProtectedRoute><NewPatient /></ProtectedRoute>} />
      <Route path="/patients/:patientId" element={<ProtectedRoute><PatientProfile /></ProtectedRoute>} />
      {/* SCREENINGS */}
      <Route path="/screenings/new" element={<ProtectedRoute><NewScreening /></ProtectedRoute>} />
      <Route path="/results/:screeningId" element={<ProtectedRoute><ScreeningResult /></ProtectedRoute>} />
      <Route path="/screenings" element={<ProtectedRoute><ScreeningHistory /></ProtectedRoute>} />
      {/* SETTINGS */}
      <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
      {/* USER MANAGEMENT */}
      <Route path="/users" element={<ProtectedRoute><UserManagement /></ProtectedRoute>} />
      <Route path="/users/new" element={<ProtectedRoute><NewUser /></ProtectedRoute>} />
    </Routes>
  );
}

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
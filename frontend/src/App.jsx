import { createBrowserRouter, RouterProvider, Navigate, Outlet } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";

import Activate from "./pages/Activate";
import Login from "./pages/Login";
import DemoLogin from "./pages/DemoLogin";
import Dashboard from "./pages/Dashboard";
import PatientList from "./pages/PatientList";
import NewPatient from "./pages/NewPatient";
import PatientProfile from "./pages/PatientProfile";
import EditPatient from "./pages/EditPatient";
import NewScreening from "./pages/NewScreening";
import ScreeningResult from "./pages/ScreeningResult";
import ScreeningHistory from "./pages/ScreeningHistory";
import Settings from "./pages/Settings";
import UserManagement from "./pages/UserManagement";
import NewUser from "./pages/NewUser";
import UserProfile from "./pages/UserProfile";
import UserDetail from "./pages/UserDetail";
import ModelPerformance from "./pages/ModelPerformance";
import Analytics from "./pages/Analytics";
import Reports from "./pages/Reports";
import ReportHighRisk from "./pages/ReportHighRisk";

import { ThemeProvider } from "./theme/ThemeProvider";
import { SettingsProvider } from "./context/SettingsContext";

import ResearchEvaluation from "./pages/ResearchEvaluation";
import ResearchResults from "./pages/ResearchResults";

import PitchMode from "./pages/PitchMode";
import MobileLanding from "./pages/MobileLanding";
import MobileScreening from "./pages/MobileScreening";
import MobileResult from "./pages/MobileResult";


function ProtectedRoute() {
  const { token } = useAuth();
  if (!token) return <Navigate to="/" replace />;
  return <Outlet />;
}

function AdminRoute() {
  const { token, user } = useAuth();
  if (!token) return <Navigate to="/" replace />;
  if (user?.role !== "admin") return <Navigate to="/dashboard" replace />;
  return <Outlet />;
}


const router = createBrowserRouter([
  { path: "/", element: <Login /> },
  { path: "/yoobeemse907capstone", element: <DemoLogin /> },
  { path: "/activate",               element: <Activate  /> },
  {
    element: <ProtectedRouteWrapper />,
    children: [
      { path: "/dashboard",              element: <Dashboard /> },
      { path: "/patients",               element: <PatientList /> },
      { path: "/patients/new",           element: <NewPatient /> },
      { path: "/patients/:patientId",    element: <PatientProfile /> },
      { path: "/patients/:patientId/edit", element: <EditPatient /> },
      { path: "/screenings/new",         element: <NewScreening /> },
      { path: "/screenings",             element: <ScreeningHistory /> },
      { path: "/results/:screeningId",   element: <ScreeningResult /> },
      { path: "/analytics",              element: <Analytics /> },
      { path: "/models",                 element: <ModelPerformance /> },
      { path: "/reports",                element: <Reports /> },
      { path: "/research/evaluation", element: <ResearchEvaluation /> },
      { path: "/research/results",    element: <ResearchResults /> },
      { path: "/reports/high-risk",        element: <ReportHighRisk /> },
      { path: "/profile",                element: <UserProfile /> },
      { path: "/pitch", element: <PitchMode /> },
      { path: "/mobile", element: <MobileLanding /> },
      { path: "/mobile/screening", element: <MobileScreening /> },
      { path: "/mobile/result/:screeningId", element: <MobileResult /> },
    ],
  },

  {
    element: <AdminRouteWrapper />,
    children: [
      { path: "/users",       element: <UserManagement /> },
      { path: "/users/new",   element: <NewUser /> },
      { path: "/users/:userId", element: <UserDetail /> },
      { path: "/settings",    element: <Settings /> },
    ],
  },
]);

function ProtectedRouteWrapper() {
  const { token } = useAuth();
  if (!token) return <Navigate to="/" replace />;
  return <Outlet />;
}

function AdminRouteWrapper() {
  const { token, user } = useAuth();
  if (!token) return <Navigate to="/" replace />;
  if (user?.role !== "admin") return <Navigate to="/dashboard" replace />;
  return <Outlet />;
}

function App() {
  return (
    <AuthProvider>
      <ThemeProvider>
        <SettingsProvider>
          <RouterProvider router={router} />
        </SettingsProvider>
      </ThemeProvider>
    </AuthProvider>
  );
}

export default App;
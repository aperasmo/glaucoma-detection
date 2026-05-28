// src/App.jsx
import { createBrowserRouter, RouterProvider, Navigate, Outlet } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";

import Login from "./pages/Login";
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


import { ThemeProvider } from "./theme/ThemeProvider";

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
      { path: "/reports",                element: <div>Reports</div> },
      { path: "/profile",                element: <UserProfile /> },
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
        <RouterProvider router={router} />
      </ThemeProvider>
    </AuthProvider>
  );
}

export default App;
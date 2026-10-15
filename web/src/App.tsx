import { Navigate, Route, Routes, useSearchParams } from "react-router-dom";
import { usePhoneEntry } from "./phoneEntry";
import { AppShell } from "./pages/AppShell";
import { LandingPage } from "./pages/LandingPage";
import { LoginPage } from "./pages/LoginPage";
import { SignupPage } from "./pages/SignupPage";
import { readSession } from "./session";

function HomeRoute() {
  const phone = usePhoneEntry();
  if (phone) {
    return <Navigate to={readSession() ? "/app" : "/login"} replace />;
  }
  return <LandingPage />;
}

function LoginRoute() {
  if (readSession()) return <Navigate to="/app" replace />;
  return <LoginPage />;
}

function SignupRoute() {
  if (readSession()) return <Navigate to="/app" replace />;
  return <SignupPage />;
}

function AppRoute() {
  const [params] = useSearchParams();
  const demo = params.get("demo") === "1";
  if (!demo && !readSession()) return <Navigate to="/login" replace />;
  return <AppShell />;
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<HomeRoute />} />
      <Route path="/login" element={<LoginRoute />} />
      <Route path="/signup" element={<SignupRoute />} />
      <Route path="/app" element={<AppRoute />} />
    </Routes>
  );
}

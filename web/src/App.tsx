import { Navigate, Route, Routes, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { usePhoneEntry } from "./phoneEntry";
import { AppShell } from "./pages/AppShell";
import { CareApp } from "./pages/CareApp";
import { DetailsPage } from "./pages/DetailsPage";
import { JoinPage } from "./pages/JoinPage";
import { LandingPage } from "./pages/LandingPage";
import { LoginPage } from "./pages/LoginPage";
import { SignupPage } from "./pages/SignupPage";
import { afterSignIn, clearSession, homePath, nextPath, readSession } from "./session";

function HomeRoute() {
  const phone = usePhoneEntry();
  if (phone) {
    const session = readSession();
    return <Navigate to={session ? homePath(session) : "/login"} replace />;
  }
  return <LandingPage />;
}

function LoginRoute() {
  const [params] = useSearchParams();
  const session = readSession();
  if (session) return <Navigate to={nextPath(params, session)} replace />;
  return <LoginPage />;
}

function SignupRoute() {
  const session = readSession();
  if (session) return <Navigate to={afterSignIn(session)} replace />;
  return <SignupPage />;
}

// The details a Google sign-up still owes. Anyone without a pending request goes to their own home.
function DetailsRoute() {
  const session = readSession();
  if (!session) return <Navigate to="/login" replace />;
  if (!session.detailsPending) return <Navigate to={afterSignIn(session)} replace />;
  return <DetailsPage />;
}

// A parent's join step. Someone with a link but no account signs up first, then comes back here.
function JoinRoute() {
  const { code } = useParams();
  const session = readSession();
  if (!session) return <Navigate to={code ? `/signup?code=${code}` : "/login"} replace />;
  if (session.detailsPending) return <Navigate to="/details" replace />;
  if (session.role === "caretaker") return <Navigate to="/care" replace />;
  return <JoinPage />;
}

// The parent's chat. A caretaker's own account opens the care desk instead.
function AppRoute() {
  const [params] = useSearchParams();
  const demo = params.get("demo") === "1";
  const session = readSession();
  if (demo) return <AppShell />;
  if (!session) return <Navigate to="/login" replace />;
  if (session.detailsPending) return <Navigate to="/details" replace />;
  if (session.role === "caretaker") return <Navigate to="/care" replace />;
  return <AppShell />;
}

// The caretaker's own app. It works on a phone and on a computer.
function CareRoute() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const demo = params.get("demo") === "1";
  const session = readSession();
  if (!demo && !session) return <Navigate to="/login?next=/care" replace />;
  if (!demo && session?.detailsPending) return <Navigate to="/details" replace />;
  if (!demo && session?.role === "parent") return <Navigate to="/app" replace />;
  return (
    <CareApp
      demo={demo}
      onLeave={() => {
        if (!demo) clearSession();
        navigate("/");
      }}
    />
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<HomeRoute />} />
      <Route path="/login" element={<LoginRoute />} />
      <Route path="/signup" element={<SignupRoute />} />
      <Route path="/details" element={<DetailsRoute />} />
      <Route path="/join" element={<JoinRoute />} />
      <Route path="/join/:code" element={<JoinRoute />} />
      <Route path="/app" element={<AppRoute />} />
      <Route path="/care" element={<CareRoute />} />
    </Routes>
  );
}

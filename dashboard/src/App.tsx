import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import { AuthGate, useAuth } from "@/components/AuthGate";
import Layout from "@/components/Layout";
import { Welcome } from "@/pages/Welcome";
import Dashboard from "@/pages/Dashboard";
import BatchList from "@/pages/BatchList";
import BatchDetail from "@/pages/BatchDetail";
import BatchNew from "@/pages/BatchNew";
import BatchEdit from "@/pages/BatchEdit";
import ActivityNew from "@/pages/ActivityNew";
import Tools from "@/pages/Tools";
import Settings from "@/pages/Settings";
import BatchComparison from "@/pages/BatchComparison";

function AuthenticatedRoutes() {
  const { isNewUser } = useAuth();

  if (isNewUser) {
    return (
      <Routes>
        <Route path="/welcome" element={<Welcome />} />
        <Route path="*" element={<Navigate to="/welcome" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/batches" element={<BatchList />} />
        <Route path="/batches/new" element={<BatchNew />} />
        <Route path="/batches/:id" element={<BatchDetail />} />
        <Route path="/batches/:id/edit" element={<BatchEdit />} />
        <Route path="/batches/:id/activities/new" element={<ActivityNew />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/tools" element={<Tools />} />
        <Route path="/compare" element={<BatchComparison />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <BrowserRouter>
        <AuthGate>
          <AuthenticatedRoutes />
        </AuthGate>
      </BrowserRouter>
      <Toaster position="top-center" style={{ top: "env(safe-area-inset-top, 0px)" }} />
    </ThemeProvider>
  );
}

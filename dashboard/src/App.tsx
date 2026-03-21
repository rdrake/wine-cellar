import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ThemeProvider } from "next-themes";
import Layout from "@/components/Layout";
import Dashboard from "@/pages/Dashboard";
import BatchList from "@/pages/BatchList";
import BatchDetail from "@/pages/BatchDetail";
import BatchNew from "@/pages/BatchNew";
import BatchEdit from "@/pages/BatchEdit";
import ActivityNew from "@/pages/ActivityNew";
import Tools from "@/pages/Tools";
import Settings from "@/pages/Settings";
import BatchComparison from "@/pages/BatchComparison";

export default function App() {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <BrowserRouter>
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
      </BrowserRouter>
    </ThemeProvider>
  );
}

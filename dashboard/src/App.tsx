import { BrowserRouter, Routes, Route } from "react-router-dom";
import AuthGuard from "@/components/AuthGuard";
import Layout from "@/components/Layout";
import Setup from "@/pages/Setup";
import BatchList from "@/pages/BatchList";
import BatchDetail from "@/pages/BatchDetail";
import BatchNew from "@/pages/BatchNew";
import BatchEdit from "@/pages/BatchEdit";
import ActivityNew from "@/pages/ActivityNew";
import Devices from "@/pages/Devices";
import Tools from "@/pages/Tools";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/setup" element={<Setup />} />
        <Route element={<AuthGuard />}>
          <Route element={<Layout />}>
            <Route path="/" element={<BatchList />} />
            <Route path="/batches/new" element={<BatchNew />} />
            <Route path="/batches/:id" element={<BatchDetail />} />
            <Route path="/batches/:id/edit" element={<BatchEdit />} />
            <Route path="/batches/:id/activities/new" element={<ActivityNew />} />
            <Route path="/devices" element={<Devices />} />
            <Route path="/tools" element={<Tools />} />
          </Route>
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

import { Navigate, Outlet } from "react-router-dom";
import { isConfigured } from "@/api";

export default function AuthGuard() {
  if (!isConfigured()) {
    return <Navigate to="/setup" replace />;
  }
  return <Outlet />;
}

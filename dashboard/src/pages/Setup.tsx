import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { setApiConfig, clearApiConfig, api } from "@/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function Setup() {
  const navigate = useNavigate();
  const [url, setUrl] = useState("https://wine-cellar-api.rdrake.workers.dev");
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setTesting(true);

    // Save config temporarily to test connection with an authenticated endpoint
    setApiConfig(url, key);
    try {
      await api.batches.list();
      navigate("/");
    } catch {
      clearApiConfig();
      setError("Could not connect. Check the URL and API key.");
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Wine Cellar</CardTitle>
          <CardDescription>Connect to your Wine Cellar API</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="url">API URL</Label>
              <Input
                id="url"
                type="url"
                placeholder="https://wine-cellar-api.workers.dev"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="key">API Key</Label>
              <Input
                id="key"
                type="password"
                placeholder="Your API key"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                required
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={testing}>
              {testing ? "Testing..." : "Connect"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

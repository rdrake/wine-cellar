import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Wine } from "lucide-react";
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
      setError("Connection failed. The URL or API key may be incorrect — double-check both and try again.");
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <Wine className="size-10 text-primary mx-auto mb-2" strokeWidth={1.5} />
          <CardTitle className="font-heading text-2xl tracking-tight">Wine Cellar</CardTitle>
          <CardDescription>Connect to your API</CardDescription>
          <p className="text-xs text-muted-foreground">Your personal winemaking dashboard</p>
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
              {testing ? "Connecting..." : "Connect"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

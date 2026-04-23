import { Info } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

export function DataSourceInfo() {
  return (
    <Alert className="border-blue-500 bg-blue-50">
      <Info className="h-4 w-4 text-blue-600" />
      <AlertDescription className="text-blue-900">
        <strong>Data Sources:</strong> Crypto via Binance + CoinGecko | NSE/BSE via Yahoo Finance (free, delayed)
      </AlertDescription>
    </Alert>
  );
}

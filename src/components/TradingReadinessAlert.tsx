import React, { useEffect, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertTriangle, CheckCircle2, AlertCircle } from "lucide-react";

interface TradingReadinessAlertProps {
  isReady: boolean;
  dataQualityScore: number;
  recentAccuracy: number;
  recentBrier: number;
  sampleCount: number;
}

export function TradingReadinessAlert({
  isReady,
  dataQualityScore,
  recentAccuracy,
  recentBrier,
  sampleCount,
}: TradingReadinessAlertProps) {
  // Avoid SSR hydration mismatch: server has no localStorage so accuracy/score
  // start at 0, while the client mounts with persisted values. Render nothing
  // on the first server pass; once mounted on the client we show real data.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  if (!mounted) return null;
  if (isReady) {
    return (
      <Alert className="border-green-500 bg-green-50">
        <CheckCircle2 className="h-4 w-4 text-green-600" />
        <AlertTitle className="text-green-900">✓ Ready to Trade</AlertTitle>
        <AlertDescription className="text-green-800">
          Model is well-trained and data quality is good. Confidence ranges are stable. Start with small positions to validate.
        </AlertDescription>
      </Alert>
    );
  }

  const issues: string[] = [];
  if (dataQualityScore < 0.6) {
    issues.push(`Data quality too low: ${(dataQualityScore * 100).toFixed(0)}% (need >60%)`);
  }
  if (recentAccuracy < 0.54) {
    issues.push(`Model accuracy too low: ${(recentAccuracy * 100).toFixed(1)}% (need >54%)`);
  }
  if (recentBrier > 0.24) {
    issues.push(`Brier score too high: ${recentBrier.toFixed(3)} (need <0.24)`);
  }
  if (sampleCount < 80) {
    issues.push(`Not enough training samples: ${sampleCount} (need >80)`);
  }

  const isCritical = issues.length >= 2;
  const AlertIcon = isCritical ? AlertTriangle : AlertCircle;
  const bgColor = isCritical ? "bg-red-50" : "bg-amber-50";
  const borderColor = isCritical ? "border-red-500" : "border-amber-500";
  const titleColor = isCritical ? "text-red-900" : "text-amber-900";
  const descColor = isCritical ? "text-red-800" : "text-amber-800";
  const iconColor = isCritical ? "text-red-600" : "text-amber-600";

  return (
    <Alert className={`${borderColor} ${bgColor}`}>
      <AlertIcon className={`h-4 w-4 ${iconColor}`} />
      <AlertTitle className={titleColor}>
        {isCritical ? "⚠ NOT Ready" : "⚠ Caution"}
      </AlertTitle>
      <AlertDescription className={descColor}>
        <div className="space-y-1">
          {issues.map((issue, i) => (
            <div key={i}>• {issue}</div>
          ))}
          {isCritical
            ? " Wait for model to improve before trading real money."
            : " Consider reducing position size or waiting for better conditions."}
        </div>
      </AlertDescription>
    </Alert>
  );
}

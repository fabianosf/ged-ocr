import type { ReactNode } from "react";
import { CheckCircle2, CircleAlert, Info } from "lucide-react";
import { Alert, AlertDescription } from "./ui/alert";

const tones = {
  info: "border-[#cde4e3] bg-[#f0f8f8] text-[#285965] [&_[data-slot=alert-description]]:text-[#285965]",
  warning: "border-[#f0dfbb] bg-[#fffaf0] text-[#7c5316] [&_[data-slot=alert-description]]:text-[#7c5316]",
  error: "border-[#efccc6] bg-[#fff5f4]",
  success: "border-[#cce9d8] bg-[#f0faf5] text-[#166534] [&_[data-slot=alert-description]]:text-[#166534]",
};

export function Notice({ children, tone = "info" }: {
  children: ReactNode;
  tone?: "info" | "warning" | "error" | "success";
}) {
  const Icon = tone === "success" ? CheckCircle2
    : tone === "warning" || tone === "error" ? CircleAlert : Info;
  return (
    <Alert variant={tone === "error" ? "destructive" : "default"}
      role={tone === "error" ? "alert" : "status"} className={`app-notice ${tones[tone]}`}>
      <Icon aria-hidden="true" />
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}

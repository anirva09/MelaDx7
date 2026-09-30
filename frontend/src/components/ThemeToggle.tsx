import { Monitor, Moon, Sun } from "lucide-react";

import { Segmented } from "@/components/ui/segmented";
import { useTheme } from "@/context/ThemeContext";

export function ThemeToggle({ className, labels = false }: { className?: string; labels?: boolean }) {
  const { preference, setPreference } = useTheme();
  const label = (text: string) => (labels ? text : <span className="sr-only">{text}</span>);
  return (
    <Segmented
      size="sm"
      label="Colour theme"
      value={preference}
      onValueChange={setPreference}
      className={className}
      options={[
        { value: "dark", label: label("Dark"), icon: <Moon aria-hidden />, title: "Dark" },
        { value: "light", label: label("Light"), icon: <Sun aria-hidden />, title: "Light" },
        { value: "system", label: label("System"), icon: <Monitor aria-hidden />, title: "Match system" },
      ]}
    />
  );
}

import { Monitor, Moon, Sun } from "lucide-react";

import { Segmented } from "@/components/ui/segmented";
import { useTheme } from "@/context/ThemeContext";

export function ThemeToggle({ className }: { className?: string }) {
  const { preference, setPreference } = useTheme();
  return (
    <Segmented
      size="sm"
      label="Colour theme"
      value={preference}
      onValueChange={setPreference}
      className={className}
      options={[
        {
          value: "light",
          label: <span className="sr-only">Light</span>,
          icon: <Sun aria-hidden />,
          title: "Light",
        },
        {
          value: "dark",
          label: <span className="sr-only">Dark</span>,
          icon: <Moon aria-hidden />,
          title: "Dark",
        },
        {
          value: "system",
          label: <span className="sr-only">System</span>,
          icon: <Monitor aria-hidden />,
          title: "Match system",
        },
      ]}
    />
  );
}

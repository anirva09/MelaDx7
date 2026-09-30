import { render, screen } from "@testing-library/react";

import type { Prediction } from "@/api/types";
import { PredictionCard } from "@/components/PredictionCard";
import { TooltipProvider } from "@/components/ui/tooltip";
import { makePrediction } from "@/test/fixtures";

function renderCard(overrides: Partial<Prediction> = {}) {
  return render(
    <TooltipProvider>
      <PredictionCard prediction={makePrediction(overrides)} />
    </TooltipProvider>,
  );
}

describe("PredictionCard", () => {
  it("shows the predicted class, its probability and the combined concern probability", () => {
    renderCard();
    expect(screen.getByTestId("predicted-class")).toHaveTextContent("Melanocytic nevus");
    expect(screen.getByTestId("predicted-confidence")).toHaveTextContent("66.0%");
    expect(screen.getByText("26.0%")).toBeInTheDocument();
    expect(screen.getByText(/Not a risk score/)).toBeInTheDocument();
    expect(screen.queryByText("Uncertain prediction")).not.toBeInTheDocument();
  });

  it("explains why a prediction is flagged uncertain", () => {
    renderCard({
      uncertainty: {
        uncertain: true,
        reasons: ["low_top_probability", "small_margin_between_top_classes"],
        margin: 0.05,
        normalized_entropy: 0.9,
        low_confidence_threshold: 0.6,
        low_margin_threshold: 0.15,
      },
    });
    expect(screen.getByRole("alert")).toHaveTextContent("Uncertain prediction");
    expect(screen.getByText(/less than 60% probability/)).toBeInTheDocument();
    expect(screen.getByText(/within 15 percentage points/)).toBeInTheDocument();
  });
});

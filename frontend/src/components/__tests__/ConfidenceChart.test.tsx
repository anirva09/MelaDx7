import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ConfidenceChart } from "@/components/ConfidenceChart";
import { makePrediction } from "@/test/fixtures";

describe("ConfidenceChart", () => {
  const prediction = makePrediction();

  it("lists every class with its probability, highest first", () => {
    render(<ConfidenceChart probabilities={prediction.probabilities} predictedCode="nv" />);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(7);
    expect(items[0]).toHaveTextContent("Melanocytic nevus: 66.0%");
    expect(items[1]).toHaveTextContent("Melanoma: 21.0%");
  });

  it("lets the user pick a class to explain", async () => {
    const onSelect = vi.fn();
    render(
      <ConfidenceChart
        probabilities={prediction.probabilities}
        predictedCode="nv"
        selectedCode="nv"
        onSelect={onSelect}
      />,
    );
    const melanoma = screen.getByRole("button", { name: /Melanoma: 21.0%/ });
    expect(melanoma).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: /Melanocytic nevus/ })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(melanoma);
    expect(onSelect).toHaveBeenCalledWith("mel");
  });
});

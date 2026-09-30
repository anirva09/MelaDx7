import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";

import { RouteErrorPage } from "@/pages/RouteErrorPage";

function Boom(): never {
  throw new Error("render failure");
}

describe("RouteErrorPage", () => {
  it("contains a page crash instead of blanking the app", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const router = createMemoryRouter([{ path: "/", element: <Boom />, errorElement: <RouteErrorPage /> }], {
      initialEntries: ["/"],
    });
    render(<RouterProvider router={router} />);
    expect(screen.getByRole("alert")).toHaveTextContent("This page stopped working");
    expect(screen.getByRole("button", { name: /Reload/ })).toBeInTheDocument();
    expect(screen.queryByText("render failure")).not.toBeInTheDocument();
  });
});

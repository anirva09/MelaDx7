import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";

import { tokenStore } from "@/api/client";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/context/AuthContext";
import { ThemeProvider } from "@/context/ThemeContext";
import { LoginPage } from "@/pages/LoginPage";
import { GuestRoute, ProtectedRoute } from "@/routes/ProtectedRoute";
import { user } from "@/test/fixtures";
import { json, mockFetch, testQueryClient } from "@/test/utils";

function renderApp(initial: string) {
  const router = createMemoryRouter(
    [
      { element: <GuestRoute />, children: [{ path: "/login", element: <LoginPage /> }] },
      {
        element: <ProtectedRoute />,
        children: [{ path: "/app/*", element: <p>Workspace for {"signed-in"} user</p> }],
      },
    ],
    { initialEntries: [initial] },
  );
  render(
    <ThemeProvider>
      <QueryClientProvider client={testQueryClient()}>
        <AuthProvider>
          <TooltipProvider>
            <RouterProvider router={router} />
          </TooltipProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ThemeProvider>,
  );
  return router;
}

describe("authentication flow", () => {
  beforeEach(() => tokenStore.set(null));

  it("redirects anonymous visitors from protected pages to sign-in", async () => {
    mockFetch({ "POST /api/auth/refresh": () => json({ error: { code: "no_session", message: "x" } }, 401) });
    const router = renderApp("/app/analyses");
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/login");
  });

  it("validates the form, then signs in and returns to the requested page", async () => {
    const { calls } = mockFetch({
      "POST /api/auth/refresh": () => json({ error: { code: "no_session", message: "x" } }, 401),
      "POST /api/auth/login": () =>
        json({ access_token: "tok", token_type: "bearer", expires_in: 900, user }),
    });
    const router = renderApp("/app/analyses");
    await screen.findByRole("heading", { name: "Sign in" });

    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("Enter your email address.")).toBeInTheDocument();
    expect(screen.getByText("Enter your password.")).toBeInTheDocument();
    expect(calls.some((c) => c.url.pathname === "/api/auth/login")).toBe(false);

    await userEvent.type(screen.getByLabelText("Email"), "tester@example.org");
    await userEvent.type(screen.getByLabelText("Password"), "a-password-1");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(router.state.location.pathname).toBe("/app/analyses"));
    expect(screen.getByText(/Workspace for signed-in user/)).toBeInTheDocument();
    expect(tokenStore.get()).toBe("tok");
  });

  it("shows the server's message for wrong credentials", async () => {
    mockFetch({
      "POST /api/auth/refresh": () => json({ error: { code: "no_session", message: "x" } }, 401),
      "POST /api/auth/login": () =>
        json({ error: { code: "invalid_credentials", message: "Incorrect email or password." } }, 401),
    });
    renderApp("/login");
    await screen.findByRole("heading", { name: "Sign in" });
    await userEvent.type(screen.getByLabelText("Email"), "tester@example.org");
    await userEvent.type(screen.getByLabelText("Password"), "wrong-password-1");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("Incorrect email or password.")).toBeInTheDocument();
  });
});

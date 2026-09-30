import { QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { lazy, Suspense, useState } from "react";
import { createBrowserRouter, Navigate, RouterProvider } from "react-router-dom";
import { Toaster } from "sonner";

import { ApiError } from "@/api/client";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/context/AuthContext";
import { ThemeProvider, useTheme } from "@/context/ThemeContext";
import { useIsDesktop } from "@/hooks/useMediaQuery";
import { AppLayout } from "@/layouts/AppLayout";
import { LandingPage } from "@/pages/LandingPage";
import { LoginPage } from "@/pages/LoginPage";
import { NotFoundPage } from "@/pages/NotFoundPage";
import { RegisterPage } from "@/pages/RegisterPage";
import { RouteErrorPage } from "@/pages/RouteErrorPage";
import { FullPageSpinner, GuestRoute, ProtectedRoute } from "@/routes/ProtectedRoute";
import { LoadingState } from "@/components/States";

// Signed-in pages are split into their own chunks (charts are only loaded when needed).
const HomePage = lazy(() => import("@/pages/HomePage").then((m) => ({ default: m.HomePage })));
const AnalyzePage = lazy(() => import("@/pages/AnalyzePage").then((m) => ({ default: m.AnalyzePage })));
const HistoryPage = lazy(() => import("@/pages/HistoryPage").then((m) => ({ default: m.HistoryPage })));
const AnalysisDetailPage = lazy(() =>
  import("@/pages/AnalysisDetailPage").then((m) => ({ default: m.AnalysisDetailPage })),
);
const ModelPage = lazy(() => import("@/pages/ModelPage").then((m) => ({ default: m.ModelPage })));
const ReportsPage = lazy(() => import("@/pages/ReportsPage").then((m) => ({ default: m.ReportsPage })));
const ProfilePage = lazy(() => import("@/pages/ProfilePage").then((m) => ({ default: m.ProfilePage })));

function page(element: React.ReactNode) {
  return <Suspense fallback={<LoadingState label="Loading page" />}>{element}</Suspense>;
}

// eslint-disable-next-line react-refresh/only-export-components
export const routes = [
  {
    // Every page renders inside this boundary, so a crash never blanks the whole app.
    errorElement: <RouteErrorPage />,
    children: [
      { path: "/", element: <LandingPage /> },
      {
        element: <GuestRoute />,
        children: [
          { path: "/login", element: <LoginPage /> },
          { path: "/register", element: <RegisterPage /> },
        ],
      },
      {
        element: <ProtectedRoute />,
        children: [
          {
            path: "/app",
            element: <AppLayout />,
            children: [
              {
                // Errors inside the workspace keep the sidebar and navigation usable.
                errorElement: <RouteErrorPage inline />,
                children: [
                  { index: true, element: page(<HomePage />) },
                  { path: "analyze", element: page(<AnalyzePage />) },
                  { path: "analyses", element: page(<HistoryPage />) },
                  { path: "analyses/:id", element: page(<AnalysisDetailPage />) },
                  { path: "model", element: page(<ModelPage />) },
                  { path: "reports", element: page(<ReportsPage />) },
                  { path: "profile", element: page(<ProfilePage />) },
                  { path: "settings", element: <Navigate to="/app/profile" replace /> },
                ],
              },
            ],
          },
        ],
      },
      { path: "/dashboard", element: <Navigate to="/app" replace /> },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
];

// eslint-disable-next-line react-refresh/only-export-components
export function createQueryClient(): QueryClient {
  return new QueryClient({
    queryCache: new QueryCache(),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        retry: (count, error) => {
          // Never retry client errors (4xx); retry transient failures twice.
          if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
          return count < 2;
        },
      },
      mutations: { retry: false },
    },
  });
}

function ThemedToaster() {
  const { resolved } = useTheme();
  const desktop = useIsDesktop();
  return (
    <Toaster
      theme={resolved}
      // Phones: banners drop in below the floating top controls, clear of the tab bar.
      position={desktop ? "bottom-right" : "top-center"}
      mobileOffset={{ top: "calc(var(--topbar-top) + 56px)" }}
      closeButton={desktop}
      toastOptions={{
        classNames: {
          toast:
            "!rounded-[16px] !border-0 !bg-[var(--surface-2)] !text-ink !font-sans !shadow-[var(--shadow-pop)]",
          description: "!text-ink-2",
        },
      }}
    />
  );
}

const router = createBrowserRouter(routes);

export default function App() {
  const [queryClient] = useState(createQueryClient);
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <TooltipProvider>
            <Suspense fallback={<FullPageSpinner />}>
              <RouterProvider router={router} />
            </Suspense>
            <ThemedToaster />
          </TooltipProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

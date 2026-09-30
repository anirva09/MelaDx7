// Apply the saved colour theme before first paint to avoid a light/dark flash.
// Loaded as a same-origin file so the Content-Security-Policy can forbid inline scripts.
(function () {
  try {
    var t = localStorage.getItem("lesionlens-theme");
    var dark = t === "dark" || (t !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", dark);
  } catch (e) {
    /* storage unavailable: fall back to the light theme */
  }
})();

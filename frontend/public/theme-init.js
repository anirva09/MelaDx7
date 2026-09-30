// Apply the saved colour theme before first paint to avoid a flash. Dark is the default
// (the product's reference design is dark); "light" and "system" are opt-in.
// Loaded as a same-origin file so the Content-Security-Policy can forbid inline scripts.
(function () {
  var dark = true;
  try {
    var t = localStorage.getItem("meladx7-theme");
    if (t === "light") dark = false;
    else if (t === "system") dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch (e) {
    /* storage unavailable: keep the default dark theme */
  }
  document.documentElement.classList.toggle("dark", dark);
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", dark ? "#141414" : "#f2f2f2");
})();

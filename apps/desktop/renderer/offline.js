const q = new URLSearchParams(location.search);
document.getElementById("d").textContent = (q.get("desc") || "") + " — " + (q.get("url") || "");
document.getElementById("r").onclick = () => window.mizanDesktop.retry();

(async () => {
  const cfg = await window.mizanDesktop.getConfig();
  document.getElementById("ver").textContent = `الإصدار ${cfg.version}`;
  const url = document.getElementById("cloudUrl");
  url.value = cfg.cloudUrl || cfg.defaultCloud;
  const go = async (mode, btn) => {
    document.querySelectorAll(".btn").forEach((b) => (b.disabled = true));
    btn.textContent = mode === "local" ? "جارٍ التجهيز… قد يستغرق دقيقة أول مرة" : "جارٍ الاتصال…";
    await window.mizanDesktop.chooseMode(mode, url.value.trim());
  };
  document.getElementById("cloud").onclick = (e) => go("cloud", e.target);
  document.getElementById("local").onclick = (e) => go("local", e.target);
})();

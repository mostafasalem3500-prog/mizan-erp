(async () => {
  const cfg = await window.mizanDesktop.getConfig();
  const $ = (id) => document.getElementById(id);
  $("ver").textContent = `الإصدار ${cfg.version}`;
  $("dev").textContent = `معرّف الجهاز: ${cfg.deviceId}`;
  const url = $("cloudUrl");
  url.value = cfg.cloudUrl || cfg.defaultCloud;
  $("remember").checked = !!cfg.remember;
  if (cfg.mode) {
    $("last").hidden = false;
    $("last").textContent = `آخر استخدام: ${cfg.mode === "local" ? "💻 الوضع المحلي" : "☁️ الوضع السحابي"}`;
    $(cfg.mode === "local" ? "c-local" : "c-cloud").classList.add("chosen");
  }
  $("localHint").textContent = cfg.hasLocalData ? "توجد قاعدة بيانات محلية على هذا الجهاز — ستُفتح كما هي." : "أول تشغيل: تجهيز قاعدة البيانات يستغرق أقل من دقيقة.";
  const go = async (mode, btn) => {
    document.querySelectorAll(".btn").forEach((b) => (b.disabled = true));
    btn.textContent = mode === "local" ? "جارٍ تشغيل قاعدة البيانات المحلية…" : "جارٍ الاتصال…";
    await window.mizanDesktop.chooseMode(mode, url.value.trim(), $("remember").checked);
  };
  $("cloud").onclick = (e) => go("cloud", e.target);
  $("local").onclick = (e) => go("local", e.target);
  document.addEventListener("keydown", (e) => { if (e.key === "Enter" && cfg.mode) $(cfg.mode).click(); });
})();

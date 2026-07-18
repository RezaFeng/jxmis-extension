const NAVIGATION_ID = "cw-business-analytics-navigation";
const HOST_ID = "cw-business-analytics-host";

export function isBusinessAnalyticsHomePage(location) {
  const value = String(location && location.href || "") + " " + String(location && location.hash || "");
  return value.includes("/project/ProjectInfoService/projectinDedaultHomePage");
}

export function createBusinessAnalyticsNavigation(adapters) {
  const document = adapters.document;
  const window = adapters.window;
  let active = null;

  function findNavigationHost() {
    return document.querySelector("#projectInfoForm .panel-toolbar .form-inline") ||
      document.querySelector(".panel-toolbar .form-inline") ||
      document.querySelector(".content-header .pull-right") ||
      document.querySelector(".content-header") ||
      document.body;
  }

  function ensure(onOpen) {
    if (!isBusinessAnalyticsHomePage(window.location)) return null;
    const existing = document.getElementById(NAVIGATION_ID);
    if (existing) return existing;
    const button = document.createElement("button");
    button.id = NAVIGATION_ID;
    button.type = "button";
    button.className = "btn btn-info";
    button.textContent = "经营分析";
    button.addEventListener("click", onOpen);
    findNavigationHost().appendChild(button);
    return button;
  }

  function findMainContent() {
    return document.querySelector("#projectInfoForm") ||
      document.querySelector("#content-main") ||
      document.querySelector(".content-wrapper") ||
      document.querySelector(".main-content") ||
      document.querySelector("#page-wrapper") ||
      document.querySelector("main");
  }

  function mount() {
    if (active) return active.shadowRoot;
    const content = findMainContent();
    if (!content || !content.parentNode) {
      throw new Error("未找到 JXPMO 主内容区");
    }
    const host = document.createElement("div");
    host.id = HOST_ID;
    content.insertAdjacentElement("afterend", host);
    const previous = {
      display: content.style.display,
      ariaHidden: content.getAttribute("aria-hidden")
    };
    content.style.display = "none";
    content.setAttribute("aria-hidden", "true");
    active = { content, host, previous, shadowRoot: host.attachShadow({ mode: "open" }) };
    return active.shadowRoot;
  }

  function restore() {
    if (!active) return;
    active.content.style.display = active.previous.display;
    if (active.previous.ariaHidden === null) active.content.removeAttribute("aria-hidden");
    else active.content.setAttribute("aria-hidden", active.previous.ariaHidden);
    active.host.remove();
    active = null;
  }

  function syncLocation() {
    if (!isBusinessAnalyticsHomePage(window.location)) restore();
  }

  return { ensure, mount, restore, syncLocation, isActive: function () { return Boolean(active); } };
}

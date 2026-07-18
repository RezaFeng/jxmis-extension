const NAVIGATION_ID = "cw-business-analytics-navigation";
const HOST_ID = "cw-business-analytics-host";
const MENU_SELECTOR = "#menunav";
const MENU_REFERENCE_SELECTOR = '#menunav > li[appid="project:1201,jxoa"]';
const CONTENT_WRAPPER_SELECTOR = "#content-wrapper";

export function isBusinessAnalyticsProjectModule(document) {
  return Boolean(document && document.querySelector(MENU_REFERENCE_SELECTOR));
}

export function createBusinessAnalyticsNavigation(adapters) {
  const document = adapters.document;
  const window = adapters.window;
  let active = null;
  let boundMenu = null;
  let onNavigateAway = function () {};

  function findNavigationHost() {
    return document.querySelector(MENU_SELECTOR);
  }

  function findNavigationReference() {
    return document.querySelector(MENU_REFERENCE_SELECTOR);
  }

  function setActiveMenuItem(menu, item) {
    const previousMenuClasses = Array.from(menu.children).map(function (menuItem) {
      return { menuItem, className: menuItem.className };
    });
    previousMenuClasses.forEach(function (entry) {
      entry.menuItem.classList.remove("active", "open");
    });
    item.classList.add("active", "open");
    return previousMenuClasses;
  }

  function bindMenu(menu) {
    if (boundMenu === menu) return;
    boundMenu = menu;
    menu.addEventListener("click", function (event) {
      if (!active) return;
      const clickedItem = event.target.closest("li");
      if (!clickedItem || clickedItem === active.menuItem) return;
      onNavigateAway();
    }, true);
  }

  function createNavigationItem(reference, onOpen) {
    const item = reference.cloneNode(true);
    item.id = NAVIGATION_ID;
    item.setAttribute("appid", "cw:business-analytics");
    item.classList.remove("active", "open");

    const link = item.querySelector("a");
    link.setAttribute("href", "javascript:;");
    link.setAttribute("url", "");
    item.querySelector("span.appname").textContent = " 经营分析 ";
    const count = item.querySelector(".msgcount");
    if (count) {
      count.textContent = "";
      count.removeAttribute("msgcount");
    }
    link.addEventListener("click", function (event) {
      event.preventDefault();
      event.stopPropagation();
      if (!active) onOpen();
    });
    return item;
  }

  function ensure(onOpen, onLeave) {
    const menu = findNavigationHost();
    const reference = findNavigationReference();
    if (!menu || !reference) return null;
    onNavigateAway = onLeave || function () { restore(); };
    bindMenu(menu);

    let item = document.getElementById(NAVIGATION_ID);
    if (!item || item.parentNode !== menu) {
      if (item) item.remove();
      item = createNavigationItem(reference, onOpen);
      reference.insertAdjacentElement("afterend", item);
    }
    if (active && active.menuItem !== item) {
      active.previousMenuClasses = setActiveMenuItem(menu, item);
      active.menuItem = item;
    }
    return item;
  }

  function findMainContent() {
    return document.querySelector(CONTENT_WRAPPER_SELECTOR);
  }

  function mount() {
    if (active) return active.shadowRoot;
    const wrapper = findMainContent();
    const menu = findNavigationHost();
    const menuItem = document.getElementById(NAVIGATION_ID);
    if (!wrapper || !menu || !menuItem) {
      throw new Error("未找到 JXPMO 主内容区或项目菜单");
    }

    const nativeContents = Array.from(wrapper.children).map(function (content) {
      return {
        content,
        display: content.style.display,
        ariaHidden: content.getAttribute("aria-hidden")
      };
    });
    nativeContents.forEach(function (entry) {
      entry.content.style.display = "none";
      entry.content.setAttribute("aria-hidden", "true");
    });

    const host = document.createElement("div");
    host.id = HOST_ID;
    wrapper.appendChild(host);
    active = {
      host,
      menuItem,
      nativeContents,
      previousMenuClasses: setActiveMenuItem(menu, menuItem),
      locationKey: String(window.location.href || "") + " " + String(window.location.hash || ""),
      shadowRoot: host.attachShadow({ mode: "open" })
    };
    return active.shadowRoot;
  }

  function restore() {
    if (!active) return;
    const current = active;
    active = null;
    current.nativeContents.forEach(function (entry) {
      entry.content.style.display = entry.display;
      if (entry.ariaHidden === null) entry.content.removeAttribute("aria-hidden");
      else entry.content.setAttribute("aria-hidden", entry.ariaHidden);
    });
    current.previousMenuClasses.forEach(function (entry) {
      if (entry.menuItem.isConnected) entry.menuItem.className = entry.className;
    });
    current.host.remove();
  }

  function syncLocation() {
    if (!active) return;
    const locationKey = String(window.location.href || "") + " " + String(window.location.hash || "");
    if (!isBusinessAnalyticsProjectModule(document) || locationKey !== active.locationKey) restore();
  }

  return { ensure, mount, restore, syncLocation, isActive: function () { return Boolean(active); } };
}

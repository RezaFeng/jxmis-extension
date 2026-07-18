import assert from "node:assert/strict";
import test from "node:test";
import {
  createBusinessAnalyticsNavigation,
  isBusinessAnalyticsProjectModule
} from "../../src/content/business-analytics/navigation.js";

class FakeClassList {
  constructor(element) {
    this.element = element;
  }

  values() {
    return this.element.className.split(/\s+/).filter(Boolean);
  }

  add(...names) {
    this.element.className = Array.from(new Set(this.values().concat(names))).join(" ");
  }

  remove(...names) {
    this.element.className = this.values().filter(function (name) {
      return !names.includes(name);
    }).join(" ");
  }

  contains(name) {
    return this.values().includes(name);
  }
}

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.id = "";
    this.className = "";
    this.attributes = new Map();
    this.children = [];
    this.parentNode = null;
    this.style = { display: "" };
    this.textContent = "";
    this.listeners = {};
    this.classList = new FakeClassList(this);
  }

  get isConnected() {
    let current = this;
    while (current) {
      if (current.isDocument) return true;
      current = current.parentNode;
    }
    return false;
  }

  setAttribute(name, value) {
    if (name === "id") this.id = String(value);
    else if (name === "class") this.className = String(value);
    else this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    if (name === "id") return this.id || null;
    if (name === "class") return this.className || null;
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  appendChild(child) {
    if (child.parentNode) child.remove();
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  insertAdjacentElement(position, child) {
    assert.equal(position, "afterend");
    const index = this.parentNode.children.indexOf(this);
    if (child.parentNode) child.remove();
    child.parentNode = this.parentNode;
    this.parentNode.children.splice(index + 1, 0, child);
    return child;
  }

  remove() {
    if (!this.parentNode || !this.parentNode.children) return;
    const index = this.parentNode.children.indexOf(this);
    if (index >= 0) this.parentNode.children.splice(index, 1);
    this.parentNode = null;
  }

  cloneNode(deep) {
    const clone = new FakeElement(this.tagName);
    clone.id = this.id;
    clone.className = this.className;
    clone.textContent = this.textContent;
    this.attributes.forEach(function (value, name) { clone.attributes.set(name, value); });
    if (deep) this.children.forEach(function (child) { clone.appendChild(child.cloneNode(true)); });
    return clone;
  }

  querySelector(selector) {
    const matches = function (element) {
      if (selector === "a") return element.tagName === "A";
      if (selector === "span.appname") {
        return element.tagName === "SPAN" && element.classList.contains("appname");
      }
      if (selector === ".msgcount") return element.classList.contains("msgcount");
      return false;
    };
    const queue = this.children.slice();
    while (queue.length) {
      const current = queue.shift();
      if (matches(current)) return current;
      queue.push(...current.children);
    }
    return null;
  }

  closest(selector) {
    let current = this;
    while (current && !current.isDocument) {
      if (selector === "li" && current.tagName === "LI") return current;
      current = current.parentNode;
    }
    return null;
  }

  addEventListener(type, listener, capture = false) {
    this.listeners[type] ||= [];
    this.listeners[type].push({ listener, capture: Boolean(capture) });
  }

  click() {
    let stopped = false;
    const event = {
      target: this,
      preventDefault: function () {},
      stopPropagation: function () { stopped = true; }
    };
    const path = [];
    let current = this;
    while (current && !current.isDocument) {
      path.push(current);
      current = current.parentNode;
    }
    path.slice().reverse().forEach(function (element) {
      if (stopped) return;
      (element.listeners.click || []).filter(function (entry) { return entry.capture; })
        .forEach(function (entry) { entry.listener(event); });
    });
    path.forEach(function (element, index) {
      if (stopped || index > 0) return;
      (element.listeners.click || []).filter(function (entry) { return !entry.capture; })
        .forEach(function (entry) { entry.listener(event); });
    });
  }

  attachShadow() {
    return { host: this };
  }
}

function createMenuItem(appId, label, className = "") {
  const item = new FakeElement("li");
  item.setAttribute("appid", appId);
  item.className = className;
  const link = item.appendChild(new FakeElement("a"));
  link.className = "dropdown-toggle single";
  link.setAttribute("url", "/project/example");
  const icon = link.appendChild(new FakeElement("i"));
  icon.className = "fa topmenu fa-file-text-o";
  const text = link.appendChild(new FakeElement("span"));
  text.className = "appname";
  text.textContent = label;
  const count = link.appendChild(new FakeElement("span"));
  count.className = "msgcount";
  count.setAttribute("msgcount", appId);
  const arrow = link.appendChild(new FakeElement("i"));
  arrow.className = "fa fa-angle-right drop-icon";
  return item;
}

function createFixture() {
  const document = {
    isDocument: true,
    children: [],
    createElement: function (tagName) { return new FakeElement(tagName); },
    querySelector: function (selector) {
      if (selector === "#menunav") return menu;
      if (selector === '#menunav > li[appid="project:1201,jxoa"]') return template;
      if (selector === "#content-wrapper") return wrapper;
      return null;
    },
    getElementById: function (id) {
      const queue = this.children.slice();
      while (queue.length) {
        const current = queue.shift();
        if (current.id === id) return current;
        queue.push(...current.children);
      }
      return null;
    }
  };
  const menu = new FakeElement("ul");
  menu.id = "menunav";
  const home = menu.appendChild(createMenuItem("project:0101,jxoa", " 首页 ", "open active"));
  const template = menu.appendChild(createMenuItem("project:1201,jxoa", " 项目文档模板 "));
  const wrapper = new FakeElement("div");
  wrapper.id = "content-wrapper";
  const app = wrapper.appendChild(new FakeElement("div"));
  app.id = "app-wrapper";
  const frame = wrapper.appendChild(new FakeElement("iframe"));
  frame.id = "app-wrapper-frame";
  frame.style.display = "none";
  menu.parentNode = document;
  wrapper.parentNode = document;
  document.children.push(menu, wrapper);
  return { document, menu, home, template, wrapper, app, frame };
}

test("business analytics reuses the project menu and replaces only right-side content", function () {
  const fixture = createFixture();
  const window = { location: { href: "https://jxmis.cyberwing.cn/jxpmo/index/frame", hash: "#!/project/home" } };
  const navigation = createBusinessAnalyticsNavigation({ document: fixture.document, window });
  let opened = 0;
  let left = 0;
  let shadowRoot;

  const item = navigation.ensure(function () {
    opened += 1;
    shadowRoot = navigation.mount();
  }, function () {
    left += 1;
    navigation.restore();
  });

  assert.equal(isBusinessAnalyticsProjectModule(fixture.document), true);
  assert.equal(fixture.menu.children.indexOf(item), fixture.menu.children.indexOf(fixture.template) + 1);
  assert.equal(item.querySelector("span.appname").textContent.trim(), "经营分析");
  assert.equal(item.querySelector("a").className, fixture.template.querySelector("a").className);

  item.querySelector("a").click();

  assert.equal(opened, 1);
  assert.ok(shadowRoot);
  assert.equal(fixture.app.style.display, "none");
  assert.equal(fixture.app.getAttribute("aria-hidden"), "true");
  assert.equal(fixture.frame.style.display, "none");
  assert.equal(item.classList.contains("active"), true);
  assert.equal(fixture.home.classList.contains("active"), false);
  assert.equal(fixture.document.getElementById("cw-business-analytics-host").parentNode, fixture.wrapper);

  fixture.home.querySelector("a").click();

  assert.equal(left, 1);
  assert.equal(navigation.isActive(), false);
  assert.equal(fixture.app.style.display, "");
  assert.equal(fixture.app.getAttribute("aria-hidden"), null);
  assert.equal(fixture.frame.style.display, "none");
  assert.equal(fixture.home.className, "open active");
  assert.equal(fixture.document.getElementById("cw-business-analytics-host"), null);
});

test("business analytics restores native content when the host route changes", function () {
  const fixture = createFixture();
  const window = { location: { href: "https://jxmis.cyberwing.cn/jxpmo/index/frame", hash: "#!/project/home" } };
  const navigation = createBusinessAnalyticsNavigation({ document: fixture.document, window });
  const item = navigation.ensure(function () { navigation.mount(); }, function () { navigation.restore(); });

  item.querySelector("a").click();
  window.location.hash = "#!/project/ModelFileService/modelfileListPage";
  navigation.syncLocation();

  assert.equal(navigation.isActive(), false);
  assert.equal(fixture.app.style.display, "");
  assert.equal(fixture.home.className, "open active");
});

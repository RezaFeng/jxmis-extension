window.__fixtureMessages = [];
window.__fixtureSaveAllCalls = 0;

window.addEventListener("message", function (event) {
  const data = event.data;
  if (event.source === window && data && typeof data.source === "string" && data.source.startsWith("cw-")) {
    window.__fixtureMessages.push(data);
  }
});

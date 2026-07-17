export function createAutomationRegistry(automations, loadScripts, onError) {
  function ensure() {
    automations.forEach(function (automation) {
      if (!automation.matcher()) {
        return;
      }
      loadScripts(automation)
        .then(function () {
          automation.ensurePanel();
        })
        .catch(function (error) {
          onError(automation, error);
        });
    });
  }

  return { ensure };
}

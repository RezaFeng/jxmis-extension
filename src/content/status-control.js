export function createStatusControl(document, controls) {
  function set(controlName, text, running) {
    const config = controls[controlName];
    if (!config) {
      return;
    }
    const status = document.getElementById(config.statusId);
    const button = document.getElementById(config.buttonId);
    if (typeof running === "boolean") {
      config.setRunning(running);
    }
    const isRunning = config.isRunning();
    if (status) {
      status.textContent = text;
      status.style.color = isRunning ? "#0b73f6" : "#666";
    }
    if (button) {
      button.disabled = isRunning;
      button.style.opacity = isRunning ? "0.7" : "1";
      button.style.cursor = isRunning ? "not-allowed" : "pointer";
      button.textContent = isRunning ? config.runningText : config.idleText;
    }
  }

  return { set };
}

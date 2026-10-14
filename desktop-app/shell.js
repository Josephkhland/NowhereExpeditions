"use strict";

const tabs = document.getElementById("tabs");
const address = document.getElementById("address");
const addressInput = document.getElementById("address-input");
let lastAddress = "";
const STATUS_TEXT = {
  online: "running",
  starting: "starting…",
  offline: "not answering yet (retrying)",
  waiting: "opens when the bot starts",
  idle: "loads when you open it",
  exited: "a server has stopped",
};

function render(state) {
  tabs.replaceChildren();
  state.tools.forEach((tool, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "tab";
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", String(tool.id === state.active));
    button.disabled = !tool.available;
    button.title = `${tool.title}: ${STATUS_TEXT[tool.status] || tool.status} (Ctrl+${index + 1})`;
    const dot = document.createElement("span");
    dot.className = `dot ${tool.status}`;
    const label = document.createElement("span");
    label.textContent = tool.title;
    const key = document.createElement("kbd");
    key.textContent = `Ctrl+${index + 1}`;
    button.append(dot, label, key);
    button.addEventListener("click", () => window.shellApi.select(tool.id));
    button.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      window.shellApi.tabMenu(tool.id); // restart its server, show its output
    });
    tabs.append(button);
  });
  // The Live site's address field, kept as it is while you're typing in it.
  const live = state.active === "live";
  address.hidden = !live;
  document.body.classList.toggle("addressing", live);
  if (live && document.activeElement !== addressInput) addressInput.value = state.address;
  lastAddress = state.address;

  // The bot dashboard's link holds its key: it never goes to the browser. The terminal isn't a web page.
  const terminal = state.active === "terminal";
  const page = terminal || state.active === "git"; // the app's own pages
  document.getElementById("browser").disabled = state.active === "bot" || page;
  document.getElementById("back").disabled = page;
  document.getElementById("reload").disabled = terminal;
}

address.addEventListener("submit", (event) => {
  event.preventDefault();
  window.shellApi.navigate(addressInput.value);
  addressInput.blur();
});
addressInput.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  addressInput.value = lastAddress;
  addressInput.blur();
});
addressInput.addEventListener("focus", () => addressInput.select());
addressInput.addEventListener("blur", () => {
  addressInput.value = lastAddress; // an address you didn't go to isn't kept
});
window.shellApi.onFocusAddress(() => addressInput.focus());

document.getElementById("reload").addEventListener("click", () => window.shellApi.reload());
document.getElementById("back").addEventListener("click", () => window.shellApi.back());
document.getElementById("browser").addEventListener("click", () => window.shellApi.openInBrowser());
window.shellApi.onState(render);

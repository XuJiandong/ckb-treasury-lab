/**
 * Entry point of every page. Mounts the shell, wires the wallet connection and
 * dispatches to the page module named by `<body data-page="…">`.
 */

import * as api from "./api.js";
import { connectWalletDialog } from "./dialogs.js";
import { WALLETS } from "./layout.js";
import { toast } from "./ui.js";
import { shorten } from "./util.js";

import { initWelcome } from "./pages/welcome.js";
import { initVoter } from "./pages/voter.js";
import { initInitiator } from "./pages/initiator.js";
import { initChallenger } from "./pages/challenger.js";

let connecting = false;

/** Opens the wallet picker and connects the chosen mock wallet. */
async function connect() {
  if (connecting) return api.wallet();
  if (api.isConnected()) return api.wallet();
  connecting = true;
  try {
    const choice = await connectWalletDialog(WALLETS);
    if (!choice) return null;
    const wallet = await api.connectWallet(choice);
    document.dispatchEvent(new CustomEvent("wallet:changed", { detail: wallet }));
    toast({
      kind: "success",
      title: "Wallet connected",
      message: `${shorten(wallet.address, 18, 8)} · this address is now your lock script`,
    });
    return wallet;
  } finally {
    connecting = false;
  }
}

document.addEventListener("wallet:connect", () => {
  void connect();
});

/** Any element with `data-connect` triggers the wallet picker when clicked. */
document.addEventListener("click", (event) => {
  const trigger = event.target.closest?.("[data-connect]");
  if (!trigger || api.isConnected()) return;
  event.preventDefault();
  void connect();
});

const page = document.body.dataset.page;
const registry = {
  welcome: initWelcome,
  voter: initVoter,
  initiator: initInitiator,
  challenger: initChallenger,
};

try {
  (registry[page] ?? initWelcome)();
} catch (error) {
  console.error(error);
  toast({
    kind: "error",
    title: "Could not render the page",
    message: error?.message ?? String(error),
  });
}

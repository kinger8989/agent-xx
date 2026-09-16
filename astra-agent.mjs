import { ethers } from "ethers";
import fs from "fs";

const AGENT_ID = process.env.AGENT_ID || "Astra-01";
const LOG_PATH = `./ledger-${AGENT_ID}.json`;

const CANDIDATE_CHAINS = [
  {
    name: "Ethereum Sepolia",
    rpcUrl: process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com",
    chainlinkEthUsd: "0x694AA1769357215DE4FAC081bf1f309aDC325306",
    faucet: "https://sepoliafaucet.com or https://www.alchemy.com/faucets/ethereum-sepolia",
    explorer: "https://sepolia.etherscan.io/address/"
  }
];

const AGGREGATOR_ABI = [
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
  "function decimals() view returns (uint8)"
];

function loadLedger() {
  if (fs.existsSync(LOG_PATH)) {
    return JSON.parse(fs.readFileSync(LOG_PATH, "utf8"));
  }
  return {
    id: AGENT_ID,
    startingCapitalNote: "TESTNET funds only — no real revenue claim is valid until pointed at a real chain with real funds.",
    wallet: null,
    chosenChain: null,
    history: []
  };
}

function saveLedger(ledger) {
  fs.writeFileSync(LOG_PATH, JSON.stringify(ledger, null, 2));
}

function logEvent(ledger, event) {
  ledger.history.push({ timestamp: new Date().toISOString(), ...event });
  saveLedger(ledger);
  console.log(`[${AGENT_ID}] ${event.action} — ${event.reason}`);
}

async function getOrCreateWallet(ledger) {
  if (process.env.PRIVATE_KEY) {
    return new ethers.Wallet(process.env.PRIVATE_KEY);
  }
  if (ledger.wallet?.privateKey) {
    return new ethers.Wallet(ledger.wallet.privateKey);
  }
  const wallet = ethers.Wallet.createRandom();
  ledger.wallet = { address: wallet.address, privateKey: wallet.privateKey };
  logEvent(ledger, {
    action: "GENERATED_WALLET",
    reason: `No PRIVATE_KEY supplied — generated a new testnet wallet. Fund this address from a faucet: ${wallet.address}`,
    address: wallet.address
  });
  return wallet;
}

async function run() {
  const ledger = loadLedger();
  const wallet = await getOrCreateWallet(ledger);
  const chain = CANDIDATE_CHAINS.find(c => c.name === ledger.chosenChain) || CANDIDATE_CHAINS[0];
  ledger.chosenChain = chain.name;

  const provider = new ethers.JsonRpcProvider(chain.rpcUrl);
  const balanceWei = await provider.getBalance(wallet.address);
  const balanceEth = ethers.formatEther(balanceWei);

  if (balanceWei === 0n) {
    logEvent(ledger, {
      action: "WAITING_ON_FUNDS",
      reason: `Checked ${chain.name} — real on-chain balance is 0. Fund ${wallet.address} via ${chain.faucet}. No action taken.`,
      chain: chain.name,
      address: wallet.address
    });
    return;
  }

  let priceUsd = null;
  try {
    const feed = new ethers.Contract(chain.chainlinkEthUsd, AGGREGATOR_ABI, provider);
    const [, answer] = await feed.latestRoundData();
    const decimals = await feed.decimals();
    priceUsd = Number(answer) / 10 ** Number(decimals);
  } catch (e) {
    console.warn("Price feed read failed:", e.message);
  }

  logEvent(ledger, {
    action: "FUNDED_SCAN",
    reason: `Confirmed ${balanceEth} test ETH on ${chain.name}. Live ETH/USD (real oracle read): ${priceUsd ?? "unavailable"}. No trade executed — strategy logic not yet attached.`,
    chain: chain.name,
    balanceEth,
    priceUsd
  });
}

run().catch(err => {
  console.error("Run failed:", err.message);
  process.exit(1);
});
/**
 * Root app: home page → game setup → game view with canvas + DOM overlay + store wiring.
 */

import { createSignal, onMount, onCleanup, Show, Switch, Match } from "solid-js";
import type { TuiCanvas } from "./renderer/TuiCanvas.js";
import type { PlanetEntry } from "@encrypted-forest/solidjs-sdk";
import { createWalletStore } from "./wallet/store.js";
import { createMiner } from "./mining/miner.js";
import { createGameSession } from "./game/session.js";
import HomePage from "./components/HomePage.js";
import GameSetup from "./components/GameSetup.js";
import GameCanvas from "./components/GameCanvas.js";
import HUD from "./components/HUD.js";
import MinerControls from "./components/MinerControls.js";
import CommandLine from "./components/CommandLine.js";
import StatusBar from "./components/StatusBar.js";

export default function App() {
  // App-level state
  const [page, setPage] = createSignal<"home" | "setup" | "game">("home");

  // Wallet store
  const walletStore = createWalletStore();
  onMount(() => walletStore.init());

  // Game session (holds fetched Game account data)
  const session = createGameSession();

  // Miner
  const miner = createMiner();

  // Game view state
  let rendererRef: TuiCanvas | undefined;
  const [hoveredCell, setHoveredCell] = createSignal<{ x: number; y: number } | null>(null);
  const [zoom, setZoom] = createSignal(1);
  const [selectedHash, setSelectedHash] = createSignal<string | null>(null);

  // Demo data — will be replaced with real stores when connected
  const demoPlanets = new Map<string, PlanetEntry>();
  const demoExplored = new Set<string>();

  function handleCellClick(gridX: number, gridY: number) {
    console.log(`Clicked cell: ${gridX}, ${gridY}`);
    // Update miner center to clicked position
    miner.updateConfig({ centerX: gridX, centerY: gridY });
  }

  function handleCommand(cmd: string) {
    console.log(`Command: ${cmd}`);
    const parts = cmd.split(/\s+/);
    const action = parts[0]?.toLowerCase();

    if (action === "home") {
      miner.stop();
      session.leaveGame();
      setPage("home");
    } else if (action === "setup") {
      miner.stop();
      setPage("setup");
    } else if (action === "mine") {
      handleMinerStart();
    } else if (action === "stop") {
      miner.stop();
    } else if (action === "goto" && parts.length >= 3) {
      const x = parseInt(parts[1]);
      const y = parseInt(parts[2]);
      if (!isNaN(x) && !isNaN(y)) {
        miner.updateConfig({ centerX: x, centerY: y });
      }
    }
  }

  function handleMinerStart() {
    const gid = session.gameId();
    if (gid == null) {
      console.warn("No game session — cannot start miner");
      return;
    }
    // Miner reads hashRounds from the game session (fetched from chain)
    miner.start(gid, session.thresholds(), session.hashRounds());
  }

  function handleMinerStop() {
    miner.stop();
  }

  function handleEnterSetup() {
    setPage("setup");
  }

  function handleEnterGame() {
    setPage("game");
  }

  function handleBackToHome() {
    session.leaveGame();
    setPage("home");
  }

  // Poll renderer for hover/zoom state
  let pollInterval: ReturnType<typeof setInterval>;
  onMount(() => {
    pollInterval = setInterval(() => {
      if (rendererRef) {
        setHoveredCell(rendererRef.getHoveredCell());
        setZoom(rendererRef.getCamera().zoom);
      }
    }, 100);
  });
  onCleanup(() => clearInterval(pollInterval));

  return (
    <Switch>
      <Match when={page() === "home"}>
        <HomePage
          walletStore={walletStore}
          onEnterGame={handleEnterSetup}
        />
      </Match>

      <Match when={page() === "setup"}>
        <GameSetup
          session={session}
          walletStore={walletStore}
          onEnterGame={handleEnterGame}
          onBack={handleBackToHome}
        />
      </Match>

      <Match when={page() === "game"}>
        {/* Game view */}
        <GameCanvas
          getPlanets={() => demoPlanets as ReadonlyMap<string, PlanetEntry>}
          getExploredCoords={() => demoExplored as ReadonlySet<string>}
          getMapDiameter={() => session.mapDiameter()}
          getPlayerId={() => null}
          getSelectedHash={() => selectedHash()}
          onCellClick={handleCellClick}
          ref={(r) => (rendererRef = r)}
        />

        <HUD
          gameId={() => session.gameId()?.toString() ?? null}
          points={() => 0n}
          ownedPlanets={() => 0}
          totalShips={() => 0n}
          totalMetal={() => 0n}
          exploredCount={() => demoExplored.size}
          hasSpawned={() => false}
        />

        <MinerControls
          miner={miner}
          onStart={handleMinerStart}
          onStop={handleMinerStop}
        />

        <CommandLine onCommand={handleCommand} />

        <StatusBar
          hoveredCell={hoveredCell}
          zoom={zoom}
          connected={() => walletStore.activeWallet() !== null}
        />
      </Match>
    </Switch>
  );
}

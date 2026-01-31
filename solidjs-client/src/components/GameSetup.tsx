/**
 * Game setup screen — shown after wallet selection.
 * User can create a new on-chain game or join an existing one.
 */

import { createSignal, Show } from "solid-js";
import type { GameSessionAPI } from "../game/session.js";
import type { WalletStoreAPI } from "../wallet/store.js";
import { DEFAULT_THRESHOLDS, DEFAULT_HASH_ROUNDS } from "@encrypted-forest/core";
import type { CreateGameArgs, WinCondition } from "@encrypted-forest/core";
import tui from "../styles/tui.module.css";

interface GameSetupProps {
  session: GameSessionAPI;
  walletStore: WalletStoreAPI;
  onEnterGame: () => void;
  onBack: () => void;
}

export default function GameSetup(props: GameSetupProps) {
  const [mode, setMode] = createSignal<"choose" | "join" | "create">("choose");

  // Join state
  const [joinGameId, setJoinGameId] = createSignal("1");
  const [joinError, setJoinError] = createSignal<string | null>(null);

  // Create state
  const [createGameId, setCreateGameId] = createSignal("1");
  const [mapDiameter, setMapDiameter] = createSignal("100");
  const [gameSpeed, setGameSpeed] = createSignal("10000");
  const [hashRounds, setHashRounds] = createSignal(DEFAULT_HASH_ROUNDS.toString());
  const [winConditionType, setWinConditionType] = createSignal<"points" | "race">("points");
  const [pointsPerMetal, setPointsPerMetal] = createSignal("1");
  const [minSpawnDistance, setMinSpawnDistance] = createSignal("10");
  const [createError, setCreateError] = createSignal<string | null>(null);

  const walletPk = () => props.walletStore.activeWallet()?.publicKey ?? "";

  // -----------------------------------------------------------------------
  // Join
  // -----------------------------------------------------------------------
  async function handleJoin() {
    setJoinError(null);
    const raw = joinGameId().trim();
    if (!raw) { setJoinError("Enter a game ID"); return; }

    let gid: bigint;
    try { gid = BigInt(raw); } catch { setJoinError("Game ID must be a number"); return; }

    try {
      await props.session.joinGame(gid, props.walletStore.rpcUrl(), walletPk());
      props.onEnterGame();
    } catch (err: any) {
      setJoinError(err.message ?? "Failed to join game");
    }
  }

  // -----------------------------------------------------------------------
  // Create
  // -----------------------------------------------------------------------
  async function handleCreate() {
    setCreateError(null);

    let gid: bigint;
    try { gid = BigInt(createGameId().trim() || "1"); } catch { setCreateError("Game ID must be a number"); return; }

    let diameter: bigint;
    try { diameter = BigInt(mapDiameter().trim() || "100"); } catch { setCreateError("Map diameter must be a number"); return; }

    let speed: bigint;
    try { speed = BigInt(gameSpeed().trim() || "10000"); } catch { setCreateError("Game speed must be a number"); return; }

    const rounds = parseInt(hashRounds().trim()) || DEFAULT_HASH_ROUNDS;

    let winCondition: WinCondition;
    if (winConditionType() === "points") {
      let ppm: bigint;
      try { ppm = BigInt(pointsPerMetal().trim() || "1"); } catch { setCreateError("Points per metal must be a number"); return; }
      winCondition = { pointsBurning: { pointsPerMetal: ppm } };
    } else {
      let msd: bigint;
      try { msd = BigInt(minSpawnDistance().trim() || "10"); } catch { setCreateError("Min spawn distance must be a number"); return; }
      winCondition = { raceToCenter: { minSpawnDistance: msd } };
    }

    const activeWallet = props.walletStore.activeWallet();
    if (!activeWallet) { setCreateError("No wallet selected"); return; }

    const args: CreateGameArgs = {
      gameId: gid,
      mapDiameter: diameter,
      gameSpeed: speed,
      startSlot: 0n,
      endSlot: 1_000_000_000n,
      winCondition,
      whitelist: false,
      serverPubkey: null,
      noiseThresholds: DEFAULT_THRESHOLDS,
      hashRounds: rounds,
    };

    try {
      await props.session.createGame(args, props.walletStore.rpcUrl(), activeWallet.keypair);
      props.onEnterGame();
    } catch (err: any) {
      setCreateError(err.message ?? "Failed to create game");
    }
  }

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        "flex-direction": "column",
        "align-items": "center",
        "justify-content": "center",
        padding: "40px 20px",
        gap: "24px",
        "overflow-y": "auto",
      }}
    >
      <h1
        style={{
          color: "#9966ff",
          "font-size": "24px",
          "font-weight": "700",
          "letter-spacing": "3px",
        }}
      >
        GAME SETUP
      </h1>

      <div style={{ color: "#e0e0e0", "font-size": "12px", "text-align": "center" }}>
        Wallet: <span style={{ color: "#cc88ff" }}>
          {props.walletStore.activeWallet()?.name ?? "None"}
        </span>
        <span class={tui.dim} style={{ "margin-left": "8px" }}>
          ({walletPk().slice(0, 8)}...)
        </span>
      </div>

      <div style={{ "font-size": "11px", color: "#777777" }}>
        RPC: {props.walletStore.rpcUrl()}
      </div>

      {/* ---- Choose mode ---- */}
      <Show when={mode() === "choose"}>
        <div style={{ display: "flex", "flex-direction": "column", gap: "16px", "max-width": "400px", width: "100%" }}>
          <button
            class={tui.button}
            onClick={() => setMode("join")}
            style={{ padding: "16px", "font-size": "14px", "font-weight": "600", color: "#88ffbb", "border-color": "#88ffbb", "letter-spacing": "2px" }}
          >
            JOIN GAME
          </button>
          <div class={tui.dim} style={{ "text-align": "center", "font-size": "11px" }}>
            Connect to an existing on-chain game by entering its ID
          </div>

          <div class={tui.dim} style={{ "border-top": "1px solid #333333", margin: "4px 0" }} />

          <button
            class={tui.button}
            onClick={() => setMode("create")}
            style={{ padding: "16px", "font-size": "14px", "font-weight": "600", color: "#cc88ff", "border-color": "#cc88ff", "letter-spacing": "2px" }}
          >
            CREATE GAME
          </button>
          <div class={tui.dim} style={{ "text-align": "center", "font-size": "11px" }}>
            Deploy a new game on-chain with custom parameters
          </div>

          <div class={tui.dim} style={{ "border-top": "1px solid #333333", margin: "4px 0" }} />

          <button
            class={tui.button}
            onClick={props.onBack}
            style={{ padding: "8px", "font-size": "12px", color: "#777777", "border-color": "#333333" }}
          >
            BACK
          </button>
        </div>
      </Show>

      {/* ---- Join ---- */}
      <Show when={mode() === "join"}>
        <div
          class={tui.panel}
          style={{ "max-width": "400px", width: "100%", padding: "20px", display: "flex", "flex-direction": "column", gap: "12px" }}
        >
          <span class={tui.accent} style={{ "font-size": "14px", "font-weight": "600" }}>
            JOIN EXISTING GAME
          </span>

          <div style={{ "font-size": "11px", color: "#777777" }}>
            Enter the game ID to fetch its configuration from chain.
          </div>

          <Field label="GAME ID" value={joinGameId()} onInput={setJoinGameId} placeholder="e.g. 1" />

          <Show when={joinError()}>
            <ErrorBox message={joinError()!} />
          </Show>

          <Show when={props.session.loading()}>
            <div style={{ color: "#cc88ff", "font-size": "11px" }}>Fetching game account...</div>
          </Show>

          <div style={{ display: "flex", gap: "8px" }}>
            <button
              class={tui.button}
              onClick={handleJoin}
              disabled={props.session.loading()}
              style={{ flex: "1", padding: "10px", color: "#88ffbb", "border-color": "#88ffbb", "font-weight": "600" }}
            >
              {props.session.loading() ? "LOADING..." : "JOIN"}
            </button>
            <BackButton onClick={() => { setMode("choose"); setJoinError(null); }} />
          </div>
        </div>
      </Show>

      {/* ---- Create ---- */}
      <Show when={mode() === "create"}>
        <div
          class={tui.panel}
          style={{ "max-width": "460px", width: "100%", padding: "20px", display: "flex", "flex-direction": "column", gap: "12px" }}
        >
          <span class={tui.accent} style={{ "font-size": "14px", "font-weight": "600" }}>
            CREATE GAME
          </span>

          <div style={{ "font-size": "11px", color: "#777777" }}>
            Configure and deploy a new game on-chain. You will be the admin.
          </div>

          {/* Core params */}
          <div style={{ display: "flex", gap: "8px" }}>
            <div style={{ flex: "1" }}>
              <Field label="GAME ID" value={createGameId()} onInput={setCreateGameId} placeholder="1" />
            </div>
            <div style={{ flex: "1" }}>
              <Field label="MAP DIAMETER" value={mapDiameter()} onInput={setMapDiameter} placeholder="100" />
            </div>
          </div>

          <div style={{ display: "flex", gap: "8px" }}>
            <div style={{ flex: "1" }}>
              <Field label="GAME SPEED" value={gameSpeed()} onInput={setGameSpeed} placeholder="10000" />
            </div>
            <div style={{ flex: "1" }}>
              <Field label="HASH ROUNDS" value={hashRounds()} onInput={setHashRounds} placeholder="100" />
            </div>
          </div>

          <div class={tui.dim} style={{ "border-top": "1px solid #333333", margin: "2px 0" }} />

          {/* Win condition */}
          <div>
            <label class={tui.label}>WIN CONDITION</label>
            <div style={{ display: "flex", gap: "4px", "margin-top": "4px" }}>
              <button
                class={tui.button}
                style={{
                  "font-size": "10px",
                  padding: "2px 8px",
                  background: winConditionType() === "points" ? "rgba(153, 102, 255, 0.2)" : undefined,
                  "border-color": winConditionType() === "points" ? "#9966ff" : undefined,
                }}
                onClick={() => setWinConditionType("points")}
              >
                POINTS BURNING
              </button>
              <button
                class={tui.button}
                style={{
                  "font-size": "10px",
                  padding: "2px 8px",
                  background: winConditionType() === "race" ? "rgba(153, 102, 255, 0.2)" : undefined,
                  "border-color": winConditionType() === "race" ? "#9966ff" : undefined,
                }}
                onClick={() => setWinConditionType("race")}
              >
                RACE TO CENTER
              </button>
            </div>
          </div>

          <Show when={winConditionType() === "points"}>
            <Field label="POINTS PER METAL" value={pointsPerMetal()} onInput={setPointsPerMetal} placeholder="1" />
          </Show>
          <Show when={winConditionType() === "race"}>
            <Field label="MIN SPAWN DISTANCE" value={minSpawnDistance()} onInput={setMinSpawnDistance} placeholder="10" />
          </Show>

          <div class={tui.dim} style={{ "border-top": "1px solid #333333", margin: "2px 0" }} />

          {/* Noise thresholds (read-only defaults for now) */}
          <div>
            <label class={tui.label}>NOISE THRESHOLDS</label>
            <div style={{ "font-size": "10px", color: "#777777", "margin-top": "4px", display: "flex", "flex-wrap": "wrap", gap: "8px" }}>
              <span>dead: {DEFAULT_THRESHOLDS.deadSpaceThreshold}</span>
              <span>planet: {DEFAULT_THRESHOLDS.planetThreshold}</span>
              <span>quasar: {DEFAULT_THRESHOLDS.quasarThreshold}</span>
              <span>rift: {DEFAULT_THRESHOLDS.spacetimeRipThreshold}</span>
              <span>asteroid: {DEFAULT_THRESHOLDS.asteroidBeltThreshold}</span>
            </div>
            <div style={{ "font-size": "10px", color: "#777777", "margin-top": "2px", display: "flex", "flex-wrap": "wrap", gap: "8px" }}>
              <span>sz1: {DEFAULT_THRESHOLDS.sizeThreshold1}</span>
              <span>sz2: {DEFAULT_THRESHOLDS.sizeThreshold2}</span>
              <span>sz3: {DEFAULT_THRESHOLDS.sizeThreshold3}</span>
              <span>sz4: {DEFAULT_THRESHOLDS.sizeThreshold4}</span>
              <span>sz5: {DEFAULT_THRESHOLDS.sizeThreshold5}</span>
            </div>
          </div>

          <Show when={createError()}>
            <ErrorBox message={createError()!} />
          </Show>

          <Show when={props.session.loading()}>
            <div style={{ color: "#cc88ff", "font-size": "11px" }}>Creating game on-chain...</div>
          </Show>

          <div style={{ display: "flex", gap: "8px" }}>
            <button
              class={tui.button}
              onClick={handleCreate}
              disabled={props.session.loading()}
              style={{ flex: "1", padding: "10px", color: "#88ffbb", "border-color": "#88ffbb", "font-weight": "600" }}
            >
              {props.session.loading() ? "CREATING..." : "CREATE"}
            </button>
            <BackButton onClick={() => { setMode("choose"); setCreateError(null); }} />
          </div>
        </div>
      </Show>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared sub-components
// ---------------------------------------------------------------------------

function Field(props: { label: string; value: string; onInput: (v: string) => void; placeholder?: string }) {
  return (
    <div>
      <label class={tui.label}>{props.label}</label>
      <input
        class={tui.input}
        type="text"
        placeholder={props.placeholder}
        value={props.value}
        onInput={(e) => props.onInput(e.currentTarget.value)}
        style={{ width: "100%", "margin-top": "4px" }}
      />
    </div>
  );
}

function ErrorBox(props: { message: string }) {
  return (
    <div style={{ color: "#ff4488", "font-size": "11px", padding: "4px 8px", border: "1px solid #ff4488" }}>
      {props.message}
    </div>
  );
}

function BackButton(props: { onClick: () => void }) {
  return (
    <button
      class={tui.button}
      onClick={props.onClick}
      style={{ padding: "10px", color: "#777777", "border-color": "#333333" }}
    >
      BACK
    </button>
  );
}

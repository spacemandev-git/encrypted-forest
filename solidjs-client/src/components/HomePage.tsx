/**
 * Home page — describes the game and provides wallet management + game entry.
 */

import { Show } from "solid-js";
import type { WalletStoreAPI } from "../wallet/store.js";
import WalletManager from "./WalletManager.js";
import tui from "../styles/tui.module.css";

interface HomePageProps {
  walletStore: WalletStoreAPI;
  onEnterGame: () => void;
}

export default function HomePage(props: HomePageProps) {
  const ws = props.walletStore;

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        overflow: "auto",
        display: "flex",
        "flex-direction": "column",
        "align-items": "center",
        padding: "40px 20px",
        gap: "32px",
      }}
    >
      {/* Title */}
      <div style={{ "text-align": "center", "max-width": "700px" }}>
        <h1
          style={{
            color: "#9966ff",
            "font-size": "32px",
            "font-weight": "700",
            "letter-spacing": "4px",
            "margin-bottom": "12px",
          }}
        >
          ENCRYPTED FOREST
        </h1>
        <p style={{ color: "#aaaaaa", "font-size": "13px", "line-height": "1.6" }}>
          A fully on-chain strategy game on Solana where players explore a hidden
          universe through fog of war, discover planets, build fleets, and compete
          for galactic dominance. All hidden information is secured by Arcium's
          multi-party computation network.
        </p>
      </div>

      {/* Two-column layout: game info + wallet */}
      <div
        style={{
          display: "flex",
          gap: "24px",
          "max-width": "900px",
          width: "100%",
          "flex-wrap": "wrap",
          "justify-content": "center",
        }}
      >
        {/* Left: Game info */}
        <div
          class={tui.panel}
          style={{
            flex: "1",
            "min-width": "340px",
            "max-width": "440px",
            padding: "20px",
            display: "flex",
            "flex-direction": "column",
            gap: "16px",
          }}
        >
          <span class={tui.accent} style={{ "font-size": "14px", "font-weight": "600" }}>
            HOW TO PLAY
          </span>

          <Section title="1. EXPLORE">
            Hash coordinate pairs on your machine to reveal the map. The fog of
            war hides everything until you discover it. Your hash miner runs
            locally — nobody else can see what you find.
          </Section>

          <Section title="2. SPAWN">
            Find a Miniscule Planet (size 1) to spawn at. This creates your first
            planet on-chain with you as the owner. You can only spawn once per game.
          </Section>

          <Section title="3. EXPAND">
            Send ships from your planets to claim neutral ones or attack enemies.
            Ships decay over distance based on your planet's Range stat. Upgrade
            planets by spending metal.
          </Section>

          <Section title="4. COMPETE">
            Race to achieve the win condition — burn metal for points at Spacetime
            Rips, or be the first to claim the center of the map.
          </Section>

          <div class={tui.dim} style={{ "border-top": "1px solid #333333" }} />

          <span class={tui.accent} style={{ "font-size": "13px", "font-weight": "600" }}>
            CELESTIAL BODIES
          </span>

          <div style={{ "font-size": "12px", display: "flex", "flex-direction": "column", gap: "8px" }}>
            <BodyTypeRow
              name="PLANET"
              color="#9966ff"
              desc="Generates ships when owned. The only type that can be upgraded."
            />
            <BodyTypeRow
              name="QUASAR"
              color="#ddaaff"
              desc="Massive storage capacity but no production. Strategic depots."
            />
            <BodyTypeRow
              name="SPACETIME RIP"
              color="#ff3377"
              desc="Burns metal for points. Low capacity, key to scoring."
            />
            <BodyTypeRow
              name="ASTEROID BELT"
              color="#ccaa55"
              desc="The only source of metal generation. Essential for upgrades."
            />
          </div>

          <div class={tui.dim} style={{ "border-top": "1px solid #333333" }} />

          <div style={{ "font-size": "11px", color: "#777777", "line-height": "1.5" }}>
            <span class={tui.accent}>SIZE</span> ranges from Miniscule (1) to Gargantuan (6).
            Larger bodies have quadratically higher capacities.
            Each body may have <span style={{ color: "#cc88ff" }}>comets</span> that
            double a random stat — 85% none, 15% one, 5% two.
          </div>

          <div style={{ "font-size": "11px", color: "#777777", "line-height": "1.5" }}>
            <span class={tui.accent}>FOG OF WAR</span> — The coordinate hash is the
            encryption key. Only players who discover a planet's coordinates can decrypt
            its on-chain data. Broadcasting reveals coordinates to all players.
          </div>
        </div>

        {/* Right: Wallet manager */}
        <div
          style={{
            flex: "1",
            "min-width": "340px",
            "max-width": "440px",
            display: "flex",
            "flex-direction": "column",
            gap: "16px",
          }}
        >
          <WalletManager walletStore={ws} />

          {/* Enter game button */}
          <Show when={ws.activeWallet()}>
            <button
              class={tui.button}
              onClick={props.onEnterGame}
              style={{
                width: "100%",
                padding: "12px",
                "font-size": "16px",
                "font-weight": "700",
                color: "#88ffbb",
                "border-color": "#88ffbb",
                "letter-spacing": "2px",
              }}
            >
              ENTER GAME
            </button>
          </Show>
          <Show when={!ws.activeWallet()}>
            <div
              class={tui.panel}
              style={{
                padding: "12px",
                "text-align": "center",
                color: "#777777",
                "font-size": "12px",
              }}
            >
              Create a wallet to enter the game
            </div>
          </Show>
        </div>
      </div>

      {/* Footer */}
      <div style={{ color: "#777777", "font-size": "10px", "margin-top": "auto", "padding-top": "40px" }}>
        Powered by Solana + Arcium MPC | All game state is fully on-chain
      </div>
    </div>
  );
}

function Section(props: { title: string; children: any }) {
  return (
    <div>
      <div style={{ color: "#cc88ff", "font-size": "12px", "font-weight": "600", "margin-bottom": "4px" }}>
        {props.title}
      </div>
      <div style={{ color: "#e0e0e0", "font-size": "12px", "line-height": "1.5" }}>
        {props.children}
      </div>
    </div>
  );
}

function BodyTypeRow(props: { name: string; color: string; desc: string }) {
  return (
    <div style={{ display: "flex", gap: "8px" }}>
      <span style={{ color: props.color, "font-weight": "600", "min-width": "110px" }}>
        {props.name}
      </span>
      <span style={{ color: "#e0e0e0" }}>{props.desc}</span>
    </div>
  );
}

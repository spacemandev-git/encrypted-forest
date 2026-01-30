/**
 * Embedded wallet manager panel — create, name, select wallets,
 * view balances, and airdrop SOL.
 */

import { createSignal, For, Show } from "solid-js";
import type { WalletStoreAPI, WalletInfo } from "../wallet/store.js";
import tui from "../styles/tui.module.css";

interface WalletManagerProps {
  walletStore: WalletStoreAPI;
}

export default function WalletManager(props: WalletManagerProps) {
  const ws = props.walletStore;
  const [newName, setNewName] = createSignal("");
  const [editingPk, setEditingPk] = createSignal<string | null>(null);
  const [editName, setEditName] = createSignal("");
  const [showRpcEdit, setShowRpcEdit] = createSignal(false);
  const [rpcInput, setRpcInput] = createSignal("");

  async function handleCreate() {
    const name = newName().trim();
    if (!name) return;
    await ws.createWallet(name);
    setNewName("");
  }

  async function handleRename(publicKey: string) {
    const name = editName().trim();
    if (!name) return;
    await ws.renameWallet(publicKey, name);
    setEditingPk(null);
    setEditName("");
  }

  async function handleRpcSave() {
    const url = rpcInput().trim();
    if (!url) return;
    await ws.setRpc(url);
    setShowRpcEdit(false);
  }

  function startRpcEdit() {
    setRpcInput(ws.rpcUrl());
    setShowRpcEdit(true);
  }

  function truncate(s: string, n: number = 12): string {
    if (s.length <= n) return s;
    return s.slice(0, 6) + ".." + s.slice(-4);
  }

  return (
    <div
      class={tui.panel}
      style={{
        width: "100%",
        padding: "16px",
        display: "flex",
        "flex-direction": "column",
        gap: "12px",
      }}
    >
      <div style={{ display: "flex", "justify-content": "space-between", "align-items": "center" }}>
        <span class={tui.accent} style={{ "font-size": "14px", "font-weight": "600" }}>
          WALLETS
        </span>
        <button class={tui.button} onClick={() => ws.refreshBalances()} style={{ "font-size": "10px" }}>
          REFRESH
        </button>
      </div>

      {/* Error display */}
      <Show when={ws.error()}>
        <div style={{ color: "#ff4488", "font-size": "11px", padding: "4px 8px", border: "1px solid #ff4488" }}>
          {ws.error()}
        </div>
      </Show>

      {/* Airdrop status */}
      <Show when={ws.airdropStatus()}>
        <div style={{ color: "#88ffbb", "font-size": "11px", padding: "4px 8px", border: "1px solid #88ffbb" }}>
          {ws.airdropStatus()}
        </div>
      </Show>

      {/* RPC config */}
      <div style={{ "font-size": "11px" }}>
        <span class={tui.label}>RPC </span>
        <Show
          when={!showRpcEdit()}
          fallback={
            <div style={{ display: "flex", gap: "4px", "margin-top": "4px" }}>
              <input
                class={tui.input}
                type="text"
                value={rpcInput()}
                onInput={(e) => setRpcInput(e.currentTarget.value)}
                onKeyDown={(e) => e.key === "Enter" && handleRpcSave()}
                style={{ flex: "1", "font-size": "11px" }}
              />
              <button class={tui.button} onClick={handleRpcSave} style={{ "font-size": "10px" }}>
                SAVE
              </button>
              <button class={tui.button} onClick={() => setShowRpcEdit(false)} style={{ "font-size": "10px" }}>
                X
              </button>
            </div>
          }
        >
          <span class={tui.dim} style={{ cursor: "pointer" }} onClick={startRpcEdit}>
            {ws.rpcUrl()} [edit]
          </span>
        </Show>
      </div>

      <div class={tui.dim} style={{ "border-top": "1px solid #333333" }} />

      {/* Wallet list */}
      <Show
        when={ws.wallets().length > 0}
        fallback={
          <div class={tui.dim} style={{ "text-align": "center", padding: "16px 0", "font-size": "12px" }}>
            No wallets yet. Create one below.
          </div>
        }
      >
        <div style={{ display: "flex", "flex-direction": "column", gap: "6px" }}>
          <For each={ws.wallets()}>
            {(wallet) => (
              <WalletRow
                wallet={wallet}
                isActive={ws.activeWallet()?.publicKey === wallet.publicKey}
                isEditing={editingPk() === wallet.publicKey}
                editName={editName()}
                onSelect={() => ws.setActive(wallet.publicKey)}
                onStartEdit={() => {
                  setEditingPk(wallet.publicKey);
                  setEditName(wallet.name);
                }}
                onEditNameChange={setEditName}
                onSaveEdit={() => handleRename(wallet.publicKey)}
                onCancelEdit={() => setEditingPk(null)}
                onDelete={() => ws.deleteWallet(wallet.publicKey)}
                onAirdrop={() => ws.airdrop(wallet.publicKey)}
                truncate={truncate}
              />
            )}
          </For>
        </div>
      </Show>

      <div class={tui.dim} style={{ "border-top": "1px solid #333333" }} />

      {/* Create new wallet */}
      <div style={{ display: "flex", gap: "8px" }}>
        <input
          class={tui.input}
          type="text"
          placeholder="Wallet name..."
          value={newName()}
          onInput={(e) => setNewName(e.currentTarget.value)}
          onKeyDown={(e) => e.key === "Enter" && handleCreate()}
          style={{ flex: "1" }}
        />
        <button
          class={tui.button}
          onClick={handleCreate}
          disabled={!newName().trim()}
          style={{ color: "#88ffbb", "border-color": "#88ffbb" }}
        >
          CREATE
        </button>
      </div>
    </div>
  );
}

function WalletRow(props: {
  wallet: WalletInfo;
  isActive: boolean;
  isEditing: boolean;
  editName: string;
  onSelect: () => void;
  onStartEdit: () => void;
  onEditNameChange: (name: string) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onDelete: () => void;
  onAirdrop: () => void;
  truncate: (s: string, n?: number) => string;
}) {
  return (
    <div
      style={{
        display: "flex",
        "flex-direction": "column",
        gap: "4px",
        padding: "8px",
        border: `1px solid ${props.isActive ? "#9966ff" : "#333333"}`,
        background: props.isActive ? "rgba(153, 102, 255, 0.1)" : "transparent",
        cursor: "pointer",
      }}
      onClick={props.onSelect}
    >
      <div style={{ display: "flex", "justify-content": "space-between", "align-items": "center" }}>
        <Show
          when={!props.isEditing}
          fallback={
            <div style={{ display: "flex", gap: "4px", flex: "1" }} onClick={(e) => e.stopPropagation()}>
              <input
                class={tui.input}
                value={props.editName}
                onInput={(e) => props.onEditNameChange(e.currentTarget.value)}
                onKeyDown={(e) => e.key === "Enter" && props.onSaveEdit()}
                style={{ flex: "1", "font-size": "11px" }}
              />
              <button class={tui.button} onClick={props.onSaveEdit} style={{ "font-size": "9px" }}>OK</button>
              <button class={tui.button} onClick={props.onCancelEdit} style={{ "font-size": "9px" }}>X</button>
            </div>
          }
        >
          <div style={{ display: "flex", "align-items": "center", gap: "6px" }}>
            <Show when={props.isActive}>
              <span style={{ color: "#88ffbb", "font-size": "10px" }}>*</span>
            </Show>
            <span
              style={{ "font-weight": "600", "font-size": "13px", color: props.isActive ? "#cc88ff" : "#e0e0e0" }}
            >
              {props.wallet.name}
            </span>
            <span
              style={{ color: "#777777", "font-size": "10px", cursor: "pointer" }}
              onClick={(e) => { e.stopPropagation(); props.onStartEdit(); }}
            >
              [rename]
            </span>
          </div>
        </Show>
      </div>

      <div style={{ display: "flex", "justify-content": "space-between", "font-size": "11px" }}>
        <span style={{ color: "#777777", "font-family": "monospace" }}>
          {props.truncate(props.wallet.publicKey)}
        </span>
        <span style={{ color: "#e0e0e0" }}>
          {props.wallet.balance.toFixed(4)} SOL
        </span>
      </div>

      <div style={{ display: "flex", gap: "6px", "margin-top": "2px" }} onClick={(e) => e.stopPropagation()}>
        <button
          class={tui.button}
          onClick={props.onAirdrop}
          style={{ "font-size": "10px", padding: "2px 8px", color: "#88ffbb", "border-color": "#88ffbb" }}
        >
          AIRDROP 10 SOL
        </button>
        <button
          class={tui.button}
          onClick={() => navigator.clipboard.writeText(props.wallet.publicKey)}
          style={{ "font-size": "10px", padding: "2px 8px" }}
        >
          COPY KEY
        </button>
        <button
          class={tui.button}
          onClick={props.onDelete}
          style={{ "font-size": "10px", padding: "2px 8px", color: "#ff4488", "border-color": "#ff4488", "margin-left": "auto" }}
        >
          DELETE
        </button>
      </div>
    </div>
  );
}

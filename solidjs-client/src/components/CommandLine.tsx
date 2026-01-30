/**
 * Bottom command input line.
 */

import { createSignal } from "solid-js";
import tui from "../styles/tui.module.css";

interface CommandLineProps {
  onCommand: (command: string) => void;
}

export default function CommandLine(props: CommandLineProps) {
  const [input, setInput] = createSignal("");

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === "Enter" && input().trim()) {
      props.onCommand(input().trim());
      setInput("");
    }
  }

  return (
    <div
      class={tui.panel}
      style={{
        position: "fixed",
        bottom: "24px",
        left: "0",
        right: "0",
        display: "flex",
        "align-items": "center",
        padding: "4px 16px",
        "z-index": "100",
        "border-bottom": "none",
        "border-left": "none",
        "border-right": "none",
      }}
    >
      <span class={tui.accent} style={{ "margin-right": "8px" }}>&gt;</span>
      <input
        class={tui.input}
        type="text"
        value={input()}
        onInput={(e) => setInput(e.currentTarget.value)}
        onKeyDown={handleKeyDown}
        placeholder="Enter command..."
        style={{
          flex: "1",
          background: "transparent",
          border: "none",
          outline: "none",
        }}
      />
    </div>
  );
}

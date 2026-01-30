/**
 * Manages draggable TUI windows.
 */

import { For, type Accessor } from "solid-js";
import { Window } from "@encrypted-forest/solidjs-sdk";
import type { WindowState } from "@encrypted-forest/solidjs-sdk";

interface WindowManagerProps {
  windows: Accessor<WindowState[]>;
  onClose: (id: string) => void;
  onFocus: (id: string) => void;
  renderContent: (id: string) => any;
}

export default function WindowManager(props: WindowManagerProps) {
  return (
    <For each={props.windows()}>
      {(win) => (
        <Window
          title={win.title}
          visible={win.visible}
          x={win.x}
          y={win.y}
          width={win.width}
          height={win.height}
          zIndex={win.zIndex}
          onclose={() => props.onClose(win.id)}
          onfocus={() => props.onFocus(win.id)}
        >
          {props.renderContent(win.id)}
        </Window>
      )}
    </For>
  );
}

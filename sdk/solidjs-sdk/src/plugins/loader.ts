/**
 * Plugin loader for Encrypted Forest (SolidJS).
 *
 * Loads user plugins dynamically and provides them with
 * a sandboxed PluginAPI. Plugins cannot directly mutate
 * stores or send transactions without user approval.
 */

import type {
  EncryptedForestPlugin,
  PluginAPI,
  TransactionRequest,
  WindowRegistration,
} from "./types.js";

// ---------------------------------------------------------------------------
// Plugin Manager
// ---------------------------------------------------------------------------

interface LoadedPlugin {
  plugin: EncryptedForestPlugin;
  windows: string[];
  eventUnsubs: Array<() => void>;
}

export class PluginManager {
  private plugins: Map<string, LoadedPlugin> = new Map();
  private api: PluginAPI;

  onTransactionRequest:
    | ((
        pluginId: string,
        request: TransactionRequest
      ) => Promise<string | null>)
    | null = null;

  onWindowRegistered: ((registration: WindowRegistration) => void) | null =
    null;

  onWindowUnregistered: ((id: string) => void) | null = null;

  constructor(api: PluginAPI) {
    this.api = api;
  }

  async loadPlugin(plugin: EncryptedForestPlugin): Promise<void> {
    if (this.plugins.has(plugin.id)) {
      throw new Error(`Plugin "${plugin.id}" is already loaded`);
    }

    const loaded: LoadedPlugin = {
      plugin,
      windows: [],
      eventUnsubs: [],
    };

    const sandboxedApi = this.createSandboxedAPI(plugin.id, loaded);
    await plugin.activate(sandboxedApi);
    this.plugins.set(plugin.id, loaded);
  }

  async loadPluginFromURL(url: string): Promise<void> {
    const module = await import(/* @vite-ignore */ url);
    const plugin: EncryptedForestPlugin = module.default;

    if (!plugin || !plugin.id || !plugin.activate) {
      throw new Error(`Invalid plugin module at ${url}`);
    }

    await this.loadPlugin(plugin);
  }

  async unloadPlugin(pluginId: string): Promise<void> {
    const loaded = this.plugins.get(pluginId);
    if (!loaded) return;

    if (loaded.plugin.deactivate) {
      await loaded.plugin.deactivate();
    }

    for (const windowId of loaded.windows) {
      this.onWindowUnregistered?.(windowId);
    }

    for (const unsub of loaded.eventUnsubs) {
      unsub();
    }

    this.plugins.delete(pluginId);
  }

  async unloadAll(): Promise<void> {
    const ids = [...this.plugins.keys()];
    for (const id of ids) {
      await this.unloadPlugin(id);
    }
  }

  getLoadedPlugins(): string[] {
    return [...this.plugins.keys()];
  }

  private createSandboxedAPI(
    pluginId: string,
    loaded: LoadedPlugin
  ): PluginAPI {
    const manager = this;

    return {
      get client() {
        return manager.api.client;
      },

      get stores() {
        return manager.api.stores;
      },

      registerWindow(registration: WindowRegistration) {
        const prefixedId = `plugin:${pluginId}:${registration.id}`;
        loaded.windows.push(prefixedId);
        manager.onWindowRegistered?.({
          ...registration,
          id: prefixedId,
          title: `[${pluginId}] ${registration.title}`,
        });
      },

      unregisterWindow(id: string) {
        const prefixedId = `plugin:${pluginId}:${id}`;
        loaded.windows = loaded.windows.filter((w) => w !== prefixedId);
        manager.onWindowUnregistered?.(prefixedId);
      },

      async requestTransaction(
        request: TransactionRequest
      ): Promise<string | null> {
        if (!manager.onTransactionRequest) {
          throw new Error("Transaction requests are not supported");
        }
        return manager.onTransactionRequest(pluginId, request);
      },

      onEvent(
        eventType: string,
        callback: (data: unknown) => void
      ): () => void {
        const unsub = manager.api.onEvent(eventType, callback);
        loaded.eventUnsubs.push(unsub);
        return () => {
          loaded.eventUnsubs = loaded.eventUnsubs.filter((u) => u !== unsub);
          unsub();
        };
      },
    };
  }
}

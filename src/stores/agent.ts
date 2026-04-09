import { ref, computed } from "vue";
import { defineStore } from "pinia";
import { useWebSocketStore } from "./websocket";
import { useSessionStore } from "./session";
import type {
  AgentInfo,
  AgentsListResult,
  ModelInfo,
  AgentInstance,
  ToolPolicyConfig,
} from "@/api/types";

export const useAgentStore = defineStore("agent", () => {
  const agents = ref<AgentInfo[]>([]);
  const defaultAgentId = ref<string>("main");
  const mainKey = ref<string>("");
  const loading = ref(false);
  const error = ref("");
  const lastUpdatedAt = ref<number | null>(null);
  const models = ref<ModelInfo[]>([]);
  let refreshInterval: ReturnType<typeof setInterval> | null = null;
  let initialized = false;
  const eventUnsubscribes: Array<() => void> = [];
  const AUTO_REFRESH_INTERVAL_MS = 10000; // 10 seconds

  const wsStore = useWebSocketStore();
  const sessionStore = useSessionStore();

  const methodUnknown = computed(() => wsStore.gatewayMethods.length === 0);
  const supportsAgents = computed(
    () => methodUnknown.value || wsStore.supportsAnyMethod(["agents.list"]),
  );

  const agentStats = computed(() => {
    const stats: Record<
      string,
      { sessions: number; input: number; output: number }
    > = {};

    for (const session of sessionStore.sessions) {
      const agentId = session.agentId || "main";
      if (!stats[agentId]) {
        stats[agentId] = { sessions: 0, input: 0, output: 0 };
      }
      stats[agentId].sessions++;
      if (session.tokenUsage) {
        stats[agentId].input += session.tokenUsage.totalInput;
        stats[agentId].output += session.tokenUsage.totalOutput;
      }
    }

    return stats;
  });

  async function mergeRuntimeSessionAgents(
    baseAgents: AgentInfo[],
  ): Promise<AgentInfo[]> {
    const merged = [...baseAgents];
    const knownIds = new Set(
      baseAgents.map((agent) => agent.id).filter(Boolean),
    );

    // Some gateways do not include runtime dynamic agents in agents.list.
    // Recover them from live sessions so they can still be managed in UI.
    if (sessionStore.sessions.length === 0) {
      try {
        await sessionStore.fetchSessions();
      } catch (e) {
        console.warn(
          "[AgentStore] Failed to preload sessions for runtime agent discovery:",
          e,
        );
      }
    }

    let discovered = 0;
    for (const session of sessionStore.sessions) {
      const agentId = (session.agentId || "").trim();
      if (!agentId || knownIds.has(agentId)) continue;

      knownIds.add(agentId);
      discovered += 1;
      merged.push({
        id: agentId,
        name: agentId,
      });
    }

    if (discovered > 0) {
      console.log(
        `[AgentStore] Discovered ${discovered} runtime agent(s) from sessions`,
      );
    }

    return merged;
  }

  async function fetchAgents() {
    if (!supportsAgents.value) {
      error.value = "Agent listing is not supported by current Gateway";
      return;
    }

    loading.value = true;
    error.value = "";
    try {
      const result = await wsStore.rpc.listAgents();
      const baseAgents = result.agents || [];
      agents.value = await mergeRuntimeSessionAgents(baseAgents);
      defaultAgentId.value = result.defaultId || "main";
      mainKey.value = result.mainKey || "";
      lastUpdatedAt.value = Date.now();
    } catch (e: any) {
      error.value = e?.message || "Failed to load agent list";
    } finally {
      loading.value = false;
    }
  }

  async function fetchModels() {
    try {
      models.value = await wsStore.rpc.listModels();
    } catch {
      models.value = [];
    }
  }

  async function addAgent(params: {
    id: string;
    workspace?: string;
    name?: string;
  }) {
    const workspace = params.workspace || `~/.openclaw/workspace-${params.id}`;
    const agentId = params.id;
    const agentName = params.name || params.id;

    await wsStore.rpc.createAgent({
      name: agentId,
      workspace,
    });

    if (agentName !== agentId) {
      const maxRetries = 10;
      const initialDelay = 1000;
      let updated = false;

      await new Promise((resolve) => setTimeout(resolve, initialDelay));

      for (let i = 0; i < maxRetries; i++) {
        try {
          await wsStore.rpc.updateAgent({
            agentId: agentId,
            name: agentName,
          });
          updated = true;
          console.log(
            `[AgentStore] Successfully updated agent name for ${agentId} to "${agentName}" on attempt ${i + 1}`,
          );
          break;
        } catch (e) {
          console.warn(
            `[AgentStore] Failed to update agent name for ${agentId} on attempt ${i + 1}:`,
            e,
          );
          if (i < maxRetries - 1) {
            const retryDelay = 500 * (i + 1);
            await new Promise((resolve) => setTimeout(resolve, retryDelay));
          }
        }
      }

      if (!updated) {
        console.error(
          `[AgentStore] Failed to update agent name for ${agentId} after ${maxRetries} attempts`,
        );
      }
    }

    await fetchAgents();
  }

  async function deleteAgent(agentId: string) {
    if (agentId === "main") {
      throw new Error("Cannot delete the main agent");
    }

    await wsStore.rpc.deleteAgent(agentId);
    agents.value = agents.value.filter((a) => a.id !== agentId);
  }

  async function setAgentIdentity(params: {
    agentId: string;
    name?: string;
    theme?: string;
    emoji?: string;
    avatar?: string;
  }) {
    if (params.name !== undefined) {
      const maxNameRetries = 10;
      const initialDelay = 500;
      const nameRetryDelay = 500;
      let nameUpdated = false;

      await new Promise((resolve) => setTimeout(resolve, initialDelay));

      for (let attempt = 0; attempt < maxNameRetries; attempt++) {
        try {
          await wsStore.rpc.updateAgent({
            agentId: params.agentId,
            name: params.name,
          });
          nameUpdated = true;
          console.log(
            `[AgentStore] Successfully updated agent name for ${params.agentId} to "${params.name}" on attempt ${attempt + 1}`,
          );
          break;
        } catch (e: any) {
          const errorMsg = e?.message || String(e);
          console.warn(
            `[AgentStore] Failed to update agent name for ${params.agentId} on attempt ${attempt + 1}: ${errorMsg}`,
          );
          if (attempt < maxNameRetries - 1) {
            await new Promise((resolve) =>
              setTimeout(resolve, nameRetryDelay * (attempt + 1)),
            );
          }
        }
      }

      if (!nameUpdated) {
        console.error(
          `[AgentStore] Failed to update agent name for ${params.agentId} after ${maxNameRetries} attempts`,
        );
      }
    }

    if (
      params.theme !== undefined ||
      params.emoji !== undefined ||
      params.avatar !== undefined ||
      params.name !== undefined
    ) {
      const maxRetries = 5;
      const retryDelay = 500;
      let lastError: Error | null = null;

      for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
          const config = await wsStore.rpc.getConfig();
          const currentList: AgentInstance[] = Array.isArray(
            config.agents?.list,
          )
            ? [...config.agents.list]
            : [];

          const agentIndex = currentList.findIndex(
            (a) => a.id === params.agentId,
          );
          const identity: Record<string, string | undefined> = {
            name: params.name,
            theme: params.theme,
            emoji: params.emoji,
            avatar: params.avatar,
          };

          if (agentIndex >= 0) {
            const existing = currentList[agentIndex];
            if (existing) {
              currentList[agentIndex] = {
                ...existing,
                name: params.name !== undefined ? params.name : existing.name,
                identity,
              };
            }
          } else {
            currentList.push({
              id: params.agentId,
              name: params.name,
              identity,
            });
          }

          const newConfig = {
            ...config,
            agents: {
              ...config.agents,
              list: currentList,
            },
          };

          await wsStore.rpc.setConfig(newConfig);
          lastError = null;
          break;
        } catch (e: any) {
          lastError = e;
          const errorMsg = e?.message || String(e);
          if (
            errorMsg.includes("hash") ||
            errorMsg.includes("version") ||
            errorMsg.includes("conflict") ||
            errorMsg.includes("stale")
          ) {
            console.warn(
              `[AgentStore] Config conflict on attempt ${attempt + 1}, retrying...`,
            );
            await new Promise((resolve) =>
              setTimeout(resolve, retryDelay * (attempt + 1)),
            );
            continue;
          }
          throw e;
        }
      }

      if (lastError) {
        console.error(
          "[AgentStore] Failed to set agent identity after all retries:",
          lastError,
        );
        throw lastError;
      }
    }

    await fetchAgents();
  }

  async function setAgentsIdentityBatch(
    paramsList: Array<{
      agentId: string;
      name?: string;
      theme?: string;
      emoji?: string;
      avatar?: string;
    }>,
  ) {
    if (paramsList.length === 0) return;

    for (const params of paramsList) {
      if (params.name !== undefined) {
        const maxNameRetries = 10;
        const initialDelay = 500;
        const nameRetryDelay = 500;
        let nameUpdated = false;

        await new Promise((resolve) => setTimeout(resolve, initialDelay));

        for (let attempt = 0; attempt < maxNameRetries; attempt++) {
          try {
            await wsStore.rpc.updateAgent({
              agentId: params.agentId,
              name: params.name,
            });
            nameUpdated = true;
            console.log(
              `[AgentStore] Successfully updated agent name for ${params.agentId} to "${params.name}" on attempt ${attempt + 1}`,
            );
            break;
          } catch (e: any) {
            const errorMsg = e?.message || String(e);
            console.warn(
              `[AgentStore] Failed to update agent name for ${params.agentId} on attempt ${attempt + 1}: ${errorMsg}`,
            );
            if (attempt < maxNameRetries - 1) {
              await new Promise((resolve) =>
                setTimeout(resolve, nameRetryDelay * (attempt + 1)),
              );
            }
          }
        }

        if (!nameUpdated) {
          console.error(
            `[AgentStore] Failed to update agent name for ${params.agentId} after ${maxNameRetries} attempts`,
          );
        }
      }
    }

    const hasIdentityParams = paramsList.some(
      (p) =>
        p.theme !== undefined ||
        p.emoji !== undefined ||
        p.avatar !== undefined ||
        p.name !== undefined,
    );

    if (hasIdentityParams) {
      const maxRetries = 5;
      const retryDelay = 500;
      let lastError: Error | null = null;

      for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
          const config = await wsStore.rpc.getConfig();
          const currentList: AgentInstance[] = Array.isArray(
            config.agents?.list,
          )
            ? [...config.agents.list]
            : [];

          for (const params of paramsList) {
            if (
              params.theme === undefined &&
              params.emoji === undefined &&
              params.avatar === undefined &&
              params.name === undefined
            ) {
              continue;
            }

            const agentIndex = currentList.findIndex(
              (a) => a.id === params.agentId,
            );
            const identity: Record<string, string | undefined> = {
              name: params.name,
              theme: params.theme,
              emoji: params.emoji,
              avatar: params.avatar,
            };

            if (agentIndex >= 0) {
              const existing = currentList[agentIndex];
              if (existing) {
                currentList[agentIndex] = {
                  ...existing,
                  name: params.name !== undefined ? params.name : existing.name,
                  identity,
                };
              }
            } else {
              currentList.push({
                id: params.agentId,
                name: params.name,
                identity,
              });
            }
          }

          const newConfig = {
            ...config,
            agents: {
              ...config.agents,
              list: currentList,
            },
          };

          await wsStore.rpc.setConfig(newConfig);
          lastError = null;
          break;
        } catch (e: any) {
          lastError = e;
          const errorMsg = e?.message || String(e);
          if (
            errorMsg.includes("hash") ||
            errorMsg.includes("version") ||
            errorMsg.includes("conflict") ||
            errorMsg.includes("stale")
          ) {
            console.warn(
              `[AgentStore] Config conflict on attempt ${attempt + 1}, retrying...`,
            );
            await new Promise((resolve) =>
              setTimeout(resolve, retryDelay * (attempt + 1)),
            );
            continue;
          }
          throw e;
        }
      }

      if (lastError) {
        console.error(
          "[AgentStore] Failed to set agents identity batch after all retries:",
          lastError,
        );
        throw lastError;
      }
    }

    await fetchAgents();
  }

  async function setAgentModel(params: { agentId: string; model?: string | null }) {
    await wsStore.rpc.updateAgent({
      agentId: params.agentId,
      model: params.model === null ? "" : params.model,
    });
    await fetchAgents();
  }

  async function setAgentTools(params: {
    agentId: string;
    allow?: string[];
    deny?: string[];
  }) {
    const config = await wsStore.rpc.getConfig();
    const currentList: AgentInstance[] = Array.isArray(config.agents?.list)
      ? [...config.agents.list]
      : [];

    const agentIndex = currentList.findIndex((a) => a.id === params.agentId);
    const tools: ToolPolicyConfig = {
      allow: params.allow,
      deny: params.deny,
    };

    if (agentIndex >= 0) {
      const existing = currentList[agentIndex];
      if (existing) {
        currentList[agentIndex] = {
          ...existing,
          tools,
        };
      }
    } else {
      currentList.push({
        id: params.agentId,
        tools,
      });
    }

    const newConfig = {
      ...config,
      agents: {
        ...config.agents,
        list: currentList,
      },
    };

    await wsStore.rpc.setConfig(newConfig);
    await fetchAgents();
  }

  function getAgentById(id: string): AgentInfo | undefined {
    return agents.value.find((a) => a.id === id);
  }

  function getAgentStats(id: string) {
    return agentStats.value[id] || { sessions: 0, input: 0, output: 0 };
  }

  /**
   * Start auto-refresh of agent list at regular intervals.
   * This is useful for detecting dynamically created agents (e.g., from wecom plugin).
   */
  function startAutoRefresh(intervalMs = AUTO_REFRESH_INTERVAL_MS): void {
    if (refreshInterval) {
      console.warn(
        "[AgentStore] Auto-refresh already running, clearing previous interval",
      );
      clearInterval(refreshInterval);
    }

    refreshInterval = setInterval(() => {
      fetchAgents().catch((e) => {
        console.warn(
          "[AgentStore] Auto-refresh failed:",
          e?.message || String(e),
        );
      });
    }, intervalMs);

    console.log(
      `[AgentStore] Auto-refresh started with interval ${intervalMs}ms`,
    );
  }

  /**
   * Stop the auto-refresh interval.
   */
  function stopAutoRefresh(): void {
    if (refreshInterval) {
      clearInterval(refreshInterval);
      refreshInterval = null;
      console.log("[AgentStore] Auto-refresh stopped");
    }
  }

  function cleanupEventListeners(): void {
    while (eventUnsubscribes.length > 0) {
      const unsubscribe = eventUnsubscribes.pop();
      unsubscribe?.();
    }
  }

  /**
   * Setup WebSocket event listeners for agent lifecycle events.
   * This enables real-time detection of dynamically created/deleted agents.
   */
  function setupEventListeners(): void {
    if (eventUnsubscribes.length > 0) {
      return;
    }

    // Listen for agent creation events (if supported by Gateway)
    eventUnsubscribes.push(
      wsStore.subscribe("agent.created", (agentId: unknown) => {
        console.log("[AgentStore] Agent created event:", agentId);
        fetchAgents().catch((e) => {
          console.warn(
            "[AgentStore] Failed to refresh agents on creation event:",
            e?.message || String(e),
          );
        });
      }),
    );

    // Listen for agent deletion events (if supported by Gateway)
    eventUnsubscribes.push(
      wsStore.subscribe("agent.deleted", (agentId: unknown) => {
        console.log("[AgentStore] Agent deleted event:", agentId);
        fetchAgents().catch((e) => {
          console.warn(
            "[AgentStore] Failed to refresh agents on deletion event:",
            e?.message || String(e),
          );
        });
      }),
    );

    // As a fallback, also listen for generic agent update events
    eventUnsubscribes.push(
      wsStore.subscribe("agents.updated", () => {
        console.log("[AgentStore] Agents updated event received");
        fetchAgents().catch((e) => {
          console.warn(
            "[AgentStore] Failed to refresh agents on update event:",
            e?.message || String(e),
          );
        });
      }),
    );

    console.log("[AgentStore] Event listeners setup complete");
  }

  /**
   * Initialize the agent store with auto-refresh and event listeners.
   * Should be called once during app initialization.
   */
  async function initialize(): Promise<void> {
    if (initialized) {
      return;
    }

    console.log("[AgentStore] Initializing...");
    try {
      initialized = true;
      // Initial fetch
      await fetchAgents();
      await fetchModels();

      // Setup event listeners for dynamic agent detection
      setupEventListeners();

      console.log("[AgentStore] Initialization complete");
    } catch (e) {
      initialized = false;
      cleanupEventListeners();
      console.error("[AgentStore] Initialization failed:", e);
      throw e;
    }
  }

  return {
    agents,
    defaultAgentId,
    mainKey,
    loading,
    error,
    lastUpdatedAt,
    models,
    methodUnknown,
    supportsAgents,
    agentStats,
    fetchAgents,
    fetchModels,
    addAgent,
    deleteAgent,
    setAgentIdentity,
    setAgentsIdentityBatch,
    setAgentModel,
    setAgentTools,
    getAgentById,
    getAgentStats,
    startAutoRefresh,
    stopAutoRefresh,
    cleanupEventListeners,
    setupEventListeners,
    initialize,
  };
});

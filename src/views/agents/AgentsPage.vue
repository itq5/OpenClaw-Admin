<script setup lang="ts">
import { computed, h, onMounted, ref, watch, type VNode } from "vue";
import {
  NCard,
  NGrid,
  NGridItem,
  NSpace,
  NText,
  NTag,
  NIcon,
  NButton,
  NSpin,
  NAlert,
  NStatistic,
  NDataTable,
  NAvatar,
  NModal,
  NForm,
  NFormItem,
  NInput,
  NSelect,
  NPopconfirm,
  NDescriptions,
  NDescriptionsItem,
  NDivider,
  useMessage,
  useDialog,
  type DataTableColumns,
  type FormInst,
  type FormRules,
} from "naive-ui";
import {
  RefreshOutline,
  PersonOutline,
  PeopleOutline,
  ChatbubblesOutline,
  SparklesOutline,
  TimeOutline,
  AddOutline,
  TrashOutline,
  CreateOutline,
  SettingsOutline,
  InformationCircleOutline,
  ExtensionPuzzleOutline,
} from "@vicons/ionicons5";
import { useI18n } from "vue-i18n";
import { useAgentStore } from "@/stores/agent";
import { useSessionStore } from "@/stores/session";
import { useConfigStore } from "@/stores/config";
import { formatRelativeTime } from "@/utils/format";
import type { AgentInfo, AgentIdentity } from "@/api/types";

const { t } = useI18n();
const message = useMessage();
const dialog = useDialog();
const agentStore = useAgentStore();
const sessionStore = useSessionStore();
const configStore = useConfigStore();

const showCreateModal = ref(false);
const showEditModal = ref(false);
const showDetailModal = ref(false);
const showIdentityModal = ref(false);
const showModelModal = ref(false);
const showToolsModal = ref(false);
const selectedAgent = ref<AgentInfo | null>(null);
const formRef = ref<FormInst | null>(null);
const identityFormRef = ref<FormInst | null>(null);
const modelFormRef = ref<FormInst | null>(null);
const toolsFormRef = ref<FormInst | null>(null);
const submitting = ref(false);

const createForm = ref({
  id: "",
  name: "",
  workspace: "",
});

const identityForm = ref({
  name: "",
  theme: "",
  emoji: "",
  avatar: "",
});

const modelForm = ref({
  model: "",
});

const toolsForm = ref({
  allow: [] as string[],
  deny: [] as string[],
});

const commonTools = [
  "read",
  "write",
  "edit",
  "apply_patch",
  "exec",
  "process",
  "web_search",
  "web_fetch",
  "memory_search",
  "memory_get",
  "sessions_list",
  "sessions_history",
  "sessions_send",
  "sessions_spawn",
  "sessions_yield",
  "subagents",
  "session_status",
  "browser",
  "canvas",
  "message",
  "cron",
  "gateway",
  "nodes",
  "agents_list",
  "image",
  "image_generate",
  "tts",
];

const toolCategories = [
  {
    nameKey: "pages.agents.form.toolCategories.files",
    tools: ["read", "write", "edit", "apply_patch"],
  },
  {
    nameKey: "pages.agents.form.toolCategories.runtime",
    tools: ["exec", "process"],
  },
  {
    nameKey: "pages.agents.form.toolCategories.web",
    tools: ["web_search", "web_fetch"],
  },
  {
    nameKey: "pages.agents.form.toolCategories.memory",
    tools: ["memory_search", "memory_get"],
  },
  {
    nameKey: "pages.agents.form.toolCategories.sessions",
    tools: [
      "sessions_list",
      "sessions_history",
      "sessions_send",
      "sessions_spawn",
      "sessions_yield",
      "subagents",
      "session_status",
    ],
  },
  {
    nameKey: "pages.agents.form.toolCategories.ui",
    tools: ["browser", "canvas"],
  },
  {
    nameKey: "pages.agents.form.toolCategories.messaging",
    tools: ["message"],
  },
  {
    nameKey: "pages.agents.form.toolCategories.automation",
    tools: ["cron", "gateway"],
  },
  {
    nameKey: "pages.agents.form.toolCategories.nodes",
    tools: ["nodes"],
  },
  {
    nameKey: "pages.agents.form.toolCategories.agents",
    tools: ["agents_list"],
  },
  {
    nameKey: "pages.agents.form.toolCategories.media",
    tools: ["image", "image_generate", "tts"],
  },
];

const createRules: FormRules = {
  id: [
    {
      required: true,
      message: t("pages.agents.form.idRequired"),
      trigger: "blur",
    },
    {
      pattern: /^[a-zA-Z0-9_-]+$/,
      message: t("pages.agents.form.idPattern"),
      trigger: "blur",
    },
  ],
};

const tableColumns = computed<DataTableColumns<AgentInfo>>(() => [
  {
    title: t("pages.agents.columns.agent"),
    key: "agent",
    width: 200,
    render(row) {
      const identity = row.identity;
      const emoji = identity?.emoji;
      const avatar = identity?.avatarUrl || identity?.avatar;

      return h(
        NSpace,
        { align: "center", size: 12 },
        {
          default: () => [
            emoji
              ? h("span", { style: "font-size: 24px;" }, emoji)
              : h(
                  NAvatar,
                  {
                    round: true,
                    size: 32,
                    style:
                      "background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);",
                  },
                  {
                    default: () => h(NIcon, { component: PersonOutline }),
                  },
                ),
            h("div", {}, [
              h(
                NText,
                { strong: true, style: "display: block;" },
                { default: () => identity?.name || row.name || row.id },
              ),
              h(
                NText,
                { depth: 3, style: "font-size: 12px;" },
                { default: () => row.id },
              ),
            ]),
          ],
        },
      );
    },
  },
  {
    title: t("pages.agents.columns.status"),
    key: "status",
    width: 70,
    render(row) {
      const stats = agentStore.agentStats[row.id];
      const isActive = stats && stats.sessions > 0;
      return h(
        NTag,
        {
          type: isActive ? "success" : "default",
          bordered: false,
          round: true,
        },
        {
          default: () =>
            isActive
              ? t("pages.agents.status.active")
              : t("pages.agents.status.idle"),
        },
      );
    },
  },
  {
    title: t("pages.agents.columns.sessions"),
    key: "sessions",
    width: 70,
    render(row) {
      const stats = agentStore.agentStats[row.id];
      return h(NText, {}, { default: () => stats?.sessions ?? 0 });
    },
  },
  {
    title: t("pages.agents.columns.tokens"),
    key: "tokens",
    width: 100,
    render(row) {
      const stats = agentStore.agentStats[row.id];
      if (!stats) return "-";
      const total = stats.input + stats.output;
      return h(NText, {}, { default: () => formatTokens(total) });
    },
  },
  {
    title: t("pages.agents.columns.theme"),
    key: "theme",
    width: 120,
    render(row) {
      const theme = row.identity?.theme;
      return theme
        ? h(
            NTag,
            { size: "small", bordered: false, round: true },
            { default: () => theme },
          )
        : "-";
    },
  },
  {
    title: t("pages.agents.columns.model"),
    key: "model",
    width: 150,
    render(row) {
      const model = row.model;
      return model
        ? h(NText, {}, { default: () => model })
        : h(NText, { depth: 3 }, { default: () => "-" });
    },
  },
  {
    title: t("pages.agents.columns.tools"),
    key: "tools",
    width: 180,
    render(row) {
      const tools = row.tools;
      if (!tools || (!tools.allow?.length && !tools.deny?.length)) {
        return h(NText, { depth: 3 }, { default: () => "-" });
      }

      const tags: VNode[] = [];

      if (tools.allow?.length) {
        tools.allow.forEach((tool) => {
          tags.push(
            h(
              NTag,
              {
                size: "small",
                type: "success",
                bordered: false,
                style: "margin: 2px;",
              },
              { default: () => tool },
            ),
          );
        });
      }

      if (tools.deny?.length) {
        tools.deny.forEach((tool) => {
          tags.push(
            h(
              NTag,
              {
                size: "small",
                type: "error",
                bordered: false,
                style: "margin: 2px;",
              },
              { default: () => tool },
            ),
          );
        });
      }

      return h(
        "div",
        { style: "display: flex; flex-wrap: wrap; margin: -2px;" },
        tags,
      );
    },
  },
  {
    title: t("pages.agents.columns.actions"),
    key: "actions",
    width: 240,
    render(row) {
      const isMain = row.id === "main";
      return h(
        NSpace,
        { size: 4 },
        {
          default: () =>
            [
              h(
                NButton,
                {
                  size: "small",
                  quaternary: true,
                  onClick: () => openDetailModal(row),
                },
                {
                  default: () => t("pages.agents.actions.detail"),
                  icon: () => h(NIcon, { component: InformationCircleOutline }),
                },
              ),
              h(
                NButton,
                {
                  size: "small",
                  quaternary: true,
                  onClick: () => openIdentityModal(row),
                },
                {
                  default: () => t("pages.agents.actions.identity"),
                  icon: () => h(NIcon, { component: CreateOutline }),
                },
              ),
              h(
                NButton,
                {
                  size: "small",
                  quaternary: true,
                  onClick: () => openModelModal(row),
                },
                {
                  default: () => t("pages.agents.actions.model"),
                  icon: () => h(NIcon, { component: SettingsOutline }),
                },
              ),
              h(
                NButton,
                {
                  size: "small",
                  quaternary: true,
                  onClick: () => openToolsModal(row),
                },
                {
                  default: () => t("pages.agents.actions.tools"),
                  icon: () => h(NIcon, { component: ExtensionPuzzleOutline }),
                },
              ),
              !isMain
                ? h(
                    NPopconfirm,
                    {
                      onPositiveClick: () => handleDelete(row.id),
                    },
                    {
                      trigger: () =>
                        h(
                          NButton,
                          {
                            size: "small",
                            quaternary: true,
                            type: "error",
                          },
                          {
                            default: () => t("common.delete"),
                            icon: () => h(NIcon, { component: TrashOutline }),
                          },
                        ),
                      default: () => t("pages.agents.confirmDelete"),
                    },
                  )
                : null,
            ].filter(Boolean),
        },
      );
    },
  },
]);

function formatTokens(num: number): string {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + "M";
  if (num >= 1000) return (num / 1000).toFixed(1) + "K";
  return num.toString();
}

async function loadData() {
  await agentStore.fetchAgents();
  await agentStore.fetchModels();
  if (!configStore.config) {
    await configStore.fetchConfig();
  }
  if (sessionStore.sessions.length === 0) {
    await sessionStore.fetchSessions();
  }
}

function openCreateModal() {
  createForm.value = { id: "", name: "", workspace: "" };
  showCreateModal.value = true;
}

function openDetailModal(agent: AgentInfo) {
  selectedAgent.value = agent;
  showDetailModal.value = true;
}

function openIdentityModal(agent: AgentInfo) {
  selectedAgent.value = agent;
  identityForm.value = {
    name: agent.identity?.name || agent.name || "",
    theme: agent.identity?.theme || "",
    emoji: agent.identity?.emoji || "",
    avatar: agent.identity?.avatar || "",
  };
  showIdentityModal.value = true;
}

function openModelModal(agent: AgentInfo) {
  selectedAgent.value = agent;
  modelForm.value = {
    model: agent.model || "",
  };
  showModelModal.value = true;
}

function openToolsModal(agent: AgentInfo) {
  selectedAgent.value = agent;
  const tools = agent.tools;
  toolsForm.value = {
    allow: tools?.allow || [],
    deny: tools?.deny || [],
  };
  showToolsModal.value = true;
}

function addToolToAllow(tool: string) {
  if (!toolsForm.value.allow.includes(tool)) {
    toolsForm.value.allow.push(tool);
  }
}

function removeToolFromAllow(tool: string) {
  const index = toolsForm.value.allow.indexOf(tool);
  if (index > -1) {
    toolsForm.value.allow.splice(index, 1);
  }
}

function addToolToDeny(tool: string) {
  if (!toolsForm.value.deny.includes(tool)) {
    toolsForm.value.deny.push(tool);
  }
}

function removeToolFromDeny(tool: string) {
  const index = toolsForm.value.deny.indexOf(tool);
  if (index > -1) {
    toolsForm.value.deny.splice(index, 1);
  }
}

async function handleCreate() {
  try {
    await formRef.value?.validate();
  } catch {
    return;
  }

  submitting.value = true;
  try {
    await agentStore.addAgent({
      id: createForm.value.id,
      name: createForm.value.name || undefined,
      workspace: createForm.value.workspace || undefined,
    });
    message.success(t("pages.agents.messages.created"));
    showCreateModal.value = false;
  } catch (e: any) {
    message.error(e?.message || t("pages.agents.messages.createFailed"));
  } finally {
    submitting.value = false;
  }
}

async function handleDelete(agentId: string) {
  try {
    await agentStore.deleteAgent(agentId);
    message.success(t("pages.agents.messages.deleted"));
  } catch (e: any) {
    message.error(e?.message || t("pages.agents.messages.deleteFailed"));
  }
}

async function handleSetIdentity() {
  if (!selectedAgent.value) return;

  submitting.value = true;
  try {
    await agentStore.setAgentIdentity({
      agentId: selectedAgent.value.id,
      name: identityForm.value.name || undefined,
      theme: identityForm.value.theme || undefined,
      emoji: identityForm.value.emoji || undefined,
      avatar: identityForm.value.avatar || undefined,
    });
    message.success(t("pages.agents.messages.identitySaved"));
    showIdentityModal.value = false;
  } catch (e: any) {
    message.error(e?.message || t("pages.agents.messages.identityFailed"));
  } finally {
    submitting.value = false;
  }
}

async function handleSetModel() {
  if (!selectedAgent.value) return;

  submitting.value = true;
  try {
    const modelValue = modelForm.value.model;
    await agentStore.setAgentModel({
      agentId: selectedAgent.value.id,
      model: modelValue || null,
    });
    message.success(t("pages.agents.messages.modelSaved"));
    showModelModal.value = false;
  } catch (e: any) {
    message.error(e?.message || t("pages.agents.messages.modelFailed"));
  } finally {
    submitting.value = false;
  }
}

async function handleSetTools() {
  if (!selectedAgent.value) return;

  submitting.value = true;
  try {
    await agentStore.setAgentTools({
      agentId: selectedAgent.value.id,
      allow:
        toolsForm.value.allow.length > 0 ? toolsForm.value.allow : undefined,
      deny: toolsForm.value.deny.length > 0 ? toolsForm.value.deny : undefined,
    });
    message.success(t("pages.agents.messages.toolsSaved"));
    showToolsModal.value = false;
  } catch (e: any) {
    message.error(e?.message || t("pages.agents.messages.toolsFailed"));
  } finally {
    submitting.value = false;
  }
}

const modelOptions = computed(() => {
  const options: Array<{ label: string; value: string }> = [];
  const config = configStore.config;
  const providers = config?.models?.providers || {};

  for (const [providerId, provider] of Object.entries(providers)) {
    if (!provider || typeof provider !== "object") continue;
    const providerConfig = provider as Record<string, unknown>;
    const models = providerConfig.models;
    if (!Array.isArray(models)) continue;

    for (const model of models) {
      if (!model || typeof model !== "object") continue;
      const modelConfig = model as Record<string, unknown>;
      const modelId =
        (typeof modelConfig.id === "string" && modelConfig.id.trim()) || "";
      if (!modelId) continue;
      const label = `${providerId}/${modelId}`;
      options.push({
        label,
        value: label,
      });
    }
  }

  return options.sort((a, b) => a.label.localeCompare(b.label));
});

const totalSessions = computed(() => {
  return agentStore.agents.reduce((acc, agent) => {
    return acc + agentStore.getAgentStats(agent.id).sessions;
  }, 0);
});

const totalTokens = computed(() => {
  return agentStore.agents.reduce((acc, agent) => {
    const stats = agentStore.getAgentStats(agent.id);
    return acc + stats.input + stats.output;
  }, 0);
});

const configuredModelsCount = computed(() => {
  return agentStore.agents.filter((agent) => agent.model).length;
});

function formatTokenTotalK(total: number): string {
  const value = Math.max(0, total) / 1000;
  const digits = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  const text = value
    .toFixed(digits)
    .replace(/\.0+$/, "")
    .replace(/(\.\d*[1-9])0+$/, "$1");
  return `${text}K`;
}

onMounted(() => {
  console.log("[AgentsPage] Mounted - loading initial data");
  loadData();
});
</script>

<template>
  <div class="agents-page">
    <NCard class="agents-hero" :bordered="false">
      <template #header>
        <div class="agents-hero-title">{{ t("routes.agents") }}</div>
      </template>
      <template #header-extra>
        <NSpace :size="8">
          <NButton size="small" type="primary" @click="openCreateModal">
            <template #icon><NIcon :component="AddOutline" /></template>
            {{ t("pages.agents.actions.create") }}
          </NButton>
          <NButton size="small" :loading="agentStore.loading" @click="loadData">
            <template #icon><NIcon :component="RefreshOutline" /></template>
            {{ t("common.refresh") }}
          </NButton>
        </NSpace>
      </template>

      <NGrid cols="1 s:2 m:4" responsive="screen" :x-gap="10" :y-gap="10">
        <NGridItem>
          <NCard embedded :bordered="false" class="agents-metric-card">
            <NSpace justify="space-between" align="center">
              <NText depth="3">{{
                t("pages.agents.metrics.totalAgents")
              }}</NText>
              <NIcon :component="PeopleOutline" />
            </NSpace>
            <div class="agents-metric-value">
              {{ agentStore.agents.length }}
            </div>
          </NCard>
        </NGridItem>
        <NGridItem>
          <NCard embedded :bordered="false" class="agents-metric-card">
            <NSpace justify="space-between" align="center">
              <NText depth="3">{{
                t("pages.agents.metrics.totalSessions")
              }}</NText>
              <NIcon :component="ChatbubblesOutline" />
            </NSpace>
            <div class="agents-metric-value">{{ totalSessions }}</div>
          </NCard>
        </NGridItem>
        <NGridItem>
          <NCard embedded :bordered="false" class="agents-metric-card">
            <NSpace justify="space-between" align="center">
              <NText depth="3">{{
                t("pages.agents.metrics.totalTokens")
              }}</NText>
              <NText depth="3">{{ t("pages.agents.units.tokens") }}</NText>
            </NSpace>
            <div class="agents-metric-value">
              {{ formatTokenTotalK(totalTokens) }}
            </div>
          </NCard>
        </NGridItem>
        <NGridItem>
          <NCard embedded :bordered="false" class="agents-metric-card">
            <NSpace justify="space-between" align="center">
              <NText depth="3">{{
                t("pages.agents.metrics.configuredModels")
              }}</NText>
              <NIcon :component="SettingsOutline" />
            </NSpace>
            <div class="agents-metric-value">{{ configuredModelsCount }}</div>
          </NCard>
        </NGridItem>
      </NGrid>
    </NCard>

    <NCard :title="t('pages.agents.listTitle')" class="agents-card">
      <template #header-extra>
        <NText depth="3" style="font-size: 12px">
          {{ t("pages.agents.listCount", { count: agentStore.agents.length }) }}
        </NText>
      </template>

      <NAlert
        v-if="!agentStore.supportsAgents"
        type="warning"
        :bordered="false"
        style="margin-bottom: 16px"
      >
        {{ t("pages.agents.notSupported") }}
      </NAlert>

      <NAlert
        v-if="agentStore.error"
        type="error"
        :bordered="false"
        style="margin-bottom: 16px"
      >
        {{ agentStore.error }}
      </NAlert>

      <NDataTable
        v-if="agentStore.agents.length > 0"
        :columns="tableColumns"
        :data="agentStore.agents"
        :bordered="false"
        :single-line="false"
        size="small"
        :pagination="{ pageSize: 12 }"
        :scroll-x="1200"
        striped
      />
      <NEmpty
        v-else
        :description="t('pages.agents.empty')"
        style="padding: 48px 0"
      />

      <NText
        v-if="agentStore.lastUpdatedAt"
        depth="3"
        style="font-size: 12px; display: block; margin-top: 16px"
      >
        {{
          t("pages.agents.lastUpdated", {
            time: formatRelativeTime(agentStore.lastUpdatedAt),
          })
        }}
      </NText>
    </NCard>

    <NModal
      v-model:show="showCreateModal"
      preset="card"
      :title="t('pages.agents.modal.createTitle')"
      style="width: 500px; max-width: 90vw"
      :mask-closable="false"
    >
      <NForm
        ref="formRef"
        :model="createForm"
        :rules="createRules"
        label-placement="left"
        label-width="100"
      >
        <NFormItem :label="t('pages.agents.form.id')" path="id">
          <NInput
            v-model:value="createForm.id"
            :placeholder="t('pages.agents.form.idPlaceholder')"
          />
        </NFormItem>
        <NFormItem :label="t('pages.agents.form.name')" path="name">
          <NInput
            v-model:value="createForm.name"
            :placeholder="t('pages.agents.form.namePlaceholder')"
          />
        </NFormItem>
        <NFormItem :label="t('pages.agents.form.workspace')" path="workspace">
          <NInput
            v-model:value="createForm.workspace"
            :placeholder="t('pages.agents.form.workspacePlaceholder')"
          />
        </NFormItem>
      </NForm>
      <template #footer>
        <NSpace justify="end">
          <NButton @click="showCreateModal = false">{{
            t("common.cancel")
          }}</NButton>
          <NButton type="primary" :loading="submitting" @click="handleCreate">
            {{ t("common.create") }}
          </NButton>
        </NSpace>
      </template>
    </NModal>

    <NModal
      v-model:show="showDetailModal"
      preset="card"
      :title="t('pages.agents.modal.detailTitle')"
      style="width: 600px; max-width: 90vw"
    >
      <template v-if="selectedAgent">
        <NDescriptions label-placement="left" :column="1" bordered>
          <NDescriptionsItem :label="t('pages.agents.detail.id')">
            {{ selectedAgent.id }}
          </NDescriptionsItem>
          <NDescriptionsItem :label="t('pages.agents.detail.name')">
            {{ selectedAgent.identity?.name || selectedAgent.name || "-" }}
          </NDescriptionsItem>
          <NDescriptionsItem :label="t('pages.agents.detail.theme')">
            {{ selectedAgent.identity?.theme || "-" }}
          </NDescriptionsItem>
          <NDescriptionsItem :label="t('pages.agents.detail.emoji')">
            {{ selectedAgent.identity?.emoji || "-" }}
          </NDescriptionsItem>
          <NDescriptionsItem :label="t('pages.agents.detail.avatar')">
            {{ selectedAgent.identity?.avatar || "-" }}
          </NDescriptionsItem>
          <NDescriptionsItem :label="t('pages.agents.detail.sessions')">
            {{ agentStore.agentStats[selectedAgent.id]?.sessions ?? 0 }}
          </NDescriptionsItem>
          <NDescriptionsItem :label="t('pages.agents.detail.tokens')">
            {{
              formatTokens(
                (agentStore.agentStats[selectedAgent.id]?.input || 0) +
                  (agentStore.agentStats[selectedAgent.id]?.output || 0),
              )
            }}
          </NDescriptionsItem>
        </NDescriptions>
      </template>
    </NModal>

    <NModal
      v-model:show="showIdentityModal"
      preset="card"
      :title="t('pages.agents.modal.identityTitle')"
      style="width: 500px; max-width: 90vw"
      :mask-closable="false"
    >
      <NForm
        ref="identityFormRef"
        :model="identityForm"
        label-placement="left"
        label-width="80"
      >
        <NFormItem :label="t('pages.agents.form.name')">
          <NInput
            v-model:value="identityForm.name"
            :placeholder="t('pages.agents.form.namePlaceholder')"
          />
        </NFormItem>
        <NFormItem :label="t('pages.agents.form.theme')">
          <NInput
            v-model:value="identityForm.theme"
            :placeholder="t('pages.agents.form.themePlaceholder')"
          />
        </NFormItem>
        <NFormItem :label="t('pages.agents.form.emoji')">
          <NInput
            v-model:value="identityForm.emoji"
            :placeholder="t('pages.agents.form.emojiPlaceholder')"
          />
        </NFormItem>
        <NFormItem :label="t('pages.agents.form.avatar')">
          <NInput
            v-model:value="identityForm.avatar"
            :placeholder="t('pages.agents.form.avatarPlaceholder')"
          />
        </NFormItem>
      </NForm>
      <template #footer>
        <NSpace justify="end">
          <NButton @click="showIdentityModal = false">{{
            t("common.cancel")
          }}</NButton>
          <NButton
            type="primary"
            :loading="submitting"
            @click="handleSetIdentity"
          >
            {{ t("common.save") }}
          </NButton>
        </NSpace>
      </template>
    </NModal>

    <NModal
      v-model:show="showModelModal"
      preset="card"
      :title="t('pages.agents.modal.modelTitle')"
      style="width: 500px; max-width: 90vw"
      :mask-closable="false"
    >
      <NForm
        ref="modelFormRef"
        :model="modelForm"
        label-placement="left"
        label-width="80"
      >
        <NFormItem :label="t('pages.agents.form.model')">
          <NSelect
            v-model:value="modelForm.model"
            :options="modelOptions"
            :placeholder="t('pages.agents.form.modelPlaceholder')"
            clearable
            filterable
          />
        </NFormItem>
      </NForm>
      <template #footer>
        <NSpace justify="end">
          <NButton @click="showModelModal = false">{{
            t("common.cancel")
          }}</NButton>
          <NButton type="primary" :loading="submitting" @click="handleSetModel">
            {{ t("common.save") }}
          </NButton>
        </NSpace>
      </template>
    </NModal>

    <NModal
      v-model:show="showToolsModal"
      preset="card"
      :title="t('pages.agents.modal.toolsTitle')"
      style="width: 700px; max-width: 90vw"
      :mask-closable="false"
    >
      <NSpace vertical size="large">
        <div>
          <NText
            depth="3"
            style="font-size: 12px; margin-bottom: 8px; display: block"
          >
            {{ t("pages.agents.form.toolsAllow") }}
          </NText>
          <NSpace size="small" style="margin-bottom: 8px">
            <NTag
              v-for="tool in toolsForm.allow"
              :key="tool"
              type="success"
              closable
              @close="removeToolFromAllow(tool)"
            >
              {{ tool }}
            </NTag>
            <NInput
              :style="{ width: '120px' }"
              size="small"
              :placeholder="t('pages.agents.form.addTool')"
              @keydown.enter="
                (e: KeyboardEvent) => {
                  const target = e.target as HTMLInputElement;
                  if (target.value.trim()) {
                    addToolToAllow(target.value.trim());
                    target.value = '';
                  }
                }
              "
            />
          </NSpace>
        </div>

        <div>
          <NText
            depth="3"
            style="font-size: 12px; margin-bottom: 8px; display: block"
          >
            {{ t("pages.agents.form.toolsDeny") }}
          </NText>
          <NSpace size="small" style="margin-bottom: 8px">
            <NTag
              v-for="tool in toolsForm.deny"
              :key="tool"
              type="error"
              closable
              @close="removeToolFromDeny(tool)"
            >
              {{ tool }}
            </NTag>
            <NInput
              :style="{ width: '120px' }"
              size="small"
              :placeholder="t('pages.agents.form.addTool')"
              @keydown.enter="
                (e: KeyboardEvent) => {
                  const target = e.target as HTMLInputElement;
                  if (target.value.trim()) {
                    addToolToDeny(target.value.trim());
                    target.value = '';
                  }
                }
              "
            />
          </NSpace>
        </div>

        <NDivider style="margin: 8px 0" />

        <div>
          <NText
            depth="3"
            style="font-size: 12px; margin-bottom: 8px; display: block"
          >
            {{ t("pages.agents.form.commonTools") }}
          </NText>
          <NSpace vertical size="small">
            <div v-for="category in toolCategories" :key="category.nameKey">
              <NText depth="3" style="font-size: 11px; margin-right: 8px"
                >{{ t(category.nameKey) }}:</NText
              >
              <NSpace size="small" style="margin-top: 4px">
                <NButton
                  v-for="tool in category.tools"
                  :key="tool"
                  size="tiny"
                  :type="
                    toolsForm.allow.includes(tool)
                      ? 'success'
                      : toolsForm.deny.includes(tool)
                        ? 'error'
                        : 'default'
                  "
                  :disabled="
                    toolsForm.allow.includes(tool) ||
                    toolsForm.deny.includes(tool)
                  "
                  @click="addToolToAllow(tool)"
                  @contextmenu.prevent="addToolToDeny(tool)"
                >
                  {{ tool }}
                </NButton>
              </NSpace>
            </div>
          </NSpace>
          <NText
            depth="3"
            style="font-size: 11px; margin-top: 8px; display: block"
          >
            {{ t("pages.agents.form.toolsHint") }}
          </NText>
        </div>
      </NSpace>
      <template #footer>
        <NSpace justify="end">
          <NButton @click="showToolsModal = false">{{
            t("common.cancel")
          }}</NButton>
          <NButton type="primary" :loading="submitting" @click="handleSetTools">
            {{ t("common.save") }}
          </NButton>
        </NSpace>
      </template>
    </NModal>
  </div>
</template>

<style scoped>
.agents-page {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.agents-hero {
  border-radius: var(--radius-lg);
  background:
    radial-gradient(
      circle at 84% 16%,
      rgba(32, 128, 240, 0.22),
      transparent 36%
    ),
    linear-gradient(120deg, var(--bg-card), rgba(24, 160, 88, 0.08));
  border: 1px solid rgba(32, 128, 240, 0.18);
}

.agents-hero-title {
  font-size: 18px;
  font-weight: 700;
  line-height: 1.2;
}

.agents-metric-card {
  border-radius: 10px;
}

.agents-metric-value {
  margin-top: 8px;
  font-size: 22px;
  font-weight: 700;
  line-height: 1.2;
}

.agents-card {
  border-radius: var(--radius-lg);
}
</style>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useOfficeStore } from '@/stores/office'
import { useAgentStore } from '@/stores/agent'
import { useSessionStore } from '@/stores/session'
import { useChatStore } from '@/stores/chat'
import { useWebSocketStore } from '@/stores/websocket'
import { useResizable } from '@/composables/useResizable'
import OfficeToolbar from '@/components/office/OfficeToolbar.vue'
import AgentChatPanel from '@/components/office/AgentChatPanel.vue'
import { formatRelativeTime } from '@/utils/format'
import { renderSimpleMarkdown } from '@/utils/markdown'
import { 
  AddOutline,
  RemoveOutline,
  ExpandOutline,
  ChatbubblesOutline,
  TimeOutline,
  TrashOutline,
  CheckmarkOutline,
  CloseOutline,
  CopyOutline,
} from '@vicons/ionicons5'
import {
  NModal,
  NForm,
  NFormItem,
  NInput,
  NSelect,
  NButton,
  NSpace,
  NIcon,
  NTooltip,
  NTag,
  NText,
  NDivider,
  useMessage,
} from 'naive-ui'

interface RoomDoor {
  position: 'top' | 'bottom' | 'left' | 'right'
  offset: number
  width?: number
}

interface Room {
  id: string
  name: string
  type: 'office' | 'meeting-small' | 'meeting-large' | 'manager' | 'restroom' | 'storage' | 'open-desk' | 'reception' | 'pantry' | 'lounge'
  x: number
  y: number
  width: number
  height: number
  hasWalls: boolean
  doors: RoomDoor[]
  deskCount?: number
}

interface Wall {
  id: string
  x1: number
  y1: number
  x2: number
  y2: number
  thickness: number
  roomId?: string
}

interface Door {
  id: string
  roomId: string
  position: 'top' | 'bottom' | 'left' | 'right'
  offset: number
  width: number
}

interface PathNode {
  x: number
  y: number
  neighbors: string[]
}

interface Character {
  agentId: string
  x: number
  y: number
  targetX: number
  targetY: number
  currentRoom: string
  status: 'idle' | 'walking' | 'working' | 'talking' | 'resting'
  talkingTo: string | null
  direction: 'left' | 'right'
  path: { x: number; y: number }[]
  colorIndex: number
  isWandering: boolean
  gender: 'male' | 'female'
  hairStyle: number
  skinTone: number
}

const { t } = useI18n()
const officeStore = useOfficeStore()
const agentStore = useAgentStore()
const sessionStore = useSessionStore()
const chatStore = useChatStore()
const wsStore = useWebSocketStore()
const message = useMessage()

const eventCleanups: Array<() => void> = []

const containerRef = ref<HTMLElement | null>(null)
const sceneRef = ref<HTMLElement | null>(null)

const scale = ref(1)
const minScale = ref(0.4)
const maxScale = ref(2)
const offset = ref({ x: 0, y: 0 })
const isDragging = ref(false)
const dragStart = ref({ x: 0, y: 0 })

const selectedCharacterId = ref<string | null>(null)
const hoveredAgentId = ref<string | null>(null)
const hoveredMessage = ref<string | null>(null)
const isTooltipHovered = ref(false)
const tooltipPosition = ref({ x: 0, y: 0 })
const showSessionList = ref(false)
const showChatPanel = ref(false)
const chatPanelSessionKey = ref<string | null>(null)
const chatPanelRef = ref<HTMLElement | null>(null)
const { width: chatPanelWidth, isResizing: isChatPanelResizing } = useResizable(chatPanelRef, {
  minWidth: 320,
  maxWidth: 700,
  defaultWidth: 420,
  storageKey: 'myworld_chat_panel_width',
  direction: 'left',
})
const isInitialized = ref(false)
const isCharactersInitialized = ref(false)

const showCreateModal = ref(false)
const creating = ref(false)
const createForm = ref({
  agentId: '',
  channel: 'main',
  peer: '',
  label: '',
})

const showCreateAgentModal = ref(false)
const creatingAgent = ref(false)
const createAgentForm = ref({
  id: '',
  name: '',
  workspace: '',
})

const showToolsModal = ref(false)
const selectedAgentForTools = ref<{ id: string; name?: string; tools?: { allow?: string[]; deny?: string[] } } | null>(null)
const toolsForm = ref({
  allow: [] as string[],
  deny: [] as string[],
})
const savingTools = ref(false)

const toolCategories = [
  { nameKey: 'myworld.toolCategories.files', tools: ['read', 'write', 'edit', 'apply_patch'] },
  { nameKey: 'myworld.toolCategories.runtime', tools: ['exec', 'process'] },
  { nameKey: 'myworld.toolCategories.web', tools: ['web_search', 'web_fetch'] },
  { nameKey: 'myworld.toolCategories.memory', tools: ['memory_search', 'memory_get'] },
  { nameKey: 'myworld.toolCategories.sessions', tools: ['sessions_list', 'sessions_history', 'sessions_send', 'sessions_spawn', 'sessions_yield', 'subagents', 'session_status'] },
  { nameKey: 'myworld.toolCategories.ui', tools: ['browser', 'canvas'] },
  { nameKey: 'myworld.toolCategories.messaging', tools: ['message'] },
  { nameKey: 'myworld.toolCategories.automation', tools: ['cron', 'gateway'] },
  { nameKey: 'myworld.toolCategories.nodes', tools: ['nodes'] },
  { nameKey: 'myworld.toolCategories.agents', tools: ['agents_list'] },
  { nameKey: 'myworld.toolCategories.media', tools: ['image', 'image_generate', 'tts'] },
]

const channelOptions = [
  { label: 'Main', value: 'main' },
  { label: 'WhatsApp', value: 'whatsapp' },
  { label: 'Telegram', value: 'telegram' },
  { label: 'Discord', value: 'discord' },
  { label: 'Slack', value: 'slack' },
]

const isDeleteMode = ref(false)
const selectedSessionKeys = ref<Set<string>>(new Set())

const sceneWidth = ref(1800)
const sceneHeight = ref(1250)

const WALL_THICKNESS = 8
const DOOR_WIDTH = 50
const LARGE_DOOR_WIDTH = 75

const rooms = computed<Room[]>(() => [
  { id: 'reception', name: t('myworld.areas.reception'), type: 'reception', x: 50, y: 30, width: 1700, height: 280, hasWalls: false, doors: [] },
  { id: 'office-1', name: t('myworld.areas.office1'), type: 'office', x: 50, y: 350, width: 320, height: 200, hasWalls: true, doors: [{ position: 'top', offset: 160, width: LARGE_DOOR_WIDTH }, { position: 'bottom', offset: 160, width: LARGE_DOOR_WIDTH }, { position: 'right', offset: 100, width: LARGE_DOOR_WIDTH }], deskCount: 8 },
  { id: 'office-2', name: t('myworld.areas.office2'), type: 'office', x: 400, y: 350, width: 320, height: 200, hasWalls: true, doors: [{ position: 'top', offset: 160, width: LARGE_DOOR_WIDTH }, { position: 'bottom', offset: 160, width: LARGE_DOOR_WIDTH }, { position: 'left', offset: 100, width: LARGE_DOOR_WIDTH }, { position: 'right', offset: 100, width: LARGE_DOOR_WIDTH }], deskCount: 8 },
  { id: 'office-3', name: t('myworld.areas.office3'), type: 'office', x: 750, y: 350, width: 320, height: 200, hasWalls: true, doors: [{ position: 'top', offset: 160, width: LARGE_DOOR_WIDTH }, { position: 'bottom', offset: 160, width: LARGE_DOOR_WIDTH }, { position: 'left', offset: 100, width: LARGE_DOOR_WIDTH }, { position: 'right', offset: 100, width: LARGE_DOOR_WIDTH }], deskCount: 8 },
  { id: 'office-4', name: t('myworld.areas.office4'), type: 'office', x: 50, y: 600, width: 320, height: 200, hasWalls: true, doors: [{ position: 'top', offset: 160, width: LARGE_DOOR_WIDTH }, { position: 'bottom', offset: 160, width: LARGE_DOOR_WIDTH }, { position: 'right', offset: 100, width: LARGE_DOOR_WIDTH }], deskCount: 8 },
  { id: 'office-5', name: t('myworld.areas.office5'), type: 'office', x: 400, y: 600, width: 320, height: 200, hasWalls: true, doors: [{ position: 'top', offset: 160, width: LARGE_DOOR_WIDTH }, { position: 'bottom', offset: 160, width: LARGE_DOOR_WIDTH }, { position: 'left', offset: 100, width: LARGE_DOOR_WIDTH }, { position: 'right', offset: 100, width: LARGE_DOOR_WIDTH }], deskCount: 8 },
  { id: 'office-6', name: t('myworld.areas.office6'), type: 'office', x: 750, y: 600, width: 320, height: 200, hasWalls: true, doors: [{ position: 'top', offset: 160, width: LARGE_DOOR_WIDTH }, { position: 'bottom', offset: 160, width: LARGE_DOOR_WIDTH }, { position: 'left', offset: 100, width: LARGE_DOOR_WIDTH }, { position: 'right', offset: 100, width: LARGE_DOOR_WIDTH }], deskCount: 8 },
  { id: 'meeting-small-1', name: t('myworld.areas.meetingSmall1'), type: 'meeting-small', x: 50, y: 850, width: 200, height: 150, hasWalls: true, doors: [{ position: 'top', offset: 100, width: LARGE_DOOR_WIDTH }, { position: 'bottom', offset: 100, width: LARGE_DOOR_WIDTH }] },
  { id: 'meeting-small-2', name: t('myworld.areas.meetingSmall2'), type: 'meeting-small', x: 280, y: 850, width: 200, height: 150, hasWalls: true, doors: [{ position: 'top', offset: 100, width: LARGE_DOOR_WIDTH }, { position: 'bottom', offset: 100, width: LARGE_DOOR_WIDTH }] },
  { id: 'meeting-large', name: t('myworld.areas.meetingRoom'), type: 'meeting-large', x: 510, y: 850, width: 300, height: 200, hasWalls: true, doors: [{ position: 'top', offset: 150, width: LARGE_DOOR_WIDTH }, { position: 'bottom', offset: 150, width: LARGE_DOOR_WIDTH }] },
  { id: 'manager-1', name: t('myworld.areas.manager1'), type: 'manager', x: 50, y: 1050, width: 200, height: 100, hasWalls: true, doors: [{ position: 'top', offset: 100 }] },
  { id: 'manager-2', name: t('myworld.areas.manager2'), type: 'manager', x: 280, y: 1050, width: 200, height: 100, hasWalls: true, doors: [{ position: 'top', offset: 100 }] },
  { id: 'pantry', name: t('myworld.areas.pantry'), type: 'pantry', x: 1250, y: 350, width: 250, height: 180, hasWalls: false, doors: [] },
  { id: 'lounge', name: t('myworld.areas.lounge'), type: 'lounge', x: 1250, y: 560, width: 250, height: 200, hasWalls: false, doors: [] },
  { id: 'meeting-small-3', name: t('myworld.areas.meetingSmall3'), type: 'meeting-small', x: 1550, y: 350, width: 200, height: 150, hasWalls: true, doors: [{ position: 'left', offset: 75 }] },
  { id: 'restroom-m-2', name: t('myworld.areas.restroomM'), type: 'restroom', x: 1550, y: 530, width: 100, height: 100, hasWalls: true, doors: [{ position: 'left', offset: 50 }] },
  { id: 'restroom-f-2', name: t('myworld.areas.restroomF'), type: 'restroom', x: 1670, y: 530, width: 100, height: 100, hasWalls: true, doors: [{ position: 'left', offset: 50 }] },
  { id: 'meeting-small-4', name: t('myworld.areas.meetingSmall4'), type: 'meeting-small', x: 1550, y: 660, width: 200, height: 150, hasWalls: true, doors: [{ position: 'left', offset: 75 }] },
  { id: 'open-desk', name: t('myworld.areas.openDesk'), type: 'open-desk', x: 1250, y: 790, width: 500, height: 300, hasWalls: false, doors: [], deskCount: 12 },
  { id: 'restroom-m', name: t('myworld.areas.restroomM'), type: 'restroom', x: 1250, y: 1120, width: 120, height: 100, hasWalls: true, doors: [{ position: 'top', offset: 60 }] },
  { id: 'restroom-f', name: t('myworld.areas.restroomF'), type: 'restroom', x: 1390, y: 1120, width: 120, height: 100, hasWalls: true, doors: [{ position: 'top', offset: 60 }] },
  { id: 'storage', name: t('myworld.areas.storage'), type: 'storage', x: 1530, y: 1120, width: 140, height: 100, hasWalls: true, doors: [{ position: 'top', offset: 70 }] },
])

const walls = computed<Wall[]>(() => {
  const result: Wall[] = []
  const wallRooms = rooms.value.filter(r => r.hasWalls)
  
  wallRooms.forEach(room => {
    result.push(
      { id: `wall-${room.id}-top`, x1: room.x, y1: room.y, x2: room.x + room.width, y2: room.y, thickness: WALL_THICKNESS, roomId: room.id },
      { id: `wall-${room.id}-bottom`, x1: room.x, y1: room.y + room.height, x2: room.x + room.width, y2: room.y + room.height, thickness: WALL_THICKNESS, roomId: room.id },
      { id: `wall-${room.id}-left`, x1: room.x, y1: room.y, x2: room.x, y2: room.y + room.height, thickness: WALL_THICKNESS, roomId: room.id },
      { id: `wall-${room.id}-right`, x1: room.x + room.width, y1: room.y, x2: room.x + room.width, y2: room.y + room.height, thickness: WALL_THICKNESS, roomId: room.id }
    )
  })
  
  result.push(
    { id: 'wall-outer-top', x1: 30, y1: 30, x2: sceneWidth.value - 30, y2: 30, thickness: 12 },
    { id: 'wall-outer-bottom', x1: 30, y1: sceneHeight.value - 30, x2: sceneWidth.value - 30, y2: sceneHeight.value - 30, thickness: 12 },
    { id: 'wall-outer-left', x1: 30, y1: 30, x2: 30, y2: sceneHeight.value - 30, thickness: 12 },
    { id: 'wall-outer-right', x1: sceneWidth.value - 30, y1: 30, x2: sceneWidth.value - 30, y2: sceneHeight.value - 30, thickness: 12 }
  )
  
  return result
})

const doors = computed<Door[]>(() => {
  const result: Door[] = []
  rooms.value.filter(r => r.hasWalls && r.doors.length > 0).forEach(room => {
    room.doors.forEach((door, index) => {
      result.push({
        id: `door-${room.id}-${index}`,
        roomId: room.id,
        position: door.position,
        offset: door.offset,
        width: door.width || DOOR_WIDTH
      })
    })
  })
  return result
})

const pathNodes = computed<Map<string, PathNode>>(() => {
  const nodes = new Map<string, PathNode>()
  
  doors.value.forEach(door => {
    const room = rooms.value.find(r => r.id === door.roomId)
    if (!room) return
    
    let doorX = room.x
    let doorY = room.y
    
    switch (door.position) {
      case 'top':
        doorX = room.x + door.offset
        doorY = room.y
        break
      case 'bottom':
        doorX = room.x + door.offset
        doorY = room.y + room.height
        break
      case 'left':
        doorX = room.x
        doorY = room.y + door.offset
        break
      case 'right':
        doorX = room.x + room.width
        doorY = room.y + door.offset
        break
    }
    
    const key = `door-${door.id}`
    nodes.set(key, { x: doorX, y: doorY, neighbors: [] })
    
    const roomCenterKey = `room-center-${room.id}`
    const existingRoomCenter = nodes.get(roomCenterKey)
    if (!existingRoomCenter) {
      nodes.set(roomCenterKey, { 
        x: room.x + room.width / 2, 
        y: room.y + room.height / 2, 
        neighbors: [key] 
      })
    } else {
      if (!existingRoomCenter.neighbors.includes(key)) existingRoomCenter.neighbors.push(key)
    }
    
    const doorNode = nodes.get(key)
    if (doorNode && !doorNode.neighbors.includes(roomCenterKey)) {
      doorNode.neighbors.push(roomCenterKey)
    }
  })
  
  return nodes
})

function findPath(startX: number, startY: number, endX: number, endY: number, targetRoomId: string): { x: number; y: number }[] {
  const path: { x: number; y: number }[] = []
  
  const startRoom = getRoomAt(startX, startY)
  const endRoom = rooms.value.find(r => r.id === targetRoomId)
  
  if (!endRoom) return [{ x: endX, y: endY }]
  
  if (startRoom?.id === targetRoomId) {
    return [{ x: endX, y: endY }]
  }
  
  path.push({ x: startX, y: startY })
  
  const roomDoors = doors.value.filter(d => d.roomId === targetRoomId)
  if (roomDoors.length > 0 && endRoom) {
    let nearestDoor = roomDoors[0]
    let minDist = Infinity
    
    roomDoors.forEach(door => {
      let doorX = endRoom.x
      let doorY = endRoom.y
      
      switch (door.position) {
        case 'top':
          doorX = endRoom.x + door.offset
          doorY = endRoom.y
          break
        case 'bottom':
          doorX = endRoom.x + door.offset
          doorY = endRoom.y + endRoom.height
          break
        case 'left':
          doorX = endRoom.x
          doorY = endRoom.y + door.offset
          break
        case 'right':
          doorX = endRoom.x + endRoom.width
          doorY = endRoom.y + door.offset
          break
      }
      
      const dist = Math.sqrt((doorX - startX) ** 2 + (doorY - startY) ** 2)
      if (dist < minDist) {
        minDist = dist
        nearestDoor = door
      }
    })
    
    let doorX = endRoom.x
    let doorY = endRoom.y
    
    if (nearestDoor) {
      switch (nearestDoor.position) {
        case 'top':
          doorX = endRoom.x + nearestDoor.offset
          doorY = endRoom.y - 10
          break
        case 'bottom':
          doorX = endRoom.x + nearestDoor.offset
          doorY = endRoom.y + endRoom.height + 10
          break
        case 'left':
          doorX = endRoom.x - 10
          doorY = endRoom.y + nearestDoor.offset
          break
        case 'right':
          doorX = endRoom.x + endRoom.width + 10
          doorY = endRoom.y + nearestDoor.offset
          break
      }
    }
    
    path.push({ x: doorX, y: doorY })
  }
  
  path.push({ x: endX, y: endY })
  
  return path
}

function getRoomAt(x: number, y: number): Room | undefined {
  return rooms.value.find(room => 
    x >= room.x && x <= room.x + room.width &&
    y >= room.y && y <= room.y + room.height
  )
}

function isPointInWalledRoom(x: number, y: number): { inRoom: boolean; room: Room | null } {
  for (const room of rooms.value) {
    if (room.hasWalls) {
      if (x >= room.x && x <= room.x + room.width &&
          y >= room.y && y <= room.y + room.height) {
        return { inRoom: true, room }
      }
    }
  }
  return { inRoom: false, room: null }
}

function isPointBlocked(x: number, y: number): boolean {
  for (const room of rooms.value) {
    if (!room.hasWalls) continue
    
    const margin = 5
    if (x >= room.x - margin && x <= room.x + room.width + margin &&
        y >= room.y - margin && y <= room.y + room.height + margin) {
      
      const inRoom = x >= room.x && x <= room.x + room.width &&
                     y >= room.y && y <= room.y + room.height
      
      if (!inRoom) continue
      
      const nearTop = y < room.y + 15
      const nearBottom = y > room.y + room.height - 15
      const nearLeft = x < room.x + 15
      const nearRight = x > room.x + room.width - 15
      
      if (nearTop || nearBottom || nearLeft || nearRight) {
        let doorFound = false
        for (const door of room.doors) {
          const doorStart = door.offset - (door.width || DOOR_WIDTH) / 2
          const doorEnd = door.offset + (door.width || DOOR_WIDTH) / 2
          
          if (door.position === 'top' && nearTop) {
            if (x >= room.x + doorStart && x <= room.x + doorEnd) {
              doorFound = true
              break
            }
          } else if (door.position === 'bottom' && nearBottom) {
            if (x >= room.x + doorStart && x <= room.x + doorEnd) {
              doorFound = true
              break
            }
          } else if (door.position === 'left' && nearLeft) {
            if (y >= room.y + doorStart && y <= room.y + doorEnd) {
              doorFound = true
              break
            }
          } else if (door.position === 'right' && nearRight) {
            if (y >= room.y + doorStart && y <= room.y + doorEnd) {
              doorFound = true
              break
            }
          }
        }
        
        if (!doorFound) {
          return true
        }
      }
    }
  }
  return false
}

function findPathAStar(startX: number, startY: number, endX: number, endY: number): { x: number; y: number }[] {
  const gridSize = 15
  const maxIterations = 1000
  
  const startGridX = Math.round(startX / gridSize) * gridSize
  const startGridY = Math.round(startY / gridSize) * gridSize
  const endGridX = Math.round(endX / gridSize) * gridSize
  const endGridY = Math.round(endY / gridSize) * gridSize
  
  interface Node {
    x: number
    y: number
    g: number
    h: number
    f: number
    parent: Node | null
  }
  
  const openMap = new Map<string, Node>()
  const closedSet = new Set<string>()
  
  const heuristic = (x: number, y: number) => {
    return Math.abs(x - endGridX) + Math.abs(y - endGridY)
  }
  
  const startNode: Node = {
    x: startGridX,
    y: startGridY,
    g: 0,
    h: heuristic(startGridX, startGridY),
    f: heuristic(startGridX, startGridY),
    parent: null
  }
  
  openMap.set(`${startGridX},${startGridY}`, startNode)
  
  const directions = [
    { dx: gridSize, dy: 0 },
    { dx: -gridSize, dy: 0 },
    { dx: 0, dy: gridSize },
    { dx: 0, dy: -gridSize },
    { dx: gridSize, dy: gridSize },
    { dx: -gridSize, dy: gridSize },
    { dx: gridSize, dy: -gridSize },
    { dx: -gridSize, dy: -gridSize },
  ]
  
  let iterations = 0
  
  while (openMap.size > 0 && iterations < maxIterations) {
    iterations++
    
    let current: Node | null = null
    let minF = Infinity
    for (const node of openMap.values()) {
      if (node.f < minF) {
        minF = node.f
        current = node
      }
    }
    if (!current) break
    
    const currentKey = `${current.x},${current.y}`
    openMap.delete(currentKey)
    
    if (Math.abs(current.x - endGridX) <= gridSize && Math.abs(current.y - endGridY) <= gridSize) {
      const path: { x: number; y: number }[] = []
      let node: Node | null = current
      while (node) {
        path.unshift({ x: node.x, y: node.y })
        node = node.parent
      }
      path.push({ x: endX, y: endY })
      return path
    }
    
    if (closedSet.has(currentKey)) continue
    closedSet.add(currentKey)
    
    for (const dir of directions) {
      const newX = current.x + dir.dx
      const newY = current.y + dir.dy
      
      if (newX < 30 || newX > sceneWidth.value - 30 || newY < 30 || newY > sceneHeight.value - 30) continue
      
      const newKey = `${newX},${newY}`
      if (closedSet.has(newKey)) continue
      
      if (isPointBlocked(newX, newY)) continue
      
      const isDiagonal = dir.dx !== 0 && dir.dy !== 0
      const moveCost = isDiagonal ? gridSize * 1.414 : gridSize
      const newG = current.g + moveCost
      const newH = heuristic(newX, newY)
      const newF = newG + newH
      
      const existingNode = openMap.get(newKey)
      if (existingNode && existingNode.g <= newG) continue
      
      const newNode: Node = {
        x: newX,
        y: newY,
        g: newG,
        h: newH,
        f: newF,
        parent: current
      }
      
      openMap.set(newKey, newNode)
    }
  }
  
  return [{ x: endX, y: endY }]
}

function moveCharacterToPosition(agentId: string, targetX: number, targetY: number) {
  const char = characters.value?.get(agentId)
  if (!char) return
  
  const path = findPathAStar(char.x, char.y, targetX, targetY)
  
  char.path = path
  char.targetX = targetX
  char.targetY = targetY
  char.status = 'walking'
  
  const targetRoom = getRoomAt(targetX, targetY)
  if (targetRoom) {
    char.currentRoom = targetRoom.id
  }
}

const characters = ref(new Map<string, Character>())

const agentColors = [
  { primary: '#3b82f6', secondary: '#1d4ed8', accent: '#60a5fa' },
  { primary: '#8b5cf6', secondary: '#6d28d9', accent: '#a78bfa' },
  { primary: '#06b6d4', secondary: '#0891b2', accent: '#22d3ee' },
  { primary: '#10b981', secondary: '#059669', accent: '#34d399' },
  { primary: '#f59e0b', secondary: '#d97706', accent: '#fbbf24' },
  { primary: '#ef4444', secondary: '#dc2626', accent: '#f87171' },
  { primary: '#ec4899', secondary: '#db2777', accent: '#f472b6' },
  { primary: '#6366f1', secondary: '#4f46e5', accent: '#818cf8' },
]

function getAgentColor(index: number) {
  return agentColors[index % agentColors.length]
}

function getDeskPositionForAgent(agentIndex: number, room: Room): { x: number; y: number } {
  const deskCount = room.deskCount || 4
  const cols = 4
  const rows = Math.ceil(deskCount / cols)
  
  const deskIndex = agentIndex % deskCount
  const col = deskIndex % cols
  const row = Math.floor(deskIndex / cols)
  
  const padding = { top: 25, right: 15, bottom: 15, left: 15 }
  const gapX = 20
  const gapY = 15
  
  const availableWidth = room.width - padding.left - padding.right
  const availableHeight = room.height - padding.top - padding.bottom
  
  const cellWidth = (availableWidth - (cols - 1) * gapX) / cols
  const cellHeight = (availableHeight - (rows - 1) * gapY) / rows
  
  const cellX = padding.left + col * (cellWidth + gapX)
  const cellY = padding.top + row * (cellHeight + gapY)
  
  return {
    x: room.x + cellX + cellWidth / 2,
    y: room.y + cellY + cellHeight / 2 + 8
  }
}

function initCharacters() {
  if (!officeStore.officeAgents || officeStore.officeAgents.length === 0) {
    return
  }
  
  if (isCharactersInitialized.value) return
  
  const map = new Map<string, Character>()
  const agents = officeStore.officeAgents
  
  const allRooms = rooms.value.filter(r => 
    r.type === 'office' || 
    r.type === 'open-desk' || 
    r.type === 'reception' || 
    r.type === 'lounge' ||
    r.type === 'pantry' ||
    r.type === 'meeting-small' ||
    r.type === 'meeting-large'
  )
  
  const deskRooms = rooms.value.filter(r => r.type === 'office' || r.type === 'open-desk')
  
  agents.forEach((agent, index) => {
    const isWorking = agent.status === 'working'
    let targetRoom: Room | undefined
    let deskPos: { x: number; y: number } | undefined
    
    if (isWorking) {
      let globalDeskIndex = index
      for (const room of deskRooms) {
        const deskCount = room.deskCount || 4
        if (globalDeskIndex < deskCount || room.type === 'open-desk') {
          targetRoom = room
          const localIndex = room.type === 'open-desk' ? globalDeskIndex : globalDeskIndex % deskCount
          deskPos = getDeskPositionForAgent(localIndex, room)
          break
        }
        globalDeskIndex -= deskCount
      }
    } else {
      const randomRoomIndex = Math.floor(Math.random() * allRooms.length)
      targetRoom = allRooms[randomRoomIndex]
    }
    
    if (!targetRoom) {
      targetRoom = allRooms[0] || rooms.value[0]
    }
    
    if (!targetRoom) return
    
    if (!deskPos) {
      deskPos = {
        x: targetRoom.x + targetRoom.width / 2,
        y: targetRoom.y + targetRoom.height / 2
      }
    }
    
    const randomOffset = isWorking ? { x: 0, y: 0 } : {
      x: (Math.random() - 0.5) * (targetRoom.width * 0.6),
      y: (Math.random() - 0.5) * (targetRoom.height * 0.6)
    }
    
    map.set(agent.id, {
      agentId: agent.id,
      x: isWorking ? deskPos.x : targetRoom.x + targetRoom.width / 2 + randomOffset.x,
      y: isWorking ? deskPos.y : targetRoom.y + targetRoom.height / 2 + randomOffset.y,
      targetX: deskPos.x,
      targetY: deskPos.y,
      currentRoom: targetRoom.id,
      status: isWorking ? 'working' : 'idle',
      talkingTo: null,
      direction: Math.random() > 0.5 ? 'right' : 'left',
      path: [],
      colorIndex: index % 6,
      isWandering: false,
      gender: Math.random() > 0.5 ? 'male' : 'female',
      hairStyle: Math.floor(Math.random() * 5),
      skinTone: Math.floor(Math.random() * 4),
    })
  })
  
  characters.value = map
  isCharactersInitialized.value = true
}

function moveCharacterToRoom(agentId: string, targetRoomId: string) {
  const char = characters.value?.get(agentId)
  if (!char) return
  
  const targetRoom = rooms.value.find(r => r.id === targetRoomId)
  if (!targetRoom) return
  
  const targetX = targetRoom.x + targetRoom.width / 2
  const targetY = targetRoom.y + targetRoom.height / 2
  
  char.path = findPath(char.x, char.y, targetX, targetY, targetRoomId)
  char.targetX = targetX
  char.targetY = targetY
  char.status = 'walking'
}

function moveCharacterToWork(agentId: string) {
  const char = characters.value?.get(agentId)
  if (!char) return
  
  const agentIndex = officeStore.officeAgents.findIndex(a => a.id === agentId)
  if (agentIndex === -1) return
  
  const deskRooms = rooms.value.filter(r => r.type === 'office' || r.type === 'open-desk')
  let globalDeskIndex = 0
  let targetRoom: Room | undefined
  let deskPos: { x: number; y: number } | undefined
  
  for (const room of deskRooms) {
    const deskCount = room.deskCount || 4
    if (globalDeskIndex + agentIndex < deskCount || room.type === 'open-desk') {
      targetRoom = room
      deskPos = getDeskPositionForAgent(agentIndex, room)
      break
    }
  }
  
  if (!targetRoom || !deskPos) return
  
  const path = findPathAStar(char.x, char.y, deskPos.x, deskPos.y)
  
  char.path = path
  char.targetX = deskPos.x
  char.targetY = deskPos.y
  char.status = 'walking'
  char.currentRoom = targetRoom.id
}

function handleWheel(event: WheelEvent) {
  event.preventDefault()
  const delta = event.deltaY * -0.001
  const newScale = Math.max(minScale.value, Math.min(maxScale.value, scale.value + delta))
  scale.value = newScale
}

function handleMouseDown(event: MouseEvent) {
  if (!sceneRef.value) return
  isDragging.value = true
  dragStart.value = {
    x: event.clientX - offset.value.x,
    y: event.clientY - offset.value.y,
  }
  document.addEventListener('mousemove', handleMouseMove)
  document.addEventListener('mouseup', handleMouseUp)
}

function handleMouseMove(event: MouseEvent) {
  if (!isDragging.value) return
  offset.value = {
    x: event.clientX - dragStart.value.x,
    y: event.clientY - dragStart.value.y,
  }
}

function handleMouseUp() {
  isDragging.value = false
  document.removeEventListener('mousemove', handleMouseMove)
  document.removeEventListener('mouseup', handleMouseUp)
}

function handleSceneClick(event: MouseEvent) {
  if (!containerRef.value) return
  
  const target = event.target as HTMLElement
  if (target.closest('.character')) return
  
  if (showChatPanel.value) {
    showChatPanel.value = false
    chatPanelSessionKey.value = null
    officeStore.selectSession(null as any)
    selectedCharacterId.value = null
    return
  }
  
  if (showSessionList.value) {
    showSessionList.value = false
    isDeleteMode.value = false
    selectedSessionKeys.value.clear()
    return
  }
  
  const rect = containerRef.value.getBoundingClientRect()
  const x = (event.clientX - rect.left - offset.value.x) / scale.value
  const y = (event.clientY - rect.top - offset.value.y) / scale.value
  
  if (selectedCharacterId.value) {
    moveCharacterToPosition(selectedCharacterId.value, x, y)
  } else {
    selectedCharacterId.value = null
  }
}

function handleOpenCreateModal() {
  createForm.value = {
    agentId: selectedCharacterId.value || 'main',
    channel: 'main',
    peer: '',
    label: '',
  }
  showCreateModal.value = true
}

async function handleCreateSession() {
  creating.value = true
  try {
    await sessionStore.createSession({
      agentId: createForm.value.agentId || 'main',
      channel: createForm.value.channel || 'main',
      peer: createForm.value.peer || undefined,
      label: createForm.value.label || undefined,
    })
    await new Promise(resolve => setTimeout(resolve, 500))
    await sessionStore.fetchSessions()
    message.success(t('pages.sessions.list.createSuccess'))
    showCreateModal.value = false
  } catch (e: any) {
    message.error(e?.message || t('pages.sessions.list.createFailed'))
  } finally {
    creating.value = false
  }
}

function handleOpenCreateAgentModal() {
  createAgentForm.value = {
    id: '',
    name: '',
    workspace: '',
  }
  showCreateAgentModal.value = true
}

async function handleCreateAgent() {
  if (!createAgentForm.value.id.trim()) {
    message.error(t('myworld.employeeIdRequired'))
    return
  }

  creatingAgent.value = true
  try {
    await agentStore.addAgent({
      id: createAgentForm.value.id.trim(),
      name: createAgentForm.value.name.trim() || createAgentForm.value.id.trim(),
      workspace: createAgentForm.value.workspace.trim() || undefined,
    })
    await new Promise(resolve => setTimeout(resolve, 500))
    await agentStore.fetchAgents()
    await officeStore.loadOfficeData()
    message.success(t('myworld.employeeCreated'))
    showCreateAgentModal.value = false
    
    if (!isCharactersInitialized.value) {
      initCharacters()
    }
  } catch (e: any) {
    message.error(e?.message || t('myworld.employeeCreateFailed'))
  } finally {
    creatingAgent.value = false
  }
}

function handleOpenToolsModal() {
  const agentList = agentStore.agents
  if (agentList.length === 0) {
    message.warning(t('myworld.noConfigurableEmployees'))
    return
  }
  
  const firstAgent = agentList[0]
  if (!firstAgent) return
  
  selectedAgentForTools.value = firstAgent
  toolsForm.value = {
    allow: firstAgent.tools?.allow || [],
    deny: firstAgent.tools?.deny || [],
  }
  showToolsModal.value = true
}

function selectAgentForTools(agentId: string) {
  const agent = agentStore.agents.find(a => a.id === agentId)
  if (!agent) return
  
  selectedAgentForTools.value = agent
  toolsForm.value = {
    allow: agent.tools?.allow || [],
    deny: agent.tools?.deny || [],
  }
}

function addToolToAllow(tool: string) {
  if (!toolsForm.value.allow.includes(tool)) {
    toolsForm.value.allow.push(tool)
  }
  const denyIndex = toolsForm.value.deny.indexOf(tool)
  if (denyIndex > -1) {
    toolsForm.value.deny.splice(denyIndex, 1)
  }
}

function removeToolFromAllow(tool: string) {
  const index = toolsForm.value.allow.indexOf(tool)
  if (index > -1) {
    toolsForm.value.allow.splice(index, 1)
  }
}

function addToolToDeny(tool: string) {
  if (!toolsForm.value.deny.includes(tool)) {
    toolsForm.value.deny.push(tool)
  }
  const allowIndex = toolsForm.value.allow.indexOf(tool)
  if (allowIndex > -1) {
    toolsForm.value.allow.splice(allowIndex, 1)
  }
}

function removeToolFromDeny(tool: string) {
  const index = toolsForm.value.deny.indexOf(tool)
  if (index > -1) {
    toolsForm.value.deny.splice(index, 1)
  }
}

async function handleSetTools() {
  if (!selectedAgentForTools.value) return
  
  savingTools.value = true
  try {
    await agentStore.setAgentTools({
      agentId: selectedAgentForTools.value.id,
      allow: toolsForm.value.allow.length > 0 ? toolsForm.value.allow : undefined,
      deny: toolsForm.value.deny.length > 0 ? toolsForm.value.deny : undefined,
    })
    message.success(t('myworld.permissionSaved'))
    showToolsModal.value = false
  } catch (e: any) {
    message.error(e?.message || t('myworld.permissionSaveFailed'))
  } finally {
    savingTools.value = false
  }
}

async function handleRefresh() {
  isCharactersInitialized.value = false
  characters.value = new Map()
  
  await Promise.all([
    officeStore.loadOfficeData(),
    sessionStore.fetchSessions(),
    agentStore.fetchAgents(),
  ])
  
  initCharacters()
  updatePositions()
  centerScene()
  message.success(t('common.refreshSuccess'))
}

function toggleDeleteMode() {
  isDeleteMode.value = !isDeleteMode.value
  if (!isDeleteMode.value) {
    selectedSessionKeys.value.clear()
  }
}

function toggleSessionSelection(sessionKey: string) {
  if (selectedSessionKeys.value.has(sessionKey)) {
    selectedSessionKeys.value.delete(sessionKey)
  } else {
    selectedSessionKeys.value.add(sessionKey)
  }
}

async function handleDeleteSelectedSessions() {
  if (selectedSessionKeys.value.size === 0) return
  
  try {
    for (const key of selectedSessionKeys.value) {
      await sessionStore.deleteSession(key)
    }
    await new Promise(resolve => setTimeout(resolve, 500))
    await sessionStore.fetchSessions()
    message.success(t('pages.sessions.list.deleteSuccess'))
    selectedSessionKeys.value.clear()
    isDeleteMode.value = false
  } catch (e: any) {
    message.error(e?.message || t('pages.sessions.list.deleteFailed'))
  }
}

async function handleDeleteSession(sessionKey: string) {
  try {
    await sessionStore.deleteSession(sessionKey)
    await new Promise(resolve => setTimeout(resolve, 500))
    await sessionStore.fetchSessions()
    message.success(t('pages.sessions.list.deleteSuccess'))
  } catch (e: any) {
    message.error(e?.message || t('pages.sessions.list.deleteFailed'))
  }
}

function handleCharacterClick(agentId: string, event: MouseEvent) {
  event.stopPropagation()
  
  if (selectedCharacterId.value === agentId) {
    selectedCharacterId.value = null
  } else {
    selectedCharacterId.value = agentId
    showChatPanel.value = false
    showSessionList.value = false
    officeStore.selectAgent(agentId)
  }
}

function handleCharacterDoubleClick(agentId: string, event: MouseEvent) {
  event.stopPropagation()
  
  selectedCharacterId.value = agentId
  
  const agent = officeStore.officeAgents.find(a => a.id === agentId)
  if (!agent) return
  
  officeStore.selectAgent(agentId)
  showSessionList.value = true
}

async function handleSessionClick(sessionKey: string) {
  officeStore.selectSession(sessionKey)
  chatStore.setSessionKey(sessionKey)
  await chatStore.fetchHistory(sessionKey)
  
  showSessionList.value = false
  showChatPanel.value = true
  
  if (selectedCharacterId.value) {
    moveCharacterToWork(selectedCharacterId.value)
  }
}

const selectedAgentSessions = computed(() => {
  if (!selectedCharacterId.value) return []
  return sessionStore.sessions
    .filter(s => s.agentId === selectedCharacterId.value)
    .sort((a, b) => new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime())
})

function getActiveSessionForAgent(agentId: string) {
  const sessions = sessionStore.sessions
    .filter(s => s.agentId === agentId)
    .sort((a, b) => {
      const aTime = new Date(a.lastActivity).getTime()
      const bTime = new Date(b.lastActivity).getTime()
      return bTime - aTime
    })
  
  if (sessions.length === 0) return null
  
  const latestSession = sessions[0]
  if (!latestSession) return null
  
  const lastActivity = new Date(latestSession.lastActivity)
  const now = new Date()
  const diffMinutes = (now.getTime() - lastActivity.getTime()) / (1000 * 60)
  
  if (diffMinutes < 30) {
    const sessionName = latestSession.label || 
                        latestSession.key.split(':').pop() || 
                        'Session'
    return {
      name: sessionName,
      status: diffMinutes < 5 ? 'active' : 'recent'
    }
  }
  
  return null
}

const selectedCharacterPosition = computed(() => {
  if (!selectedCharacterId.value || !characters.value || !containerRef.value) return null
  const char = characters.value.get(selectedCharacterId.value)
  if (!char) return null
  
  const containerRect = containerRef.value.getBoundingClientRect()
  const screenX = char.x * scale.value + offset.value.x
  const screenY = char.y * scale.value + offset.value.y
  
  const popupWidth = 280
  const popupHeight = 300
  
  const characterHeight = 50 * scale.value
  const headOffset = -characterHeight * 0.35
  
  const gap = 20 * scale.value
  
  let x = screenX + gap
  let y = screenY + headOffset - popupHeight / 2
  
  if (x + popupWidth > containerRect.width - 20) {
    x = screenX - popupWidth - gap
  }
  
  y = Math.max(80, Math.min(y, containerRect.height - popupHeight - 20))
  
  const viewportX = containerRect.left + x
  const viewportY = containerRect.top + y
  
  return { x: viewportX, y: viewportY }
})

function handleZoomIn() {
  scale.value = Math.min(maxScale.value, scale.value + 0.2)
}

function handleZoomOut() {
  scale.value = Math.max(minScale.value, scale.value - 0.2)
}

function centerScene() {
  if (!containerRef.value) return
  const containerRect = containerRef.value.getBoundingClientRect()
  
  const scaleX = (containerRect.width - 40) / sceneWidth.value
  const scaleY = (containerRect.height - 40) / sceneHeight.value
  const fitScale = Math.min(scaleX, scaleY)
  
  scale.value = fitScale
  
  const centerX = (containerRect.width - sceneWidth.value * fitScale) / 2
  const centerY = (containerRect.height - sceneHeight.value * fitScale) / 2
  offset.value = { x: centerX, y: centerY }
}

function handleResetView() {
  centerScene()
}

function handleCloseChatPanel() {
  showChatPanel.value = false
}

let animationFrame: number | null = null
let lastWanderCheck = 0
const WANDER_CHECK_INTERVAL = 5000
const WANDER_CHANCE = 0.2
const MAX_WANDERING_AGENTS = 3

function getRandomWalkablePosition(): { x: number; y: number } {
  const margin = 50
  const maxAttempts = 20
  
  for (let i = 0; i < maxAttempts; i++) {
    const x = margin + Math.random() * (sceneWidth.value - margin * 2)
    const y = margin + Math.random() * (sceneHeight.value - margin * 2)
    
    if (!isPointBlocked(x, y)) {
      return { x, y }
    }
  }
  
  return { x: sceneWidth.value / 2, y: sceneHeight.value / 2 }
}

function startWandering(agentId: string) {
  const char = characters.value?.get(agentId)
  if (!char || char.status !== 'idle') return
  
  let wanderingCount = 0
  characters.value?.forEach(c => {
    if (c.isWandering) wanderingCount++
  })
  if (wanderingCount >= MAX_WANDERING_AGENTS) return
  
  const target = getRandomWalkablePosition()
  const path = findPathAStar(char.x, char.y, target.x, target.y)
  
  if (path.length > 1) {
    char.path = path
    char.targetX = target.x
    char.targetY = target.y
    char.status = 'walking'
    char.isWandering = true
  }
}

function updatePositions() {
  if (!characters.value) return
  
  const now = Date.now()
  
  characters.value.forEach((char) => {
    if (char.agentId === hoveredAgentId.value) {
      return
    }
    
    if (char.status === 'walking') {
      if (char.path.length > 0) {
        const nextPoint = char.path[0]
        if (!nextPoint) return
        
        const dx = nextPoint.x - char.x
        const dy = nextPoint.y - char.y
        const dist = Math.sqrt(dx * dx + dy * dy)
        
        const speed = char.isWandering ? 1.5 : 8.0
        const arrivalThreshold = Math.max(speed, 5)
        
        if (dist <= arrivalThreshold) {
          char.x = nextPoint.x
          char.y = nextPoint.y
          char.path.shift()
          
          if (char.path.length === 0) {
            const room = getRoomAt(char.x, char.y)
            if (room) {
              char.currentRoom = room.id
            }
            char.isWandering = false
            const agentStatus = chatStore.getOrCreateAgentStatus(char.agentId)
            const isActivePhase = agentStatus.phase !== 'idle' && agentStatus.phase !== 'done' && agentStatus.phase !== 'error' && agentStatus.phase !== 'aborted'
            char.status = isActivePhase ? 'working' : 'idle'
          }
        } else {
          char.x += (dx / dist) * speed
          char.y += (dy / dist) * speed
          char.direction = dx > 0 ? 'right' : 'left'
        }
      } else {
        char.isWandering = false
        const agentStatus = chatStore.getOrCreateAgentStatus(char.agentId)
        const isActivePhase = agentStatus.phase !== 'idle' && agentStatus.phase !== 'done' && agentStatus.phase !== 'error' && agentStatus.phase !== 'aborted'
        char.status = isActivePhase ? 'working' : 'idle'
      }
    } else if (char.status === 'idle') {
      if (now - lastWanderCheck > WANDER_CHECK_INTERVAL) {
        if (Math.random() < WANDER_CHANCE) {
          startWandering(char.agentId)
        }
      }
    }
  })
  
  if (now - lastWanderCheck > WANDER_CHECK_INTERVAL) {
    lastWanderCheck = now
  }
  
  animationFrame = requestAnimationFrame(updatePositions)
}

const agents = computed(() => officeStore.officeAgents)
const activeCount = computed(() => agents.value.filter(a => a.status === 'working').length)
const totalTokens = computed(() => agents.value.reduce((sum, a) => sum + a.totalTokens, 0))

const currentTime = ref(Date.now())

const agentActiveSession = computed(() => {
  const result = new Map<string, { 
    sessionName: string
    status: 'active' | 'recent' | 'idle'
    lastMessage: string | null
    phase: string
  }>()
  
  const currentSessionKey = officeStore.selectedSessionKey
  const allSessions = sessionStore.sessions
  const now = currentTime.value
  
  const sessionsByAgent = new Map<string, typeof allSessions>()
  for (const session of allSessions) {
    const existing = sessionsByAgent.get(session.agentId) || []
    existing.push(session)
    sessionsByAgent.set(session.agentId, existing)
  }
  
  for (const agent of agents.value) {
    const agentStatus = chatStore.getOrCreateAgentStatus(agent.id)
    const isActivePhase = agentStatus.phase !== 'idle' && agentStatus.phase !== 'done' && agentStatus.phase !== 'error' && agentStatus.phase !== 'aborted'
    
    const agentSessions = sessionsByAgent.get(agent.id)
    
    let sessionName = 'Session'
    let lastMessage: string | null = agentStatus.lastMessage
    
    if (agentStatus.sessionKey) {
      sessionName = agentStatus.sessionKey.split(':').pop() || 'Session'
    }
    
    const matchingSession = agentSessions?.find(s => s.key === agentStatus.sessionKey)
    if (matchingSession?.label) {
      sessionName = matchingSession.label
    }
    
    if (currentSessionKey && agentSessions?.some(s => s.key === currentSessionKey)) {
      const currentSession = agentSessions.find(s => s.key === currentSessionKey)
      if (currentSession?.label) {
        sessionName = currentSession.label
      } else if (currentSession?.key) {
        sessionName = currentSession.key.split(':').pop() || 'Session'
      }
      const currentMsg = chatStore.messages.length > 0 
        ? chatStore.messages[chatStore.messages.length - 1]?.content?.slice(0, 30) || null
        : null
      if (currentMsg) {
        lastMessage = currentMsg
      }
    }
    
    if (isActivePhase) {
      result.set(agent.id, {
        sessionName,
        status: 'active',
        lastMessage,
        phase: agentStatus.phase
      })
    } else if (agentStatus.finishedAtMs) {
      const diffMinutes = (now - agentStatus.finishedAtMs) / (1000 * 60)
      if (diffMinutes < 1) {
        result.set(agent.id, {
          sessionName,
          status: 'recent',
          lastMessage,
          phase: agentStatus.phase
        })
      }
    }
  }
  
  return result
})

function getSessionInfoForAgent(agentId: string) {
  return agentActiveSession.value.get(agentId) || null
}

function getFullMessageForAgent(agentId: string): string | null {
  const agentStatus = chatStore.getOrCreateAgentStatus(agentId)
  return agentStatus.lastMessage || null
}

function copyMessageToClipboard(text: string) {
  if (!text) {
    message.warning(t('myworld.noContentToCopy'))
    return
  }
  
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => {
      message.success(t('myworld.copiedToClipboard'))
    }).catch((err) => {
      console.error('复制失败:', err)
      fallbackCopy(text)
    })
  } else {
    fallbackCopy(text)
  }
}

function fallbackCopy(text: string) {
  const textArea = document.createElement('textarea')
  textArea.value = text
  textArea.style.position = 'fixed'
  textArea.style.left = '-9999px'
  document.body.appendChild(textArea)
  textArea.select()
  try {
    document.execCommand('copy')
    message.success(t('myworld.copiedToClipboard'))
  } catch (err) {
    console.error('复制失败:', err)
    message.error(t('myworld.copyFailed'))
  }
  document.body.removeChild(textArea)
}

function handleCharacterMouseEnter(agentId: string, event: MouseEvent) {
  hoveredAgentId.value = agentId
  const agentStatus = chatStore.getOrCreateAgentStatus(agentId)
  hoveredMessage.value = agentStatus.lastMessage || null
  
  const target = event.currentTarget as HTMLElement
  const rect = target.getBoundingClientRect()
  tooltipPosition.value = {
    x: rect.left + rect.width / 2,
    y: rect.top - 4
  }
}

function handleCharacterMouseLeave() {
  setTimeout(() => {
    if (!isTooltipHovered.value) {
      hoveredAgentId.value = null
      hoveredMessage.value = null
    }
  }, 50)
}

function handleTooltipMouseEnter() {
  isTooltipHovered.value = true
}

function handleTooltipMouseLeave() {
  isTooltipHovered.value = false
  hoveredAgentId.value = null
  hoveredMessage.value = null
}

watch(() => officeStore.officeAgents, (newAgents, oldAgents) => {
  if (!characters.value) return
  
  newAgents.forEach((agent) => {
    const char = characters.value.get(agent.id)
    const oldAgent = oldAgents?.find(a => a.id === agent.id)
    
    if (!char) return
    
    if (agent.status === 'working' && oldAgent?.status !== 'working') {
      moveCharacterToWork(agent.id)
    }
    
    if (agent.status === 'idle' && oldAgent?.status === 'working') {
      if (char.status !== 'walking') char.status = 'idle'
    }
  })
}, { deep: true })

// 监听所有智能体的状态变化
watch(() => chatStore.agentStatuses, (newStatuses) => {
  if (!characters.value) return
  
  newStatuses.forEach((status, agentId) => {
    const char = characters.value?.get(agentId)
    if (!char) return
    
    const isActivePhase = status.phase !== 'idle' && status.phase !== 'done' && status.phase !== 'error' && status.phase !== 'aborted'
    
    if (isActivePhase) {
      if (char.status !== 'working' && char.status !== 'walking') {
        moveCharacterToWork(agentId)
      }
    } else {
      if (char.status !== 'walking') char.status = 'idle'
    }
  })
}, { deep: true })

watch(() => chatStore.messages, (newMessages, oldMessages) => {
  // 处理所有智能体的消息事件
  const latestMessage = newMessages[newMessages.length - 1]
  if (!latestMessage) return
  
  // 从消息中提取智能体 ID（如果是助手消息）
  if (latestMessage.role === 'assistant' && latestMessage.name) {
    const agentId = latestMessage.name
    const char = characters.value?.get(agentId)
    if (char && char.status !== 'walking') {
      char.status = 'working'
    }
  }
}, { deep: true })

function handleCodeCopy(event: Event) {
  const target = event.target as HTMLElement
  const button = target.closest('.code-copy-btn') as HTMLButtonElement
  if (!button) return

  const code = button.dataset.code || ''
  navigator.clipboard.writeText(code).then(() => {
    button.classList.add('copied')
    button.title = 'Copied!'
    setTimeout(() => {
      button.classList.remove('copied')
      button.title = 'Copy code'
    }, 2000)
  }).catch((err) => {
    console.error('Failed to copy:', err)
  })
}

onMounted(async () => {
  await officeStore.loadOfficeData()
  await sessionStore.fetchSessions()
  
  initCharacters()
  updatePositions()
  document.addEventListener('click', handleCodeCopy)
  
  setTimeout(() => {
    centerScene()
    isInitialized.value = true
  }, 100)
  
  eventCleanups.push(
    wsStore.subscribe('event', (evt: unknown) => {
      const data = evt as { event?: string; payload?: unknown }
      const eventName = data.event || ''
      if (eventName === 'chat' || eventName.startsWith('chat.') || eventName === 'agent' || eventName.startsWith('agent.')) {
        chatStore.handleAgentStatusEvent(eventName, data.payload)
      }
    })
  )
  
  const timeInterval = setInterval(() => {
    currentTime.value = Date.now()
  }, 1000)
  eventCleanups.push(() => clearInterval(timeInterval))
})

watch(() => officeStore.officeAgents, (newAgents) => {
  if (newAgents && newAgents.length > 0 && !isCharactersInitialized.value) {
    initCharacters()
  }
}, { immediate: false })

onUnmounted(() => {
  if (animationFrame) cancelAnimationFrame(animationFrame)
  eventCleanups.forEach(cleanup => cleanup())
  eventCleanups.length = 0
  document.removeEventListener('click', handleCodeCopy)
})
</script>

<template>
  <div class="my-world">
    <OfficeToolbar
      :active-count="activeCount"
      :total-agents="agents.length"
      :total-tokens="totalTokens"
      @create-agent="handleOpenCreateAgentModal"
      @permission-control="handleOpenToolsModal"
      @refresh="handleRefresh"
    />
    
    <div class="world-controls">
      <button class="control-btn" @click="handleZoomIn" :title="t('myworld.zoomIn')">
        <AddOutline :size="18" />
      </button>
      <span class="zoom-level">{{ Math.round(scale * 100) }}%</span>
      <button class="control-btn" @click="handleZoomOut" :title="t('myworld.zoomOut')">
        <RemoveOutline :size="18" />
      </button>
      <button class="control-btn reset-btn" @click="handleResetView" :title="t('myworld.resetView')">
        <ExpandOutline :size="18" />
      </button>
    </div>
    
    <div 
      ref="containerRef" 
      class="world-container"
      @wheel="handleWheel"
      @mousedown="handleMouseDown"
      @click="handleSceneClick"
    >
      <div 
        ref="sceneRef"
        class="world-scene"
        :style="{
          width: `${sceneWidth}px`,
          height: `${sceneHeight}px`,
          transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
        }"
      >
        <div class="office-floor">
          <div class="floor-tiles"></div>
        </div>
        
        <div class="rooms-layer">
          <div
            v-for="room in rooms"
            :key="room.id"
            class="room"
            :class="[`room-${room.type}`, { 'has-walls': room.hasWalls }]"
            :style="{
              left: `${room.x}px`,
              top: `${room.y}px`,
              width: `${room.width}px`,
              height: `${room.height}px`,
            }"
          >
            <div class="room-floor"></div>
            <div v-if="room.name" class="room-label">
              <span class="label-text">{{ room.name }}</span>
            </div>
            
            <div v-if="room.type === 'office' || room.type === 'open-desk'" class="room-desks">
              <div 
                v-for="i in (room.deskCount || 4)" 
                :key="i" 
                class="desk-unit"
              >
                <div class="desk"></div>
                <div class="chair"></div>
                <div class="monitor"></div>
              </div>
            </div>
            
            <div v-else-if="room.type === 'meeting-small'" class="meeting-furniture small">
              <div class="meeting-table"></div>
              <div class="meeting-chairs">
                <div v-for="i in 4" :key="i" class="meeting-chair"></div>
              </div>
            </div>
            
            <div v-else-if="room.type === 'meeting-large'" class="meeting-furniture large">
              <div class="meeting-table"></div>
              <div class="meeting-chairs">
                <div v-for="i in 8" :key="i" class="meeting-chair"></div>
              </div>
              <div class="whiteboard"></div>
            </div>
            
            <div v-else-if="room.type === 'manager'" class="manager-furniture">
              <div class="executive-desk"></div>
              <div class="executive-chair"></div>
              <div class="cabinet"></div>
            </div>
            
            <div v-else-if="room.type === 'reception'" class="reception-furniture">
              <div class="reception-main-counter"></div>
              <div class="reception-side-counter"></div>
              <div class="waiting-sofa-set">
                <div class="waiting-sofa"></div>
                <div class="waiting-sofa"></div>
                <div class="waiting-coffee-table"></div>
              </div>
              <div class="reception-plants">
                <div class="big-plant"></div>
                <div class="big-plant"></div>
              </div>
              <div class="reception-pillars">
                <div class="pillar"></div>
                <div class="pillar"></div>
                <div class="pillar"></div>
                <div class="pillar"></div>
              </div>
            </div>
            
            <div v-else-if="room.type === 'pantry'" class="pantry-furniture">
              <div class="counter"></div>
              <div class="coffee-machine"></div>
              <div class="water-dispenser"></div>
              <div class="fridge"></div>
              <div class="snack-shelf"></div>
            </div>
            
            <div v-else-if="room.type === 'lounge'" class="lounge-furniture">
              <div class="sofa-set">
                <div class="sofa"></div>
                <div class="sofa"></div>
                <div class="coffee-table"></div>
              </div>
              <div class="tv-screen"></div>
              <div class="plants">
                <div class="plant"></div>
                <div class="plant"></div>
              </div>
            </div>
            
            <div v-else-if="room.type === 'restroom'" class="restroom-furniture">
              <div class="sink-area">
                <div class="sink"></div>
                <div class="sink"></div>
              </div>
              <div class="stalls">
                <div class="stall"></div>
                <div class="stall"></div>
                <div class="stall"></div>
              </div>
            </div>
            
            <div v-else-if="room.type === 'storage'" class="storage-furniture">
              <div class="shelf" v-for="i in 3" :key="i"></div>
            </div>
            
            <template v-if="room.hasWalls && room.doors.length > 0">
              <div 
                v-for="(door, index) in room.doors"
                :key="index"
                class="door"
                :class="[`door-${door.position}`]"
                :style="{
                  '--door-offset': `${door.offset}px`,
                  '--door-width': `${door.width || DOOR_WIDTH}px`,
                }"
              >
                <div class="door-frame">
                  <div class="door-panel"></div>
                </div>
              </div>
            </template>
            
            <div v-if="room.hasWalls" class="room-walls">
              <div class="wall wall-top"></div>
              <div class="wall wall-bottom"></div>
              <div class="wall wall-left"></div>
              <div class="wall wall-right"></div>
            </div>
          </div>
        </div>
        
        <div class="outer-walls">
          <div class="outer-wall outer-wall-top"></div>
          <div class="outer-wall outer-wall-bottom"></div>
          <div class="outer-wall outer-wall-left"></div>
          <div class="outer-wall outer-wall-right"></div>
        </div>
        
        <div class="company-logo">
          <span class="logo-icon">🦞</span>
        </div>
        
        <div class="characters-layer">
          <template v-if="characters.size > 0">
            <div
              v-for="[agentId, char] in characters"
              :key="agentId"
              class="character"
              :class="[
                `status-${char.status}`,
                `dir-${char.direction}`,
                `gender-${char.gender}`,
                `hair-${char.hairStyle}`,
                `skin-${char.skinTone}`,
                { selected: selectedCharacterId === agentId }
              ]"
              :style="{
              left: `${char.x}px`,
              top: `${char.y}px`,
              '--primary': agentColors[char.colorIndex]?.primary || '#3b82f6',
              '--secondary': agentColors[char.colorIndex]?.secondary || '#1d4ed8',
              '--accent': agentColors[char.colorIndex]?.accent || '#60a5fa',
            }"
            @click="handleCharacterClick(agentId, $event)"
            @dblclick="handleCharacterDoubleClick(agentId, $event)"
            @mouseenter="handleCharacterMouseEnter(agentId, $event)"
            @mouseleave="handleCharacterMouseLeave"
            @wheel.stop
          >
            <div class="character-shadow"></div>
            
            <div v-if="getSessionInfoForAgent(agentId)" class="session-bubble" :class="getSessionInfoForAgent(agentId)?.status">
              <div class="bubble-header">
                <span class="session-name">{{ getSessionInfoForAgent(agentId)!.sessionName }}</span>
                <span class="session-status" :class="getSessionInfoForAgent(agentId)?.status">
                  {{ getSessionInfoForAgent(agentId)?.status === 'active' ? '●' : '○' }}
                </span>
              </div>
              <div v-if="getSessionInfoForAgent(agentId)?.lastMessage" class="bubble-message" :title="getSessionInfoForAgent(agentId)?.lastMessage || undefined">
                {{ getSessionInfoForAgent(agentId)!.lastMessage?.slice(0, 30) }}...
              </div>
              <div v-else-if="getSessionInfoForAgent(agentId)?.phase && getSessionInfoForAgent(agentId)?.phase !== 'idle'" class="bubble-phase">
                {{ getSessionInfoForAgent(agentId)!.phase }}
              </div>
            </div>
            
            <div class="character-body">
              <div class="character-head">
                <div class="hair"></div>
                <div class="face">
                  <div class="eyes">
                    <span class="eye"></span>
                    <span class="eye"></span>
                  </div>
                </div>
              </div>
              <div class="character-torso">
                <div class="arm arm-left"></div>
                <div class="arm arm-right"></div>
              </div>
              <div class="character-legs">
                <div class="leg leg-left"></div>
                <div class="leg leg-right"></div>
              </div>
            </div>
            <div class="character-info">
              <span class="character-name">{{ agents.find(a => a.id === agentId)?.name || agentId }}</span>
              <span class="character-status">{{ t(`myworld.characterStatus.${char.status}`) }}</span>
            </div>
            <div v-if="char.status === 'working'" class="working-indicator">
              <span class="dot"></span>
              <span class="dot"></span>
              <span class="dot"></span>
            </div>
            </div>
          </template>
        </div>
        
        <div class="entrance-marker">
          <div class="entrance-gate">
            <div class="gate-pillar left"></div>
            <div class="gate-door">🚪</div>
            <div class="gate-pillar right"></div>
          </div>
          <span class="entrance-text">{{ t('myworld.entrance') }}</span>
        </div>
      </div>
    </div>
    
    <Teleport to="body">
      <div 
        v-if="hoveredAgentId && hoveredMessage && (isTooltipHovered || hoveredAgentId)" 
        class="full-message-tooltip" 
        :style="{
          left: `${tooltipPosition.x}px`,
          top: `${tooltipPosition.y}px`,
        }"
        @wheel.stop 
        @mouseenter="handleTooltipMouseEnter" 
        @mouseleave="handleTooltipMouseLeave"
      >
        <div class="tooltip-content" v-html="renderSimpleMarkdown(hoveredMessage)" @wheel.stop></div>
        <button class="tooltip-copy-btn" @click.stop.prevent="copyMessageToClipboard(hoveredMessage || '')">
          <NIcon :component="CopyOutline" :size="14" />
        </button>
      </div>
    </Teleport>
    
    <Transition name="fade">
      <div 
        v-if="showSessionList && selectedCharacterPosition" 
        class="session-list-popup"
        :style="{
          left: `${selectedCharacterPosition.x}px`,
          top: `${selectedCharacterPosition.y}px`,
        }"
        @click.stop
      >
        <div class="popup-header">
          <span class="popup-title">{{ agents.find(a => a.id === selectedCharacterId)?.name }} - {{ t('myworld.skillsList') }}</span>
          <div class="popup-actions">
            <button v-if="!isDeleteMode" class="popup-add" @click="handleOpenCreateModal" :title="t('pages.sessions.list.createModal.title')">
              <AddOutline :size="16" />
            </button>
            <button v-if="!isDeleteMode && selectedAgentSessions.length > 0" class="popup-delete" @click="toggleDeleteMode" :title="t('common.delete')">
              <TrashOutline :size="16" />
            </button>
            <template v-if="isDeleteMode">
              <button class="popup-confirm" @click="handleDeleteSelectedSessions" :disabled="selectedSessionKeys.size === 0" :title="t('common.confirm')">
                <CheckmarkOutline :size="16" />
              </button>
              <button class="popup-cancel" @click="toggleDeleteMode" :title="t('common.cancel')">
                <CloseOutline :size="16" />
              </button>
            </template>
            <button class="popup-close" @click="showSessionList = false; isDeleteMode = false; selectedSessionKeys.clear()" :title="t('myworld.popup.close')">×</button>
          </div>
        </div>
        <div class="popup-content">
          <div v-if="selectedAgentSessions.length === 0" class="empty-sessions">
            <p>{{ t('myworld.popup.noSessions') }}</p>
          </div>
          <div 
            v-for="session in selectedAgentSessions" 
            :key="session.key"
            class="session-item"
            :class="{ 
              'selected-for-delete': selectedSessionKeys.has(session.key),
              'delete-mode': isDeleteMode 
            }"
            @click="isDeleteMode ? toggleSessionSelection(session.key) : handleSessionClick(session.key)"
          >
            <div v-if="isDeleteMode" class="session-checkbox" :class="{ checked: selectedSessionKeys.has(session.key) }">
              <CheckmarkOutline v-if="selectedSessionKeys.has(session.key)" :size="12" />
            </div>
            <div class="session-icon">
              <ChatbubblesOutline :size="14" />
            </div>
            <div class="session-info">
              <span class="session-name">{{ session.label || session.key.split(':').pop() }}</span>
              <span class="session-time">{{ session.messageCount }}条消息 · {{ formatRelativeTime(session.lastActivity) }}</span>
            </div>
            <div v-if="!isDeleteMode" class="session-arrow">→</div>
            <button v-if="isDeleteMode" class="session-delete-btn" @click.stop="handleDeleteSession(session.key)">
              <TrashOutline :size="14" />
            </button>
          </div>
        </div>
      </div>
    </Transition>
    
    <NModal
      v-model:show="showCreateModal"
      preset="card"
      :title="t('pages.sessions.list.createModal.title')"
      style="width: 500px; max-width: 90vw;"
      :mask-closable="false"
    >
      <NForm label-placement="left" label-width="80">
        <NFormItem :label="t('pages.sessions.list.createModal.channel')">
          <NSelect
            v-model:value="createForm.channel"
            :options="channelOptions"
            :placeholder="t('pages.sessions.list.createModal.channelPlaceholder')"
          />
        </NFormItem>
        <NFormItem :label="t('pages.sessions.list.createModal.peer')">
          <NInput
            v-model:value="createForm.peer"
            :placeholder="t('pages.sessions.list.createModal.peerPlaceholder')"
          />
        </NFormItem>
        <NFormItem :label="t('pages.sessions.list.createModal.label')">
          <NInput
            v-model:value="createForm.label"
            :placeholder="t('pages.sessions.list.createModal.labelPlaceholder')"
          />
        </NFormItem>
      </NForm>
      <template #footer>
        <NSpace justify="end">
          <NButton @click="showCreateModal = false">{{ t('common.cancel') }}</NButton>
          <NButton type="primary" :loading="creating" @click="handleCreateSession">
            {{ t('common.create') }}
          </NButton>
        </NSpace>
      </template>
    </NModal>
    
    <NModal
      v-model:show="showCreateAgentModal"
      preset="card"
      :title="t('myworld.addEmployee')"
      style="width: 500px; max-width: 90vw;"
      :mask-closable="false"
    >
      <NForm label-placement="left" label-width="100">
        <NFormItem :label="t('myworld.employeeId')" path="id">
          <NInput v-model:value="createAgentForm.id" :placeholder="t('myworld.employeeIdPlaceholder')" />
        </NFormItem>
        <NFormItem :label="t('myworld.employeeName')" path="name">
          <NInput v-model:value="createAgentForm.name" :placeholder="t('myworld.employeeNamePlaceholder')" />
        </NFormItem>
        <NFormItem :label="t('myworld.workspace')" path="workspace">
          <NInput v-model:value="createAgentForm.workspace" :placeholder="t('myworld.workspacePlaceholder')" />
        </NFormItem>
      </NForm>
      <template #footer>
        <NSpace justify="end">
          <NButton @click="showCreateAgentModal = false">{{ t('common.cancel') }}</NButton>
          <NButton type="primary" :loading="creatingAgent" @click="handleCreateAgent">
            {{ t('common.create') }}
          </NButton>
        </NSpace>
      </template>
    </NModal>
    
    <NModal
      v-model:show="showToolsModal"
      preset="card"
      :title="t('myworld.modifyEmployeePermission')"
      style="width: 700px; max-width: 90vw;"
      :mask-closable="false"
    >
      <NSpace vertical size="large">
        <NFormItem :label="t('myworld.employeeName')">
          <NSelect
            :value="selectedAgentForTools?.id"
            :options="agentStore.agents.map(a => ({ label: a.name || a.id, value: a.id }))"
            @update:value="selectAgentForTools"
          />
        </NFormItem>
        
        <div>
          <NText depth="3" style="font-size: 12px; margin-bottom: 8px; display: block;">
            {{ t('myworld.allowedPermissions') }} (Allow)
          </NText>
          <NSpace size="small" style="margin-bottom: 8px;">
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
              :placeholder="t('myworld.addPermission')"
              @keydown.enter="(e: KeyboardEvent) => {
                const target = e.target as HTMLInputElement
                if (target.value.trim()) {
                  addToolToAllow(target.value.trim())
                  target.value = ''
                }
              }"
            />
          </NSpace>
        </div>

        <div>
          <NText depth="3" style="font-size: 12px; margin-bottom: 8px; display: block;">
            {{ t('myworld.deniedPermissions') }} (Deny)
          </NText>
          <NSpace size="small" style="margin-bottom: 8px;">
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
              :placeholder="t('myworld.addPermission')"
              @keydown.enter="(e: KeyboardEvent) => {
                const target = e.target as HTMLInputElement
                if (target.value.trim()) {
                  addToolToDeny(target.value.trim())
                  target.value = ''
                }
              }"
            />
          </NSpace>
        </div>

        <NDivider style="margin: 8px 0;" />

        <div>
          <NText depth="3" style="font-size: 12px; margin-bottom: 8px; display: block;">
            {{ t('myworld.commonPermissions') }}
          </NText>
          <NSpace vertical size="small">
            <div v-for="category in toolCategories" :key="category.nameKey">
              <NText depth="3" style="font-size: 11px; margin-right: 8px;">{{ t(category.nameKey) }}:</NText>
              <NSpace size="small" style="margin-top: 4px;">
                <NButton
                  v-for="tool in category.tools"
                  :key="tool"
                  size="tiny"
                  :type="toolsForm.allow.includes(tool) ? 'success' : toolsForm.deny.includes(tool) ? 'error' : 'default'"
                  :disabled="toolsForm.allow.includes(tool) || toolsForm.deny.includes(tool)"
                  @click="addToolToAllow(tool)"
                  @contextmenu.prevent="addToolToDeny(tool)"
                >
                  {{ tool }}
                </NButton>
              </NSpace>
            </div>
          </NSpace>
          <NText depth="3" style="font-size: 11px; margin-top: 8px; display: block;">
            {{ t('myworld.permissionHint') }}
          </NText>
        </div>
      </NSpace>
      <template #footer>
        <NSpace justify="end">
          <NButton @click="showToolsModal = false">{{ t('common.cancel') }}</NButton>
          <NButton type="primary" :loading="savingTools" @click="handleSetTools">
            {{ t('common.save') }}
          </NButton>
        </NSpace>
      </template>
    </NModal>
    
    <Transition name="slide">
      <div 
        v-if="showChatPanel" 
        ref="chatPanelRef"
        class="chat-panel-overlay" 
        :class="{ 'is-resizing': isChatPanelResizing }"
        :style="{ width: `${chatPanelWidth}px` }"
      >
        <AgentChatPanel
          :title="t('myworld.chat.title')"
          :selected-agent="officeStore.selectedAgent"
          :selected-session-key="chatPanelSessionKey"
          @close="handleCloseChatPanel"
        />
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.my-world {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  flex-direction: column;
  background: linear-gradient(180deg, #0c1222 0%, #1a2744 50%, #0f172a 100%);
  overflow: hidden;
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
}

.world-controls {
  position: absolute;
  top: 80px;
  right: 20px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  z-index: 100;
  background: rgba(15, 23, 42, 0.9);
  padding: 12px;
  border-radius: 16px;
  backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
}

.control-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.2) 0%, rgba(59, 130, 246, 0.1) 100%);
  border: 1px solid rgba(59, 130, 246, 0.3);
  border-radius: 10px;
  color: #60a5fa;
  cursor: pointer;
  transition: all 0.2s ease;
}

.control-btn:hover {
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.3) 0%, rgba(59, 130, 246, 0.2) 100%);
  border-color: rgba(59, 130, 246, 0.5);
  transform: translateY(-1px);
}

.zoom-level {
  text-align: center;
  font-size: 11px;
  color: #94a3b8;
  font-weight: 600;
  padding: 4px 0;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.reset-btn {
  margin-top: 4px;
}

.world-container {
  flex: 1;
  overflow: hidden;
  position: relative;
  cursor: grab;
}

.world-container:active {
  cursor: grabbing;
}

.world-scene {
  position: absolute;
  top: 0;
  left: 0;
  transform-origin: 0 0;
  border-radius: 24px;
  overflow: hidden;
  box-shadow: 
    0 0 0 1px rgba(255, 255, 255, 0.05),
    0 25px 50px -12px rgba(0, 0, 0, 0.5),
    0 0 100px rgba(59, 130, 246, 0.1);
}

.office-floor {
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, #374151 0%, #4b5563 100%);
}

.floor-tiles {
  position: absolute;
  inset: 0;
  background-image: 
    linear-gradient(90deg, rgba(255, 255, 255, 0.03) 1px, transparent 1px),
    linear-gradient(0deg, rgba(255, 255, 255, 0.03) 1px, transparent 1px);
  background-size: 50px 50px;
}

.rooms-layer {
  position: absolute;
  inset: 0;
}

.room {
  position: absolute;
  border-radius: 4px;
  overflow: hidden;
}

.room-floor {
  position: absolute;
  inset: 0;
}

.room-office .room-floor,
.room-open-desk .room-floor {
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.06) 0%, rgba(59, 130, 246, 0.02) 100%);
}

.room-meeting-small .room-floor,
.room-meeting-large .room-floor {
  background: linear-gradient(135deg, rgba(168, 85, 247, 0.06) 0%, rgba(168, 85, 247, 0.02) 100%);
}

.room-manager .room-floor {
  background: linear-gradient(135deg, rgba(245, 158, 11, 0.06) 0%, rgba(245, 158, 11, 0.02) 100%);
}

.room-reception .room-floor {
  background: linear-gradient(135deg, rgba(236, 72, 153, 0.06) 0%, rgba(236, 72, 153, 0.02) 100%);
}

.room-pantry .room-floor {
  background: linear-gradient(135deg, rgba(34, 197, 94, 0.06) 0%, rgba(34, 197, 94, 0.02) 100%);
}

.room-lounge .room-floor {
  background: linear-gradient(135deg, rgba(16, 185, 129, 0.06) 0%, rgba(16, 185, 129, 0.02) 100%);
}

.room-restroom .room-floor {
  background: linear-gradient(135deg, rgba(100, 116, 139, 0.08) 0%, rgba(100, 116, 139, 0.04) 100%);
}

.room-storage .room-floor {
  background: linear-gradient(135deg, rgba(168, 162, 158, 0.06) 0%, rgba(168, 162, 158, 0.02) 100%);
}

.room-label {
  position: absolute;
  top: 8px;
  left: 10px;
  z-index: 5;
}

.room-restroom .room-label {
  top: auto;
  bottom: 5px;
  left: 50%;
  transform: translateX(-50%);
}

.label-text {
  font-size: 10px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.5);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.room-desks {
  position: absolute;
  inset: 25px 15px 15px 15px;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  grid-template-rows: repeat(2, 1fr);
  gap: 15px 20px;
}

.desk-unit {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}

.desk {
  width: 45px;
  height: 20px;
  background: linear-gradient(180deg, #475569 0%, #334155 100%);
  border-radius: 3px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
}

.chair {
  width: 18px;
  height: 12px;
  background: linear-gradient(180deg, #334155 0%, #1e293b 100%);
  border-radius: 4px 4px 2px 2px;
}

.monitor {
  width: 20px;
  height: 15px;
  background: linear-gradient(180deg, #1e293b 0%, #0f172a 100%);
  border: 1px solid #475569;
  border-radius: 2px;
  box-shadow: 0 0 8px rgba(59, 130, 246, 0.2);
}

.meeting-furniture {
  position: absolute;
  inset: 20px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
}

.meeting-furniture.small .meeting-table {
  width: 100px;
  height: 50px;
  background: linear-gradient(180deg, #475569 0%, #334155 100%);
  border-radius: 8px;
  box-shadow: 0 3px 8px rgba(0, 0, 0, 0.3);
}

.meeting-furniture.large .meeting-table {
  width: 180px;
  height: 70px;
  background: linear-gradient(180deg, #475569 0%, #334155 100%);
  border-radius: 10px;
  box-shadow: 0 3px 8px rgba(0, 0, 0, 0.3);
}

.meeting-chairs {
  display: flex;
  gap: 15px;
}

.meeting-chair {
  width: 15px;
  height: 18px;
  background: linear-gradient(180deg, #334155 0%, #1e293b 100%);
  border-radius: 5px 5px 2px 2px;
}

.whiteboard {
  position: absolute;
  top: 10px;
  right: 15px;
  width: 60px;
  height: 35px;
  background: linear-gradient(180deg, #f8fafc 0%, #e2e8f0 100%);
  border: 2px solid #94a3b8;
  border-radius: 3px;
}

.manager-furniture {
  position: absolute;
  inset: 15px;
  display: flex;
  align-items: center;
  justify-content: space-around;
}

.executive-desk {
  width: 80px;
  height: 35px;
  background: linear-gradient(180deg, #78350f 0%, #451a03 100%);
  border-radius: 6px;
  box-shadow: 0 3px 8px rgba(0, 0, 0, 0.3);
}

.executive-chair {
  width: 25px;
  height: 30px;
  background: linear-gradient(180deg, #1e293b 0%, #0f172a 100%);
  border-radius: 6px 6px 3px 3px;
}

.cabinet {
  width: 30px;
  height: 50px;
  background: linear-gradient(180deg, #475569 0%, #334155 100%);
  border-radius: 4px;
}

.reception-furniture {
  position: absolute;
  inset: 20px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 40px;
}

.reception-main-counter {
  width: 300px;
  height: 60px;
  background: linear-gradient(180deg, #1e3a5f 0%, #0f172a 100%);
  border-radius: 12px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(59, 130, 246, 0.3);
}

.reception-side-counter {
  width: 100px;
  height: 80px;
  background: linear-gradient(180deg, #374151 0%, #1f2937 100%);
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
}

.waiting-sofa-set {
  display: flex;
  align-items: center;
  gap: 30px;
  margin-left: 200px;
}

.waiting-sofa {
  width: 120px;
  height: 45px;
  background: linear-gradient(180deg, #1e3a5f 0%, #0f172a 100%);
  border-radius: 12px 12px 6px 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
}

.waiting-coffee-table {
  width: 60px;
  height: 30px;
  background: linear-gradient(180deg, #78350f 0%, #451a03 100%);
  border-radius: 6px;
  box-shadow: 0 3px 8px rgba(0, 0, 0, 0.3);
}

.reception-plants {
  display: flex;
  gap: 40px;
}

.big-plant {
  width: 40px;
  height: 70px;
  background: linear-gradient(180deg, #166534 0%, #14532d 100%);
  border-radius: 50% 50% 10% 10%;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
}

.reception-pillars {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  display: flex;
  justify-content: space-around;
  padding: 0 200px;
}

.pillar {
  width: 30px;
  height: 100%;
  background: linear-gradient(90deg, #475569 0%, #64748b 50%, #475569 100%);
  border-radius: 0 0 4px 4px;
  box-shadow: inset -2px 0 4px rgba(0, 0, 0, 0.2), inset 2px 0 4px rgba(255, 255, 255, 0.1);
}

.company-logo {
  position: absolute;
  top: 100px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 5;
  pointer-events: none;
}

.logo-icon {
  font-size: 150px;
  filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.3));
}

.pantry-furniture {
  position: absolute;
  inset: 15px;
  display: flex;
  align-items: flex-end;
  justify-content: space-around;
  flex-wrap: wrap;
  gap: 10px;
  padding-bottom: 15px;
}

.counter {
  width: 80px;
  height: 25px;
  background: linear-gradient(180deg, #475569 0%, #334155 100%);
  border-radius: 4px;
}

.coffee-machine {
  width: 25px;
  height: 40px;
  background: linear-gradient(180deg, #374151 0%, #1f2937 100%);
  border-radius: 4px;
}

.water-dispenser {
  width: 20px;
  height: 35px;
  background: linear-gradient(180deg, #60a5fa 0%, #3b82f6 100%);
  border-radius: 3px;
}

.fridge {
  width: 35px;
  height: 55px;
  background: linear-gradient(180deg, #e5e7eb 0%, #d1d5db 100%);
  border-radius: 4px;
  border: 1px solid #9ca3af;
}

.snack-shelf {
  width: 50px;
  height: 40px;
  background: linear-gradient(180deg, #78350f 0%, #451a03 100%);
  border-radius: 3px;
}

.lounge-furniture {
  position: absolute;
  inset: 15px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 15px;
}

.sofa-set {
  display: flex;
  align-items: center;
  gap: 20px;
}

.sofa {
  width: 70px;
  height: 25px;
  background: linear-gradient(180deg, #1e3a5f 0%, #0f172a 100%);
  border-radius: 8px 8px 4px 4px;
  box-shadow: 0 3px 8px rgba(0, 0, 0, 0.3);
}

.coffee-table {
  width: 40px;
  height: 18px;
  background: linear-gradient(180deg, #78350f 0%, #451a03 100%);
  border-radius: 4px;
}

.tv-screen {
  width: 100px;
  height: 50px;
  background: linear-gradient(180deg, #1e293b 0%, #0f172a 100%);
  border: 2px solid #475569;
  border-radius: 4px;
}

.plants {
  position: absolute;
  bottom: 15px;
  right: 20px;
  display: flex;
  gap: 15px;
}

.plant {
  width: 20px;
  height: 30px;
  background: linear-gradient(180deg, #166534 0%, #14532d 100%);
  border-radius: 50% 50% 10% 10%;
}

.restroom-furniture {
  position: absolute;
  inset: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.sink-area {
  display: flex;
  gap: 8px;
  justify-content: center;
}

.sink {
  width: 20px;
  height: 12px;
  background: linear-gradient(180deg, #e5e7eb 0%, #d1d5db 100%);
  border-radius: 3px;
  border: 1px solid #9ca3af;
}

.stalls {
  display: flex;
  gap: 3px;
  justify-content: center;
}

.stall {
  width: 28px;
  height: 35px;
  background: linear-gradient(180deg, #475569 0%, #334155 100%);
  border-radius: 3px;
  border: 1px solid #64748b;
}

.storage-furniture {
  position: absolute;
  inset: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.shelf {
  width: 100%;
  height: 20px;
  background: linear-gradient(180deg, #78350f 0%, #451a03 100%);
  border-radius: 3px;
}

.room-walls {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.room-walls .wall {
  position: absolute;
  background: linear-gradient(180deg, #64748b 0%, #475569 100%);
  box-shadow: 
    0 0 4px rgba(0, 0, 0, 0.3),
    inset 0 1px 0 rgba(255, 255, 255, 0.1);
}

.room-walls .wall-top {
  top: 0;
  left: 0;
  right: 0;
  height: 8px;
}

.room-walls .wall-bottom {
  bottom: 0;
  left: 0;
  right: 0;
  height: 8px;
}

.room-walls .wall-left {
  top: 0;
  left: 0;
  bottom: 0;
  width: 8px;
}

.room-walls .wall-right {
  top: 0;
  right: 0;
  bottom: 0;
  width: 8px;
}

.outer-walls {
  position: absolute;
  inset: 20px;
  pointer-events: none;
}

.outer-wall {
  position: absolute;
  background: linear-gradient(180deg, #475569 0%, #334155 100%);
  box-shadow: 
    0 0 6px rgba(0, 0, 0, 0.4),
    inset 0 1px 0 rgba(255, 255, 255, 0.1);
}

.outer-wall-top {
  top: 0;
  left: 0;
  right: 0;
  height: 12px;
}

.outer-wall-bottom {
  bottom: 0;
  left: 0;
  right: 0;
  height: 12px;
}

.outer-wall-left {
  top: 0;
  left: 0;
  bottom: 0;
  width: 12px;
}

.outer-wall-right {
  top: 0;
  right: 0;
  bottom: 0;
  width: 12px;
}

.door {
  position: absolute;
  z-index: 10;
}

.door-top {
  left: calc(var(--door-offset) - var(--door-width) / 2);
  top: -2px;
  width: var(--door-width);
  height: 12px;
}

.door-bottom {
  left: calc(var(--door-offset) - var(--door-width) / 2);
  bottom: -2px;
  width: var(--door-width);
  height: 12px;
}

.door-left {
  left: -2px;
  top: calc(var(--door-offset) - var(--door-width) / 2);
  width: 12px;
  height: var(--door-width);
}

.door-right {
  right: -2px;
  top: calc(var(--door-offset) - var(--door-width) / 2);
  width: 12px;
  height: var(--door-width);
}

.door-frame {
  width: 100%;
  height: 100%;
  background: transparent;
  display: flex;
  align-items: center;
  justify-content: center;
}

.door-panel {
  width: 70%;
  height: 90%;
  background: linear-gradient(180deg, #92400e 0%, #78350f 100%);
  border-radius: 4px;
  border: 2px solid #b45309;
  box-shadow: 
    inset 0 0 3px rgba(0, 0, 0, 0.2),
    0 2px 6px rgba(0, 0, 0, 0.15);
}

.characters-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.character {
  position: absolute;
  transform: translate(-50%, -50%);
  cursor: pointer;
  pointer-events: auto;
  transition: transform 0.15s ease;
  z-index: 10;
}

.character:hover {
  transform: translate(-50%, -50%) scale(1.1);
  z-index: 20;
}

.character.selected {
  z-index: 30;
}

.character-shadow {
  position: absolute;
  bottom: -12px;
  left: 50%;
  transform: translateX(-50%);
  width: 25px;
  height: 6px;
  background: radial-gradient(ellipse, rgba(0, 0, 0, 0.35) 0%, transparent 70%);
  filter: blur(1px);
}

.character-body {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.character-head {
  position: relative;
  width: 14px;
  height: 16px;
  z-index: 3;
}

.hair {
  position: absolute;
  top: 0;
  left: 1px;
  right: 1px;
  height: 8px;
  background: #1e293b;
  border-radius: 6px 6px 0 0;
}

.character.gender-male .hair {
  height: 7px;
}

.character.gender-female .hair {
  height: 9px;
  border-radius: 7px 7px 0 0;
}

.character.hair-0 .hair {
  background: #1e293b;
}

.character.hair-1 .hair {
  background: #78350f;
}

.character.hair-2 .hair {
  background: #dc2626;
}

.character.hair-3 .hair {
  background: #fbbf24;
}

.character.hair-4 .hair {
  background: #6b7280;
}

.character.gender-female.hair-0 .hair::after {
  content: '';
  position: absolute;
  top: 2px;
  left: -2px;
  width: 4px;
  height: 10px;
  background: #1e293b;
  border-radius: 2px;
}

.character.gender-female.hair-1 .hair::after {
  content: '';
  position: absolute;
  top: 2px;
  right: -2px;
  width: 4px;
  height: 10px;
  background: #78350f;
  border-radius: 2px;
}

.character.gender-male.hair-2 .hair {
  height: 5px;
  left: 2px;
  right: 2px;
}

.character.gender-female.hair-3 .hair {
  height: 10px;
  left: 0;
  right: 0;
  border-radius: 8px 8px 0 0;
}

.character.gender-male.hair-4 .hair {
  height: 4px;
  border-radius: 3px 3px 0 0;
}

.face {
  position: absolute;
  bottom: 0;
  left: 1px;
  right: 1px;
  height: 10px;
  background: linear-gradient(180deg, #fcd9b6 0%, #f5c09d 100%);
  border-radius: 0 0 5px 5px;
}

.character.skin-0 .face {
  background: linear-gradient(180deg, #fcd9b6 0%, #f5c09d 100%);
}

.character.skin-1 .face {
  background: linear-gradient(180deg, #f5c09d 0%, #d4a574 100%);
}

.character.skin-2 .face {
  background: linear-gradient(180deg, #d4a574 0%, #b8956e 100%);
}

.character.skin-3 .face {
  background: linear-gradient(180deg, #a67c52 0%, #8b6544 100%);
}

.eyes {
  position: absolute;
  top: 3px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 3px;
}

.eye {
  width: 1.5px;
  height: 1.5px;
  background: #1e293b;
  border-radius: 50%;
}

.character-torso {
  position: relative;
  width: 18px;
  height: 16px;
  background: linear-gradient(180deg, var(--primary) 0%, var(--secondary) 100%);
  border-radius: 5px 5px 2px 2px;
  margin-top: -1px;
  z-index: 2;
}

.character.gender-male .character-torso {
  width: 20px;
  height: 18px;
  border-radius: 6px 6px 3px 3px;
}

.character.gender-female .character-torso {
  width: 16px;
  height: 15px;
  border-radius: 8px 8px 3px 3px;
}

.arm {
  position: absolute;
  top: 2px;
  width: 4px;
  height: 12px;
  background: linear-gradient(180deg, var(--primary) 0%, var(--secondary) 100%);
  border-radius: 2px;
}

.character.gender-male .arm {
  width: 5px;
  height: 14px;
}

.character.gender-female .arm {
  width: 3px;
  height: 11px;
}

.arm-left {
  left: -3px;
  transform-origin: top center;
}

.arm-right {
  right: -3px;
  transform-origin: top center;
}

.character-legs {
  display: flex;
  gap: 2px;
  margin-top: -1px;
  z-index: 1;
}

.leg {
  width: 6px;
  height: 14px;
  background: linear-gradient(180deg, #1e293b 0%, #0f172a 100%);
  border-radius: 0 0 2px 2px;
}

.character.gender-male .leg {
  width: 7px;
  height: 15px;
}

.character.gender-female .leg {
  width: 5px;
  height: 13px;
  gap: 1px;
}

.character.gender-female .character-legs {
  gap: 1px;
}

.character-info {
  position: absolute;
  bottom: -25px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  white-space: nowrap;
}

.character-name {
  font-size: 9px;
  font-weight: 600;
  color: #fff;
  background: rgba(15, 23, 42, 0.9);
  padding: 2px 6px;
  border-radius: 4px;
  backdrop-filter: blur(8px);
}

.character-status {
  font-size: 7px;
  color: #94a3b8;
}

.session-bubble {
  position: absolute;
  top: -70px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px 10px;
  border-radius: 10px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  white-space: nowrap;
  min-width: 60px;
  max-width: 150px;
}

.session-bubble.active {
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.95) 0%, rgba(99, 102, 241, 0.95) 100%);
  animation: bubble-pulse 2s infinite;
}

.session-bubble.recent {
  background: linear-gradient(135deg, rgba(245, 158, 11, 0.9) 0%, rgba(234, 88, 12, 0.9) 100%);
}

.bubble-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}

.session-name {
  font-size: 9px;
  font-weight: 600;
  color: #fff;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
}

.session-status {
  font-size: 8px;
  flex-shrink: 0;
}

.session-status.active {
  color: #10b981;
  animation: blink 1s infinite;
}

.session-status.recent {
  color: #fef3c7;
}

.bubble-message {
  font-size: 8px;
  color: rgba(255, 255, 255, 0.85);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bubble-phase {
  font-size: 7px;
  color: rgba(255, 255, 255, 0.7);
  text-transform: uppercase;
}

.full-message-tooltip {
  position: fixed;
  transform: translate(-50%, -100%);
  width: max-content;
  min-width: 80px;
  max-width: 450px;
  padding: 10px 14px;
  background: linear-gradient(135deg, rgba(30, 41, 59, 0.98) 0%, rgba(15, 23, 42, 0.98) 100%);
  border: 1px solid rgba(99, 102, 241, 0.4);
  border-radius: 10px;
  font-size: 12px;
  color: #e2e8f0;
  line-height: 1.5;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(99, 102, 241, 0.1);
  z-index: 9999;
  pointer-events: auto;
  text-align: left;
  overflow: visible;
}

.tooltip-content {
  white-space: normal;
  word-wrap: break-word;
  overflow-wrap: anywhere;
  pointer-events: auto;
  max-height: 200px;
  overflow-y: auto;
}

.tooltip-content :deep(p) {
  margin: 0 0 8px 0;
}

.tooltip-content :deep(p:last-child) {
  margin-bottom: 0;
}

.tooltip-content :deep(code) {
  background: rgba(0, 0, 0, 0.3);
  padding: 2px 4px;
  border-radius: 4px;
  font-family: monospace;
  font-size: 11px;
}

.tooltip-content :deep(pre) {
  background: rgba(0, 0, 0, 0.3);
  padding: 8px;
  border-radius: 6px;
  overflow-x: auto;
  margin: 8px 0;
}

.tooltip-content :deep(pre code) {
  background: none;
  padding: 0;
}

/* —— 代码块容器（带行号） —— */
.tooltip-content :deep(.code-block-container) {
  display: flex;
  position: relative;
  margin: 8px 0;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(0, 0, 0, 0.3);
  overflow-x: auto;
}

.tooltip-content :deep(.code-block-container pre) {
  margin: 0;
  padding: 0;
  border: none;
  background: transparent;
  overflow: visible;
}

.tooltip-content :deep(.code-line-numbers) {
  display: flex;
  flex-direction: column;
  padding: 8px 6px;
  background: rgba(0, 0, 0, 0.2);
  border-right: 1px solid rgba(255, 255, 255, 0.1);
  text-align: right;
  user-select: none;
  min-width: 32px;
}

.tooltip-content :deep(.line-number) {
  font-family: 'SFMono-Regular', Menlo, Monaco, Consolas, monospace;
  font-size: 11px;
  line-height: 1.5;
  color: rgba(255, 255, 255, 0.4);
  padding: 0 2px;
}

.tooltip-content :deep(.code-content) {
  flex: 1;
  padding: 8px;
  overflow-x: auto;
  min-width: 0;
}

.tooltip-content :deep(.code-content code) {
  display: block;
  font-family: 'SFMono-Regular', Menlo, Monaco, Consolas, monospace;
  font-size: 11px;
  line-height: 1.5;
  white-space: pre;
}

.tooltip-content :deep(.code-copy-btn) {
  position: absolute;
  top: 4px;
  right: 4px;
  padding: 4px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.6);
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s ease, background 0.15s ease;
}

.tooltip-content :deep(.code-block-container:hover .code-copy-btn) {
  opacity: 1;
}

.tooltip-content :deep(.code-copy-btn:hover) {
  background: rgba(255, 255, 255, 0.2);
  color: #fff;
}

.tooltip-content :deep(.code-copy-btn.copied) {
  color: #818cf8;
}

.tooltip-content :deep(ul),
.tooltip-content :deep(ol) {
  margin: 8px 0;
  padding-left: 20px;
}

.tooltip-content :deep(li) {
  margin: 4px 0;
}

.tooltip-content :deep(strong) {
  font-weight: 600;
  color: #fff;
}

.tooltip-content :deep(em) {
  font-style: italic;
}

.tooltip-content :deep(a) {
  color: #818cf8;
  text-decoration: underline;
}

.tooltip-copy-btn {
  position: absolute;
  top: 4px;
  right: 4px;
  background: rgba(255, 255, 255, 0.1);
  border: none;
  border-radius: 4px;
  padding: 4px;
  cursor: pointer;
  color: #94a3b8;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: all 0.2s ease;
  pointer-events: auto;
  z-index: 10;
}

.tooltip-copy-btn:hover {
  background: rgba(255, 255, 255, 0.2);
  color: #fff;
}

.full-message-tooltip:hover .tooltip-copy-btn {
  opacity: 1;
  pointer-events: auto;
}

.full-message-tooltip::before {
  content: '';
  position: absolute;
  bottom: -6px;
  left: 50%;
  transform: translateX(-50%);
  border-left: 6px solid transparent;
  border-right: 6px solid transparent;
  border-top: 6px solid rgba(30, 41, 59, 0.98);
  z-index: 1;
}

.full-message-tooltip::after {
  content: '';
  position: absolute;
  bottom: -8px;
  left: 50%;
  transform: translateX(-50%);
  border-left: 8px solid transparent;
  border-right: 8px solid transparent;
  border-top: 8px solid rgba(99, 102, 241, 0.4);
  z-index: 0;
}

@keyframes bubble-pulse {
  0%, 100% { transform: translateX(-50%) scale(1); }
  50% { transform: translateX(-50%) scale(1.02); }
}

@keyframes blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.working-indicator {
  position: absolute;
  top: -10px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 2px;
  background: rgba(15, 23, 42, 0.9);
  padding: 2px 6px;
  border-radius: 8px;
  backdrop-filter: blur(8px);
}

.dot {
  width: 3px;
  height: 3px;
  background: #10b981;
  border-radius: 50%;
  animation: typing 1.4s infinite ease-in-out;
}

.dot:nth-child(1) { animation-delay: 0s; }
.dot:nth-child(2) { animation-delay: 0.2s; }
.dot:nth-child(3) { animation-delay: 0.4s; }

@keyframes typing {
  0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
  30% { transform: translateY(-3px); opacity: 1; }
}

.character.status-walking .leg-left {
  animation: walk-leg 0.3s infinite;
}

.character.status-walking .leg-right {
  animation: walk-leg 0.3s infinite 0.15s;
}

.character.status-walking .arm-left {
  animation: walk-arm 0.3s infinite;
}

.character.status-walking .arm-right {
  animation: walk-arm 0.3s infinite 0.15s;
}

@keyframes walk-leg {
  0%, 100% { transform: rotate(0deg); }
  50% { transform: rotate(20deg); }
}

@keyframes walk-arm {
  0%, 100% { transform: rotate(0deg); }
  50% { transform: rotate(-15deg); }
}

.character.status-working .character-torso {
  animation: working-breathe 2s infinite ease-in-out;
}

@keyframes working-breathe {
  0%, 100% { transform: scaleY(1); }
  50% { transform: scaleY(1.02); }
}

.character.status-resting {
  opacity: 0.7;
}

.character.selected::after {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 40px;
  height: 55px;
  border: 2px solid var(--accent);
  border-radius: 50%;
  animation: selection-pulse 2s infinite;
  pointer-events: none;
}

@keyframes selection-pulse {
  0%, 100% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
  50% { opacity: 0.5; transform: translate(-50%, -50%) scale(1.1); }
}

.entrance-marker {
  position: absolute;
  left: 50%;
  top: 5px;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  z-index: 50;
}

.entrance-gate {
  display: flex;
  align-items: flex-end;
  gap: 0;
}

.gate-pillar {
  width: 20px;
  height: 50px;
  background: linear-gradient(90deg, #475569 0%, #64748b 50%, #475569 100%);
  box-shadow: inset -2px 0 4px rgba(0, 0, 0, 0.2), inset 2px 0 4px rgba(255, 255, 255, 0.1);
}

.gate-pillar.left {
  border-radius: 4px 0 0 0;
}

.gate-pillar.right {
  border-radius: 0 4px 0 0;
}

.gate-door {
  width: 60px;
  height: 45px;
  background: linear-gradient(180deg, #78350f 0%, #451a03 100%);
  border-top: 3px solid #b45309;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
}

.entrance-icon {
  font-size: 20px;
  filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.3));
}

.entrance-text {
  font-size: 12px;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.8);
  text-transform: uppercase;
  letter-spacing: 2px;
  background: rgba(15, 23, 42, 0.8);
  padding: 4px 12px;
  border-radius: 4px;
}

.session-list-popup {
  position: fixed;
  width: 280px;
  max-height: 400px;
  background: rgba(15, 23, 42, 0.98);
  backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 16px;
  box-shadow: 
    0 20px 40px rgba(0, 0, 0, 0.4),
    0 0 0 1px rgba(255, 255, 255, 0.05);
  z-index: 300;
  overflow: hidden;
  transform-origin: left center;
}

.popup-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  background: rgba(59, 130, 246, 0.1);
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.popup-title {
  font-size: 14px;
  font-weight: 600;
  color: #fff;
}

.popup-add {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  background: rgba(59, 130, 246, 0.2);
  border: none;
  border-radius: 6px;
  color: #60a5fa;
  cursor: pointer;
  font-size: 16px;
  transition: all 0.2s ease;
}

.popup-add:hover {
  background: rgba(59, 130, 246, 0.3);
  color: #93c5fd;
}

.popup-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.popup-delete {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  background: rgba(239, 68, 68, 0.2);
  border: none;
  border-radius: 6px;
  color: #f87171;
  cursor: pointer;
  transition: all 0.2s ease;
}

.popup-delete:hover {
  background: rgba(239, 68, 68, 0.3);
  color: #fca5a5;
}

.popup-confirm {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  background: rgba(34, 197, 94, 0.2);
  border: none;
  border-radius: 6px;
  color: #4ade80;
  cursor: pointer;
  transition: all 0.2s ease;
}

.popup-confirm:hover:not(:disabled) {
  background: rgba(34, 197, 94, 0.3);
  color: #86efac;
}

.popup-confirm:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.popup-cancel {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  background: rgba(156, 163, 175, 0.2);
  border: none;
  border-radius: 6px;
  color: #9ca3af;
  cursor: pointer;
  transition: all 0.2s ease;
}

.popup-cancel:hover {
  background: rgba(156, 163, 175, 0.3);
  color: #d1d5db;
}

.popup-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  background: rgba(255, 255, 255, 0.1);
  border: none;
  border-radius: 6px;
  color: #94a3b8;
  cursor: pointer;
  font-size: 16px;
  transition: all 0.2s ease;
}

.popup-close:hover {
  background: rgba(255, 255, 255, 0.2);
  color: #fff;
}

.popup-content {
  max-height: 340px;
  overflow-y: auto;
  padding: 8px;
}

.empty-sessions {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100px;
  color: #64748b;
  font-size: 13px;
}

.session-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.05);
  border-radius: 10px;
  margin-bottom: 6px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.session-item:last-child {
  margin-bottom: 0;
}

.session-item:hover {
  background: rgba(59, 130, 246, 0.15);
  border-color: rgba(59, 130, 246, 0.3);
  transform: translateX(4px);
}

.session-item.delete-mode:hover {
  background: rgba(239, 68, 68, 0.1);
  border-color: rgba(239, 68, 68, 0.3);
}

.session-item.selected-for-delete {
  background: rgba(239, 68, 68, 0.15);
  border-color: rgba(239, 68, 68, 0.4);
}

.session-checkbox {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-radius: 4px;
  flex-shrink: 0;
  transition: all 0.2s ease;
}

.session-checkbox.checked {
  background: #ef4444;
  border-color: #ef4444;
  color: #fff;
}

.session-delete-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  background: rgba(239, 68, 68, 0.2);
  border: none;
  border-radius: 6px;
  color: #f87171;
  cursor: pointer;
  transition: all 0.2s ease;
  flex-shrink: 0;
}

.session-delete-btn:hover {
  background: rgba(239, 68, 68, 0.4);
  color: #fff;
}

.session-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.2) 0%, rgba(59, 130, 246, 0.1) 100%);
  border-radius: 8px;
  color: #60a5fa;
  flex-shrink: 0;
}

.session-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow: hidden;
}

.session-name {
  font-size: 13px;
  font-weight: 500;
  color: #fff;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.session-time {
  font-size: 11px;
  color: #64748b;
}

.session-arrow {
  font-size: 14px;
  color: #475569;
  transition: all 0.2s ease;
  flex-shrink: 0;
}

.session-item:hover .session-arrow {
  color: #60a5fa;
  transform: translateX(2px);
}

.fade-enter-active,
.fade-leave-active {
  transition: all 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
  transform: scale(0.95) translateY(-10px);
}

.chat-panel-overlay {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  background: rgba(15, 23, 42, 0.98);
  backdrop-filter: blur(20px);
  border-left: 1px solid rgba(255, 255, 255, 0.1);
  z-index: 200;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.chat-panel-overlay::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 6px;
  cursor: ew-resize;
  background: transparent;
  transition: background 0.2s ease;
  z-index: 10;
}

.chat-panel-overlay:hover::before {
  background: linear-gradient(90deg, rgba(59, 130, 246, 0.3) 0%, transparent 100%);
}

.chat-panel-overlay.is-resizing::before {
  background: linear-gradient(90deg, rgba(59, 130, 246, 0.5) 0%, transparent 100%);
}

.chat-panel-overlay.is-resizing {
  transition: none;
}

.chat-panel-overlay :deep(.n-card) {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.chat-panel-overlay :deep(.n-card__content) {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.slide-enter-active,
.slide-leave-active {
  transition: all 0.3s ease;
}

.slide-enter-from,
.slide-leave-to {
  transform: translateX(100%);
  opacity: 0;
}
</style>

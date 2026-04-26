<script setup lang="ts">
import { computed, h, onMounted, onUnmounted, ref, nextTick, watch } from 'vue'
import {
  NCard,
  NInput,
  NButton,
  NIcon,
  NSpace,
  NEmpty,
  NSpin,
  NAlert,
  NText,
  NTag,
  NDataTable,
  NPopconfirm,
  NModal,
  NForm,
  NFormItem,
  NUpload,
  NImage,
  NTabs,
  NTabPane,
  NBreadcrumb,
  NBreadcrumbItem,
  NTooltip,
  useMessage,
  type DataTableColumns,
  type UploadFileInfo,
} from 'naive-ui'
import {
  RefreshOutline,
  FolderOutline,
  DocumentOutline,
  CodeSlashOutline,
  ImageOutline,
  VideocamOutline,
  MusicalNotesOutline,
  ArchiveOutline,
  CloudDownloadOutline,
  AddOutline,
  CloudUploadOutline,
  CloseOutline,
  HomeOutline,
  CreateOutline,
  TextOutline,
  ListOutline,
  CodeOutline,
  LinkOutline,
  ImageOutline as ImageIconOutline,
  ChatboxEllipsesOutline,
  ReturnDownBackOutline,
  RemoveOutline,
  AddCircleOutline,
  ReorderFourOutline,
  ExpandOutline,
  ContractOutline,
  DocumentTextOutline,
  ChevronDownOutline,
  ChevronForwardOutline,
} from '@vicons/ionicons5'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth'
import { useHermesConnectionStore } from '@/stores/hermes/connection'
import { formatRelativeTime } from '@/utils/format'
import { renderSimpleMarkdown, extractTocHeadings } from '@/utils/markdown'
import PdfViewer from '@/components/common/PdfViewer.vue'

interface FileEntry {
  name: string
  path: string
  type: 'file' | 'directory'
  isDirectory?: boolean
  size?: number
  updatedAtMs?: number
  extension?: string
  modifiedAt?: string
}

const props = defineProps<{
  skillName: string
  skillCategory?: string
  skillPath?: string
  autoOpenFile?: string
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

const { t } = useI18n()
const message = useMessage()
const authStore = useAuthStore()
const hermesConnectionStore = useHermesConnectionStore()

const loading = ref(false)
const error = ref('')
const currentPath = ref('')
const entries = ref<FileEntry[]>([])
const selectedFile = ref<FileEntry | null>(null)
const fileContent = ref<string>('')
const fileLoading = ref(false)
const editedContent = ref('')

const showPreviewModal = ref(false)
const showEditorModal = ref(false)
const isEditorMaximized = ref(false)
const showCreateModal = ref(false)
const showRenameModal = ref(false)
const createType = ref<'file' | 'directory'>('file')
const createName = ref('')
const createLoading = ref(false)
const renameTarget = ref<FileEntry | null>(null)
const renameName = ref('')
const renameLoading = ref(false)

const uploadLoading = ref(false)

const editorTextarea = ref<HTMLTextAreaElement | null>(null)

const imgExts = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'bmp']
const mdExts = ['md', 'markdown']
const codeExts = ['ts', 'tsx', 'js', 'jsx', 'vue', 'json', 'yaml', 'yml', 'py', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'css', 'scss', 'html', 'xml', 'sh', 'bash']
const pdfExts = ['pdf']

const isImageFile = computed(() => {
  if (!selectedFile.value) return false
  const ext = selectedFile.value.extension?.toLowerCase() || ''
  return imgExts.includes(ext)
})

const isMarkdownFile = computed(() => {
  if (!selectedFile.value) return false
  const ext = selectedFile.value.extension?.toLowerCase() || ''
  return mdExts.includes(ext)
})

const isCodeFile = computed(() => {
  if (!selectedFile.value) return false
  const ext = selectedFile.value.extension?.toLowerCase() || ''
  return codeExts.includes(ext)
})

const isPdfFile = computed(() => {
  if (!selectedFile.value) return false
  const ext = selectedFile.value.extension?.toLowerCase() || ''
  return pdfExts.includes(ext)
})

const pdfUrl = computed(() => {
  if (!selectedFile.value || !currentWorkspace.value) return ''
  return `/api/files/get?path=${encodeURIComponent(selectedFile.value.path)}&workspace=${encodeURIComponent(currentWorkspace.value)}&binary=true`
})

const imageUrl = ref<string | null>(null)
const previewTab = ref<'preview' | 'source'>('preview')
const isPreviewMaximized = ref(false)
const tocExpandedState = ref<Record<string, boolean>>({})

const tocHeadings = computed(() => {
  if (!isMarkdownFile.value || !fileContent.value) return []
  return extractTocHeadings(fileContent.value)
})

const editorTocHeadings = computed(() => {
  if (!isMarkdownFile.value || !editedContent.value) return []
  return extractTocHeadings(editedContent.value)
})

function getTocKey(heading: { text: string; level: number }): string {
  return `h${heading.level}-${heading.text.toLowerCase().replace(/[^\w\u4e00-\u9fa5]+/g, '-')}`
}

function isTocExpanded(heading: { text: string; level: number }): boolean {
  const key = getTocKey(heading)
  if (tocExpandedState.value[key] === undefined) {
    return true
  }
  return tocExpandedState.value[key]
}

function toggleTocExpand(heading: { text: string; level: number }) {
  const key = getTocKey(heading)
  tocExpandedState.value[key] = !isTocExpanded(heading)
}

function hasVisibleChildren(headings: { level: number; text: string; id: string }[], currentIndex: number, parentLevel: number): boolean {
  for (let i = currentIndex + 1; i < headings.length; i++) {
    const heading = headings[i]
    if (heading && heading.level <= parentLevel) break
    return true
  }
  return false
}

function isHeadingVisible(headings: { level: number; text: string; id: string }[], currentIndex: number): boolean {
  const current = headings[currentIndex]
  if (!current) return false
  if (current.level === 1) return true
  
  for (let i = currentIndex - 1; i >= 0; i--) {
    const prev = headings[i]
    if (prev && prev.level < current.level) {
      return isTocExpanded(prev)
    }
  }
  return true
}

function getTocNumber(headings: { level: number; text: string; id: string }[], currentIndex: number): string {
  const current = headings[currentIndex]
  if (!current) return ''
  
  const counters: number[] = [0, 0, 0, 0, 0, 0]
  
  for (let i = 0; i <= currentIndex; i++) {
    const h = headings[i]
    if (!h) continue
    
    if (!isHeadingVisible(headings, i)) continue
    
    const level = h.level
    const idx = level - 1
    if (idx >= 0 && idx < 6) {
      counters[idx] = (counters[idx] ?? 0) + 1
    }
    
    for (let j = level; j < 6; j++) {
      counters[j] = 0
    }
  }
  
  const parts: string[] = []
  for (let i = 0; i < current.level; i++) {
    const count = counters[i] ?? 0
    if (count > 0) {
      parts.push(String(count))
    }
  }
  
  return parts.join('.')
}

function scrollToHeading(id: string) {
  const element = document.getElementById(id)
  if (element) {
    element.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
}

function scrollToEditorHeading(id: string) {
  const previewPane = document.querySelector('.preview-pane')
  if (previewPane) {
    const element = previewPane.querySelector(`#${id}`)
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }
}

function generateHeadingId(text: string): string {
  return text.toLowerCase().replace(/[^\w\u4e00-\u9fa5]+/g, '-')
}

const currentWorkspace = computed(() => hermesConnectionStore.hermesStatus?.hermes_home || '')

const skillBasePath = computed(() => {
  if (props.skillPath) {
    return props.skillPath
  }
  if (props.skillCategory) {
    return `skills/${props.skillCategory}/${props.skillName}`
  }
  return `skills/${props.skillName}`
})

const pathParts = computed(() => {
  if (!currentPath.value || currentPath.value === skillBasePath.value) return []
  return currentPath.value.replace(skillBasePath.value + '/', '').split('/').filter(Boolean)
})

const directories = computed(() => entries.value.filter(e => e.type === 'directory'))
const files = computed(() => entries.value.filter(e => e.type === 'file'))

function getAuthHeaders() {
  const token = authStore.token
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  }
}

const tableColumns = computed<DataTableColumns<FileEntry>>(() => [
  {
    title: t('pages.files.columns.name'),
    key: 'name',
    render(row) {
      const icon = row.type === 'directory' ? FolderOutline : getFileIcon(row.extension || '')
      const color = row.type === 'directory' ? '#f0a020' : undefined
      return h(NSpace, { align: 'center', size: 8 }, {
        default: () => [
          h(NIcon, { component: icon, color, size: 18 }),
          h('span', { 
            style: 'cursor: pointer; font-weight: 500;', 
            onClick: () => handleRowClick(row) 
          }, row.name),
        ],
      })
    },
  },
  {
    title: t('pages.files.columns.size'),
    key: 'size',
    width: 100,
    render(row) {
      if (row.type === 'directory') return h(NText, { depth: 3 }, { default: () => '-' })
      return formatFileSize(row.size ?? 0)
    },
  },
  {
    title: t('pages.files.columns.modified'),
    key: 'modifiedAt',
    width: 160,
    render(row) {
      return row.modifiedAt ? formatRelativeTime(new Date(row.modifiedAt).getTime()) : '-'
    },
  },
  {
    title: t('pages.files.columns.type'),
    key: 'type',
    width: 100,
    render(row) {
      const typeMap: Record<string, string> = {
        directory: t('pages.files.types.directory'),
        file: t('pages.files.types.file'),
        symlink: t('pages.files.types.symlink'),
      }
      return h(NTag, { size: 'small', bordered: false, round: true, type: row.type === 'directory' ? 'warning' : 'default' }, { default: () => typeMap[row.type] || row.type })
    },
  },
  {
    title: t('pages.files.columns.actions'),
    key: 'actions',
    width: 240,
    render(row) {
      const actions: any[] = []
      
      if (row.type === 'directory') {
        actions.push(
          h(NButton, {
            size: 'tiny',
            quaternary: true,
            type: 'primary',
            onClick: () => navigateToDirectory(row.name),
          }, {
            default: () => t('pages.files.actions.open'),
          })
        )
      } else {
        const ext = row.extension?.toLowerCase() || ''
        const isImage = imgExts.includes(ext)
        const isPdf = pdfExts.includes(ext)
        
        actions.push(
          h(NButton, {
            size: 'tiny',
            quaternary: true,
            onClick: () => openPreview(row),
          }, {
            default: () => t('pages.files.actions.view'),
          })
        )
        actions.push(
          h(NButton, {
            size: 'tiny',
            quaternary: true,
            onClick: () => downloadFileDirect(row),
          }, {
            default: () => t('pages.files.actions.download'),
          })
        )
        if (!isImage && !isPdf) {
          actions.push(
            h(NButton, {
              size: 'tiny',
              quaternary: true,
              type: 'info',
              onClick: () => openEditor(row),
            }, {
              default: () => t('pages.files.actions.edit'),
            })
          )
        }
      }
      
      actions.push(
        h(NButton, {
          size: 'tiny',
          quaternary: true,
          onClick: () => openRenameModal(row),
        }, {
          default: () => t('pages.files.actions.rename'),
        })
      )
      
      actions.push(
        h(NPopconfirm, {
          onPositiveClick: () => deleteEntry(row),
        }, {
          trigger: () => h(NButton, {
            size: 'tiny',
            quaternary: true,
            type: 'error',
          }, {
            default: () => t('pages.files.actions.delete'),
          }),
          default: () => t('pages.files.deleteConfirm', { name: row.name }),
        })
      )
      
      return h(NSpace, { size: 4 }, { default: () => actions })
    },
  },
])

function getFileIcon(ext: string): any {
  const extLower = ext.toLowerCase().replace('.', '')
  if (codeExts.includes(extLower)) return CodeSlashOutline
  if (imgExts.includes(extLower)) return ImageOutline
  if (pdfExts.includes(extLower)) return DocumentTextOutline
  const videoExts = ['mp4', 'webm', 'mov', 'avi', 'mkv']
  if (videoExts.includes(extLower)) return VideocamOutline
  const audioExts = ['mp3', 'wav', 'ogg', 'flac', 'aac']
  if (audioExts.includes(extLower)) return MusicalNotesOutline
  const archiveExts = ['zip', 'tar', 'gz', 'rar', '7z']
  if (archiveExts.includes(extLower)) return ArchiveOutline
  return DocumentOutline
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

async function browsePath(path: string) {
  if (!currentWorkspace.value) {
    error.value = t('pages.files.noWorkspace')
    return
  }
  
  loading.value = true
  error.value = ''
  
  try {
    const targetPath = path || skillBasePath.value
    const url = `/api/files/list?path=${encodeURIComponent(targetPath)}&workspace=${encodeURIComponent(currentWorkspace.value)}`
    
    console.log('[SkillFileBrowser] Requesting:', url)
    
    const response = await fetch(url, {
      headers: getAuthHeaders()
    })
    
    const data = await response.json()
    
    console.log('[SkillFileBrowser] Response:', data)
    
    if (!response.ok || !data.ok) {
      throw new Error(data.error?.message || 'Failed to list files')
    }
    
    entries.value = (data.files || []).map((f: any) => ({
      name: f.name,
      path: f.path,
      type: f.type || (f.isDirectory ? 'directory' : 'file'),
      size: f.size,
      modifiedAt: f.updatedAtMs ? new Date(f.updatedAtMs).toISOString() : undefined,
      extension: f.extension,
    }))
    
    currentPath.value = data.path || targetPath
    
    console.log('[SkillFileBrowser] Loaded', entries.value.length, 'entries for path:', targetPath)
  } catch (e: any) {
    console.error('[SkillFileBrowser] browsePath error:', e)
    error.value = e?.message || t('pages.files.loadFailed')
    entries.value = []
  } finally {
    loading.value = false
  }
}

function handleRowClick(row: FileEntry) {
  if (row.type === 'directory') {
    navigateToDirectory(row.name)
  } else {
    openPreview(row)
  }
}

function navigateToDirectory(dirName: string) {
  const newPath = currentPath.value 
    ? `${currentPath.value}/${dirName}` 
    : `${skillBasePath.value}/${dirName}`
  browsePath(newPath)
}

function navigateToPath(index: number) {
  if (index === -1) {
    browsePath(skillBasePath.value)
  } else {
    const parts = pathParts.value.slice(0, index + 1)
    browsePath(`${skillBasePath.value}/${parts.join('/')}`)
  }
}

async function openPreview(file: FileEntry) {
  selectedFile.value = file
  fileLoading.value = true
  fileContent.value = ''
  imageUrl.value = null
  previewTab.value = 'preview'
  
  try {
    const response = await fetch(`/api/files/get?path=${encodeURIComponent(file.path)}&workspace=${encodeURIComponent(currentWorkspace.value)}`, {
      headers: getAuthHeaders()
    })
    
    const data = await response.json()
    
    if (!response.ok || !data.ok) {
      throw new Error(data.error?.message || 'Failed to read file')
    }
    
    fileContent.value = data.file.content || ''
    
    const ext = file.extension?.toLowerCase() || ''
    if (imgExts.includes(ext) && data.file.content) {
      imageUrl.value = `data:image/${ext};base64,${data.file.content}`
    }
    
    showPreviewModal.value = true
  } catch (e: any) {
    console.error('[SkillFileBrowser] openPreview error:', e)
    message.error(t('pages.files.readFileFailed') + ': ' + (e?.message || ''))
  } finally {
    fileLoading.value = false
  }
}

async function openEditor(file: FileEntry) {
  selectedFile.value = file
  fileLoading.value = true
  fileContent.value = ''
  editedContent.value = ''
  
  try {
    const response = await fetch(`/api/files/get?path=${encodeURIComponent(file.path)}&workspace=${encodeURIComponent(currentWorkspace.value)}`, {
      headers: getAuthHeaders()
    })
    
    const data = await response.json()
    
    if (!response.ok || !data.ok) {
      throw new Error(data.error?.message || 'Failed to read file')
    }
    
    fileContent.value = data.file.content || ''
    editedContent.value = fileContent.value
    showEditorModal.value = true
    
    await nextTick()
    if (editorTextarea.value) {
      editorTextarea.value.focus()
    }
  } catch (e: any) {
    console.error('[SkillFileBrowser] openEditor error:', e)
    message.error(t('pages.files.readFileFailed') + ': ' + (e?.message || ''))
  } finally {
    fileLoading.value = false
  }
}

async function saveFile() {
  if (!selectedFile.value) return
  
  fileLoading.value = true
  try {
    console.log('[SkillFileBrowser] Saving file:', selectedFile.value.path)
    
    const response = await fetch('/api/files/set', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        path: selectedFile.value.path,
        content: editedContent.value,
        workspace: currentWorkspace.value
      })
    })
    
    const data = await response.json()
    
    if (!response.ok || !data.ok) {
      throw new Error(data.error?.message || 'Failed to save file')
    }
    
    fileContent.value = editedContent.value
    message.success(t('pages.files.saveSuccess'))
    await browsePath(currentPath.value)
  } catch (e: any) {
    console.error('[SkillFileBrowser] saveFile error:', e)
    message.error(t('pages.files.saveFailed') + ': ' + (e?.message || ''))
  } finally {
    fileLoading.value = false
  }
}

async function downloadFileDirect(file: FileEntry) {
  try {
    const response = await fetch(`/api/files/get?path=${encodeURIComponent(file.path)}&workspace=${encodeURIComponent(currentWorkspace.value)}`, {
      headers: getAuthHeaders()
    })
    
    const data = await response.json()
    
    if (!response.ok || !data.ok) {
      throw new Error(data.error?.message || 'Failed to read file')
    }
    
    const content = data.file.content || ''
    
    if (!content) {
      message.warning(t('pages.files.noContent'))
      return
    }
    
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = file.name
    link.click()
    URL.revokeObjectURL(url)
  } catch (e: any) {
    message.error(t('pages.files.readFileFailed'))
  }
}

function downloadFile(file: FileEntry) {
  if (!fileContent.value) {
    message.warning(t('pages.files.noContent'))
    return
  }
  const blob = new Blob([fileContent.value], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = file.name
  link.click()
  URL.revokeObjectURL(url)
}

function openCreateModal(type: 'file' | 'directory') {
  createType.value = type
  createName.value = ''
  showCreateModal.value = true
}

async function createEntry() {
  if (!createName.value.trim()) return
  
  createLoading.value = true
  try {
    const name = createName.value.trim()
    const fullPath = currentPath.value ? `${currentPath.value}/${name}` : `${skillBasePath.value}/${name}`
    
    console.log('[SkillFileBrowser] Creating:', createType.value, fullPath)
    
    if (createType.value === 'file') {
      const response = await fetch('/api/files/set', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          path: fullPath,
          content: '',
          workspace: currentWorkspace.value
        })
      })
      
      const data = await response.json()
      
      if (!response.ok || !data.ok) {
        throw new Error(data.error?.message || 'Failed to create file')
      }
      
      showCreateModal.value = false
      message.success(t('pages.files.createSuccess'))
      await browsePath(currentPath.value)
    } else {
      const response = await fetch('/api/files/mkdir', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          path: fullPath,
          workspace: currentWorkspace.value
        })
      })
      
      const data = await response.json()
      
      if (!response.ok || !data.ok) {
        throw new Error(data.error?.message || 'Failed to create directory')
      }
      
      showCreateModal.value = false
      message.success(t('pages.files.createDirSuccess'))
      await browsePath(currentPath.value)
    }
  } catch (e: any) {
    console.error('[SkillFileBrowser] createEntry error:', e)
    message.error(t('pages.files.createFailed') + ': ' + (e?.message || ''))
  } finally {
    createLoading.value = false
  }
}

async function deleteEntry(file: FileEntry) {
  try {
    console.log('[SkillFileBrowser] Deleting:', file.path)
    
    const response = await fetch('/api/files/delete', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        path: file.path,
        workspace: currentWorkspace.value
      })
    })
    
    const data = await response.json()
    
    if (!response.ok || !data.ok) {
      throw new Error(data.error?.message || 'Failed to delete')
    }
    
    if (selectedFile.value?.path === file.path) {
      selectedFile.value = null
      fileContent.value = ''
    }
    message.success(t('pages.files.deleteSuccess'))
    await browsePath(currentPath.value)
  } catch (e: any) {
    console.error('[SkillFileBrowser] deleteEntry error:', e)
    message.error(t('pages.files.deleteFailed') + ': ' + (e?.message || ''))
  }
}

function openRenameModal(file: FileEntry) {
  renameTarget.value = file
  renameName.value = file.name
  showRenameModal.value = true
}

async function renameEntry() {
  if (!renameTarget.value || !renameName.value.trim()) return
  
  const newName = renameName.value.trim()
  if (newName === renameTarget.value.name) {
    showRenameModal.value = false
    return
  }
  
  renameLoading.value = true
  try {
    const oldPath = renameTarget.value.path
    const parentPath = oldPath.includes('/') ? oldPath.substring(0, oldPath.lastIndexOf('/')) : ''
    const newPath = parentPath ? `${parentPath}/${newName}` : newName
    
    console.log('[SkillFileBrowser] Renaming:', oldPath, '->', newPath)
    
    const response = await fetch('/api/files/rename', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        oldPath,
        newPath,
        workspace: currentWorkspace.value
      })
    })
    
    const data = await response.json()
    
    if (!response.ok || !data.ok) {
      throw new Error(data.error?.message || 'Failed to rename')
    }
    
    showRenameModal.value = false
    message.success(t('pages.files.renameSuccess'))
    await browsePath(currentPath.value)
  } catch (e: any) {
    console.error('[SkillFileBrowser] renameEntry error:', e)
    message.error(t('pages.files.renameFailed') + ': ' + (e?.message || ''))
  } finally {
    renameLoading.value = false
  }
}

async function handleUpload({ file, onFinish, onError }: { file: UploadFileInfo, onFinish: () => void, onError: (error: Error) => void }) {
  if (!file.file) {
    onError(new Error('No file'))
    return
  }
  
  uploadLoading.value = true
  try {
    const fullPath = currentPath.value ? `${currentPath.value}/${file.name}` : `${skillBasePath.value}/${file.name}`
    
    console.log('[SkillFileBrowser] Uploading:', fullPath, 'size:', file.file.size)
    
    const formData = new FormData()
    formData.append('file', file.file)
    formData.append('path', fullPath)
    formData.append('workspace', currentWorkspace.value || '')
    
    const token = authStore.token
    const response = await fetch('/api/files/upload', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`
      },
      body: formData
    })
    
    const data = await response.json()
    
    if (!response.ok || !data.ok) {
      throw new Error(data.error?.message || 'Failed to upload file')
    }
    
    message.success(t('pages.files.uploadSuccess'))
    await browsePath(currentPath.value)
    onFinish()
  } catch (e: any) {
    console.error('[SkillFileBrowser] handleUpload error:', e)
    message.error(t('pages.files.uploadFailed') + ': ' + (e?.message || ''))
    onError(e)
  } finally {
    uploadLoading.value = false
  }
}

function renderMarkdown(content: string): string {
  return renderSimpleMarkdown(content, {
    imageBasePath: selectedFile.value?.path,
    workspace: currentWorkspace.value || undefined,
    authToken: authStore.token || undefined,
  })
}

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

function insertText(before: string, after: string = '') {
  if (!editorTextarea.value) return
  
  const textarea = editorTextarea.value
  const start = textarea.selectionStart
  const end = textarea.selectionEnd
  const selectedText = editedContent.value.substring(start, end)
  const newText = before + selectedText + after
  
  editedContent.value = 
    editedContent.value.substring(0, start) + 
    newText + 
    editedContent.value.substring(end)
  
  nextTick(() => {
    textarea.focus()
    const newCursorPos = start + before.length + selectedText.length
    textarea.setSelectionRange(newCursorPos, newCursorPos)
  })
}

function insertHeading(level: number) {
  const prefix = '#'.repeat(level) + ' '
  insertText(prefix)
}

function insertBold() {
  insertText('**', '**')
}

function insertItalic() {
  insertText('*', '*')
}

function insertStrikethrough() {
  insertText('~~', '~~')
}

function insertCode() {
  insertText('`', '`')
}

function insertCodeBlock() {
  insertText('\n```\n', '\n```\n')
}

function insertLink() {
  insertText('[', '](url)')
}

function insertImage() {
  insertText('![alt](', ')')
}

function insertQuote() {
  insertText('\n> ')
}

function insertUl() {
  insertText('\n- ')
}

function insertOl() {
  insertText('\n1. ')
}

function insertHr() {
  insertText('\n\n---\n\n')
}

function insertTable() {
  const table = `
| Header 1 | Header 2 | Header 3 |
|----------|----------|----------|
| Cell 1   | Cell 2   | Cell 3   |
| Cell 4   | Cell 5   | Cell 6   |
`
  insertText(table)
}

const imageUploading = ref(false)

async function handleEditorPaste(event: ClipboardEvent) {
  const items = event.clipboardData?.items
  if (!items) return
  
  const imageItems = Array.from(items).filter(item => item.type.startsWith('image/'))
  if (imageItems.length === 0) return
  
  event.preventDefault()
  
  for (const item of imageItems) {
    const file = item.getAsFile()
    if (!file) continue
    
    await uploadPastedImage(file)
  }
}

async function uploadPastedImage(file: File) {
  if (!currentWorkspace.value || !selectedFile.value) {
    message.error(t('pages.files.uploadFailed') + ': No workspace selected')
    return
  }
  
  imageUploading.value = true
  
  try {
    const mdFilePath = selectedFile.value.path || ''
    const mdFileDir = mdFilePath.includes('/') ? mdFilePath.substring(0, mdFilePath.lastIndexOf('/')) : ''
    
    const imagesDir = mdFileDir ? `${mdFileDir}/images` : `${skillBasePath.value}/images`
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const ext = file.name.split('.').pop() || 'png'
    const fileName = `image-${timestamp}.${ext}`
    const imagePath = `${imagesDir}/${fileName}`
    
    const formData = new FormData()
    formData.append('file', file)
    formData.append('path', imagePath)
    formData.append('workspace', currentWorkspace.value)
    
    const token = authStore.token
    const response = await fetch('/api/files/upload', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`
      },
      body: formData
    })
    
    const data = await response.json()
    
    if (!response.ok || !data.ok) {
      throw new Error(data.error?.message || 'Failed to upload image')
    }
    
    const relativePath = `./images/${fileName}`
    const markdownImage = `![${file.name.replace(/\.[^/.]+$/, '')}](${relativePath})`
    
    insertText(markdownImage)
    
    message.success(t('pages.files.imageUploadSuccess'))
  } catch (e: any) {
    console.error('[SkillFileBrowser] uploadPastedImage error:', e)
    message.error(t('pages.files.uploadFailed') + ': ' + (e?.message || ''))
  } finally {
    imageUploading.value = false
  }
}

async function openAutoFile() {
  if (!props.autoOpenFile) return
  
  const filePath = `${skillBasePath.value}/${props.autoOpenFile}`
  
  try {
    const response = await fetch(`/api/files/get?path=${encodeURIComponent(filePath)}&workspace=${encodeURIComponent(currentWorkspace.value)}`, {
      headers: getAuthHeaders()
    })
    
    const data = await response.json()
    
    if (!response.ok || !data.ok) {
      console.log('[SkillFileBrowser] Auto-open file not found:', filePath)
      return
    }
    
    const file: FileEntry = {
      name: props.autoOpenFile,
      path: filePath,
      type: 'file',
      extension: props.autoOpenFile.split('.').pop(),
    }
    
    openPreview(file)
  } catch (e: any) {
    console.log('[SkillFileBrowser] Auto-open file error:', e)
  }
}

async function initialize() {
  if (!hermesConnectionStore.hermesConnected) {
    await hermesConnectionStore.connect()
  }
  
  if (currentWorkspace.value) {
    await browsePath(skillBasePath.value)
    if (props.autoOpenFile) {
      await openAutoFile()
    }
  }
}

watch(() => props.skillName, () => {
  if (props.skillName) {
    initialize()
  }
})

onMounted(() => {
  document.addEventListener('click', handleCodeCopy)
  initialize()
})

onUnmounted(() => {
  document.removeEventListener('click', handleCodeCopy)
})
</script>

<template>
  <div class="skill-file-browser">
    <div class="browser-header">
      <NSpace :size="12" align="center">
        <NIcon :component="FolderOutline" size="20" color="#f0a020" />
        <NText strong style="font-size: 15px;">{{ skillName }}</NText>
        <NTag size="small" :bordered="false" type="info">
          {{ t('pages.hermesSkills.skillFiles') }}
        </NTag>
      </NSpace>
      <NSpace :size="8">
        <NButton size="small" :loading="loading" @click="browsePath(currentPath || skillBasePath)">
          <template #icon><NIcon :component="RefreshOutline" /></template>
          {{ t('common.refresh') }}
        </NButton>
        <NButton size="small" @click="emit('close')">
          <template #icon><NIcon :component="CloseOutline" /></template>
          {{ t('common.close') }}
        </NButton>
      </NSpace>
    </div>

    <NAlert v-if="error" type="error" :bordered="false" style="margin-bottom: 12px;">
      {{ error }}
    </NAlert>

    <div class="files-toolbar">
      <NSpace :size="12" align="center">
        <NBreadcrumb>
          <NBreadcrumbItem @click="navigateToPath(-1)">
            <NIcon :component="HomeOutline" />
          </NBreadcrumbItem>
          <NBreadcrumbItem @click="navigateToPath(-1)">
            {{ skillName }}
          </NBreadcrumbItem>
          <NBreadcrumbItem v-for="(part, index) in pathParts" :key="index" @click="navigateToPath(index)">
            {{ part }}
          </NBreadcrumbItem>
        </NBreadcrumb>
      </NSpace>
      
      <NSpace :size="8">
        <NButton size="small" @click="openCreateModal('directory')" :disabled="!currentWorkspace">
          <template #icon><NIcon :component="AddOutline" /></template>
          {{ t('pages.files.actions.newFolder') }}
        </NButton>
        <NButton size="small" @click="openCreateModal('file')" :disabled="!currentWorkspace">
          <template #icon><NIcon :component="AddOutline" /></template>
          {{ t('pages.files.actions.newFile') }}
        </NButton>
        <NUpload
          :show-file-list="false"
          :custom-request="handleUpload"
          :disabled="uploadLoading || !currentWorkspace"
        >
          <NButton size="small" :loading="uploadLoading" :disabled="!currentWorkspace">
            <template #icon><NIcon :component="CloudUploadOutline" /></template>
            {{ t('pages.files.actions.upload') }}
          </NButton>
        </NUpload>
      </NSpace>
    </div>

    <div class="files-stats">
      <NTag size="small" :bordered="false">
        {{ directories.length }} {{ t('pages.files.types.directory') }}
      </NTag>
      <NTag size="small" :bordered="false" type="info">
        {{ files.length }} {{ t('pages.files.types.file') }}
      </NTag>
    </div>

    <NSpin :show="loading">
      <NDataTable
        v-if="entries.length > 0"
        :columns="tableColumns"
        :data="entries"
        :bordered="false"
        :single-line="false"
        size="small"
        :max-height="400"
        virtual-scroll
        :row-key="(row: FileEntry) => row.path"
      />
      <NEmpty v-else-if="!currentWorkspace" :description="t('pages.files.selectAgentFirst')" style="padding: 48px 0;" />
      <div v-else class="skill-empty-state">
        <NEmpty :description="t('pages.hermesSkills.skillDirEmpty')" style="padding: 24px 0;" />
        <NSpace vertical :size="12" align="center">
          <NText depth="3" style="font-size: 13px;">
            {{ t('pages.hermesSkills.skillDirHint') }}
          </NText>
          <NButton size="small" @click="browsePath('skills')">
            <template #icon><NIcon :component="FolderOutline" /></template>
            {{ t('pages.hermesSkills.browseSkillsDir') }}
          </NButton>
        </NSpace>
      </div>
    </NSpin>

    <NModal 
      v-model:show="showPreviewModal" 
      preset="card" 
      :style="isPreviewMaximized ? 'width: 100vw; height: 100vh; max-width: 100vw; top: 0; left: 0; margin: 0;' : 'width: 90%; max-width: 1200px;'" 
      :content-style="isPreviewMaximized ? 'height: calc(100vh - 80px); overflow: hidden;' : ''"
      :title="selectedFile?.name || t('pages.files.preview')"
      :closable="!isPreviewMaximized"
      :mask-closable="!isPreviewMaximized"
    >
      <template #header-extra>
        <NSpace :size="8">
          <NButton size="small" quaternary @click="isPreviewMaximized = !isPreviewMaximized">
            <template #icon><NIcon :component="isPreviewMaximized ? ContractOutline : ExpandOutline" /></template>
            {{ isPreviewMaximized ? t('pages.files.actions.exitFullscreen') : t('pages.files.actions.fullscreen') }}
          </NButton>
          <NButton size="small" quaternary @click="downloadFile(selectedFile!)">
            <template #icon><NIcon :component="CloudDownloadOutline" /></template>
            {{ t('pages.files.actions.download') }}
          </NButton>
          <NButton v-if="!isImageFile && !isPdfFile" size="small" type="primary" @click="showPreviewModal = false; openEditor(selectedFile!)">
            <template #icon><NIcon :component="CreateOutline" /></template>
            {{ t('pages.files.actions.edit') }}
          </NButton>
        </NSpace>
      </template>
      
      <NSpin :show="fileLoading">
        <div v-if="isImageFile && imageUrl" class="preview-image">
          <NImage 
            :src="imageUrl" 
            object-fit="contain"
            :img-props="{ style: 'max-width: 100%; max-height: 100%; object-fit: contain;' }"
          />
        </div>
        
        <PdfViewer
          v-else-if="isPdfFile && pdfUrl"
          :url="pdfUrl"
          :auth-token="authStore.token || undefined"
          :fullscreen="isPreviewMaximized"
          @toggle-fullscreen="isPreviewMaximized = !isPreviewMaximized"
        />
        
        <template v-else-if="isMarkdownFile">
          <div class="markdown-container" :class="{ 'markdown-container--full': isPreviewMaximized }">
            <div class="markdown-content" :class="{ 'markdown-content--full': !tocHeadings.length }">
              <NTabs v-model:value="previewTab" type="line">
                <NTabPane name="preview" :tab="t('pages.files.preview')">
                  <div class="markdown-preview" :class="{ 'markdown-preview--full': isPreviewMaximized }" v-html="renderMarkdown(fileContent)"></div>
                </NTabPane>
                <NTabPane name="source" :tab="t('pages.files.source')">
                  <pre class="code-preview">{{ fileContent }}</pre>
                </NTabPane>
              </NTabs>
            </div>
            <div v-if="tocHeadings.length > 0 && previewTab === 'preview'" class="markdown-toc" :class="isPreviewMaximized ? 'markdown-toc--preview-full' : 'markdown-toc--preview'">
              <div class="toc-title">{{ t('pages.files.toc') }}</div>
              <div class="toc-list">
                <template v-for="(heading, index) in tocHeadings" :key="heading.id">
                  <div
                    v-if="isHeadingVisible(tocHeadings, index)"
                    class="toc-item"
                    :class="['toc-item--level-' + heading.level, { 'toc-item--has-children': hasVisibleChildren(tocHeadings, index, heading.level) }]"
                  >
                    <span class="toc-number">{{ getTocNumber(tocHeadings, index) }}</span>
                    <span class="toc-text" @click="scrollToHeading(heading.id)">{{ heading.text }}</span>
                    <span
                      v-if="hasVisibleChildren(tocHeadings, index, heading.level)"
                      class="toc-toggle"
                      @click.stop="toggleTocExpand(heading)"
                    >
                      <NIcon size="14" :component="isTocExpanded(heading) ? ChevronDownOutline : ChevronForwardOutline" />
                    </span>
                  </div>
                </template>
              </div>
            </div>
          </div>
        </template>
        
        <pre v-else-if="isCodeFile || fileContent" class="code-preview">{{ fileContent }}</pre>
        
        <NEmpty v-else :description="t('pages.files.noPreview')" />
      </NSpin>
    </NModal>

    <NModal 
      v-model:show="showEditorModal" 
      preset="card" 
      :style="isEditorMaximized ? 'width: 100vw; height: 100vh; max-width: 100vw; top: 0; left: 0; margin: 0;' : 'width: 95%; max-width: 1400px; height: 90vh;'" 
      :content-style="isEditorMaximized ? 'height: calc(100vh - 80px); overflow: hidden;' : ''"
      :title="selectedFile?.name || t('pages.files.editor.title')"
      :closable="!isEditorMaximized"
      :mask-closable="!isEditorMaximized"
    >
      <template #header-extra>
        <NSpace :size="8">
          <NButton size="small" quaternary @click="isEditorMaximized = !isEditorMaximized">
            <template #icon><NIcon :component="isEditorMaximized ? ContractOutline : ExpandOutline" /></template>
            {{ isEditorMaximized ? t('pages.files.actions.exitFullscreen') : t('pages.files.actions.fullscreen') }}
          </NButton>
          <NButton size="small" type="primary" :loading="fileLoading" @click="saveFile">
            {{ t('pages.files.actions.save') }}
          </NButton>
          <NButton size="small" @click="showEditorModal = false">
            {{ t('common.cancel') }}
          </NButton>
        </NSpace>
      </template>
      
      <div class="editor-container" :class="{ 'editor-container--fullscreen': isEditorMaximized }">
        <div class="editor-toolbar">
          <div class="toolbar-group">
            <NTooltip trigger="hover">
              <template #trigger>
                <NButton size="tiny" quaternary @click="insertHeading(1)">H1</NButton>
              </template>
              {{ t('pages.files.editor.heading1') }}
            </NTooltip>
            <NTooltip trigger="hover">
              <template #trigger>
                <NButton size="tiny" quaternary @click="insertHeading(2)">H2</NButton>
              </template>
              {{ t('pages.files.editor.heading2') }}
            </NTooltip>
            <NTooltip trigger="hover">
              <template #trigger>
                <NButton size="tiny" quaternary @click="insertHeading(3)">H3</NButton>
              </template>
              {{ t('pages.files.editor.heading3') }}
            </NTooltip>
          </div>
          
          <div class="toolbar-divider"></div>
          
          <div class="toolbar-group">
            <NTooltip trigger="hover">
              <template #trigger>
                <NButton size="tiny" quaternary @click="insertBold">
                  <template #icon><NIcon :component="TextOutline" /></template>
                  <span style="font-weight: bold;">B</span>
                </NButton>
              </template>
              {{ t('pages.files.editor.bold') }}
            </NTooltip>
            <NTooltip trigger="hover">
              <template #trigger>
                <NButton size="tiny" quaternary @click="insertItalic">
                  <template #icon><NIcon :component="TextOutline" /></template>
                  <span style="font-style: italic;">I</span>
                </NButton>
              </template>
              {{ t('pages.files.editor.italic') }}
            </NTooltip>
            <NTooltip trigger="hover">
              <template #trigger>
                <NButton size="tiny" quaternary @click="insertStrikethrough">
                  <template #icon><NIcon :component="TextOutline" /></template>
                  <span style="text-decoration: line-through;">S</span>
                </NButton>
              </template>
              {{ t('pages.files.editor.strikethrough') }}
            </NTooltip>
          </div>
          
          <div class="toolbar-divider"></div>
          
          <div class="toolbar-group">
            <NTooltip trigger="hover">
              <template #trigger>
                <NButton size="tiny" quaternary @click="insertCode">
                  <template #icon><NIcon :component="CodeOutline" /></template>
                </NButton>
              </template>
              {{ t('pages.files.editor.inlineCode') }}
            </NTooltip>
            <NTooltip trigger="hover">
              <template #trigger>
                <NButton size="tiny" quaternary @click="insertCodeBlock">
                  <template #icon><NIcon :component="CodeSlashOutline" /></template>
                </NButton>
              </template>
              {{ t('pages.files.editor.codeBlock') }}
            </NTooltip>
          </div>
          
          <div class="toolbar-divider"></div>
          
          <div class="toolbar-group">
            <NTooltip trigger="hover">
              <template #trigger>
                <NButton size="tiny" quaternary @click="insertLink">
                  <template #icon><NIcon :component="LinkOutline" /></template>
                </NButton>
              </template>
              {{ t('pages.files.editor.link') }}
            </NTooltip>
            <NTooltip trigger="hover">
              <template #trigger>
                <NButton size="tiny" quaternary @click="insertImage">
                  <template #icon><NIcon :component="ImageIconOutline" /></template>
                </NButton>
              </template>
              {{ t('pages.files.editor.image') }}
            </NTooltip>
          </div>
          
          <div class="toolbar-divider"></div>
          
          <div class="toolbar-group">
            <NTooltip trigger="hover">
              <template #trigger>
                <NButton size="tiny" quaternary @click="insertQuote">
                  <template #icon><NIcon :component="ChatboxEllipsesOutline" /></template>
                </NButton>
              </template>
              {{ t('pages.files.editor.quote') }}
            </NTooltip>
            <NTooltip trigger="hover">
              <template #trigger>
                <NButton size="tiny" quaternary @click="insertUl">
                  <template #icon><NIcon :component="ListOutline" /></template>
                </NButton>
              </template>
              {{ t('pages.files.editor.unorderedList') }}
            </NTooltip>
            <NTooltip trigger="hover">
              <template #trigger>
                <NButton size="tiny" quaternary @click="insertOl">
                  <template #icon><NIcon :component="ReorderFourOutline" /></template>
                </NButton>
              </template>
              {{ t('pages.files.editor.orderedList') }}
            </NTooltip>
          </div>
          
          <div class="toolbar-divider"></div>
          
          <div class="toolbar-group">
            <NTooltip trigger="hover">
              <template #trigger>
                <NButton size="tiny" quaternary @click="insertHr">
                  <template #icon><NIcon :component="RemoveOutline" /></template>
                </NButton>
              </template>
              {{ t('pages.files.editor.horizontalRule') }}
            </NTooltip>
            <NTooltip trigger="hover">
              <template #trigger>
                <NButton size="tiny" quaternary @click="insertTable">
                  <template #icon><NIcon :component="AddCircleOutline" /></template>
                </NButton>
              </template>
              {{ t('pages.files.editor.table') }}
            </NTooltip>
          </div>
        </div>
        
        <div class="editor-content">
          <div class="editor-pane">
            <textarea
              ref="editorTextarea"
              v-model="editedContent"
              class="full-editor"
              :placeholder="t('pages.files.editPlaceholder')"
              @paste="handleEditorPaste"
            />
          </div>
          <div v-if="isMarkdownFile" class="preview-pane-wrapper">
            <div class="preview-pane">
              <div class="markdown-preview markdown-preview--full" v-html="renderMarkdown(editedContent)"></div>
            </div>
            <div v-if="editorTocHeadings.length > 0" class="markdown-toc" :class="isEditorMaximized ? 'markdown-toc--editor-full' : 'markdown-toc--editor'">
              <div class="toc-title">{{ t('pages.files.toc') }}</div>
              <div class="toc-list">
                <template v-for="(heading, index) in editorTocHeadings" :key="heading.id">
                  <div
                    v-if="isHeadingVisible(editorTocHeadings, index)"
                    class="toc-item"
                    :class="['toc-item--level-' + heading.level, { 'toc-item--has-children': hasVisibleChildren(editorTocHeadings, index, heading.level) }]"
                  >
                    <span class="toc-number">{{ getTocNumber(editorTocHeadings, index) }}</span>
                    <span class="toc-text" @click="scrollToEditorHeading(heading.id)">{{ heading.text }}</span>
                    <span
                      v-if="hasVisibleChildren(editorTocHeadings, index, heading.level)"
                      class="toc-toggle"
                      @click.stop="toggleTocExpand(heading)"
                    >
                      <NIcon size="14" :component="isTocExpanded(heading) ? ChevronDownOutline : ChevronForwardOutline" />
                    </span>
                  </div>
                </template>
              </div>
            </div>
          </div>
        </div>
      </div>
    </NModal>

    <NModal v-model:show="showCreateModal" preset="dialog" :title="createType === 'file' ? t('pages.files.createFile') : t('pages.files.createFolder')">
      <NForm @submit.prevent="createEntry">
        <NFormItem :label="createType === 'file' ? t('pages.files.fileName') : t('pages.files.folderName')">
          <NInput v-model:value="createName" :placeholder="t('pages.files.namePlaceholder')" @keyup.enter="createEntry" />
        </NFormItem>
      </NForm>
      <template #action>
        <NSpace>
          <NButton @click="showCreateModal = false">{{ t('common.cancel') }}</NButton>
          <NButton type="primary" :loading="createLoading" :disabled="!createName.trim()" @click="createEntry">
            {{ t('common.create') }}
          </NButton>
        </NSpace>
      </template>
    </NModal>

    <NModal v-model:show="showRenameModal" preset="dialog" :title="t('pages.files.actions.rename')">
      <NForm @submit.prevent="renameEntry">
        <NFormItem :label="t('pages.files.fileName')">
          <NInput v-model:value="renameName" :placeholder="t('pages.files.namePlaceholder')" @keyup.enter="renameEntry" />
        </NFormItem>
      </NForm>
      <template #action>
        <NSpace>
          <NButton @click="showRenameModal = false">{{ t('common.cancel') }}</NButton>
          <NButton type="primary" :loading="renameLoading" :disabled="!renameName.trim()" @click="renameEntry">
            {{ t('common.confirm') }}
          </NButton>
        </NSpace>
      </template>
    </NModal>
  </div>
</template>

<style scoped>
.skill-file-browser {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  background: var(--bg-card);
  border-radius: 12px;
  border: 1px solid var(--border-color);
  margin-top: 8px;
}

.browser-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border-color);
}

.files-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background: var(--bg-secondary);
  border-radius: var(--radius);
}

.skill-empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 24px;
  background: var(--bg-secondary);
  border-radius: var(--radius);
}

.files-stats {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}

.preview-image {
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 24px;
  background: var(--bg-secondary);
  border-radius: var(--radius);
  min-height: 200px;
  max-height: 500px;
  overflow: hidden;
}

.preview-image :deep(.n-image) {
  max-width: 100%;
  max-height: 100%;
}

.preview-image :deep(.n-image img) {
  max-width: 100%;
  max-height: 452px;
  object-fit: contain;
}

.code-preview {
  margin: 0;
  padding: 16px;
  background: var(--bg-secondary);
  border-radius: var(--radius);
  font-family: 'SF Mono', 'Menlo', 'Monaco', 'Consolas', monospace;
  font-size: 13px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 500px;
  overflow: auto;
}

.markdown-container {
  display: flex;
  gap: 16px;
  min-height: 200px;
  max-height: 70vh;
}

.markdown-container--full {
  max-height: calc(100vh - 100px);
  height: calc(100vh - 100px);
}

.markdown-content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.markdown-content--full {
  width: 100%;
}

.markdown-content .n-tabs {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.markdown-content :deep(.n-tabs-pane-wrapper) {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.markdown-content :deep(.n-tab-pane) {
  height: 100%;
  overflow: hidden;
}

.markdown-toc {
  width: 220px;
  flex-shrink: 0;
  background: var(--bg-secondary);
  border-radius: var(--radius);
  padding: 12px;
  overflow-y: auto;
  box-sizing: border-box;
}

.markdown-toc--preview {
  margin-top: 40px;
  max-height: calc(70vh - 40px);
}

.markdown-toc--preview-full {
  margin-top: 40px;
  height: calc(100% - 40px);
  max-height: calc(100vh - 140px);
}

.markdown-toc--editor {
  max-height: none;
}

.markdown-toc--editor-full {
  max-height: none;
}

.toc-title {
  font-weight: 600;
  font-size: 13px;
  margin-bottom: 12px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--border-color);
  color: var(--text-primary);
  letter-spacing: 0.5px;
  text-transform: uppercase;
}

.toc-list {
  display: flex;
  flex-direction: column;
}

.toc-item {
  font-size: 13px;
  color: var(--text-secondary);
  cursor: pointer;
  padding: 6px 8px;
  border-radius: 6px;
  transition: all 0.15s ease;
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 1px 0;
  position: relative;
}

.toc-item:hover {
  background: rgba(var(--primary-color-rgb, 59, 130, 246), 0.08);
  color: var(--text-primary);
}

.toc-item:hover .toc-number {
  color: var(--link-color);
}

.toc-number {
  color: var(--text-tertiary);
  font-size: 11px;
  font-weight: 500;
  min-width: 20px;
  flex-shrink: 0;
  transition: color 0.15s ease;
}

.toc-text {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 1.4;
}

.toc-toggle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  flex-shrink: 0;
  cursor: pointer;
  border-radius: 4px;
  margin-left: auto;
  color: var(--text-tertiary);
  transition: all 0.15s ease;
  opacity: 0.5;
}

.toc-item:hover .toc-toggle {
  opacity: 1;
}

.toc-toggle:hover {
  background: rgba(var(--primary-color-rgb, 59, 130, 246), 0.15);
  color: var(--link-color);
}

.toc-item--level-1 { 
  font-weight: 600;
  margin-top: 4px;
}
.toc-item--level-1:first-child { 
  margin-top: 0;
}

.toc-item--level-2 { 
  padding-left: 20px;
}

.toc-item--level-3 { 
  padding-left: 36px;
  font-size: 12px;
}

.toc-item--level-4 { 
  padding-left: 52px;
  font-size: 12px;
  color: var(--text-tertiary);
}

.toc-item--level-5 { 
  padding-left: 68px;
  font-size: 11px;
  color: var(--text-tertiary);
}

.toc-item--level-6 { 
  padding-left: 84px;
  font-size: 11px;
  color: var(--text-tertiary);
}

.markdown-preview {
  padding: 16px;
  background: var(--bg-secondary);
  border-radius: var(--radius);
  overflow: auto;
  max-height: 70vh;
  box-sizing: border-box;
}

.markdown-preview--full {
  max-height: calc(100vh - 150px);
  height: 100%;
}

.markdown-preview :deep(h1),
.markdown-preview :deep(h2),
.markdown-preview :deep(h3),
.markdown-preview :deep(h4),
.markdown-preview :deep(h5),
.markdown-preview :deep(h6) {
  margin: 16px 0 8px 0;
  font-weight: 600;
  color: var(--text-primary);
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.markdown-preview :deep(h1::before),
.markdown-preview :deep(h2::before),
.markdown-preview :deep(h3::before),
.markdown-preview :deep(h4::before),
.markdown-preview :deep(h5::before),
.markdown-preview :deep(h6::before) {
  content: attr(data-heading-number);
  color: var(--text-tertiary);
  font-weight: 500;
  font-size: 0.85em;
  flex-shrink: 0;
}

.markdown-preview :deep(h1) { font-size: 1.75em; }
.markdown-preview :deep(h2) { font-size: 1.5em; }
.markdown-preview :deep(h3) { font-size: 1.25em; }
.markdown-preview :deep(h4) { font-size: 1.1em; }
.markdown-preview :deep(h5) { font-size: 1em; }
.markdown-preview :deep(h6) { font-size: 0.95em; }

.markdown-preview :deep(p) {
  margin: 8px 0;
  line-height: 1.7;
}

.markdown-preview :deep(ul),
.markdown-preview :deep(ol) {
  margin: 8px 0;
  padding-left: 24px;
}

.markdown-preview :deep(li) {
  margin: 4px 0;
}

.markdown-preview :deep(code) {
  padding: 2px 6px;
  background: var(--bg-primary);
  border-radius: 4px;
  font-family: 'SF Mono', 'Menlo', 'Monaco', monospace;
  font-size: 0.9em;
}

.markdown-preview :deep(pre) {
  margin: 12px 0;
  background: var(--bg-primary);
  border-radius: var(--radius);
  overflow: hidden;
}

.markdown-preview :deep(pre code) {
  padding: 0;
  background: transparent;
}

.markdown-preview :deep(.code-block-container) {
  display: flex;
  position: relative;
  margin: 12px 0;
  background: var(--bg-primary);
  border-radius: var(--radius);
  overflow-x: auto;
}

.markdown-preview :deep(.code-line-numbers) {
  display: flex;
  flex-direction: column;
  padding: 12px 8px;
  background: var(--bg-secondary);
  border-right: 1px solid var(--border-color);
  text-align: right;
  user-select: none;
  min-width: 40px;
}

.markdown-preview :deep(.line-number) {
  font-family: 'SF Mono', 'Menlo', 'Monaco', 'Consolas', monospace;
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-tertiary);
  padding: 0 4px;
}

.markdown-preview :deep(.code-content) {
  flex: 1;
  padding: 12px;
  overflow-x: auto;
  min-width: 0;
}

.markdown-preview :deep(.code-content code) {
  padding: 0;
  background: transparent;
  display: block;
  font-family: 'SF Mono', 'Menlo', 'Monaco', 'Consolas', monospace;
  font-size: 13px;
  line-height: 1.6;
  white-space: pre;
}

.markdown-preview :deep(.code-block-wrapper) {
  position: relative;
  margin: 12px 0;
  padding: 12px;
  background: var(--bg-primary);
  border-radius: var(--radius);
  overflow-x: auto;
}

.markdown-preview :deep(.code-block-wrapper code) {
  padding: 0;
  background: transparent;
  display: block;
}

.markdown-preview :deep(.code-copy-btn) {
  position: absolute;
  top: 8px;
  right: 8px;
  padding: 4px 8px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary);
  z-index: 10;
}

.markdown-preview :deep(.code-block-container:hover .code-copy-btn) {
  opacity: 1;
}

.markdown-preview :deep(.code-copy-btn:hover) {
  background: var(--bg-primary);
  color: var(--link-color);
}
.markdown-preview :deep(.code-copy-btn.copied) {
  color: var(--success-color);
}

.markdown-preview :deep(.katex-display) {
  display: block;
  margin: 16px 0;
  overflow-x: auto;
  overflow-y: hidden;
  text-align: center;
  padding: 8px 0;
}

.markdown-preview :deep(.katex-display > .katex) {
  display: inline-block;
  text-align: center;
  white-space: normal;
}

.markdown-preview :deep(.katex) {
  font-size: 1.1em;
}

.markdown-preview :deep(.katex-inline) {
  padding: 0 2px;
}

.markdown-preview :deep(blockquote) {
  margin: 12px 0;
  padding: 8px 16px;
  border-left: 4px solid var(--border-color);
  background: var(--bg-primary);
}

.markdown-preview :deep(a) {
  color: var(--link-color);
  text-decoration: none;
}

.markdown-preview :deep(a:hover) {
  text-decoration: underline;
}

.markdown-preview :deep(table) {
  width: 100%;
  border-collapse: collapse;
  margin: 12px 0;
}

.markdown-preview :deep(th),
.markdown-preview :deep(td) {
  padding: 8px 12px;
  border: 1px solid var(--border-color);
  text-align: left;
}

.markdown-preview :deep(th) {
  background: var(--bg-primary);
  font-weight: 600;
}

.markdown-preview :deep(img) {
  max-width: 100%;
  height: auto;
  border-radius: var(--radius);
  margin: 8px 0;
}

.markdown-preview :deep(hr) {
  border: none;
  border-top: 1px solid var(--border-color);
  margin: 16px 0;
}

.markdown-preview :deep(del) {
  color: var(--text-tertiary);
  text-decoration: line-through;
}

.markdown-preview :deep(mark) {
  background: rgba(255, 200, 0, 0.3);
  padding: 1px 4px;
  border-radius: 2px;
}

.markdown-preview :deep(strong) {
  font-weight: 600;
}

.markdown-preview :deep(em) {
  font-style: italic;
}

.markdown-preview :deep(sup) {
  font-size: 0.75em;
  vertical-align: super;
  line-height: 0;
}

.markdown-preview :deep(sub) {
  font-size: 0.75em;
  vertical-align: sub;
  line-height: 0;
}

.markdown-preview :deep(details) {
  margin: 8px 0;
  padding: 8px 12px;
  background: var(--bg-primary);
  border-radius: var(--radius);
  border: 1px solid var(--border-color);
}

.markdown-preview :deep(summary) {
  cursor: pointer;
  font-weight: 500;
  outline: none;
}

.markdown-preview :deep(summary:hover) {
  color: var(--link-color);
}

.markdown-preview :deep(dl) {
  margin: 12px 0;
}

.markdown-preview :deep(dt) {
  font-weight: 600;
  margin-top: 8px;
}

.markdown-preview :deep(dd) {
  margin-left: 24px;
  color: var(--text-secondary);
}

.markdown-preview :deep(figure) {
  margin: 12px 0;
  text-align: center;
}

.markdown-preview :deep(figcaption) {
  font-size: 0.9em;
  color: var(--text-tertiary);
  margin-top: 4px;
}

.markdown-preview :deep(abbr[title]) {
  text-decoration: underline dotted;
  cursor: help;
}

.markdown-preview :deep(kbd) {
  display: inline-block;
  padding: 2px 6px;
  font-family: 'SF Mono', 'Menlo', 'Monaco', monospace;
  font-size: 0.85em;
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  box-shadow: inset 0 -1px 0 var(--border-color);
}

.editor-container {
  height: calc(90vh - 120px);
  display: flex;
  flex-direction: column;
}

.editor-container--fullscreen {
  height: calc(100vh - 100px);
}

.editor-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 8px 12px;
  background: var(--bg-secondary);
  border-radius: var(--radius);
  margin-bottom: 12px;
}

.toolbar-group {
  display: flex;
  gap: 2px;
}

.toolbar-divider {
  width: 1px;
  background: var(--border-color);
  margin: 0 8px;
}

.editor-content {
  flex: 1;
  display: flex;
  gap: 12px;
  min-height: 0;
  overflow: hidden;
}

.editor-pane {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.preview-pane-wrapper {
  flex: 1;
  display: flex;
  gap: 12px;
  min-width: 0;
  border-left: 1px solid var(--border-color);
  padding-left: 12px;
  min-height: 0;
  overflow: hidden;
  align-items: stretch;
}

.preview-pane {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.preview-pane .markdown-preview {
  flex: 1;
  overflow: auto;
  min-height: 0;
}

.preview-pane-wrapper .markdown-toc {
  flex-shrink: 0;
  align-self: stretch;
}

.full-editor {
  width: 100%;
  flex: 1;
  min-height: 0;
  padding: 16px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius);
  font-family: 'SF Mono', 'Menlo', 'Monaco', 'Consolas', monospace;
  font-size: 13px;
  line-height: 1.6;
  resize: none;
  outline: none;
  box-sizing: border-box;
  color: var(--text-primary);
}

.full-editor:focus {
  border-color: var(--link-color);
}
</style>

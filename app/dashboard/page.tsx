'use client'

import { useMemo, useState } from 'react'

type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE'

type LogEntry = {
  time: string
  label: string
  method: HttpMethod
  url: string
  status?: number
  ok?: boolean
  payload?: unknown
  error?: string
}

function pretty(value: unknown) {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

export default function DashboardPage() {
  const [projectName, setProjectName] = useState('Demo Project')
  const [projectDescription, setProjectDescription] = useState('Temporary testing project')
  const [projectId, setProjectId] = useState('')

  const [fileId, setFileId] = useState('')
  const [filePath, setFilePath] = useState('src/index.ts')
  const [fileContent, setFileContent] = useState('console.log("hello from test harness")')
  const [updatedPath, setUpdatedPath] = useState('src/main.ts')
  const [updatedContent, setUpdatedContent] = useState('console.log("updated content")')

  const [busy, setBusy] = useState(false)
  const [logs, setLogs] = useState<LogEntry[]>([])

  const canUseProjectId = useMemo(() => projectId.trim().length > 0, [projectId])
  const canUseFileId = useMemo(() => fileId.trim().length > 0, [fileId])

  const appendLog = (entry: LogEntry) => {
    setLogs((prev) => [entry, ...prev])
  }

  async function callApi(label: string, method: HttpMethod, url: string, body?: unknown) {
    setBusy(true)
    try {
      const response = await fetch(url, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      })

      const contentType = response.headers.get('content-type')
      const parsed = contentType?.includes('application/json')
        ? await response.json()
        : await response.text()

      appendLog({
        time: new Date().toLocaleTimeString(),
        label,
        method,
        url,
        status: response.status,
        ok: response.ok,
        payload: parsed,
      })

      return parsed
    } catch (error) {
      appendLog({
        time: new Date().toLocaleTimeString(),
        label,
        method,
        url,
        error: error instanceof Error ? error.message : 'Unknown error',
      })
      return null
    } finally {
      setBusy(false)
    }
  }

  async function createProject() {
    const result = await callApi('Create Project', 'POST', '/api/projects', {
      name: projectName,
      description: projectDescription,
    })
    if (result && typeof result === 'object' && 'projectId' in result && typeof result.projectId === 'string') {
      setProjectId(result.projectId)
    }
  }

  async function listProjects() {
    await callApi('List Projects', 'GET', '/api/projects')
  }

  async function getProjectById() {
    await callApi('Get Project by ID', 'GET', `/api/projects/${projectId}`)
  }

  async function deleteProjectById() {
    await callApi('Delete Project by ID', 'DELETE', `/api/projects/${projectId}`)
  }

  async function createFile() {
    const result = await callApi('Create File', 'POST', `/api/projects/${projectId}/files`, {
      path: filePath,
      content: fileContent,
    })
    if (result && typeof result === 'object' && 'fileId' in result && typeof result.fileId === 'string') {
      setFileId(result.fileId)
    }
  }

  async function getFileById() {
    await callApi('Get File by ID', 'GET', `/api/projects/${projectId}/files/${fileId}`)
  }

  async function patchFileById() {
    await callApi('Patch File by ID', 'PATCH', `/api/projects/${projectId}/files/${fileId}`, {
      path: updatedPath,
      content: updatedContent,
    })
  }

  async function deleteFileById() {
    await callApi('Delete File by ID', 'DELETE', `/api/projects/${projectId}/files/${fileId}`)
  }

  return (
    <main className="min-h-screen bg-zinc-50 p-6 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <div className="mx-auto grid w-full max-w-7xl gap-6 lg:grid-cols-2">
        <section className="space-y-6 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div>
            <h1 className="text-2xl font-bold">Temporary API Test Harness</h1>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              Use this page to test project/file endpoints with your existing Clerk browser session.
            </p>
            <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
              Note: This is a temporary testing UI. Remove after API validation.
            </p>
          </div>

          <div className="space-y-3">
            <h2 className="text-lg font-semibold">Project Inputs</h2>
            <input
              className="w-full rounded border border-zinc-300 p-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              placeholder="Project name"
            />
            <textarea
              className="w-full rounded border border-zinc-300 p-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
              value={projectDescription}
              onChange={(e) => setProjectDescription(e.target.value)}
              rows={3}
              placeholder="Project description"
            />
            <input
              className="w-full rounded border border-zinc-300 p-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              placeholder="Project ID (auto-filled after create)"
            />

            <div className="flex flex-wrap gap-2">
              <button disabled={busy} onClick={createProject} className="rounded bg-blue-600 px-3 py-2 text-sm text-white disabled:opacity-50">Create Project</button>
              <button disabled={busy} onClick={listProjects} className="rounded bg-zinc-700 px-3 py-2 text-sm text-white disabled:opacity-50">List Projects</button>
              <button disabled={busy || !canUseProjectId} onClick={getProjectById} className="rounded bg-emerald-700 px-3 py-2 text-sm text-white disabled:opacity-50">Get Project</button>
              <button disabled={busy || !canUseProjectId} onClick={deleteProjectById} className="rounded bg-rose-700 px-3 py-2 text-sm text-white disabled:opacity-50">Delete Project</button>
            </div>
          </div>

          <div className="space-y-3 border-t border-zinc-200 pt-4 dark:border-zinc-800">
            <h2 className="text-lg font-semibold">File Inputs</h2>
            <input
              className="w-full rounded border border-zinc-300 p-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
              value={filePath}
              onChange={(e) => setFilePath(e.target.value)}
              placeholder="File path (e.g. src/index.ts)"
            />
            <textarea
              className="w-full rounded border border-zinc-300 p-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
              value={fileContent}
              onChange={(e) => setFileContent(e.target.value)}
              rows={4}
              placeholder="File content"
            />
            <input
              className="w-full rounded border border-zinc-300 p-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
              value={fileId}
              onChange={(e) => setFileId(e.target.value)}
              placeholder="File ID (auto-filled after create)"
            />

            <input
              className="w-full rounded border border-zinc-300 p-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
              value={updatedPath}
              onChange={(e) => setUpdatedPath(e.target.value)}
              placeholder="Updated file path"
            />
            <textarea
              className="w-full rounded border border-zinc-300 p-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
              value={updatedContent}
              onChange={(e) => setUpdatedContent(e.target.value)}
              rows={4}
              placeholder="Updated file content"
            />

            <div className="flex flex-wrap gap-2">
              <button disabled={busy || !canUseProjectId} onClick={createFile} className="rounded bg-blue-600 px-3 py-2 text-sm text-white disabled:opacity-50">Create File</button>
              <button disabled={busy || !canUseProjectId || !canUseFileId} onClick={getFileById} className="rounded bg-emerald-700 px-3 py-2 text-sm text-white disabled:opacity-50">Get File</button>
              <button disabled={busy || !canUseProjectId || !canUseFileId} onClick={patchFileById} className="rounded bg-amber-600 px-3 py-2 text-sm text-white disabled:opacity-50">Patch File</button>
              <button disabled={busy || !canUseProjectId || !canUseFileId} onClick={deleteFileById} className="rounded bg-rose-700 px-3 py-2 text-sm text-white disabled:opacity-50">Delete File</button>
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Response Log</h2>
            <button
              disabled={busy}
              onClick={() => setLogs([])}
              className="rounded border border-zinc-300 px-3 py-1 text-xs dark:border-zinc-700"
            >
              Clear
            </button>
          </div>

          {logs.length === 0 ? (
            <p className="text-sm text-zinc-600 dark:text-zinc-400">No requests yet. Click any action to begin testing.</p>
          ) : (
            <div className="space-y-3">
              {logs.map((log, idx) => (
                <article key={`${log.time}-${idx}`} className="rounded border border-zinc-200 p-3 text-sm dark:border-zinc-800">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <span className="rounded bg-zinc-100 px-2 py-0.5 text-xs dark:bg-zinc-800">{log.time}</span>
                    <span className="font-medium">{log.label}</span>
                    <span className="rounded bg-zinc-100 px-2 py-0.5 text-xs dark:bg-zinc-800">{log.method}</span>
                    <span className="break-all text-xs text-zinc-600 dark:text-zinc-400">{log.url}</span>
                  </div>

                  {typeof log.status === 'number' && (
                    <p className={`mb-2 text-xs ${log.ok ? 'text-emerald-600' : 'text-rose-600'}`}>
                      Status: {log.status} ({log.ok ? 'OK' : 'Error'})
                    </p>
                  )}

                  {log.error ? (
                    <p className="text-rose-600">{log.error}</p>
                  ) : (
                    <pre className="overflow-x-auto rounded bg-zinc-950 p-3 text-xs text-zinc-100">{pretty(log.payload)}</pre>
                  )}
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  )
}

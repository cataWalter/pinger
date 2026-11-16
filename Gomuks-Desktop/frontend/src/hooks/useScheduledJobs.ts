import { useCallback, useState } from 'react'
import { AppService } from '../../bindings/mychat/desktop'
import type { ScheduledJob } from '../../bindings/mychat/desktop/models.js'
import { describeError, localDateTimeInputValue } from '../appShared'

type WorkspaceGenerationRef = { readonly current: number }

export function useScheduledJobs(workspaceGenerationRef: WorkspaceGenerationRef) {
  const [jobs, setJobs] = useState<ScheduledJob[]>([])
  const [open, setOpen] = useState(false)
  const [times, setTimes] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    const generation = workspaceGenerationRef.current
    setLoading(true)
    try {
      const result = await AppService.ScheduledJobs()
      if (workspaceGenerationRef.current !== generation) return
      const nextJobs = result ?? []
      setJobs(nextJobs)
      setTimes(Object.fromEntries(nextJobs.map((job) => [job.id, localDateTimeInputValue(job.dueAt)])))
      setError('')
    } catch (jobsError) {
      if (workspaceGenerationRef.current === generation) setError(describeError(jobsError))
    } finally {
      if (workspaceGenerationRef.current === generation) setLoading(false)
    }
  }, [workspaceGenerationRef])

  const openDialog = useCallback(() => {
    setOpen(true)
    setError('')
    void refresh()
  }, [refresh])

  return { jobs, setJobs, open, setOpen, times, setTimes, loading, error, setError, refresh, openDialog }
}
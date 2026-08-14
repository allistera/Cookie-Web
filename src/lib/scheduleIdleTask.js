export function scheduleIdleTask(task, target = window) {
  if ('requestIdleCallback' in target) {
    target.requestIdleCallback(task, { timeout: 2000 })
    return
  }
  target.setTimeout(task, 0)
}

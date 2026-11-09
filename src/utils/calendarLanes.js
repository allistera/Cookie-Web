// Gives each timed item a lane among the items it overlaps, and the number of
// lanes its group of overlapping items needs, so a view can draw them beside
// each other instead of on top of one another. Items are `{ start, end }` in
// minutes; `lane` and `lanes` are set on them in place, and the items come
// back in start order.
export function assignLanes(items) {
  const sorted = [...items].sort((a, b) => a.start - b.start || b.end - a.end)
  let cluster = []
  let clusterEnd = -1
  const close = () => {
    const lanes = Math.max(1, ...cluster.map((item) => item.lane + 1))
    for (const item of cluster) item.lanes = lanes
    cluster = []
  }
  for (const item of sorted) {
    item.lane = 0
    if (item.start >= clusterEnd) {
      close()
      clusterEnd = -1
    }
    const used = new Set(
      cluster.filter((other) => other.end > item.start).map((other) => other.lane),
    )
    while (used.has(item.lane)) item.lane += 1
    cluster.push(item)
    clusterEnd = Math.max(clusterEnd, item.end)
  }
  close()
  return sorted
}

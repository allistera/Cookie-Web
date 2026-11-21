// Gives each timed item a lane among the items it overlaps, and the number of
// lanes its group of overlapping items needs, so a view can draw them beside
// each other instead of on top of one another. Items are `{ start, end }` in
// minutes; `lane` and `lanes` are set on them in place, and the items come
// back in start order.
export function assignLanes(items) {
  const sorted = [...items].sort((a, b) => a.start - b.start || b.end - a.end)
  let cluster = []
  let laneEnds = []
  let clusterEnd = -1
  const close = () => {
    const lanes = Math.max(1, laneEnds.length)
    for (const item of cluster) item.lanes = lanes
    cluster = []
    laneEnds = []
  }
  for (const item of sorted) {
    if (item.start >= clusterEnd) {
      close()
      clusterEnd = -1
    }
    let lane = 0
    while (lane < laneEnds.length && laneEnds[lane] > item.start) lane += 1
    item.lane = lane
    laneEnds[lane] = item.end
    cluster.push(item)
    clusterEnd = Math.max(clusterEnd, item.end)
  }
  close()
  return sorted
}

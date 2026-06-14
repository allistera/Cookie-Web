export const TODAY = 'Thursday, June 12'

export const FEED = [
  {
    id: 'acme',
    kind: 'reply',
    from: 'Maya Chen',
    org: 'Acme Co',
    source: 'Gmail',
    subject: 'Re: Acme renewal — redlines attached',
    time: '9:41 AM',
    points: [
      'Maya approved the 12-month term, wants the cap raised to $40k.',
      'Legal needs the MSA countersigned by Friday.',
      'She asked for a 30-min call this week to close.',
    ],
    draft:
      "Hi Maya — thanks for the redlines. The $40k cap works on our side, and I'll get the MSA countersigned today so we're clear before Friday. I'll also send over a couple of call times for this week shortly.\n\nBest,\nAllister",
    rules: ['Warm tone', 'Sign as Allister', 'Keep under 80 words'],
  },
  {
    id: 'roadmap',
    kind: 'digest',
    from: 'Q3 Roadmap',
    org: 'Notion',
    source: 'Notion',
    subject: 'Q3 Roadmap — 6 edits since yesterday',
    time: '8:20 AM',
    points: [
      'Onboarding revamp moved from Q4 into Q3.',
      'Mobile calendar sync marked at risk — needs a decision.',
      'Two new hires added to the platform pod.',
      'Launch date holds at Sept 18.',
    ],
  },
  {
    id: 'sam',
    kind: 'event',
    from: 'Sam Okafor',
    org: 'Calendar',
    source: 'Calendar',
    subject: 'Coffee with Sam',
    time: 'Auto-scheduled',
    when: 'Thu · 2:30 PM · 30 min',
    points: [
      "Cookie found a free 30-min slot that fits Sam's availability.",
      'Booked at Verve, 2 blocks from your 3:30 standup.',
    ],
  },
]

export const CALENDAR_EVENTS = [
  { id: 'e1', title: 'Design review', time: '10:00', dur: 60, top: 80, height: 70, tone: 'plain' },
  { id: 'e2', title: 'Focus — Acme MSA', time: '11:30', dur: 90, top: 175, height: 100, tone: 'focus' },
  { id: 'e3', title: 'Coffee with Sam', time: '2:30', dur: 30, top: 355, height: 44, tone: 'auto' },
  { id: 'e4', title: 'Platform standup', time: '3:30', dur: 30, top: 425, height: 44, tone: 'plain' },
]

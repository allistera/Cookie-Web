// Fixture rows in the same shape as GET /api/emails. Served by the local
// Vite middleware in e2e mode (and in dev when DATABASE_URL is unset) so the
// app works without a database. Content mirrors the seed data in Neon.
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

const rows = [
  {
    from_name: 'City Construction',
    from_address: 'updates@cityconstruction.com',
    subject: 'Revised Floor Plan - Natural Light adjustments',
    snippet:
      'Hi Allister, following up on our call yesterday, we modified the bay window design...',
    body_text:
      'Hi Allister, following up on our call yesterday, we modified the bay window design to bring more natural light into the kitchen and breakfast nook.\n\nThe revised floor plan is attached. If the new window placement works for you, we can lock it in with the framing crew this week.',
    ageMs: 0.5 * HOUR,
    is_unread: true,
    is_starred: false,
    // Matches api/_fixtures/messages.js: fixture-1 (index 0) carries an HTML
    // body, so the reader shows a spinner during the on-demand fetch. All other
    // fixture rows are text-only (has_html false) and render instantly.
    has_html: true,
    labels: [{ name: 'Home', color: '#e5484d' }],
  },
  {
    from_name: "Homeowner's Insurance",
    from_address: 'claims@homeownersins.com',
    subject: 'Claim #99281 - Processing Update',
    snippet:
      'We are pleased to inform you that your insurance claim has been processed. You will hear...',
    body_text:
      'We are pleased to inform you that your insurance claim has been processed. You will hear from your adjuster with the final settlement details within one week.\n\nNo further action is required on your part at this time. You can review the status of claim #99281 at any point from your online account.',
    ageMs: 0.9 * HOUR,
    is_unread: true,
    is_starred: true,
    labels: [{ name: 'Finance', color: '#2f9e44' }, { name: 'Home', color: '#e5484d' }],
  },
  {
    from_name: 'Coach Mike',
    from_address: 'mike.torres@leaguemail.com',
    subject: 'Soccer Snacks - June 6th Scrimmage',
    snippet:
      'Hey parents, just a reminder that tomorrow we play the Green Eagles. Allister has snacks...',
    body_text:
      "Hey parents, just a reminder that tomorrow we play the Green Eagles. Allister has snacks this week - we need enough for 20 kids.\n\nPlease remember one of our players has a peanut allergy, so keep everything peanut-free. Log what you're bringing in the team signup sheet so we don't double up.",
    ageMs: 1 * DAY + 2 * HOUR,
    is_unread: true,
    is_starred: false,
    labels: [{ name: 'School', color: '#8e4ec6' }],
  },
  {
    from_name: 'Univ of State Tours',
    from_address: 'tours@univstate.edu',
    subject: 'Confirmation: June 12th guided tour',
    snippet:
      'Thank you for scheduling a campus visit. Please complete the waiver in the link...',
    body_text:
      'Thank you for scheduling a campus visit. Please complete the waiver in the link below before arriving for the June 12th guided tour.\n\nTours depart from the Visitor Center at 10:00 AM sharp. Parking passes will be emailed two days before your visit.',
    ageMs: 1 * DAY + 4 * HOUR,
    is_unread: false,
    is_starred: false,
    labels: [{ name: 'School', color: '#8e4ec6' }],
  },
  {
    from_name: 'Resale Marketplace',
    from_address: 'no-reply@resalemarketplace.com',
    subject: 'Item Sold! Baby winter coat bundle',
    snippet: 'Congratulations, your listing was purchased for $15. Print the label and mail...',
    body_text:
      'Congratulations, your listing was purchased for $15. Print the label and mail the baby winter coat bundle within 3 days to keep your seller rating.\n\nOnce the buyer confirms delivery, the funds will be released to your linked account.',
    ageMs: 3 * DAY + 5 * HOUR,
    is_unread: true,
    is_starred: false,
    labels: [{ name: 'Shopping', color: '#d6409f' }],
  },
  {
    from_name: 'Palm House Hotel',
    from_address: 'reservations@palmhousehotel.com',
    subject: 'Your reservation upgrade is confirmed',
    snippet: 'Dear Allister, we have upgraded your room to Deluxe. Click here to see detail...',
    body_text:
      'Dear Allister, we have upgraded your room to Deluxe. Click here to see the details of your updated reservation.\n\nPlease confirm the upgrade by Tuesday to keep the promotional rate for your Chicago summer trip.',
    ageMs: 4 * DAY + 6 * HOUR,
    is_unread: false,
    is_starred: true,
    labels: [{ name: 'Travel', color: '#2383e2' }],
  },
  {
    from_name: 'Sarah Miller',
    from_address: 'sarah.miller@gmail.com',
    subject: 'RE: Neighborhood Block Party',
    snippet: 'I can bring the paper plates and napkins! Do we need cups too?',
    body_text:
      "I can bring the paper plates and napkins! Do we need cups too?\n\nAlso, my brother has a folding canopy we can borrow if the forecast looks hot. Let me know and I'll grab it Saturday morning.",
    ageMs: 6 * DAY + 7 * HOUR,
    is_unread: false,
    is_starred: false,
    labels: [{ name: 'Home', color: '#e5484d' }],
  },
  {
    from_name: 'Electric Co.',
    from_address: 'billing@electricco.com',
    subject: 'Your May billing statement is ready',
    snippet: 'Account ending in 4991. Total due: $112.40. Auto-pay will process on...',
    body_text:
      'Account ending in 4991. Total due: $112.40. Auto-pay will process on the 15th.\n\nYour usage this month was 8% lower than the same period last year. View the full statement online for a detailed breakdown.',
    ageMs: 8 * DAY + 3 * HOUR,
    is_unread: false,
    is_starred: false,
    labels: [{ name: 'Finance', color: '#2f9e44' }],
  },
  {
    from_name: 'Netflix',
    from_address: 'info@netflix.com',
    subject: 'New Shows for June 2026',
    snippet:
      'Here is your curated list of movies and television series launching this month...',
    body_text:
      "Here is your curated list of movies and television series launching this month.\n\nBased on your watch history, we think you'll enjoy the new season of your saved shows arriving June 14th.",
    ageMs: 9 * DAY + 5 * HOUR,
    is_unread: false,
    is_starred: false,
    labels: [{ name: 'Newsletters', color: '#d9730d' }],
  },
  {
    from_name: 'Lincoln High',
    from_address: 'office@lincolnhigh.edu',
    subject: 'FAFSA Deadlines and College Prep guidance',
    snippet:
      'Parents of juniors, the FAFSA deadline has been shifted. Please review the new calendar...',
    body_text:
      'Parents of juniors, the FAFSA deadline has been shifted. Please review the new calendar on the school portal.\n\nThe counseling office is holding a virtual Q&A session next Thursday evening for any questions about the college prep timeline.',
    ageMs: 11 * DAY + 2 * HOUR,
    is_unread: false,
    is_starred: false,
    labels: [{ name: 'School', color: '#8e4ec6' }],
  },
  {
    from_name: 'Target Shop',
    from_address: 'offers@target.com',
    subject: '20% Off Patio Furniture this weekend only',
    snippet: 'Upgrade your backyard space before summer begins. Exclusions apply...',
    body_text:
      'Upgrade your backyard space before summer begins. Exclusions apply.\n\nThis weekend only, take 20% off patio furniture in store and online. Sale ends Sunday at midnight.',
    ageMs: 12 * DAY + 4 * HOUR,
    is_unread: false,
    is_starred: false,
    labels: [{ name: 'Newsletters', color: '#d9730d' }, { name: 'Shopping', color: '#d6409f' }],
  },
  {
    from_name: 'Lincoln Counselors',
    from_address: 'counselors@lincolnhigh.edu',
    subject: 'Scholarships for the Arts program',
    snippet: "We noticed your daughter's excellent fine arts GPA. She may qualify for...",
    body_text:
      "We noticed your daughter's excellent fine arts GPA. She may qualify for several arts-focused scholarships with spring deadlines.\n\nStop by the counseling office or reply to this email to set up a short meeting to review the application requirements.",
    ageMs: 14 * DAY + 6 * HOUR,
    is_unread: false,
    is_starred: false,
    labels: [{ name: 'School', color: '#8e4ec6' }],
  },
  {
    from_name: 'Resale Marketplace',
    from_address: 'no-reply@resalemarketplace.com',
    subject: 'Inquiry: Toddler shoe lot availability',
    snippet: 'A buyer sent a message: Is the lot of shoes still available for pickup?',
    body_text:
      'A buyer sent a message: Is the lot of shoes still available for pickup?\n\nReply within 48 hours to keep your response rate badge. Quick replies improve your listing placement in search.',
    ageMs: 16 * DAY + 3 * HOUR,
    is_unread: false,
    is_starred: false,
    labels: [{ name: 'Shopping', color: '#d6409f' }],
  },
  {
    from_name: 'Zoom Video',
    from_address: 'billing@zoom.us',
    subject: 'Invoice for subscription renewal',
    snippet: 'Your annual Zoom Pro subscription has renewed. Amount charged: $149.90...',
    body_text:
      'Your annual Zoom Pro subscription has renewed. Amount charged: $149.90.\n\nYour next billing date is May 19, 2027. Manage your subscription or download the invoice from your account page.',
    ageMs: 17 * DAY + 5 * HOUR,
    is_unread: false,
    is_starred: false,
    labels: [{ name: 'Finance', color: '#2f9e44' }],
  },
  {
    // Newsletter with a List-Unsubscribe header — api/_fixtures/messages.js
    // returns parsed unsubscribe info for this row (fixture-15) so the
    // reader's Unsubscribe button is exercisable without a database.
    from_name: 'Daily Bites',
    from_address: 'newsletter@dailybites.example',
    subject: 'Your weeknight dinner plan: 5 quick recipes',
    snippet:
      'This week we are keeping it simple: five dinners you can get on the table in under 30 minutes...',
    body_text:
      'This week we are keeping it simple: five dinners you can get on the table in under 30 minutes.\n\n1. Lemon garlic salmon\n2. Sheet-pan gnocchi\n3. Black bean tacos\n4. Miso noodle soup\n5. Caprese orzo\n\nYou are receiving this because you subscribed to Daily Bites.',
    ageMs: 3 * DAY + 3 * HOUR,
    is_unread: false,
    is_starred: false,
    labels: [],
  },
]

// Outbound copies in the same shape as GET /api/emails?folder=sent. The
// recipients jsonb mirrors what api/send.js stores for real sent mail.
const sentRows = [
  {
    from_name: 'Allister',
    from_address: 'me@allisterantosik.com',
    recipients: {
      to: [{ name: null, address: 'info@citytileandstone.com' }],
      cc: [],
      bcc: [],
    },
    subject: 'Re: Kitchen Renovation - Tile Selection Due',
    snippet:
      'Hi City Tile and Stone, I confirm the selection of the White Subway Tiles for our kitchen...',
    body_text:
      "Hi City Tile and Stone,\n\nI confirm the selection of the White Subway Tiles for our kitchen renovation. Please proceed with the order so we stay aligned with the contractor's installation timeline.\n\nBest,\nAllister",
    ageMs: 2 * HOUR,
    labels: [{ name: 'Home', color: '#e5484d' }],
  },
  {
    from_name: 'Allister',
    from_address: 'me@allisterantosik.com',
    recipients: {
      to: [{ name: null, address: 'mike.torres@leaguemail.com' }],
      cc: [],
      bcc: [],
    },
    subject: 'Re: Soccer Snacks - June 6th Scrimmage',
    snippet:
      "Hi Coach Mike, I've got snacks covered - fruit kabobs and juice boxes, all peanut-free...",
    body_text:
      "Hi Coach Mike,\n\nI've got snacks covered — fruit kabobs and juice boxes, all peanut-free. I've logged it in the signup sheet too.\n\nSee you at the scrimmage,\nAllister",
    ageMs: 1 * DAY + 1 * HOUR,
    labels: [{ name: 'School', color: '#8e4ec6' }],
  },
  {
    from_name: 'Allister',
    from_address: 'me@allisterantosik.com',
    recipients: {
      to: [{ name: null, address: 'sarah.miller@gmail.com' }],
      cc: [],
      bcc: [],
    },
    subject: 'RE: Neighborhood Block Party',
    snippet: 'Plates and napkins would be great, and yes please on the cups!',
    body_text:
      "Plates and napkins would be great, and yes please on the cups!\n\nThe canopy is a good call — forecast says mid-80s. If your brother doesn't mind, let's grab it Saturday morning.",
    ageMs: 6 * DAY + 5 * HOUR,
    labels: [{ name: 'Home', color: '#e5484d' }],
  },
]

export function fixtureEmails() {
  const now = Date.now()
  return rows.map(({ ageMs, ...row }, index) => ({
    id: `fixture-${index + 1}`,
    has_html: false,
    ...row,
    sent_at: new Date(now - ageMs).toISOString(),
  }))
}

export function fixtureSentEmails() {
  const now = Date.now()
  return sentRows.map(({ ageMs, ...row }, index) => ({
    id: `fixture-sent-${index + 1}`,
    has_html: false,
    is_unread: false,
    is_starred: false,
    is_sent: true,
    ...row,
    sent_at: new Date(now - ageMs).toISOString(),
  }))
}

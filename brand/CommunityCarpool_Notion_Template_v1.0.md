# COMMUNITY CARPOOL: NOTION DATABASE STRUCTURE

## Overview
This Notion template serves as your **master control center** for:
- ✅ SEO optimization tasks
- ✅ Marketing campaigns (by channel)
- ✅ Intern assignments & tracking
- ✅ Weekly metrics & analytics
- ✅ Content calendar
- ✅ Backlink outreach

---

## DATABASE STRUCTURE

### **Database 1: Master Task List**

**Name:** Community Carpool - Master Checklist

**Properties:**

| Property Name | Type | Description |
|---------------|------|-------------|
| Task Name | Text | Title of the task |
| Category | Select | SEO, Marketing, Content, Intern, Analytics, Technical |
| Phase | Select | Phase 1 (Week 1-4), Phase 2 (Week 5-12), Phase 3 (Week 13-24) |
| Week # | Number | Week number (1-24) |
| Priority | Select | Critical, High, Medium, Low |
| Status | Select | Not Started, In Progress, Blocked, Complete |
| Owner | Person | Who's responsible (you or intern name) |
| Assigned To Intern | Relation | Link to Interns database |
| Deadline | Date | Due date |
| Time Estimate (hrs) | Number | Hours needed to complete |
| Completion % | Number | 0-100% |
| Notes | Text | Additional details |
| Link | URL | Link to resource (blog post, signup page, etc.) |

**Views:**

1. **By Week** - Grouped by Week #
2. **By Status** - Grouped by Status (Not Started → In Progress → Complete)
3. **By Owner** - Grouped by Owner (You vs. Intern names)
4. **This Week** - Filter: Week # = current week
5. **Calendar View** - By Deadline

---

### **Database 2: SEO Tasks**

**Name:** SEO - Task Breakdown

**Properties:**

| Property Name | Type | Description |
|---------------|------|-------------|
| Task | Text | SEO task (e.g., "Add meta descriptions") |
| Category | Select | Technical, Content, Local, Backlinks, Analytics |
| Phase | Select | Phase 1, 2, 3 |
| Week | Number | Week # |
| Status | Select | Not Started, In Progress, Complete |
| Owner | Person | Assigned to |
| Deadline | Date | Due |
| Priority | Select | Critical, High, Medium |
| Pages Affected | Text | Which pages/URLs |
| Est. Time | Number | Hours |
| Actual Time | Number | Hours spent |
| Completion % | Number | 0-100 |
| Notes | Text | Details |

**Sample Tasks (Pre-populated):**

```
Phase 1 Tasks (Week 1-2):
├─ Set up Google Search Console | Technical | Week 1 | Critical
├─ Set up Google Analytics 4 | Technical | Week 1 | Critical
├─ Add meta descriptions | Technical | Week 1 | High
├─ Add Open Graph tags | Technical | Week 1 | High
├─ Create sitemap.xml | Technical | Week 2 | High
├─ Create robots.txt | Technical | Week 2 | High
├─ Add Schema.org structured data | Technical | Week 2 | Medium
└─ Test mobile usability | Technical | Week 2 | Medium

Phase 2 Tasks (Week 3-8):
├─ Write /bangalore-carpool landing page | Content | Week 3 | High
├─ Write /mumbai-carpool landing page | Content | Week 3 | High
├─ Write /delhi-carpool landing page | Week 4 | High
├─ Write /how-much-can-you-save page | Content | Week 4 | High
├─ Write /carpool-vs-uber-lyft page | Content | Week 4 | High
├─ Blog post: "How Carpooling Saves ₹100k/year" | Content | Week 5 | High
├─ Blog post: "Carpooling Laws in India" | Content | Week 5 | High
├─ Blog post: "Environmental Impact" | Content | Week 6 | Medium
├─ Blog post: "Safety Tips" | Content | Week 6 | Medium
├─ Blog post: "Corporate Programs" | Content | Week 7 | Medium
├─ Internal linking strategy | Technical | Week 7 | Medium
└─ Submit updated sitemap to GSC | Technical | Week 8 | Low
```

---

### **Database 3: Marketing Campaigns**

**Name:** Marketing - Campaigns by Channel

**Properties:**

| Property Name | Type | Description |
|---------------|------|-------------|
| Campaign Name | Text | Channel + city (e.g., "Reddit Bangalore") |
| Channel | Select | Reddit, Slack, Facebook, LinkedIn, Twitter, WhatsApp, Email, Campus |
| City | Select | Bangalore, Mumbai, Delhi, Hyderabad, Chennai, Pune, etc. |
| Phase | Select | Phase 1, 2, 3 |
| Week Launch | Number | Week # campaign starts |
| Status | Select | Planned, Active, Paused, Complete |
| Assigned To | Person | Intern or you |
| Content/Link | URL | Link to Reddit post, blog post, etc. |
| Cadence | Select | 1x/week, 2x/week, 1x/month, ongoing |
| Target Audience | Text | e.g., "Tech commuters", "Parents", "HR leads" |
| Posts/Actions Planned | Number | How many posts planned |
| Posts Published | Number | Actual posts published |
| Signups from Campaign | Number | Tracked via ?source= link |
| Conversion Rate | Formula | Signups / Impressions |
| Cost | Currency | Always $0 for organic |
| Notes | Text | Key messaging, template, etc. |

**Sample Campaigns (Pre-populated):**

```
Phase 2 Campaigns:
├─ Reddit Bangalore | Reddit | Bangalore | Phase 2 | Week 5 | Active
├─ Reddit Mumbai | Reddit | Mumbai | Phase 2 | Week 8 | Active
├─ Reddit Delhi | Reddit | Delhi | Phase 2 | Week 9 | Planned
├─ Slack Communities (20) | Slack | All | Phase 2 | Week 5 | Active
├─ Facebook Groups Bangalore | Facebook | Bangalore | Phase 2 | Week 6 | Active
└─ LinkedIn Organic Posts | LinkedIn | All | Phase 2 | Week 5 | Ongoing

Phase 3 Campaigns:
├─ Campus Recruitment | Campus | All Metros | Phase 3 | Week 17 | Planned
├─ Company Outreach | WhatsApp/Email | All | Phase 2+ | Week 7 | Ongoing
└─ Email Digest | Email | All | Phase 2+ | Week 8 | Planned
```

---

### **Database 4: Interns**

**Name:** Interns - Campus Growth

**Properties:**

| Property Name | Type | Description |
|---------------|------|-------------|
| Intern Name | Text | Full name |
| University | Text | IIT, BITS, college name |
| City | Select | Bangalore, Mumbai, Delhi, etc. |
| Status | Select | Active, Onboarding, Paused, Inactive |
| Role | Select | Campus Ambassador, Community Manager, Content Creator |
| Referral Link | URL | Unique communitycarpool.org?source=intern_[name] |
| Email | Email | Contact info |
| Phone | Phone | Contact info |
| Assigned Channels | Multi-select | Reddit, Slack, Facebook, Campus, etc. |
| Signup Target | Number | Weekly target (e.g., 10 signups/week) |
| Signups This Week | Rollup | Count from Master Task List |
| Total Signups | Rollup | Cumulative signups |
| Leaderboard Rank | Formula | Rank by total signups |
| Match Rate | Number | % of signups that result in matches |
| Incentives Earned | Text | Premium features unlocked, etc. |
| Start Date | Date | When intern onboarded |
| End Date | Date | When intern finished |
| Feedback | Text | Performance notes |
| Active Tasks | Relation | Link to tasks assigned |

**Sample Interns (Template):**

```
Intern 1: [Name] | IIT Bangalore | Bangalore | Active
├─ Referral Link: communitycarpool.org?source=intern_alice_bangalore
├─ Channels: Reddit, Slack, Facebook
├─ Signup Target: 15/week
└─ Actual Signups: 12/week (avg)

Intern 2: [Name] | BITS Mumbai | Mumbai | Onboarding
├─ Referral Link: communitycarpool.org?source=intern_bob_mumbai
├─ Channels: Reddit, Slack
├─ Signup Target: 10/week
└─ Actual Signups: 0 (just starting)
```

---

### **Database 5: Weekly Metrics**

**Name:** Analytics - Weekly Metrics

**Properties:**

| Property Name | Type | Description |
|---------------|------|-------------|
| Week # | Number | Week number (1-24) |
| Date Range | Text | e.g., "Jan 1-7" |
| Total Signups | Number | Total new users this week |
| Signups by Source | Rollup | Count by channel (auto from campaign data) |
| Total Users | Rollup | Cumulative users |
| Active Users | Number | Users who submitted journey |
| Matches Made | Number | Successful matches |
| Match Rate % | Formula | Matches / Active Users |
| Avg Time to Match | Number | Days from signup to first match |
| Share Rate % | Number | % of matches that shared |
| Organic Referrals | Number | Users who came from referral link |
| Top Channel | Formula | Highest signup source |
| Signups by City | Breakdown | Multi-select breakdown |
| Revenue | Currency | Always $0 for organic |
| Key Events | Text | Major milestones (e.g., "First 1,000 users") |
| Challenges | Text | What went wrong this week |
| Next Week Focus | Text | What to prioritize next week |
| Notes | Text | Anything else to track |

**Views:**

1. **Timeline** - Week # on X-axis, Signups on Y-axis
2. **Metric Dashboard** - Key numbers: Total users, Match rate, Share rate
3. **By Source** - Which channels performed best each week

---

### **Database 6: Content Calendar**

**Name:** Content - Blog Posts & Landing Pages

**Properties:**

| Property Name | Type | Description |
|---------------|------|-------------|
| Title | Text | Blog post / page title |
| URL | URL | Link to published content |
| Type | Select | Blog Post, Landing Page, Case Study, Guide |
| Category | Select | Cost Savings, Climate, Safety, Corporate, Local |
| Target Keyword | Text | Main keyword targeting |
| Status | Select | Outline, Draft, In Review, Published, Promoted |
| Owner | Person | Who's writing |
| Published Date | Date | When published |
| Word Count | Number | Target/actual |
| SEO Score | Number | 1-100 (use Surfer/tool) |
| Internal Links | Number | How many links to other pages |
| Backlinks | Number | External sites linking to it |
| Traffic | Number | Organic clicks/month from this post |
| CTA | Text | Call to action in post |
| Phase | Select | Phase 1, 2, 3 |

**Sample Content:**

```
Landing Pages:
├─ /bangalore-carpool | Landing Page | Local | "carpool bangalore" | Phase 2
├─ /mumbai-carpool | Landing Page | Local | "carpool mumbai" | Phase 2
├─ /delhi-carpool | Landing Page | Local | "carpool delhi" | Phase 2
├─ /how-much-can-you-save | Landing Page | Cost Savings | "carpool savings" | Phase 2
└─ /carpool-vs-uber-lyft | Landing Page | Cost Savings | "carpool vs uber" | Phase 2

Blog Posts:
├─ How Carpooling Saves ₹100k/Year | Blog | Cost Savings | "save money carpooling" | Phase 2
├─ Carpooling Laws in India | Blog | Safety | "carpooling laws india" | Phase 2
├─ Environmental Impact of Carpooling | Blog | Climate | "carbon footprint carpooling" | Phase 2
├─ Safety Tips for Carpool Matching | Blog | Safety | "safe carpooling" | Phase 3
└─ Corporate Carpool Programs | Blog | Corporate | "employee carpool program" | Phase 3
```

---

### **Database 7: Backlink Outreach**

**Name:** SEO - Backlink Outreach Tracker

**Properties:**

| Property Name | Type | Description |
|---------------|------|-------------|
| Target Site | Text | Website name (e.g., "YourStory") |
| URL | URL | Link to their site |
| Type | Select | Blog, News, Directory, Startup, Corporate, NGO |
| Contact Name | Text | Editor/contact person |
| Email | Email | outreach@website.com |
| Status | Select | Not Contacted, Email Sent, Replied, In Progress, Link Live, Rejected |
| Message Sent Date | Date | When you reached out |
| Reply Date | Date | When they replied |
| Link URL | URL | The actual backlink on their site |
| Our Page | URL | Which page they linked to |
| Anchor Text | Text | How they linked to us |
| DA (Domain Authority) | Number | Their DA score (from Ahrefs) |
| Traffic Value | Number | Estimated traffic value |
| Follow/Nofollow | Select | Follow, Nofollow |
| Notes | Text | Conversation notes |

**Sample Outreach Targets:**

```
Media/News:
├─ YourStory | youratory.com | Blog | Week 10
├─ Inc42 | inc42.com | News | Week 10
├─ TechCrunch India | techcrunch.com | News | Week 11
├─ FirstPost | firstpost.com | Blog | Week 11
└─ IndiaStack | indiastack.org | Directory | Week 12

Directories:
├─ AngelList | angellist.com | Directory | Week 9
├─ Product Hunt | producthunt.com | Directory | Week 9
└─ Crunchbase | crunchbase.com | Directory | Week 9

Partnerships:
├─ Climate Action NGO | Partner 1 | NGO | Week 15
├─ Sustainability Org | Partner 2 | NGO | Week 15
└─ Environmental Blog | Environmental | Blog | Week 16
```

---

## IMPLEMENTATION GUIDE

### Step 1: Create Notion Workspace
1. Go to notion.so
2. Create new workspace (or use existing)
3. Create 7 databases (or start with 2-3)

### Step 2: Set Up First Database (Master Checklist)
**Minimal setup for week 1:**
- Create "Community Carpool Master Checklist" database
- Add properties: Task Name, Category, Week, Status, Owner, Deadline
- Populate with Phase 1 tasks from this guide
- Create "This Week" filter view

### Step 3: Share with Interns
- Create "Interns" database
- Add intern names + referral links
- Share **read-only** link with each intern
- Share **edit** access to their assigned tasks only

### Step 4: Connect to Analytics
- Weekly: Manual entry of signups + metrics
- Use your built-in site analytics + campaign link tracker
- Plug numbers into "Weekly Metrics" database

### Step 5: Weekly Review Ritual
Every Friday (30 min):
1. Review "This Week" view (Master Checklist)
2. Mark tasks complete
3. Update "Weekly Metrics" database
4. Check leaderboard (top interns)
5. Plan next week tasks

---

## NOTION SHORTCUTS YOU'LL USE

| Action | Shortcut |
|--------|----------|
| Create new task | Cmd+N (Mac) or Ctrl+N (Windows) |
| Mark task complete | Click checkbox |
| Filter by week | Click "This Week" view |
| See top interns | Open "Interns" database, sort by "Total Signups" |
| Check weekly metrics | Open "Analytics - Weekly Metrics" |

---

## SAMPLE NOTION DASHBOARD (Overview Page)

**Create a "Dashboard" page at the top that shows:**

```
🎯 COMMUNITY CARPOOL MASTER DASHBOARD

Week 6 Status (Current Week)

KEY METRICS:
├─ Total Users: 450
├─ This Week Signups: 85
├─ Active Matches: 32
├─ Match Rate: 45%
└─ Share Rate: 35%

PHASE 1 PROGRESS (Week 1-4):
├─ Total Tasks: 15
├─ Completed: 14 ✓
├─ In Progress: 1
└─ Progress: 93%

TOP INTERNS THIS WEEK:
├─ 1. Alice (Bangalore) - 12 signups
├─ 2. Bob (Mumbai) - 8 signups
└─ 3. Carol (Delhi) - 6 signups

CAMPAIGNS ACTIVE:
├─ Reddit Bangalore (15 signups)
├─ Slack Communities (12 signups)
├─ Facebook Groups (8 signups)
└─ LinkedIn (5 signups)

THIS WEEK'S FOCUS:
├─ Launch Phase 2 campaigns
├─ Expand to Mumbai/Delhi Reddit
└─ Onboard 2 new interns

NEXT DEADLINE:
└─ Friday: Publish first blog post on cost savings
```

---

## REVISION NOTES

**Document Version:** 1.0  
**Template Type:** Notion Database Structure  
**Setup Time:** 2-3 hours for full setup, 30 min for MVP (Master Checklist only)

**To implement:**
1. Start with "Master Checklist" + "Weekly Metrics"
2. Add "Interns" when you hire first person
3. Add other databases as you scale

**To update:**
- Add new campaigns as you launch them
- Update weekly metrics every Friday
- Add completed tasks to Master Checklist daily

---

*End of Notion Template*

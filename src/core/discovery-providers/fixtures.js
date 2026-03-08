const FIXTURES = [
  {
    title: 'I hate manually updating our client spreadsheet every week',
    text: 'Every Friday I spend 3 hours copying data from our CRM to a Google Sheet for my manager. There has to be a better way. I tried Zapier but it keeps breaking.',
    sourceType: 'reddit', sourceName: 'r/smallbusiness',
    sourceUrl: 'https://reddit.com/r/smallbusiness/example1',
    author: 'frustrated_admin', score: 145, comments: 32,
    extractedPain: 'manually updating spreadsheets weekly',
    extractedDesire: 'automated CRM to spreadsheet sync',
    extractedUseCase: 'automate CRM data export to Google Sheets'
  },
  {
    title: 'Looking for a tool to automate invoice processing',
    text: 'We receive about 200 invoices/month via email. Currently someone manually enters them into QuickBooks. Looking for something that can OCR the PDFs and auto-create entries.',
    sourceType: 'reddit', sourceName: 'r/Entrepreneur',
    sourceUrl: 'https://reddit.com/r/Entrepreneur/example2',
    author: 'startup_cfo', score: 89, comments: 24,
    extractedPain: 'manual invoice data entry',
    extractedDesire: 'automated invoice OCR and entry',
    extractedUseCase: 'automate invoice processing from email to QuickBooks'
  },
  {
    title: 'Anyone struggling with employee onboarding workflows?',
    text: 'Our HR team uses 5 different tools for onboarding. New hire paperwork, IT provisioning, training assignments - it is all manual and things fall through the cracks constantly.',
    sourceType: 'reddit', sourceName: 'r/SaaS',
    sourceUrl: 'https://reddit.com/r/SaaS/example3',
    author: 'hr_tech_lead', score: 67, comments: 18,
    extractedPain: 'fragmented onboarding across 5 tools',
    extractedDesire: 'unified onboarding workflow',
    extractedUseCase: 'build unified employee onboarding dashboard'
  },
  {
    title: 'Is there a better way to track competitor pricing?',
    text: 'I manually check 15 competitor websites every day to update our pricing intelligence spreadsheet. This is insane. There should be a tool for this.',
    sourceType: 'web', sourceName: 'indiehackers.com',
    sourceUrl: 'https://indiehackers.com/post/competitor-pricing',
    author: 'pricing_analyst', score: 201, comments: 45,
    extractedPain: 'manually checking 15 competitor sites daily',
    extractedDesire: 'automated competitor price tracking',
    extractedUseCase: 'automate competitor pricing monitoring'
  },
  {
    title: 'How do you automate social media reporting?',
    text: 'My agency manages 20+ client accounts. Every month we spend 2 days pulling metrics from each platform and building reports in PowerPoint. Would love to automate this.',
    sourceType: 'x', sourceName: 'X/Twitter',
    sourceUrl: 'https://x.com/agency_marketer/status/123',
    author: '@agency_marketer', score: 34, comments: 12,
    extractedPain: '2 days monthly on manual social media reports',
    extractedDesire: 'automated social media reporting',
    extractedUseCase: 'automate multi-platform social media reporting'
  },
  {
    title: 'Frustrated with project status update meetings',
    text: 'We have 3 standup meetings per day across teams just to get status updates. If there was a dashboard that pulled from Jira, Slack, and GitHub automatically, we could eliminate 80% of these meetings.',
    sourceType: 'reddit', sourceName: 'r/webdev',
    sourceUrl: 'https://reddit.com/r/webdev/example6',
    author: 'dev_lead_tired', score: 312, comments: 87,
    extractedPain: '3 daily standups for status updates',
    extractedDesire: 'automated project status dashboard',
    extractedUseCase: 'build dashboard pulling from Jira, Slack, GitHub'
  },
  {
    title: 'Need help automating data backup verification',
    text: 'We backup 50 databases nightly but have no automated way to verify they completed successfully. Last month we discovered a backup had been failing silently for 2 weeks.',
    sourceType: 'reddit', sourceName: 'r/sysadmin',
    sourceUrl: 'https://reddit.com/r/sysadmin/example7',
    author: 'sysadmin_bob', score: 178, comments: 56,
    extractedPain: 'no automated backup verification',
    extractedDesire: 'automated backup health monitoring',
    extractedUseCase: 'automate database backup verification and alerting'
  },
  {
    title: 'There should be a tool for contract renewal tracking',
    text: 'We manage 300+ vendor contracts and keep missing renewal deadlines. Everything is tracked in a spreadsheet that nobody updates. Auto-reminders from calendar do not work because terms vary.',
    sourceType: 'web', sourceName: 'news.ycombinator.com',
    sourceUrl: 'https://news.ycombinator.com/item?id=example8',
    author: 'procurement_mgr', score: 95, comments: 28,
    extractedPain: 'missing contract renewal deadlines',
    extractedDesire: 'automated contract renewal tracking',
    extractedUseCase: 'build contract renewal tracker with smart reminders'
  },
  {
    title: 'Tedious customer feedback categorization',
    text: 'We get 500+ support tickets daily and manually tag them by category, sentiment, and priority. An AI tool that could auto-categorize and route tickets would save us 2 FTEs.',
    sourceType: 'reddit', sourceName: 'r/microsaas',
    sourceUrl: 'https://reddit.com/r/microsaas/example9',
    author: 'support_lead', score: 156, comments: 41,
    extractedPain: 'manual categorization of 500+ daily tickets',
    extractedDesire: 'AI-powered ticket categorization',
    extractedUseCase: 'automate support ticket categorization and routing'
  },
  {
    title: 'Want to automate weekly client reporting',
    text: 'Every Monday I spend half my day generating reports for 12 clients. Data comes from GA4, ads platforms, and our CRM. I just need something that pulls it all together automatically.',
    sourceType: 'x', sourceName: 'X/Twitter',
    sourceUrl: 'https://x.com/freelance_dev/status/456',
    author: '@freelance_dev', score: 22, comments: 8,
    extractedPain: 'half day weekly on manual client reports',
    extractedDesire: 'automated multi-source client reporting',
    extractedUseCase: 'automate client reporting from GA4, ads, CRM'
  }
];

module.exports = { FIXTURES };

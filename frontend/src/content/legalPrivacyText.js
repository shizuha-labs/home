// Privacy Policy sections — mirror of wiki template 72e80a42 (see legalText.js header).

export const PRIVACY_SECTIONS = [
  {
    id: 'who-we-are',
    heading: '1. Who We Are',
    blocks: [
      { p: 'Shizuha Global Pvt. Ltd ("Shizuha", "we", "us", "our") operates the Shizuha platform and services. This Privacy Policy explains what personal data we collect, why we collect it, how we use and protect it, and your rights. It applies to all users of our Services.' },
    ],
  },
  {
    id: 'data-we-collect',
    heading: '2. Data We Collect',
    blocks: [
      { p: '2.1 Account Data — Name, email address, phone number, organisation name, billing address, and login credentials (hashed). Collected for account management, authentication, and invoicing.' },
      { p: '2.2 Usage Data — Agent interactions, API calls, storage and compute usage, feature usage, session activity. Collected for service delivery, metering, security, and product improvement.' },
      { p: '2.3 Content Data — Your prompts, inputs, outputs, documents, messages, code, Dojo session transcripts, scores, and progress. Collected to provide the core service (running your autonomous org, messaging, AI inference, interview prep).' },
      { p: '2.4 Payment Data — Invoices, payment history, and transaction references (processed via our billing/Books systems). We do not store raw card numbers or CVV.' },
      { p: '2.5 Technical Data — IP address, browser type, device information, and log data. Collected for security, abuse prevention, and service reliability.' },
    ],
  },
  {
    id: 'how-we-use',
    heading: '3. How We Use Your Data',
    blocks: [
      { p: 'We use personal data to:' },
      {
        ul: [
          'Provide, maintain, and improve the Services;',
          'Authenticate users and secure accounts;',
          'Process payments and generate invoices;',
          'Enforce our Terms and prevent abuse, fraud, or illegal activity;',
          'Comply with applicable law and legal obligations;',
          'With your consent, send product communications.',
        ],
      },
      { p: 'We do not sell your personal data.' },
    ],
  },
  {
    id: 'legal-basis',
    heading: '4. Legal Basis (DPDP Act 2023)',
    blocks: [
      { p: 'Under the Digital Personal Data Protection Act, 2023, we process personal data based on:' },
      {
        ul: [
          'Consent — obtained at account creation and for each specific purpose where required; revocable at any time;',
          'Legitimate use — for providing the service you requested, fulfilling legal obligations, and responding to lawful requests.',
        ],
      },
    ],
  },
  {
    id: 'data-location',
    heading: '5. Data Location and Cross-Border Transfer',
    blocks: [
      { p: '5.1 Primary data location: India (our clusters are in India).' },
      { p: '5.2 Inference: Self-hosted models run in India. Where you opt in to external model providers (e.g., third-party AI APIs), your prompts/outputs may be processed by that provider per its disclosed policy. We disclose providers in the model catalog and obtain your consent where required.' },
      { p: '5.3 We do not transfer tenant data outside India by default.' },
    ],
  },
  {
    id: 'sub-processors',
    heading: '6. Sub-Processors',
    blocks: [
      {
        table: {
          head: ['Sub-Processor', 'Service', 'Data', 'Location'],
          rows: [
            ['Shizuha Cortex (self-hosted)', 'AI inference', 'Prompts, outputs', 'India'],
            ['External model APIs (opt-in)', 'AI inference', 'Prompts, outputs', 'Per provider (disclosed)'],
            ['Cloudflare', 'CDN, DNS, DDoS protection', 'IP, request metadata', 'Global edge'],
            ['Payment gateway', 'Payment processing', 'Payment data', 'India'],
          ],
        },
      },
      { p: 'We require sub-processors to process data only for the purposes we specify and to protect it appropriately.' },
    ],
  },
  {
    id: 'retention',
    heading: '7. Data Retention',
    blocks: [
      {
        table: {
          head: ['Data Type', 'Retention'],
          rows: [
            ['Account data', 'Duration of account + 90 days'],
            ['Content data (incl. Dojo transcripts)', 'Duration of account + 90 days, or on your request'],
            ['Usage logs (anonymised)', 'Up to 24 months'],
            ['Payment records', 'As required by law (e.g., 8 years for statutory records)'],
            ['Backup data', 'Per backup rotation'],
          ],
        },
      },
      { p: 'We retain personal data only as long as necessary for the purposes in this Policy or as required by law.' },
    ],
  },
  {
    id: 'your-rights',
    heading: '8. Your Rights (Data Principal Rights)',
    blocks: [
      { p: 'Under the DPDP Act 2023 and applicable law, you have the right to:' },
      {
        ul: [
          'Access your personal data;',
          'Correct inaccurate personal data;',
          'Erase your personal data (subject to legal retention);',
          'Withdraw consent for processing based on consent;',
          'Grievance redressal — contact our Grievance Officer.',
        ],
      },
      { p: 'To exercise these rights, contact us at privacy@shizuha.com or grievance@shizuha.com.' },
    ],
  },
  {
    id: 'dojo-privacy',
    heading: '9. Dojo-Specific Privacy',
    blocks: [
      { p: '9.1 Your data is yours. Dojo coaching data (session transcripts, scores, progress, and prep content) belongs to you by default.' },
      { p: '9.2 No recruiter exposure without consent. We do not expose your individual prep scores, transcripts, or progress to recruiters, companies, or employers without your explicit consent.' },
      { p: '9.3 Aggregate signals only. Where recruiter-facing signals are provided in later phases, they are aggregated or user-controlled — never individual scores without consent.' },
      { p: '9.4 AI feedback is coaching. Dojo AI-generated feedback is labeled as coaching, not a hiring decision, and is not shared as an employment assessment.' },
      { p: '9.5 Transcript retention. Session transcripts are retained only as needed for your progress and product quality, per §7.' },
    ],
  },
  {
    id: 'connect-privacy',
    heading: '10. Connect/Chat-Specific Privacy',
    blocks: [
      { p: '10.1 Messages and conversations are private to the participants. We process them to deliver the service.' },
      { p: '10.2 We provide blocking and abuse controls. Reported abuse is handled per our abuse policy.' },
      { p: '10.3 We do not use message content for advertising.' },
    ],
  },
  {
    id: 'security',
    heading: '11. Security',
    blocks: [
      { p: 'We implement reasonable technical and organisational measures to protect personal data, including:' },
      {
        ul: [
          'Encryption in transit (TLS 1.3) and at rest (AES-256);',
          'Access controls and role-based permissions;',
          'Audit logging;',
          'Incident response procedures.',
        ],
      },
    ],
  },
  {
    id: 'breach',
    heading: '12. Data Breach Notification',
    blocks: [
      { p: 'In the event of a personal data breach, we will notify the Data Protection Board of India and affected data principals as required by the DPDP Act 2023 and applicable rules.' },
    ],
  },
  {
    id: 'children',
    heading: "13. Children's Privacy",
    blocks: [
      { p: 'Our Services are not directed to children under 13. If we learn we have collected personal data from a child under 13 without consent, we will delete it.' },
    ],
  },
  {
    id: 'grievance-contact',
    heading: '14. Grievance Officer and Contact',
    blocks: [
      { p: 'Grievance Officer: grievance@shizuha.com (appointed under IT Rules 2021). We respond within the timelines prescribed by law.' },
      { p: 'Data Protection Officer: dpo@shizuha.com' },
      { p: 'Privacy inquiries: privacy@shizuha.com' },
    ],
  },
  {
    id: 'changes',
    heading: '15. Changes to This Policy',
    blocks: [
      { p: 'We may update this Privacy Policy from time to time. Material changes will be notified via the Services or email. Continued use of the Services after changes take effect constitutes acceptance.' },
    ],
  },
  {
    id: 'contact',
    heading: '16. Contact',
    blocks: [
      { p: 'Shizuha Global Pvt. Ltd, [registered address], India. Email: privacy@shizuha.com.' },
    ],
  },
]

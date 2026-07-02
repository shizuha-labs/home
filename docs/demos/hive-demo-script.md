# HIVE 2-minute demo script (VEN-54)

Task: show HIVE executing one real end-to-end research workflow for an early-access visitor.

## Flow and timing

1. **Open (0:00-0:10)** — Start on `https://shizuha.com/hive`, frame HIVE as an autonomous AI workplace.
2. **Task prompt (0:10-0:30)** — Enter: “Research India-ready payment rails for a SaaS waitlist launch, compare Razorpay, Cashfree, and Stripe India, then save a concise recommendation to Drive.”
3. **Agent execution (0:30-1:05)** — Show HIVE browsing sources, checking docs, and writing status updates while it works.
4. **Result (1:05-1:30)** — Show the structured recommendation: shortlisted provider, trade-offs, compliance notes, and next action.
5. **Follow-up (1:30-1:50)** — Ask a natural follow-up and show HIVE preserving context.
6. **Close (1:50-2:00)** — Return to the CTA: “Join the early-access waitlist.”

## Production notes

- Keep the demo truthful: one user prompt, one agent run, one delivered artifact.
- Avoid printing private credentials, account emails, internal URLs, or non-public customer data.
- The committed fallback MP4 at `/demo/hive-demo.mp4` is a product-safe launch asset that communicates this exact flow without exposing a live internal account.
- Replace it with a Loom or live capture later by updating `HIVE_DEMO_VIDEO` in `frontend/src/components/HiveDemo.jsx`.

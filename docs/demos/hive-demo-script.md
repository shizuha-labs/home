# HIVE 2-minute demo script (VEN-54)

Task: show HIVE executing one real end-to-end task for an early-access visitor. The committed MP4 records an actual HIVE engineering-agent run from July 2, 2026: the agent researches the Forgejo PR API, updates Pulse linked-PR status sync for Origin, runs the targeted Django regression test, opens PR #252, and links the result back to ORIG-15.

## Flow and timing

1. **Open (0:00-0:10)** — Show HIVE/Sara receiving the Pulse assignment for ORIG-15: migrate linked-PR status sync to Origin/Forgejo.
2. **Task context (0:10-0:30)** — Show the agent reading the task, checking prior notes, and identifying the Forgejo API/Pulse sync surface.
3. **Implementation (0:30-1:05)** — Show the code patch adding Origin/Forgejo PR API handling while preserving existing GitHub sync behavior.
4. **Verification (1:05-1:30)** — Show the targeted Django regression test passing against a local Postgres-backed run.
5. **Delivery (1:30-1:50)** — Show PR #252 opened and linked back to ORIG-15 for the review handoff.
6. **Close (1:50-2:00)** — Return to the CTA: “Join the early-access waitlist.”

## Production notes

- Keep the demo truthful: one task, one agent run, one delivered artifact.
- Avoid printing private credentials, account emails, internal tokens, or non-public customer data.
- The committed MP4 at `/demo/hive-demo.mp4` is the launch demo asset; it uses the real ORIG-15/PR #252 transcript with sensitive values omitted.
- Replace it with a narrated Loom/live capture later by updating `HIVE_DEMO_VIDEO` in `frontend/src/components/HiveDemo.jsx`.

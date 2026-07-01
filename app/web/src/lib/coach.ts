// The coaching brain: pure functions over engine analysis. No I/O, no React.
//
// The actual logic now lives in app/shared/coachcore.mjs — the ONE source of truth
// shared with the server's batch analysis worker (docs/16 §5.3). This file re-exports
// it so the live coach (the regression test) and the trainer provably run identical
// math. Behavior is unchanged from the in-file implementation it replaced.
export * from "../../../shared/coachcore.mjs";

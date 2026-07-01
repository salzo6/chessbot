// The Train page — "Dojo" (docs/16 §8). A new top-level surface: the memory and curriculum
// that turns Vesper from a place you play into a place you improve. Purely additive; nothing
// here touches Play/Arena/Leaderboard/Library. Phased: Dashboard + Socratic Review (T1),
// Drilling + SR (T2), motif siblings (T3).
import { useState } from "react";
import { PageHeader } from "../components/ui";
import Dashboard from "../components/train/Dashboard";
import ReviewBoard from "../components/train/ReviewBoard";
import DrillBoard from "../components/train/DrillBoard";

type View =
  | { mode: "dashboard" }
  | { mode: "review"; gameId: string; ply?: number }
  | { mode: "drill" };

export default function Train() {
  const [view, setView] = useState<View>({ mode: "dashboard" });

  return (
    <div>
      <PageHeader
        eyebrow="Train · your personal dojo"
        title={view.mode === "review" ? "Game review" : view.mode === "drill" ? "Drills" : "Dojo"}
        desc={
          view.mode === "review"
            ? "Step through your game. At each of your mistakes, find the better move before the engine reveals it — that's where the learning is."
            : view.mode === "drill"
            ? "Spaced-repetition drills built from the mistakes you actually make. Find the move the engine would play."
            : "Your saved games, mined for the patterns you actually get wrong — and drilled until they stop."
        }
      />

      {view.mode === "dashboard" && (
        <Dashboard
          onReview={(gameId, ply) => setView({ mode: "review", gameId, ply })}
          onDrills={() => setView({ mode: "drill" })}
        />
      )}
      {view.mode === "review" && (
        <ReviewBoard gameId={view.gameId} initialPly={view.ply} onBack={() => setView({ mode: "dashboard" })} />
      )}
      {view.mode === "drill" && <DrillBoard onBack={() => setView({ mode: "dashboard" })} />}
    </div>
  );
}

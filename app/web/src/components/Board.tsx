import { useEffect, useLayoutEffect, useRef } from "react";
import { Chessground } from "chessground";
import type { Api } from "chessground/api";
import type { Config } from "chessground/config";
import type { Key } from "chessground/types";

export interface BoardProps {
  fen: string;
  orientation?: "white" | "black";
  turnColor?: "white" | "black";
  lastMove?: [string, string];
  check?: boolean;
  viewOnly?: boolean;
  dests?: Map<string, string[]>;
  movableColor?: "white" | "black" | "both";
  onMove?: (from: string, to: string) => void;
}

export default function Board({
  fen,
  orientation = "white",
  turnColor,
  lastMove,
  check,
  viewOnly,
  dests,
  movableColor,
  onMove,
}: BoardProps) {
  const ref = useRef<HTMLDivElement>(null);
  const api = useRef<Api | null>(null);
  // Keep the move callback current — the chessground instance is created once,
  // so its `after` handler must read the latest onMove (not a stale closure).
  const onMoveRef = useRef(onMove);
  useLayoutEffect(() => { onMoveRef.current = onMove; }, [onMove]);

  useEffect(() => {
    if (!ref.current) return;
    const config: Config = {
      fen,
      orientation,
      coordinates: true,
      viewOnly,
      animation: { enabled: true, duration: 220 },
      highlight: { lastMove: true, check: true },
      movable: {
        free: false,
        color: movableColor,
        showDests: true,
        dests: dests as unknown as Map<Key, Key[]>,
        events: {
          after: (from, to) => onMoveRef.current?.(from, to),
        },
      },
      draggable: { showGhost: true },
    };
    api.current = Chessground(ref.current, config);
    return () => api.current?.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    api.current?.set({
      fen,
      orientation,
      turnColor,
      check,
      lastMove: lastMove as Key[] | undefined,
      viewOnly,
      movable: {
        color: movableColor,
        dests: dests as unknown as Map<Key, Key[]>,
      },
    });
  }, [fen, orientation, turnColor, check, lastMove, viewOnly, movableColor, dests]);

  return <div ref={ref} className="cg-wrap" />;
}

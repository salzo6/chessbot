#!/usr/bin/env node
// Vesper — a from-scratch UCI chess engine.
//   0x88 board · PVS alpha-beta · transposition table · quiescence ·
//   null-move · LMR · tapered hand-crafted eval.
// This file is the UCI front-end; the engine lives in board/eval/search.mjs.

import { createInterface } from "node:readline";
import { Board, STARTPOS } from "./board.mjs";
import { Searcher } from "./search.mjs";

const NAME = "Vesper";
const VERSION = "1.0";
const AUTHOR = "Vesper project (chessbot)";

let board = new Board();
let ttBits = 22;                       // ~4M entries (~64 MB)
let searcher = new Searcher(board, ttBits);

function out(s) { process.stdout.write(s + "\n"); }

function printInfo(info) {
  let s = `info depth ${info.depth}`;
  if (info.mate != null) s += ` score mate ${info.mate}`;
  else s += ` score cp ${info.score}`;
  s += ` nodes ${info.nodes} nps ${info.nps} time ${info.time}`;
  if (info.pv && info.pv.length) s += ` pv ${info.pv.join(" ")}`;
  out(s);
}
searcher.onInfo = printInfo;

function setPosition(tokens) {
  let i = 1;
  if (tokens[i] === "startpos") {
    board.setFen(STARTPOS);
    i++;
  } else if (tokens[i] === "fen") {
    const fen = tokens.slice(i + 1, i + 7).join(" ");
    board.setFen(fen);
    i += 7;
  }
  if (tokens[i] === "moves") {
    for (let j = i + 1; j < tokens.length; j++) {
      const m = board.findMove(tokens[j]);
      if (!m) break;
      board.makeMove(m);
    }
  }
}

function parseGo(tokens) {
  const limits = {};
  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === "movetime") limits.movetime = +tokens[++i];
    else if (t === "depth") limits.depth = +tokens[++i];
    else if (t === "nodes") limits.nodes = +tokens[++i];
    else if (t === "wtime") limits.wtime = +tokens[++i];
    else if (t === "btime") limits.btime = +tokens[++i];
    else if (t === "winc") limits.winc = +tokens[++i];
    else if (t === "binc") limits.binc = +tokens[++i];
    else if (t === "movestogo") limits.movestogo = +tokens[++i];
    else if (t === "infinite") limits.infinite = true;
  }
  return limits;
}

function doGo(tokens) {
  const limits = parseGo(tokens);
  const res = searcher.search(limits);
  out(`bestmove ${res.bestMove}`);
}

function handle(line) {
  const tokens = line.trim().split(/\s+/);
  switch (tokens[0]) {
    case "uci":
      out(`id name ${NAME} ${VERSION}`);
      out(`id author ${AUTHOR}`);
      out("option name Hash type spin default 64 min 1 max 1024");
      out("option name Clear Hash type button");
      out("uciok");
      break;
    case "isready":
      out("readyok");
      break;
    case "ucinewgame":
      searcher.clearHash();
      break;
    case "setoption": {
      // setoption name <Name> [value <V>]
      const nameIdx = tokens.indexOf("name");
      const valIdx = tokens.indexOf("value");
      const name = nameIdx >= 0 ? tokens.slice(nameIdx + 1, valIdx >= 0 ? valIdx : undefined).join(" ") : "";
      const value = valIdx >= 0 ? tokens.slice(valIdx + 1).join(" ") : "";
      if (name === "Hash") {
        const mb = Math.max(1, Math.min(1024, +value || 64));
        let bits = Math.floor(Math.log2((mb * 1024 * 1024) / 16));
        bits = Math.max(16, Math.min(24, bits));
        if (bits !== ttBits) {
          ttBits = bits;
          searcher = new Searcher(board, ttBits);
          searcher.onInfo = printInfo;
        }
      } else if (name === "Clear Hash") {
        searcher.clearHash();
      }
      break;
    }
    case "position":
      setPosition(tokens);
      break;
    case "go":
      doGo(tokens);
      break;
    case "stop":
      searcher.stop = true;
      break;
    case "ponderhit":
      break;
    case "quit":
      process.exit(0);
      break;
    case "d": // debug helper: print board FEN
      out(board.getFen());
      break;
    default:
      break;
  }
}

const rl = createInterface({ input: process.stdin, terminal: false });
rl.on("line", handle);
rl.on("close", () => process.exit(0));

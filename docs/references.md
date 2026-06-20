# References

Consolidated primary sources behind the research foundation. Grouped by topic. All URLs were live and cited by the research agents (June 2026); engine data drifts, so re-verify load-bearing numbers against the live source.

## Encyclopedic / community hubs
- **Chess Programming Wiki** — https://www.chessprogramming.org (the field's encyclopedia; ~4,200 articles)
- **TalkChess / Computer Chess Club** — https://talkchess.com
- **Engine Programming Discord** (real-time hub for non-Stockfish authors; hosts `#bullet`)
- **EngineProgramming engine list** — https://github.com/EngineProgramming/engine-list

## Stockfish
- Source — https://github.com/official-stockfish/Stockfish (GPL-3.0); networks — https://github.com/official-stockfish/networks; trainer — https://github.com/official-stockfish/nnue-pytorch
- SF18 blog — https://stockfishchess.org/blog/2026/stockfish-18/ ; NNUE intro — https://stockfishchess.org/blog/2020/introducing-nnue-evaluation/ ; SF14 (Lc0 data) — https://stockfishchess.org/blog/2021/stockfish-14/
- Docs (UCI, Useful-data, Advanced-topics, Compiling) — https://official-stockfish.github.io/docs/stockfish-wiki/
- NNUE arch reference (nnue-pytorch docs) — https://github.com/official-stockfish/nnue-pytorch/blob/master/docs/nnue.md
- Fishtest math — https://official-stockfish.github.io/docs/fishtest-wiki/Fishtest-Mathematics.html
- VNNI 256 vs 512 throughput — https://github.com/official-stockfish/Stockfish/pull/3038 ; SFNNv9 L1=3072 — https://github.com/official-stockfish/Stockfish/pull/5149

## Neural / RL engines
- AlphaZero — https://arxiv.org/abs/1712.01815 ; DeepMind blog — https://deepmind.google/blog/alphazero-shedding-new-light-on-chess-shogi-and-go/ ; pseudocode — https://gist.github.com/erenon/cb42f6656e5e04e854e6f44a7ac54023
- Leela — https://github.com/LeelaChessZero/lc0 ; training — https://github.com/LeelaChessZero/lczero-training ; transformer progress — https://lczero.org/blog/2024/02/transformer-progress/ ; technical explanation — https://github.com/LeelaChessZero/lc0/wiki/Technical-Explanation-of-Leela-Chess-Zero
- TCEC — https://en.wikipedia.org/wiki/Top_Chess_Engine_Championship ; S28 — https://www.chessdom.com/stockfish-dominates-tcec-superfinal-wins-the-title-for-the-18th-time/
- MuZero — https://arxiv.org/abs/1911.08265 ; EfficientZero — https://arxiv.org/abs/2111.00210 ; Gumbel — https://openreview.net/forum?id=bERaNdoegnO ; MiniZero — https://arxiv.org/pdf/2310.11305
- KataGo — https://arxiv.org/abs/1902.10565 ; https://github.com/lightvector/KataGo (+ docs/KataGoMethods.md)
- Maia — https://github.com/CSSLab/maia-chess ; KDD 2020 paper — https://www.cs.toronto.edu/~ashton/pubs/maia-kdd2020.pdf
- MCTS frameworks — mctx https://github.com/google-deepmind/mctx ; pgx https://github.com/sotetsuk/pgx ; LightZero https://github.com/opendilab/LightZero ; alpha-zero-general https://github.com/suragnair/alpha-zero-general

## Frontier / novel approaches
- Searchless chess — https://arxiv.org/abs/2402.04494 ; code https://github.com/google-deepmind/searchless_chess ; NeurIPS https://openreview.net/forum?id=XlpipUGygX
- Dual-capability bottleneck — https://arxiv.org/abs/2603.29761 ; OOD compositionality — https://arxiv.org/abs/2510.20783
- Chessformer (ICLR 2026) — https://arxiv.org/html/2605.19091v1 ; https://openreview.net/forum?id=2ltBRzEHyd
- Learned look-ahead — https://arxiv.org/abs/2406.00877 ; follow-ups https://arxiv.org/abs/2505.21552 , https://arxiv.org/abs/2508.21380 ; "Transformers Struggle to Learn to Search" — https://arxiv.org/abs/2412.04703
- Searchformer — https://arxiv.org/abs/2402.14083 ; Dualformer — https://arxiv.org/abs/2410.09918
- DeepMind internal/external planning LMs — https://arxiv.org/abs/2412.12119
- Search-contempt — https://arxiv.org/abs/2504.07757 ; DiffuSearch — https://arxiv.org/abs/2502.19805 (code https://github.com/HKUNLP/DiffuSearch)
- Engine paradigms comparison (Maharaj et al. — a Stockfish-vs-Leela study, not a general survey) — https://arxiv.org/abs/2109.11602 ; lc0-stockfish-hybrid — https://github.com/weepingwillowben/lc0-stockfish-hybrid
- The Bitter Lesson — http://www.incompleteideas.net/IncIdeas/BitterLesson.html

## NNUE / training
- bullet (Rust trainer) — https://github.com/jw1912/bullet ; hobbyist end-to-end — https://slama.dev/prokopakop/nnues-and-where-to-find-them/
- NNUE measured per-tweak Elo — https://asteri.sm/files/2024-07-15-nnue-research-02.html ; training data scale — https://robotmoon.com/nnue-training-data/
- PyTorch MPS (Mac training) — https://pytorch.org/blog/introducing-accelerated-pytorch-training-on-mac/

## Engine engineering
- CPW: Bitboards, Magic Bitboards, Looking for Magics, Transposition Table, Zobrist Hashing, Perft, Perft Results (all under chessprogramming.org)
- Legal movegen — https://peterellisjones.com/posts/generating-legal-chess-moves-efficiently/ ; magic bitboards — https://analog-hors.github.io/site/magic-bitboards/
- Learning engines — Rustic https://rustic-chess.org , akimbo https://github.com/jw1912/akimbo , Viridithas https://github.com/cosmobobak/viridithas , VICE https://github.com/bluefeversoft/vice , BBC https://github.com/maksimKorzh/bbc , Sunfish https://github.com/thomasahle/sunfish

## Testing & infrastructure
- UCI spec — https://backscattering.de/chess/uci/
- fastchess — https://github.com/Disservin/fastchess ; cutechess — https://github.com/cutechess/cutechess ; c-chess-cli — https://github.com/lucasart/c-chess-cli
- Ordo — https://github.com/michiguel/Ordo ; Bayeselo — https://www.remi-coulom.fr/Bayesian-Elo/ ; OpenBench — https://github.com/AndyGrant/OpenBench
- Opening books for testing — https://github.com/official-stockfish/books ; UHO — https://www.sp-cc.de/
- python-chess — https://python-chess.readthedocs.io/
- Rating lists — CCRL https://ccrl.chessdom.com ; CEGT http://www.cegt.net ; SP-CC https://www.sp-cc.de

## Theory / limits
- Shannon number — https://en.wikipedia.org/wiki/Shannon_number ; legal-position count — https://github.com/tromp/ChessPositionRanking , https://tromp.github.io/chess/chess.html
- Solving chess — https://en.wikipedia.org/wiki/Solving_chess ; checkers solved (Science 2007) — https://www.science.org/doi/10.1126/science.1144079
- Lloyd, computational capacity of the universe — https://arxiv.org/abs/quant-ph/0110141 ; Grover's algorithm — https://en.wikipedia.org/wiki/Grover%27s_algorithm
- Endgame tablebases — https://www.chessprogramming.org/Syzygy_Bases ; 8-piece progress — https://lichess.org/@/Lichess/blog/op1-partial-8-piece-tablebase-available/1ptPBDpC ; Fathom — https://github.com/jdart1/Fathom

## Supporting systems
- Polyglot book format — http://hgm.nubati.net/book_format.html ; polyglot tool — https://github.com/ddugovic/polyglot ; Brainfish/Cerebellum — https://zipproth.de/
- Lichess tablebase API — https://tablebase.lichess.ovh/ ; lichess-bot — https://github.com/lichess-bot-devs/lichess-bot

## Apple Silicon
- Stockfish Useful-data (thread/hash/depth Elo) — https://official-stockfish.github.io/docs/stockfish-wiki/Useful-data.html
- Lc0 Metal backend — https://lczero.org/blog/2022/12/lc0-release-v0.29.0/ ; Apple Neural Engine reference — https://github.com/hollance/neural-engine ; MLX — https://github.com/ml-explore/mlx
- Cloud GPU pricing — https://www.spheron.network/blog/gpu-cloud-pricing-comparison-2026/

---

*Note: a few 2026-dated arXiv IDs in the frontier section (2603.x, 2605.x, 2604.x) are very recent and lightly reviewed — treat as directional. Several Elo figures throughout come from test-operator forum data (Pohl, Strangmüller, CCRL/CEGT snapshots), reliable in ordering but approximate in exact value.*

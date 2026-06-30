import { Routes, Route } from "react-router-dom";
import Layout from "./components/Layout";
import Dashboard from "./pages/Dashboard";
import Play from "./pages/Play";
import Arena from "./pages/Arena";
import Leaderboard from "./pages/Leaderboard";
import Bots from "./pages/Bots";

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/play" element={<Play />} />
        <Route path="/arena" element={<Arena />} />
        <Route path="/leaderboard" element={<Leaderboard />} />
        <Route path="/bots" element={<Bots />} />
      </Routes>
    </Layout>
  );
}

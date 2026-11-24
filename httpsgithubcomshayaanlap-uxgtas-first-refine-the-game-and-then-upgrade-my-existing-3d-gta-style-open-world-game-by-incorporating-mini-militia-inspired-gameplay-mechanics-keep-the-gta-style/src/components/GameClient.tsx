"use client";

import dynamic from "next/dynamic";

const GameApp = dynamic(() => import("./GameApp"), {
  ssr: false,
  loading: () => (
    <div className="fixed inset-0 flex items-center justify-center bg-black text-white/70 tracking-widest text-sm">
      LOADING…
    </div>
  ),
});

export default function GameClient() {
  return <GameApp />;
}

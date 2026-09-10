'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

export default function Home() {
  const [roomName, setRoomName] = useState('');
  const [nick, setNick] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleCreate = async () => {
    setLoading(true);
    const roomId = 'BET-' + Math.random().toString(36).slice(2, 7).toUpperCase();
    const finalNick = nick.trim() || 'Capitano';
    localStorage.setItem('bs_nick', finalNick);

    const { error } = await supabase.from('rooms').insert({
      id: roomId,
      name: roomName.trim() || `Schedina #${roomId}`,
      host_id: finalNick,
    });

    if (!error) {
      router.push(`/room/${roomId}`);
    } else {
      alert('Errore creazione stanza: ' + error.message);
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#090d14] text-slate-100 flex flex-col items-center justify-center p-4">
      <div className="max-w-md w-full bg-[#151f30] border border-slate-800 rounded-2xl p-6 shadow-2xl">
        <h1 className="text-2xl font-black text-center mb-1">
          ⚽ Bet<span className="text-[#00e676]">Squad</span>
        </h1>
        <p className="text-xs text-slate-400 text-center mb-6">La schedina collaborativa tra amici in tempo reale</p>

        <div className="space-y-4">
          <div>
            <label className="text-xs font-semibold text-slate-400">Il tuo Nickname</label>
            <input
              type="text"
              placeholder="Es. Capitano"
              className="w-full bg-[#0f1724] border border-slate-800 rounded-xl p-3 text-sm mt-1 focus:border-[#00e676] outline-none"
              value={nick}
              onChange={(e) => setNick(e.target.value)}
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-400">Nome Stanza (Opzionale)</label>
            <input
              type="text"
              placeholder="Es. Serie A Weekend"
              className="w-full bg-[#0f1724] border border-slate-800 rounded-xl p-3 text-sm mt-1 focus:border-[#00e676] outline-none"
              value={roomName}
              onChange={(e) => setRoomName(e.target.value)}
            />
          </div>
          <button
            onClick={handleCreate}
            disabled={loading}
            className="w-full bg-gradient-to-r from-[#00e676] to-[#00b85c] text-[#04220f] font-bold p-3 rounded-xl hover:opacity-95 transition disabled:opacity-50"
          >
            {loading ? 'Creazione...' : 'Crea Stanza Schedina 🚀'}
          </button>
        </div>
      </div>
    </div>
  );
}